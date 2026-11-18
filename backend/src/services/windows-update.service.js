'use strict';

const { exec } = require('node:child_process');
const { promisify } = require('node:util');

const execAsync = promisify(exec);

function runPs(script, timeout = 45000) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return execAsync(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, {
    timeout,
    maxBuffer: 1024 * 1024 * 5
  });
}

class WindowsUpdateService {
  async getStatus() {
    const ps = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      $svcNames = @('wuauserv', 'UsoSvc', 'WaaSMedicSvc', 'bits')
      $services = @()
      foreach ($name in $svcNames) {
        $s = Get-Service -Name $name -ErrorAction SilentlyContinue
        $regStart = $null
        try {
          $regPath = "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\$name"
          if (Test-Path $regPath) {
            $regStart = (Get-ItemProperty -Path $regPath -Name Start -ErrorAction SilentlyContinue).Start
          }
        } catch {}
        $services += [PSCustomObject]@{
          name = $name
          status = if ($s) { $s.Status.ToString() } else { 'Não encontrado' }
          start_type = if ($s) { $s.StartType.ToString() } else { 'Unknown' }
          reg_start = $regStart
        }
      }

      $noAutoUpdate = 0
      try {
        $auPath = 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU'
        if (Test-Path $auPath) {
          $val = (Get-ItemProperty -Path $auPath -Name NoAutoUpdate -ErrorAction SilentlyContinue).NoAutoUpdate
          if ($null -ne $val) { $noAutoUpdate = [int]$val }
        }
      } catch {}

      $wuSvc = $services | Where-Object { $_.name -eq 'wuauserv' } | Select-Object -First 1
      $usoSvc = $services | Where-Object { $_.name -eq 'UsoSvc' } | Select-Object -First 1
      $isPermDisabled = ($noAutoUpdate -eq 1) -and ($wuSvc.reg_start -eq 4) -and ($usoSvc.reg_start -eq 4)

      [PSCustomObject]@{
        mode = if ($isPermDisabled) { 'DESABILITADO_PERMANENTEMENTE' } elseif ($wuSvc.reg_start -eq 4) { 'DESABILITADO_PARCIAL' } else { 'ATIVO_PADRAO' }
        no_auto_update_policy = ($noAutoUpdate -eq 1)
        services = $services
      } | ConvertTo-Json -Depth 4 -Compress
    `;

    try {
      const { stdout } = await runPs(ps);
      return JSON.parse(stdout.trim());
    } catch (e) {
      throw new Error(`Falha ao consultar status do Windows Update: ${e.message}`);
    }
  }

  async repairWindowsUpdate() {
    const start = Date.now();
    const ps = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      $svcs = @('wuauserv', 'cryptSvc', 'bits', 'msiserver')
      foreach ($s in $svcs) {
        Stop-Service -Name $s -Force -ErrorAction SilentlyContinue
      }

      $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
      $sd = "$env:SystemRoot\\SoftwareDistribution"
      $cat = "$env:SystemRoot\\System32\\catroot2"
      if (Test-Path $sd) {
        Rename-Item -Path $sd -NewName "SoftwareDistribution.bak_$stamp" -Force -ErrorAction SilentlyContinue
      }
      if (Test-Path $cat) {
        Rename-Item -Path $cat -NewName "catroot2.bak_$stamp" -Force -ErrorAction SilentlyContinue
      }

      foreach ($s in $svcs) {
        Set-Service -Name $s -StartupType Manual -ErrorAction SilentlyContinue
        Start-Service -Name $s -ErrorAction SilentlyContinue
      }

      [PSCustomObject]@{
        ok = $true
        task_name = 'Reparo Completo do Windows Update'
        output_summary = 'Serviços (wuauserv, bits, cryptSvc, msiserver) parados, pastas SoftwareDistribution e catroot2 redefinidas e serviços reiniciados.'
      } | ConvertTo-Json -Compress
    `;

    try {
      const { stdout } = await runPs(ps, 90000);
      const res = JSON.parse(stdout.trim());
      return {
        ...res,
        command: 'Reset wuauserv/bits/cryptSvc/msiserver + SoftwareDistribution & catroot2',
        exit_code: 0,
        success: true,
        duration_seconds: (Date.now() - start) / 1000
      };
    } catch (e) {
      return {
        task_name: 'Reparo Completo do Windows Update',
        command: 'Reset wuauserv/bits/cryptSvc/msiserver + SoftwareDistribution & catroot2',
        exit_code: e.code || -1,
        output_summary: `Falha no reparo: ${e.message}`,
        success: false,
        duration_seconds: (Date.now() - start) / 1000
      };
    }
  }

