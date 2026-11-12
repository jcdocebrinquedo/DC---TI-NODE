'use strict';

const { exec } = require('node:child_process');
const { promisify } = require('node:util');
const { formatLocalDateTime } = require('../utils/local-date');

const execAsync = promisify(exec);

class RepairService {
  async repairPrintSpooler() {
    const start = Date.now();
    const psScript = `
      Stop-Service -Name Spooler -Force -ErrorAction SilentlyContinue
      Remove-Item -Path "$env:SystemRoot\\System32\\spool\\PRINTERS\\*" -Force -Recurse -ErrorAction SilentlyContinue
      Start-Service -Name Spooler
      (Get-Service -Name Spooler).Status
    `.replace(/\n/g, '; ');

    try {
      const { stdout } = await execAsync(`powershell -NoProfile -Command "${psScript}"`);
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
      ipconfig /flushdns
      netsh winsock reset
      netsh int ip reset
    `.replace(/\n/g, '; ');

    try {
      await execAsync(`powershell -NoProfile -Command "${psScript}"`);
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

  async runSfcScan() {
    const start = Date.now();
    try {
      const { stdout } = await execAsync('sfc /scannow');
      const text = stdout.toString();
      let summary = 'Varredura SFC finalizada.';
      let success = true;

      if (text.includes('não encontrou nenhuma violação') || text.includes('did not find any integrity violations')) {
        summary = 'Nenhuma violação de integridade do Windows encontrada.';
      } else if (text.includes('reparou com êxito') || text.includes('successfully repaired')) {
        summary = 'Arquivos de sistema corrompidos foram localizados e REPARADOS com sucesso.';
      }

      return {
        task_name: 'Verificação de Arquivos de Sistema (SFC)',
        command: 'sfc /scannow',
        exit_code: 0,
        output_summary: summary,
        success,
        duration_seconds: (Date.now() - start) / 1000
      };
    } catch (e) {
      return {
        task_name: 'Verificação de Arquivos de Sistema (SFC)',
        command: 'sfc /scannow',
        exit_code: e.code || -1,
        output_summary: e.stdout ? e.stdout.toString() : e.message,
        success: false,
        duration_seconds: (Date.now() - start) / 1000
      };
    }
  }

  async runDismRestoreHealth() {
    const start = Date.now();
    try {
      const { stdout } = await execAsync('dism /Online /Cleanup-Image /RestoreHealth');
      return {
        task_name: 'Restauração da Imagem do Windows (DISM)',
        command: 'dism /Online /Cleanup-Image /RestoreHealth',
        exit_code: 0,
        output_summary: 'A operação de restauração da imagem do Windows foi concluída com êxito (Component Store saudável).',
        success: true,
        duration_seconds: (Date.now() - start) / 1000
      };
    } catch (e) {
      return {
        task_name: 'Restauração da Imagem do Windows (DISM)',
        command: 'dism /Online /Cleanup-Image /RestoreHealth',
        exit_code: e.code || -1,
        output_summary: e.stdout ? e.stdout.toString() : e.message,
        success: false,
        duration_seconds: (Date.now() - start) / 1000
      };
    }
  }

  async runFullSuite() {
    const tasks = [];
    const notes = [];
    let overallSuccess = true;

    const spooler = await this.repairPrintSpooler();
    tasks.push(spooler);
    notes.push(`${spooler.task_name}: ${spooler.output_summary}`);
    if (!spooler.success) overallSuccess = false;

    const net = await this.repairNetworkStack();
    tasks.push(net);
    notes.push(`${net.task_name}: ${net.output_summary}`);
    if (!net.success) overallSuccess = false;

    const sfc = await this.runSfcScan();
    tasks.push(sfc);
    notes.push(`${sfc.task_name}: ${sfc.output_summary}`);
    if (!sfc.success) overallSuccess = false;

    const dism = await this.runDismRestoreHealth();
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
}

module.exports = { RepairService };

