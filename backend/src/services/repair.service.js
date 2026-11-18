'use strict';

const { exec, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { formatLocalDateTime } = require('../utils/local-date');

const execAsync = promisify(exec);

function runPs(script, timeout = 60000) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return execAsync(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, {
    timeout,
    maxBuffer: 1024 * 1024 * 10
  });
}

function decodeWinOutput(bufOrStr) {
  if (!bufOrStr) return '';
  if (typeof bufOrStr === 'string') return bufOrStr.replace(/\0/g, '').trim();
  let zeroCount = 0;
  const sampleLen = Math.min(bufOrStr.length, 200);
  for (let i = 0; i < sampleLen; i++) {
    if (bufOrStr[i] === 0) zeroCount++;
  }
  if (zeroCount > sampleLen * 0.2) {
    return bufOrStr.toString('utf16le').replace(/^\uFEFF/, '').replace(/\0/g, '').trim();
  }
  return bufOrStr.toString('utf8').replace(/\0/g, '').trim();
}

function spawnWithProgress(exe, args, onProgress, label) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(exe, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    const outChunks = [];
    const errChunks = [];
    let lastPct = 0;

    const handleChunk = (chunk, isErr = false) => {
      if (isErr) errChunks.push(chunk);
      else outChunks.push(chunk);

      const text = decodeWinOutput(chunk);
      if (!text) return;
      const pctMatch = text.match(/(\d+(?:[.,]\d+)?)\s*%/);
      if (pctMatch) {
        const pct = Math.min(99, Math.round(parseFloat(pctMatch[1].replace(',', '.'))));
        if (pct >= lastPct) {
          lastPct = pct;
          if (typeof onProgress === 'function') {
            onProgress({ progress: pct, message: `${label}: ${pct}% concluído...` });
          }
        }
      }
    };

    child.stdout.on('data', (c) => handleChunk(c, false));
    child.stderr.on('data', (c) => handleChunk(c, true));

    child.on('error', (err) => {
      resolve({
        code: -1,
        stdout: decodeWinOutput(Buffer.concat(outChunks)),
        stderr: err.message,
        durationSeconds: (Date.now() - start) / 1000
      });
    });

    child.on('close', (code) => {
      resolve({
        code: code ?? 0,
        stdout: decodeWinOutput(Buffer.concat(outChunks)),
        stderr: decodeWinOutput(Buffer.concat(errChunks)),
        durationSeconds: (Date.now() - start) / 1000
      });
    });
  });
}

class RepairService {
  async repairPrintSpooler() {
    const start = Date.now();
    const psScript = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      Stop-Service -Name Spooler -Force -ErrorAction SilentlyContinue
      Remove-Item -Path "$env:SystemRoot\\System32\\spool\\PRINTERS\\*" -Force -Recurse -ErrorAction SilentlyContinue
      Start-Service -Name Spooler -ErrorAction Stop
      (Get-Service -Name Spooler).Status.ToString()
    `;

    try {
      const { stdout } = await runPs(psScript, 30000);
      const success = stdout.includes('Running');
      return {
        task_name: 'Reparo do Spooler de Impressão',
        command: 'Stop-Service Spooler; Remove-Item spool\\PRINTERS; Start-Service Spooler',
        exit_code: success ? 0 : 1,
        output_summary: success
          ? 'Fila de impressão limpa com sucesso e serviço Spooler reiniciado.'
          : `Resultado: ${stdout.trim()}`,
        success,
        duration_seconds: (Date.now() - start) / 1000
      };
    } catch (e) {
      return {
        task_name: 'Reparo do Spooler de Impressão',
        command: 'Stop-Service Spooler; Remove-Item spool\\PRINTERS; Start-Service Spooler',
        exit_code: e.code || -1,
        output_summary: `Falha: ${e.message}`,
        success: false,
        duration_seconds: (Date.now() - start) / 1000
      };
    }
  }

  async repairNetworkStack() {
    const start = Date.now();
    const psScript = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      ipconfig /flushdns | Out-Null
      netsh winsock reset | Out-Null
      netsh int ip reset | Out-Null
      'OK'
    `;

    try {
      await runPs(psScript, 45000);
      return {
        task_name: 'Redefinição de Rede & DNS',
        command: 'ipconfig /flushdns; netsh winsock reset; netsh int ip reset',
        exit_code: 0,
        output_summary: 'DNS esvaziado, catálogo Winsock redefinido e rotas IP recicladas.',
        success: true,
        duration_seconds: (Date.now() - start) / 1000
      };
    } catch (e) {
      return {
        task_name: 'Redefinição de Rede & DNS',
        command: 'ipconfig /flushdns; netsh winsock reset; netsh int ip reset',
        exit_code: e.code || -1,
        output_summary: `Falha: ${e.message}`,
        success: false,
        duration_seconds: (Date.now() - start) / 1000
      };
    }
  }

