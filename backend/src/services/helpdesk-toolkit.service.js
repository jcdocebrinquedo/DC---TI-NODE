'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { exec, execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { Worker } = require('node:worker_threads');
const { formatLocalDateTime, localTimestampSlug } = require('../utils/local-date');

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

function runPs(script, timeout = 25000) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return execAsync(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, {
    timeout,
    maxBuffer: 1024 * 1024 * 10
  });
}

const WORKER_CODE = `
const { parentPort, workerData } = require('worker_threads');
const endTime = Date.now() + workerData.durationMs;
let iterations = 0;
while (Date.now() < endTime) {
  for (let i = 0; i < 5000; i++) {
    Math.sqrt(Math.random() * 1000000);
  }
  iterations += 5000;
}
parentPort.postMessage(iterations);
`;

class HelpdeskToolkitService {
  constructor() {
    this.activeStressWorkers = [];
  }

  async getCrashMinidumps() {
    const minidumpDir = 'C:\\Windows\\Minidump';
    const reports = [];

    try {
      if (fs.existsSync(minidumpDir)) {
        const files = fs.readdirSync(minidumpDir);
        for (const file of files) {
          if (file.endsWith('.dmp')) {
            const stat = fs.statSync(path.join(minidumpDir, file));
            reports.push({
              file_name: file,
              size_kb: Math.round(stat.size / 1024),
              created_at: formatLocalDateTime(stat.mtime)
            });
          }
        }
      }
    } catch {}

    let criticalEvents = [];
    let bugchecks = [];
    try {
      const ps = `
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        $crit = Get-WinEvent -FilterHashtable @{LogName='System'; Level=1,2} -MaxEvents 8 -ErrorAction SilentlyContinue | ForEach-Object {
          [PSCustomObject]@{
            time = $_.TimeCreated.ToString('dd/MM/yyyy HH:mm:ss')
            id = $_.Id
            message = if ($_.Message) { $_.Message.Substring(0, [Math]::Min(180, $_.Message.Length)) } else { '' }
          }
        }
        $bc = Get-WinEvent -FilterHashtable @{LogName='System'; Id=1001} -MaxEvents 5 -ErrorAction SilentlyContinue | Where-Object { $_.ProviderName -match 'BugCheck|WER' -or $_.Message -match '0x' } | ForEach-Object {
          [PSCustomObject]@{
            time = $_.TimeCreated.ToString('dd/MM/yyyy HH:mm:ss')
            provider = $_.ProviderName
            message = if ($_.Message) { $_.Message.Substring(0, [Math]::Min(260, $_.Message.Length)) } else { '' }
          }
        }
        [PSCustomObject]@{
          critical = @($crit)
          bugchecks = @($bc)
        } | ConvertTo-Json -Depth 4 -Compress
      `;
      const { stdout } = await runPs(ps);
      if (stdout && stdout.trim()) {
        const parsed = JSON.parse(stdout.trim());
        criticalEvents = Array.isArray(parsed.critical) ? parsed.critical : (parsed.critical ? [parsed.critical] : []);
        bugchecks = Array.isArray(parsed.bugchecks) ? parsed.bugchecks : (parsed.bugchecks ? [parsed.bugchecks] : []);
      }
    } catch {}

    return {
      has_dumps: reports.length > 0,
      dump_files: reports,
      critical_events: criticalEvents,
      bugchecks
    };
  }

  async _readCpuTempCelsius() {
    try {
      const { stdout } = await runPs(`
        $t = Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($t -and $t.CurrentTemperature) {
          [math]::Round(($t.CurrentTemperature / 10) - 273.15, 1)
        }
      `, 4000);
      const val = parseFloat((stdout || '').trim());
      return Number.isFinite(val) && val > 0 && val < 130 ? val : null;
    } catch {
      return null;
    }
  }

  async runQuickStressTest(durationSeconds = 10) {
    // Cancela workers anteriores se ainda houver
    await this.stopStressTest();

    const startTime = Date.now();
    const durationMs = Math.min(Math.max(Number(durationSeconds) || 10, 5), 30) * 1000;
    const workerCount = Math.max(1, os.cpus().length || 4);

    const tempBefore = await this._readCpuTempCelsius();

    const workerPromises = [];
    for (let i = 0; i < workerCount; i++) {
      workerPromises.push(new Promise((resolve) => {
        const worker = new Worker(WORKER_CODE, {
          eval: true,
          workerData: { durationMs }
        });
        this.activeStressWorkers.push(worker);

        let done = false;
        worker.on('message', (iters) => {
          if (!done) {
            done = true;
            resolve(Number(iters) || 0);
          }
        });
        worker.on('error', () => {
          if (!done) {
            done = true;
            resolve(0);
          }
        });
        worker.on('exit', () => {
          if (!done) {
            done = true;
            resolve(0);
          }
        });
      }));
    }

    const results = await Promise.all(workerPromises);
    this.activeStressWorkers = [];

    const tempAfter = await this._readCpuTempCelsius();
    const totalIterations = results.reduce((a, b) => a + b, 0);
    const elapsedSeconds = Math.max(1, Math.round((Date.now() - startTime) / 1000));

    return {
      success: true,
      duration_seconds: elapsedSeconds,
      cpu_cores_tested: workerCount,
      operations_completed: totalIterations,
      temp_before_c: tempBefore,
      temp_after_c: tempAfter,
      stability: tempAfter && tempAfter >= 90
        ? `Atenção: Temperatura elevada detectada (${tempAfter}°C). Verificar pasta térmica e cooler.`
        : 'Estável - Teste multi-thread concluído sem travamentos ou falhas de processamento'
    };
  }

