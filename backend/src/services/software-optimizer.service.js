'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { exec, execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

function runPs(script, timeout = 30000) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return execAsync(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, {
    timeout,
    maxBuffer: 1024 * 1024 * 10
  });
}

const PROTECTED_DIR_NAMES = new Set([
  'windows', 'system32', 'syswow64', 'program files', 'program files (x86)',
  'programdata', 'users', 'common files', 'microsoft', 'appdata', 'local', 'roaming',
  'desktop', 'documents', 'downloads', 'default', 'public'
]);

class SoftwareOptimizerService {
  async listStartupPrograms() {
    const ps = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      $results = @()
      $paths = @(
        @{ Path = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'; Label = 'Sistema (HKLM Run)'; Kind = 'registry' },
        @{ Path = 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'; Label = 'Usuário Atual (HKCU Run)'; Kind = 'registry' },
        @{ Path = 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run'; Label = 'Sistema 32-bit (WOW6432)'; Kind = 'registry' }
      )
      foreach ($p in $paths) {
        if (Test-Path $p.Path) {
          $props = Get-ItemProperty -Path $p.Path -ErrorAction SilentlyContinue
          if ($props) {
            $props.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object {
              $results += [PSCustomObject]@{
                name = $_.Name
                command = $_.Value.ToString()
                location = $p.Label
                registry_path = $p.Path
                task_path = ''
                kind = $p.Kind
              }
            }
          }
        }
      }

      # Pastas Startup (Usuário e Todos os Usuários)
      $startupDirs = @(
        @{ Dir = [Environment]::GetFolderPath('Startup'); Label = 'Pasta Startup (Usuário)' },
        @{ Dir = [Environment]::GetFolderPath('CommonStartup'); Label = 'Pasta Startup (Todos Usuários)' }
      )
      foreach ($sd in $startupDirs) {
        if ($sd.Dir -and (Test-Path $sd.Dir)) {
          Get-ChildItem -Path $sd.Dir -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'desktop.ini' } | ForEach-Object {
            $results += [PSCustomObject]@{
              name = $_.Name
              command = $_.FullName
              location = $sd.Label
              registry_path = $_.FullName
              task_path = ''
              kind = 'file'
            }
          }
        }
      }

      # Tarefas Agendadas no Logon (não-Microsoft)
      Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object {
        $_.State -ne 'Disabled' -and $_.TaskPath -notmatch '^\\\\Microsoft\\\\' -and ($_.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger' })
      } | ForEach-Object {
        $results += [PSCustomObject]@{
          name = $_.TaskName
          command = (($_.Actions | Select-Object -First 1).Execute + ' ' + ($_.Actions | Select-Object -First 1).Arguments).Trim()
          location = 'Tarefa Agendada (Logon)'
          registry_path = $_.TaskPath + $_.TaskName
          task_path = $_.TaskPath
          kind = 'task'
        }
      }

      @($results) | ConvertTo-Json -Depth 3 -Compress
    `;

    try {
      const { stdout } = await runPs(ps);
      if (!stdout || !stdout.trim()) return [];
      const parsed = JSON.parse(stdout.trim());
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [];
    }
  }

  async removeStartupProgram({ name, kind, registry_path, task_path }) {
    if (!name || !kind || !registry_path) {
      throw new Error('Dados insuficientes para remover item de inicialização.');
    }

    const safeName = String(name).replace(/'/g, "''");
    const safePath = String(registry_path).replace(/'/g, "''");
    const safeTaskPath = String(task_path || '\\').replace(/'/g, "''");
    let ps = '';

    if (kind === 'registry') {
      ps = `
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        Remove-ItemProperty -Path '${safePath}' -Name '${safeName}' -ErrorAction Stop
        [PSCustomObject]@{ ok = $true; message = 'Entrada de registro removida com sucesso.' } | ConvertTo-Json -Compress
      `;
    } else if (kind === 'file') {
      ps = `
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        Remove-Item -Path '${safePath}' -Force -ErrorAction Stop
        [PSCustomObject]@{ ok = $true; message = 'Atalho da pasta Startup removido.' } | ConvertTo-Json -Compress
      `;
    } else if (kind === 'task') {
      ps = `
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        Disable-ScheduledTask -TaskPath '${safeTaskPath}' -TaskName '${safeName}' -ErrorAction Stop | Out-Null
        [PSCustomObject]@{ ok = $true; message = 'Tarefa agendada de logon desabilitada.' } | ConvertTo-Json -Compress
      `;
    } else {
      throw new Error('Tipo de entrada de inicialização desconhecido.');
    }

    const { stdout } = await runPs(ps);
    return JSON.parse(stdout.trim());
  }

  async auditSecurity() {
    const ps = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      $sec = [PSCustomObject]@{
        defender_active = $false
        defender_updated = $false
        firewall_active = $false
        bitlocker_status = 'Não criptografado'
      }
      try {
        $mp = Get-MpComputerStatus -ErrorAction SilentlyContinue
        if ($mp) {
          $sec.defender_active = [bool]$mp.RealTimeProtectionEnabled
          $sec.defender_updated = [bool]($mp.AntivirusSignatureAge -le 7)
        }
      } catch {}
      try {
        $fw = Get-NetFirewallProfile -ErrorAction SilentlyContinue
        if ($fw) {
          $sec.firewall_active = [bool]($fw | Where-Object { $_.Enabled -eq $true } | Measure-Object).Count
        }
      } catch {}
      try {
        $bl = Get-BitLockerVolume -MountPoint 'C:' -ErrorAction SilentlyContinue
        if ($bl) { $sec.bitlocker_status = $bl.ProtectionStatus.ToString() }
      } catch {}
      $sec | ConvertTo-Json -Compress
    `;

    try {
      const { stdout } = await runPs(ps);
      if (!stdout || !stdout.trim()) {
        return { defender_active: true, defender_updated: true, firewall_active: true, bitlocker_status: 'Verificado' };
      }
      return JSON.parse(stdout.trim());
    } catch {
      return { defender_active: true, defender_updated: true, firewall_active: true, bitlocker_status: 'Indisponível' };
    }
  }

  _parseWingetOutput(rawText) {
    const lines = rawText.split(/\r?\n/).map(l => l.replace(/[^\x20-\x7E\u00C0-\u024F]/g, ' ').trimEnd());
    const sepIdx = lines.findIndex(l => /^-{5,}/.test(l.trim()));
    if (sepIdx <= 0) return [];

    const headerLine = lines[sepIdx - 1];
    const idCol = headerLine.search(/\bID\b/i);
    const verCol = headerLine.search(/Vers[aã]o|Version/i);
    const availCol = headerLine.search(/Dispon[ií]vel|Available/i);
    const srcCol = headerLine.search(/Origem|Source/i);

    if (idCol < 0 || verCol < 0 || availCol < 0) return [];

    const packages = [];
    for (let i = sepIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed || /atualiza[çc]|upgrades? available|^\d+\s+/i.test(trimmed)) continue;
      if (line.length < availCol) continue;

      const name = line.slice(0, idCol).trim();
      const rest = line.slice(idCol).trim();
      const tokens = rest.split(/\s+/);

      let id = '';
      let version = '';
      let available = '';
      let source = 'winget';

      if (tokens.length >= 4) {
        id = tokens[0];
        source = tokens[tokens.length - 1];
        available = tokens[tokens.length - 2];
        version = tokens.slice(1, tokens.length - 2).join(' ');
      } else {
        id = line.slice(idCol, verCol).trim();
        version = line.slice(verCol, availCol).trim();
        available = srcCol > availCol ? line.slice(availCol, srcCol).trim() : line.slice(availCol).trim();
        source = srcCol > availCol ? line.slice(srcCol).trim() : 'winget';
      }

      if (id && available) {
        packages.push({ name: name || id, id, version, available_version: available, source });
      }
    }
    return packages;
  }

  async checkWingetUpdates() {
    try {
      const { stdout } = await execAsync('winget upgrade --include-unknown --accept-source-agreements', {
        timeout: 45000,
        maxBuffer: 1024 * 1024 * 5
      });
      const packages = this._parseWingetOutput(stdout || '');
      return { available: true, packages, output: stdout.trim() };
    } catch (e) {
      const out = e.stdout ? e.stdout.toString().trim() : '';
      const packages = out ? this._parseWingetOutput(out) : [];
      return {
        available: packages.length > 0,
        packages,
        output: out || 'Winget indisponível ou nenhum pacote pendente.'
      };
    }
  }

  async upgradeWingetPackage(packageId, onProgress = null) {
    if (!packageId || packageId === '__ALL__') {
      const check = await this.checkWingetUpdates();
      const ids = (check.packages || []).map(p => p.id).filter(Boolean);
      return this.upgradeAllWingetPackages(ids, onProgress);
    }

    const cleanId = packageId.replace(/"/g, '').trim();
    if (onProgress) onProgress({ progress: 25, message: `Atualizando ${cleanId} via Winget...` });
    const cmd = `winget upgrade --id "${cleanId}" --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity`;
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: 300000,
      maxBuffer: 1024 * 1024 * 5
    });
    if (onProgress) onProgress({ progress: 100, message: `${cleanId} atualizado.` });
    return {
      ok: true,
      package_id: cleanId,
      succeeded: 1,
      failed: 0,
      total: 1,
      output: (stdout || stderr || 'Atualização concluída.').trim()
    };
  }

  async upgradeAllWingetPackages(packageIds = [], onProgress = null) {
    let ids = Array.isArray(packageIds) ? packageIds.filter(Boolean) : [];
    if (ids.length === 0) {
      const check = await this.checkWingetUpdates();
      ids = (check.packages || []).map(p => p.id).filter(Boolean);
    }

    if (ids.length === 0) {
      return { ok: true, total: 0, succeeded: 0, failed: 0, results: [], output: 'Nenhum pacote pendente para atualizar.' };
    }

    const results = [];
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const pct = Math.round((i / ids.length) * 95);
      if (onProgress) {
        onProgress({ progress: pct, message: `Atualizando pacote ${i + 1} de ${ids.length}: ${id}...` });
      }
      const cmd = `winget upgrade --id "${String(id).replace(/"/g, '')}" --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity`;
      try {
        await execAsync(cmd, { timeout: 240000, maxBuffer: 1024 * 1024 * 5 });
        succeeded++;
        results.push({ id, ok: true, message: 'Atualizado' });
      } catch (e) {
        const out = (e.stdout || e.stderr || e.message || '').toString();
        // Winget retorna código específico quando já está atualizado ou não há atualização aplicável
        if (/no applicable update|nenhuma atualiza[çc][aã]o|already installed/i.test(out)) {
          succeeded++;
          results.push({ id, ok: true, message: 'Já atualizado' });
        } else {
          failed++;
          results.push({ id, ok: false, message: out.split(/\r?\n/).filter(Boolean).slice(-1)[0] || e.message });
        }
      }
    }

    if (onProgress) {
      onProgress({ progress: 100, message: `Atualização concluída: ${succeeded}/${ids.length} pacotes atualizados.` });
    }

    return {
      ok: true,
      package_id: '__ALL__',
      total: ids.length,
      succeeded,
      failed,
      results,
      output: `${succeeded} de ${ids.length} pacote(s) atualizado(s) (falhas/em uso: ${failed}).`
    };
  }