  async runSfcScan(onProgress = null) {
    if (typeof onProgress === 'function') {
      onProgress({ progress: 5, message: 'Iniciando verificação SFC (/scannow)...' });
    }
    const { code, stdout, stderr, durationSeconds } = await spawnWithProgress(
      'sfc.exe',
      ['/scannow'],
      onProgress,
      'Verificação SFC'
    );

    const text = stdout || stderr;
    let summary = 'Varredura SFC finalizada.';
    if (/não encontrou nenhuma violação|did not find any integrity violations/i.test(text)) {
      summary = 'Nenhuma violação de integridade do Windows encontrada.';
    } else if (/reparou com êxito|successfully repaired/i.test(text)) {
      summary = 'Arquivos de sistema corrompidos foram localizados e REPARADOS com sucesso.';
    } else if (text) {
      summary = text.split(/\r?\n/).filter(Boolean).slice(-2).join(' ');
    }

    const ok = code === 0 || /reparou com êxito|successfully repaired|não encontrou nenhuma violação|did not find any integrity violations/i.test(text);

    return {
      task_name: 'Verificação de Arquivos de Sistema (SFC)',
      command: 'sfc /scannow',
      exit_code: code,
      output_summary: summary,
      success: ok,
      duration_seconds: durationSeconds
    };
  }

  async runDismRestoreHealth(onProgress = null) {
    if (typeof onProgress === 'function') {
      onProgress({ progress: 5, message: 'Iniciando restauração DISM (/RestoreHealth)...' });
    }
    const { code, stdout, stderr, durationSeconds } = await spawnWithProgress(
      'dism.exe',
      ['/Online', '/Cleanup-Image', '/RestoreHealth'],
      onProgress,
      'Restauração DISM'
    );

    const text = stdout || stderr;
    const ok = code === 0 || /êxito|successfully/i.test(text);
    return {
      task_name: 'Restauração da Imagem do Windows (DISM)',
      command: 'dism /Online /Cleanup-Image /RestoreHealth',
      exit_code: code,
      output_summary: ok
        ? 'A operação de restauração da imagem do Windows foi concluída com êxito (Component Store saudável).'
        : (text.split(/\r?\n/).filter(Boolean).slice(-2).join(' ') || 'Falha no DISM.'),
      success: ok,
      duration_seconds: durationSeconds
    };
  }