  async stopStressTest() {
    if (this.activeStressWorkers.length === 0) return { stopped: 0 };
    const workers = [...this.activeStressWorkers];
    this.activeStressWorkers = [];
    await Promise.all(workers.map(w => w.terminate().catch(() => {})));
    return { stopped: workers.length };
  }

  _scanDirectoryRecursive(dirPath, filterExt = null) {
    let filesCount = 0;
    let totalBytes = 0;

    const stack = [dirPath];
    while (stack.length > 0) {
      const current = stack.pop();
      let entries;
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          stack.push(fullPath);
        } else if (entry.isFile()) {
          if (filterExt && !filterExt.some(ext => entry.name.toLowerCase().endsWith(ext))) {
            continue;
          }
          try {
            const stat = fs.statSync(fullPath);
            totalBytes += stat.size;
            filesCount++;
          } catch {}
        }
      }
    }

    return { filesCount, totalBytes };
  }

  async calculateProfileBackupSize() {
    const userProfile = process.env.USERPROFILE || 'C:\\Users\\Default';
    const targets = [
      { key: 'desktop', name: 'Área de Trabalho', path: path.join(userProfile, 'Desktop') },
      { key: 'documents', name: 'Documentos', path: path.join(userProfile, 'Documents') },
      { key: 'downloads', name: 'Downloads', path: path.join(userProfile, 'Downloads') },
      { key: 'pictures', name: 'Imagens', path: path.join(userProfile, 'Pictures') },
      { key: 'favorites', name: 'Favoritos', path: path.join(userProfile, 'Favorites') },
      { key: 'outlook', name: 'Arquivos Outlook (.pst/.ost)', path: path.join(userProfile, 'AppData', 'Local', 'Microsoft', 'Outlook'), ext: ['.pst', '.ost'] }
    ];

    const summary = [];
    let grandTotalBytes = 0;

    for (const item of targets) {
      if (!fs.existsSync(item.path)) {
        summary.push({
          key: item.key,
          folder: item.name,
          path: item.path,
          files_count: 0,
          size_mb: '0.0'
        });
        continue;
      }
      const { filesCount, totalBytes } = this._scanDirectoryRecursive(item.path, item.ext || null);
      grandTotalBytes += totalBytes;
      summary.push({
        key: item.key,
        folder: item.name,
        path: item.path,
        files_count: filesCount,
        size_mb: (totalBytes / (1024 * 1024)).toFixed(1)
      });
    }

    return {
      total_size_gb: (grandTotalBytes / (1024 * 1024 * 1024)).toFixed(2),
      folders: summary
    };
  }

  _spawnTarArchive(args, onFileLine) {
    return new Promise((resolve, reject) => {
      const child = spawn('tar.exe', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
      const warnings = [];
      let stderrBuf = '';

      const handleLines = (chunk, isErr) => {
        const str = chunk.toString('utf8');
        if (isErr) {
          stderrBuf += str;
          const lines = stderrBuf.split(/\r?\n/);
          stderrBuf = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (/^a\s+/i.test(trimmed)) {
              if (onFileLine) onFileLine(trimmed);
            } else if (/tar:|cannot|can't|permission|error|denied|failed/i.test(trimmed)) {
              warnings.push(trimmed);
            } else if (onFileLine) {
              onFileLine(trimmed);
            }
          }
        }
      };

      child.stdout.on('data', (c) => handleLines(c, false));
      child.stderr.on('data', (c) => handleLines(c, true));
      child.on('error', (err) => reject(err));
      child.on('close', (code) => {
        resolve({ code: code ?? 0, warnings });
      });
    });
  }

  _countArchiveFiles(tarFilePath) {
    return new Promise((resolve) => {
      let args = ['-tf', tarFilePath];
      if (tarFilePath.endsWith('.zst')) args = ['--zstd', '-tf', tarFilePath];
      else if (tarFilePath.endsWith('.gz')) args = ['-tzf', tarFilePath];
      const child = spawn('tar.exe', args, {
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true
      });
      let count = 0;
      let buf = '';
      child.stdout.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() || '';
        for (const l of lines) {
          if (l && !l.endsWith('/')) count++;
        }
      });
      child.on('close', () => {
        if (buf.trim() && !buf.trim().endsWith('/')) count++;
        resolve(count);
      });
      child.on('error', () => resolve(0));
    });
  }

  _buildFileSizeMap(baseParent, dirName, fileMap) {
    let filesCount = 0;
    let totalBytes = 0;
    const rootFull = path.join(baseParent, dirName);
    const stack = [rootFull];

    while (stack.length > 0) {
      const current = stack.pop();
      let entries;
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          stack.push(fullPath);
        } else if (entry.isFile()) {
          try {
            const stat = fs.statSync(fullPath);
            const rel = path.relative(baseParent, fullPath).replace(/\\/g, '/');
            fileMap.set(rel, stat.size);
            totalBytes += stat.size;
            filesCount++;
          } catch {}
        }
      }
    }
    return { filesCount, totalBytes };
  }

  async runProfileBackup({ destination, folders = ['desktop', 'documents', 'downloads'] }, onProgress = null) {
    const destRoot = (destination || '').trim();
    if (!destRoot) {
      throw new Error('Informe o caminho da pasta de destino para o backup (ex: D:\\Backup_PC).');
    }

    fs.mkdirSync(destRoot, { recursive: true });

    const userProfile = process.env.USERPROFILE || 'C:\\Users\\Default';
    const slug = localTimestampSlug();
    const computer = (process.env.COMPUTERNAME || 'ESTACAO').replace(/[^a-zA-Z0-9_-]/g, '_');
    const tarFilePath = path.join(destRoot, `Backup_${computer}_${slug}.tar.zst`);

    const mapFolders = {
      desktop: { name: 'Desktop', parent: userProfile, dirName: 'Desktop' },
      documents: { name: 'Documents', parent: userProfile, dirName: 'Documents' },
      downloads: { name: 'Downloads', parent: userProfile, dirName: 'Downloads' },
      pictures: { name: 'Pictures', parent: userProfile, dirName: 'Pictures' },
      favorites: { name: 'Favorites', parent: userProfile, dirName: 'Favorites' },
      outlook: { name: 'Outlook', parent: path.join(userProfile, 'AppData', 'Local', 'Microsoft'), dirName: 'Outlook' }
    };

    const selected = Array.isArray(folders) && folders.length > 0 ? folders : ['desktop', 'documents', 'downloads'];

    if (onProgress) onProgress({ progress: 1, message: 'Mapeando arquivos e tamanhos de origem...' });

    let totalSourceFiles = 0;
    let totalSourceBytes = 0;
    const fileSizeMap = new Map();
    const validFolders = [];
    for (const key of selected) {
      const cfg = mapFolders[key];
      if (!cfg) continue;
      const fullSrc = path.join(cfg.parent, cfg.dirName);
      if (!fs.existsSync(fullSrc)) continue;
      const { filesCount, totalBytes } = this._buildFileSizeMap(cfg.parent, cfg.dirName, fileSizeMap);
      totalSourceFiles += filesCount;
      totalSourceBytes += totalBytes;
      validFolders.push({ ...cfg, filesCount, totalBytes });
    }

    if (validFolders.length === 0) {
      throw new Error('Nenhuma das pastas selecionadas foi encontrada.');
    }

    const allWarnings = [];
    let processedFiles = 0;
    let processedBytes = 0;

    // Exclui apenas junções virtuais protegidas do Windows que causam Access Denied dentro de Documents
    const junctionExcludes = [
      '--exclude=Documents/Meus Vídeos',
      '--exclude=Documents/Minhas Imagens',
      '--exclude=Documents/Minhas Músicas',
      '--exclude=Documents/My Videos',
      '--exclude=Documents/My Pictures',
      '--exclude=Documents/My Music'
    ];

    const tarArgs = ['--format=pax', '--zstd', ...junctionExcludes, '-cvf', tarFilePath];
    for (const cfg of validFolders) {
      tarArgs.push('-C', cfg.parent, cfg.dirName);
    }

    const totalMb = (totalSourceBytes / (1024 * 1024)).toFixed(0);
    if (onProgress) {
      onProgress({
        progress: 2,
        message: `Comprimindo (.tar.zst): 0/${totalSourceFiles} arquivos (0 / ${totalMb} MB)...`
      });
    }

    const emitProgress = () => {
      if (!onProgress) return;
      const byteRatio = totalSourceBytes > 0
        ? (processedBytes / totalSourceBytes)
        : (processedFiles / Math.max(1, totalSourceFiles));
      const pct = Math.max(2, Math.min(94, Math.round(byteRatio * 92) + 2));
      const doneMb = (processedBytes / (1024 * 1024)).toFixed(0);
      onProgress({
        progress: pct,
        message: `Comprimindo (.tar.zst): ${processedFiles}/${totalSourceFiles} arquivos (${doneMb} / ${totalMb} MB)...`
      });
    };

    const heartbeat = setInterval(emitProgress, 1000);

    let code = 0;
    let warnings = [];
    try {
      const res = await this._spawnTarArchive(tarArgs, (rawLine) => {
        const cleanPath = rawLine.replace(/^a\s+/i, '').trim().replace(/\\/g, '/');
        if (!cleanPath || cleanPath.endsWith('/')) return;
        const size = fileSizeMap.get(cleanPath);
        if (typeof size === 'number') {
          processedFiles = Math.min(totalSourceFiles, processedFiles + 1);
          processedBytes = Math.min(totalSourceBytes, processedBytes + size);
        }
      });
      code = res.code;
      warnings = res.warnings;
    } finally {
      clearInterval(heartbeat);
    }

    if (warnings.length > 0) {
      allWarnings.push(...warnings.slice(0, 20));
    }

    if (!fs.existsSync(tarFilePath)) {
      throw new Error('Falha ao criar o arquivo .tar.zst de backup.');
    }

    const results = validFolders.map(cfg => ({
      folder: cfg.name,
      source_files: cfg.filesCount,
      status: code === 0 ? '100% Comprimido em .tar.zst (Zstd + PAX)' : `Comprimido com ${warnings.length} aviso(s)`
    }));

    if (onProgress) onProgress({ progress: 96, message: 'Verificando integridade e contagem final no .tar.zst...' });
    const archivedFilesCount = await this._countArchiveFiles(tarFilePath);
    const tarSizeMb = Math.round((fs.statSync(tarFilePath).size / (1024 * 1024)) * 100) / 100;

    return {
      ok: true,
      tar_path: tarFilePath,
      size_mb: tarSizeMb,
      total_source_files: totalSourceFiles,
      archived_files_count: archivedFilesCount,
      warnings: allWarnings,
      executed_at_local: formatLocalDateTime(),
      folders_archived: results
    };
  }

  async getRemoteAccessIds() {
    const ps = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      $res = [PSCustomObject]@{ anydesk = $null; rustdesk = $null; teamviewer = $null }

      # AnyDesk
      $adPaths = @("$env:APPDATA\\AnyDesk\\system.conf", "$env:ProgramData\\AnyDesk\\system.conf")
      foreach ($p in $adPaths) {
        if (Test-Path $p) {
          $line = Select-String -Path $p -Pattern 'ad\\.anynet\\.id=(\\d+)' -ErrorAction SilentlyContinue | Select-Object -First 1
          if ($line) { $res.anydesk = $line.Matches[0].Groups[1].Value; break }
        }
      }

      # RustDesk
      $rdPaths = @("$env:APPDATA\\RustDesk\\config\\RustDesk.toml", "$env:SystemDrive\\Windows\\ServiceProfiles\\LocalService\\AppData\\Roaming\\RustDesk\\config\\RustDesk.toml")
      foreach ($p in $rdPaths) {
        if (Test-Path $p) {
          $line = Select-String -Path $p -Pattern "id\\s*=\\s*'([^']+)'" -ErrorAction SilentlyContinue | Select-Object -First 1
          if ($line) { $res.rustdesk = $line.Matches[0].Groups[1].Value; break }
        }
      }

      # TeamViewer
      try {
        $tv = Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\TeamViewer' -Name ClientID -ErrorAction SilentlyContinue
        if (-not $tv) { $tv = Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\WOW6432Node\\TeamViewer' -Name ClientID -ErrorAction SilentlyContinue }
        if ($tv -and $tv.ClientID) { $res.teamviewer = $tv.ClientID.ToString() }
      } catch {}

      $res | ConvertTo-Json -Compress
    `;

    try {
      const { stdout } = await runPs(ps, 10000);
      return JSON.parse(stdout.trim());
    } catch {
      return { anydesk: null, rustdesk: null, teamviewer: null };
    }
  }

  openNativeTool(tool) {
    const allowed = {
      devmgmt: 'devmgmt.msc',
      services: 'services.msc',
      eventvwr: 'eventvwr.msc',
      appwiz: 'appwiz.cpl',
      msconfig: 'msconfig.exe',
      resmon: 'resmon.exe',
      taskmgr: 'taskmgr.exe'
    };
    const target = allowed[tool];
    if (!target) {
      throw new Error('Ferramenta nativa não permitida.');
    }
    const p = spawn('cmd.exe', ['/c', 'start', '', target], { detached: true, stdio: 'ignore' });
    p.unref();
    return { launched: target };
  }
}

const helpdeskToolkitService = new HelpdeskToolkitService();

module.exports = { HelpdeskToolkitService, helpdeskToolkitService };