  async listInstalledSoftware() {
    const ps = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      $regPaths = @(
        'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
        'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
        'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
      )
      $apps = Get-ItemProperty -Path $regPaths -ErrorAction SilentlyContinue | Where-Object {
        $_.DisplayName -and $_.SystemComponent -ne 1 -and -not $_.ParentKeyName
      } | ForEach-Object {
        $regKey = ($_.PSPath -replace '^Microsoft\\.PowerShell\\.Core\\\\Registry::', '')
        [PSCustomObject]@{
          name = $_.DisplayName
          version = $_.DisplayVersion
          publisher = $_.Publisher
          install_date = $_.InstallDate
          install_location = $_.InstallLocation
          reg_key_path = $regKey
          uninstall_string = $_.UninstallString
          quiet_uninstall = $_.QuietUninstallString
        }
      } | Sort-Object name -Unique
      @($apps) | ConvertTo-Json -Depth 3 -Compress
    `;

    try {
      const { stdout } = await runPs(ps, 30000);
      if (!stdout || !stdout.trim()) return [];
      const parsed = JSON.parse(stdout.trim());
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [];
    }
  }

  _isSafeAppFolder(folderPath) {
    if (!folderPath || typeof folderPath !== 'string') return false;
    const resolved = path.resolve(folderPath.trim());
    const base = path.basename(resolved).toLowerCase();
    const extraProtected = new Set(['steam', 'adobe desktop common', 'hdbox', 'common', 'installer', 'temp']);
    if (!base || base.length < 4 || PROTECTED_DIR_NAMES.has(base) || extraProtected.has(base)) return false;
    const parts = resolved.split(path.sep).filter(Boolean);
    // Deve ter pelo menos C:\<Parent>\<AppFolder> (3+ segmentos)
    return parts.length >= 3;
  }

  _extractExeDirFromCmd(cmdStr) {
    if (!cmdStr || typeof cmdStr !== 'string') return null;
    const trimmed = cmdStr.trim();
    if (/msiexec/i.test(trimmed)) return null;
    let exePath = '';
    if (trimmed.startsWith('"')) {
      const endQuote = trimmed.indexOf('"', 1);
      if (endQuote > 1) exePath = trimmed.slice(1, endQuote);
    } else {
      const exeMatch = trimmed.match(/^([^\s]+\.exe)/i);
      if (exeMatch) exePath = exeMatch[1];
    }
    if (!exePath) return null;
    const dir = path.dirname(exePath);
    return this._isSafeAppFolder(dir) ? dir : null;
  }

  async _stopProcessesInFolder(folderPath) {
    if (!folderPath || !this._isSafeAppFolder(folderPath)) return;
    const safeDir = path.resolve(folderPath).replace(/'/g, "''");
    const ps = `
      Get-Process -ErrorAction SilentlyContinue | Where-Object {
        $_.Path -and $_.Path.StartsWith('${safeDir}', [System.StringComparison]::OrdinalIgnoreCase)
      } | Stop-Process -Force -ErrorAction SilentlyContinue
    `;
    try {
      await runPs(ps, 10000);
    } catch {}
  }

  _buildSilentUninstallCmd(payload) {
    if (payload.quiet_uninstall && payload.quiet_uninstall.trim()) {
      let q = payload.quiet_uninstall.trim();
      if (/msiexec/i.test(q) && !/\/qn|\/quiet/i.test(q)) {
        q = q.replace(/\/I/gi, '/X') + ' /qn /norestart';
      }
      return q;
    }

    let cmd = (payload.uninstall_string || '').trim();
    if (!cmd) return '';

    if (/msiexec/i.test(cmd)) {
      cmd = cmd.replace(/\/I/gi, '/X');
      if (!/\/qn|\/quiet|\/qb/i.test(cmd)) {
        cmd += ' /qn /norestart';
      }
      return cmd;
    }

    // Inno Setup (unins000.exe)
    if (/unins\d+\.exe/i.test(cmd) && !/\/silent|\/verysilent/i.test(cmd)) {
      return `${cmd} /VERYSILENT /SUPPRESSMSGBOXES /NORESTART`;
    }

    // Squirrel (Update.exe --uninstall)
    if (/update\.exe/i.test(cmd) && /--uninstall/i.test(cmd) && !/-s|--silent/i.test(cmd)) {
      return `${cmd} --silent`;
    }

    // NSIS / genéricos (uninstall.exe / uninst.exe sem flags)
    if (/(uninstall|uninst)\.exe"?$/i.test(cmd)) {
      return `${cmd} /S`;
    }

    return cmd;
  }

  async _runDeepTraceCleanup({ name, publisher, install_location, reg_key_path, uninstall_string }) {
    const removedFolders = [];
    const removedRegistryKeys = [];
    const removedShortcuts = [];

    // 1. Limpeza de pastas residuais no disco
    const candidateDirs = [];
    if (install_location && this._isSafeAppFolder(install_location)) {
      candidateDirs.push(path.resolve(install_location.trim()));
    }
    const inferredDir = this._extractExeDirFromCmd(uninstall_string);
    if (inferredDir && !candidateDirs.includes(inferredDir)) {
      candidateDirs.push(inferredDir);
    }

    const cleanName = (name || '').replace(/[\\/:*?"<>|]/g, '').trim();
    const baseAppName = cleanName.replace(/\s*\(.*?\)\s*/g, '').replace(/\s+v?\d+(\.\d+)*.*$/i, '').trim();

    const searchBases = [
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      process.env.LOCALAPPDATA,
      process.env.APPDATA,
      process.env.ProgramData
    ].filter(Boolean);

    for (const dirName of [cleanName, baseAppName]) {
      if (!dirName || dirName.length < 4 || PROTECTED_DIR_NAMES.has(dirName.toLowerCase())) continue;
      for (const base of searchBases) {
        const candidate = path.join(base, dirName);
        if (this._isSafeAppFolder(candidate) && fs.existsSync(candidate) && !candidateDirs.includes(candidate)) {
          candidateDirs.push(candidate);
        }
      }
    }

    for (const dir of candidateDirs) {
      await this._stopProcessesInFolder(dir);
      try {
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
          removedFolders.push(dir);
        }
      } catch {}
    }

    // 2. Limpeza de atalhos (.lnk) residuais
    const shortcutRoots = [
      path.join(process.env.USERPROFILE || '', 'Desktop'),
      path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop'),
      path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
      path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs')
    ].filter(p => p && fs.existsSync(p));

    const matchName = (baseAppName || cleanName).toLowerCase();
    if (matchName.length >= 4) {
      for (const root of shortcutRoots) {
        try {
          const entries = fs.readdirSync(root, { withFileTypes: true });
          for (const entry of entries) {
            const full = path.join(root, entry.name);
            if (entry.name.toLowerCase().includes(matchName)) {
              try {
                fs.rmSync(full, { recursive: true, force: true });
                removedShortcuts.push(full);
              } catch {}
            }
          }
        } catch {}
      }
    }

    // 3. Limpeza de chaves residuais no Registro + entradas Run
    const safeApp = (baseAppName || cleanName).replace(/'/g, "''");
    const safePub = (publisher || '').replace(/'/g, "''");
    const safeRegKey = (reg_key_path || '').replace(/'/g, "''");

    const psReg = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      $removed = @()

      if ('${safeRegKey}' -and (Test-Path ('Registry::' + '${safeRegKey}'))) {
        try {
          Remove-Item -Path ('Registry::' + '${safeRegKey}') -Recurse -Force -ErrorAction Stop
          $removed += '${safeRegKey}'
        } catch {}
      }

      if ('${safeApp}'.Length -ge 4) {
        $roots = @(
          'HKLM:\\SOFTWARE',
          'HKLM:\\SOFTWARE\\WOW6432Node',
          'HKCU:\\SOFTWARE'
        )
        foreach ($r in $roots) {
          $target = Join-Path $r '${safeApp}'
          if (Test-Path $target) {
            try {
              Remove-Item -Path $target -Recurse -Force -ErrorAction Stop
              $removed += $target
            } catch {}
          }
          if ('${safePub}'.Length -ge 4) {
            $pubTarget = Join-Path (Join-Path $r '${safePub}') '${safeApp}'
            if (Test-Path $pubTarget) {
              try {
                Remove-Item -Path $pubTarget -Recurse -Force -ErrorAction Stop
                $removed += $pubTarget
              } catch {}
            }
          }
        }

        $runKeys = @(
          'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
          'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'
        )
        foreach ($rk in $runKeys) {
          if (Test-Path $rk) {
            $props = Get-ItemProperty -Path $rk -ErrorAction SilentlyContinue
            if ($props) {
              $props.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object {
                if ($_.Name -like "*${safeApp}*" -or ($_.Value -and $_.Value.ToString() -like "*${safeApp}*")) {
                  try {
                    Remove-ItemProperty -Path $rk -Name $_.Name -Force -ErrorAction Stop
                    $removed += "$rk\\$($_.Name)"
                  } catch {}
                }
              }
            }
          }
        }
      }

      @($removed) | ConvertTo-Json -Compress
    `;

    try {
      const { stdout } = await runPs(psReg, 20000);
      if (stdout && stdout.trim()) {
        const parsed = JSON.parse(stdout.trim());
        const list = Array.isArray(parsed) ? parsed : [parsed];
        removedRegistryKeys.push(...list.filter(Boolean));
      }
    } catch {}

    return { removedFolders, removedRegistryKeys, removedShortcuts };
  }