  async runFullSuite(onProgress = null) {
    const tasks = [];
    const notes = [];
    let overallSuccess = true;

    if (onProgress) onProgress({ progress: 5, message: 'Etapa 1/4: Reparando Spooler de Impressão...' });
    const spooler = await this.repairPrintSpooler();
    tasks.push(spooler);
    notes.push(`${spooler.task_name}: ${spooler.output_summary}`);
    if (!spooler.success) overallSuccess = false;

    if (onProgress) onProgress({ progress: 15, message: 'Etapa 2/4: Redefinindo Pilha de Rede & DNS...' });
    const net = await this.repairNetworkStack();
    tasks.push(net);
    notes.push(`${net.task_name}: ${net.output_summary}`);
    if (!net.success) overallSuccess = false;

    if (onProgress) onProgress({ progress: 25, message: 'Etapa 3/4: Executando Verificação SFC...' });
    const sfc = await this.runSfcScan((p) => {
      if (onProgress) onProgress({ progress: 25 + Math.round(p.progress * 0.35), message: `Etapa 3/4: ${p.message}` });
    });
    tasks.push(sfc);
    notes.push(`${sfc.task_name}: ${sfc.output_summary}`);
    if (!sfc.success) overallSuccess = false;

    if (onProgress) onProgress({ progress: 60, message: 'Etapa 4/4: Executando Restauração DISM...' });
    const dism = await this.runDismRestoreHealth((p) => {
      if (onProgress) onProgress({ progress: 60 + Math.round(p.progress * 0.39), message: `Etapa 4/4: ${p.message}` });
    });
    tasks.push(dism);
    notes.push(`${dism.task_name}: ${dism.output_summary}`);
    if (!dism.success) overallSuccess = false;

    return {
      executed_at_local: formatLocalDateTime(),
      tasks,
      overall_success: overallSuccess,
      requires_reboot: true,
      summary_notes: notes
    };
  }

  async createRestorePoint(description = 'DC-TI Manutencao Preventiva') {
    const start = Date.now();
    const safeDesc = String(description).replace(/'/g, "''");
    const ps = `
      Enable-ComputerRestore -Drive "$env:SystemDrive\\" -ErrorAction SilentlyContinue
      Checkpoint-Computer -Description '${safeDesc}' -RestorePointType 'MODIFY_SETTINGS' -ErrorAction Stop
    `;
    try {
      await runPs(ps, 90000);
      return {
        task_name: 'Criação de Ponto de Restauração',
        command: `Checkpoint-Computer -Description '${safeDesc}'`,
        exit_code: 0,
        output_summary: `Ponto de restauração "${safeDesc}" criado com sucesso.`,
        success: true,
        duration_seconds: (Date.now() - start) / 1000
      };
    } catch (e) {
      return {
        task_name: 'Criação de Ponto de Restauração',
        command: 'Checkpoint-Computer',
        exit_code: e.code || -1,
        output_summary: `Falha (verifique se a Proteção do Sistema está ativa ou frequência mínima de 24h): ${e.message}`,
        success: false,
        duration_seconds: (Date.now() - start) / 1000
      };
    }
  }

  async scheduleChkdsk(drive = 'C:') {
    const start = Date.now();
    const cleanDrive = /^[A-Za-z]:$/.test(drive) ? drive : 'C:';
    try {
      const { stdout } = await execAsync(`cmd /c "echo S | chkdsk ${cleanDrive} /f"`, { timeout: 20000 });
      return {
        task_name: `Agendamento CHKDSK (${cleanDrive})`,
        command: `chkdsk ${cleanDrive} /f`,
        exit_code: 0,
        output_summary: `Verificação de disco (${cleanDrive}) agendada para a próxima reinicialização do Windows.`,
        raw: stdout.trim(),
        success: true,
        duration_seconds: (Date.now() - start) / 1000
      };
    } catch (e) {
      const out = (e.stdout || '').toString().trim();
      const scheduled = /agendad|scheduled|next time the system restarts|pr[oó]xima vez/i.test(out);
      return {
        task_name: `Agendamento CHKDSK (${cleanDrive})`,
        command: `chkdsk ${cleanDrive} /f`,
        exit_code: scheduled ? 0 : (e.code || -1),
        output_summary: scheduled
          ? `Verificação de disco (${cleanDrive}) agendada para a próxima reinicialização.`
          : `Falha ao agendar CHKDSK: ${e.message}`,
        success: scheduled,
        duration_seconds: (Date.now() - start) / 1000
      };
    }
  }
}

module.exports = { RepairService };