  async disablePermanently() {
    const ps = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      $targets = @('wuauserv', 'UsoSvc', 'WaaSMedicSvc')
      foreach ($svc in $targets) {
        Stop-Service -Name $svc -Force -ErrorAction SilentlyContinue
        Set-Service -Name $svc -StartupType Disabled -ErrorAction SilentlyContinue
        $regPath = "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\$svc"
        if (Test-Path $regPath) {
          Set-ItemProperty -Path $regPath -Name 'Start' -Value 4 -Type DWord -Force -ErrorAction SilentlyContinue
        }
      }

      $auPath = 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU'
      if (-not (Test-Path $auPath)) {
        New-Item -Path $auPath -Force | Out-Null
      }
      Set-ItemProperty -Path $auPath -Name 'NoAutoUpdate' -Value 1 -Type DWord -Force
      Set-ItemProperty -Path $auPath -Name 'AUOptions' -Value 1 -Type DWord -Force

      $taskPaths = @('\\Microsoft\\Windows\\WindowsUpdate\\*', '\\Microsoft\\Windows\\UpdateOrchestrator\\*')
      foreach ($tp in $taskPaths) {
        Get-ScheduledTask -TaskPath ($tp -replace '\\*$', '') -ErrorAction SilentlyContinue | ForEach-Object {
          Disable-ScheduledTask -InputObject $_ -ErrorAction SilentlyContinue | Out-Null
        }
      }

      [PSCustomObject]@{
        ok = $true
        message = 'Windows Update desabilitado permanentemente (serviços wuauserv/UsoSvc/WaaSMedicSvc, políticas de Registro NoAutoUpdate=1 e tarefas agendadas bloqueadas).'
      } | ConvertTo-Json -Compress
    `;

    const { stdout } = await runPs(ps, 45000);
    return JSON.parse(stdout.trim());
  }

  async enableDefault() {
    const ps = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      $serviceDefaults = @{
        'wuauserv' = 3
        'UsoSvc' = 3
        'WaaSMedicSvc' = 3
        'bits' = 3
      }
      foreach ($kv in $serviceDefaults.GetEnumerator()) {
        $regPath = "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\$($kv.Key)"
        if (Test-Path $regPath) {
          Set-ItemProperty -Path $regPath -Name 'Start' -Value $kv.Value -Type DWord -Force -ErrorAction SilentlyContinue
        }
        Set-Service -Name $kv.Key -StartupType Manual -ErrorAction SilentlyContinue
      }

      $auPath = 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU'
      if (Test-Path $auPath) {
        Remove-ItemProperty -Path $auPath -Name 'NoAutoUpdate' -ErrorAction SilentlyContinue
        Remove-ItemProperty -Path $auPath -Name 'AUOptions' -ErrorAction SilentlyContinue
      }

      foreach ($tp in @('\\Microsoft\\Windows\\WindowsUpdate\\', '\\Microsoft\\Windows\\UpdateOrchestrator\\')) {
        Get-ScheduledTask -TaskPath $tp -ErrorAction SilentlyContinue | ForEach-Object {
          Enable-ScheduledTask -InputObject $_ -ErrorAction SilentlyContinue | Out-Null
        }
      }

      Start-Service -Name 'wuauserv' -ErrorAction SilentlyContinue

      [PSCustomObject]@{
        ok = $true
        message = 'Windows Update restaurado para o comportamento padrão (serviços em Manual, políticas removidas e tarefas reativadas).'
      } | ConvertTo-Json -Compress
    `;

    const { stdout } = await runPs(ps, 45000);
    return JSON.parse(stdout.trim());
  }
}

const windowsUpdateService = new WindowsUpdateService();

module.exports = { WindowsUpdateService, windowsUpdateService };