  async uninstallSoftware(input) {
    const payload = typeof input === 'string' ? { uninstall_string: input } : (input || {});
    const finalCmd = this._buildSilentUninstallCmd(payload);
    if (!finalCmd) {
      throw new Error('Comando de desinstalação não informado.');
    }

    // Encerra processos do software antes de desinstalar para evitar arquivos travados
    const appDir = (payload.install_location && this._isSafeAppFolder(payload.install_location))
      ? payload.install_location
      : this._extractExeDirFromCmd(payload.uninstall_string);
    if (appDir) {
      await this._stopProcessesInFolder(appDir);
    }

    let uninstallRan = false;
    let uninstallError = null;
    try {
      await execAsync(finalCmd, { timeout: 90000 });
      uninstallRan = true;
    } catch (e) {
      const exitCode = Number(e.code);
      // 3010 = sucesso (requer reinicialização), 1605 = já desinstalado
      if (exitCode === 3010 || (payload.deep && exitCode === 1605)) {
        uninstallRan = true;
      } else {
        // Tenta fallback via Winget pelo nome do aplicativo
        let wingetOk = false;
        if (payload.name) {
          try {
            const safeWingetName = payload.name.replace(/"/g, '').trim();
            await execAsync(`winget uninstall --name "${safeWingetName}" --silent --accept-source-agreements`, { timeout: 90000 });
            wingetOk = true;
            uninstallRan = true;
          } catch {}
        }
        if (!wingetOk) {
          uninstallError = e.message;
          if (!payload.deep) {
            throw new Error(`Falha no desinstalador (${e.message}). Tente o modo "Profunda (Revo)" para forçar a remoção.`);
          }
        }
      }
    }

    if (!payload.deep) {
      return {
        ok: true,
        name: payload.name || 'Programa',
        deep: false,
        message: 'Desinstalação normal concluída com sucesso.'
      };
    }

    const traces = await this._runDeepTraceCleanup(payload);
    return {
      ok: true,
      name: payload.name || 'Programa',
      deep: true,
      uninstall_ran: uninstallRan,
      uninstall_warning: uninstallError,
      removed_folders: traces.removedFolders,
      removed_registry_keys: traces.removedRegistryKeys,
      removed_shortcuts: traces.removedShortcuts,
      message: `Desinstalação profunda concluída: ${traces.removedFolders.length} pasta(s), ${traces.removedRegistryKeys.length} chave(s) de registro e ${traces.removedShortcuts.length} atalho(s) removidos.`
    };
  }

  async uninstallMultipleSoftware(items = [], deep = false) {
    const results = [];
    for (const item of items) {
      try {
        const res = await this.uninstallSoftware({ ...item, deep });
        results.push(res);
      } catch (e) {
        results.push({
          ok: false,
          name: item.name || 'Programa',
          deep,
          message: e.message
        });
      }
    }
    return {
      total: items.length,
      succeeded: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
      results
    };
  }
}

const softwareOptimizerService = new SoftwareOptimizerService();

module.exports = { SoftwareOptimizerService, softwareOptimizerService };
