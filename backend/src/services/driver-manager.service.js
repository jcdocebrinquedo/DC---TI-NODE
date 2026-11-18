'use strict';

const { exec, spawn } = require('node:child_process');
const { promisify } = require('node:util');

const execAsync = promisify(exec);

function runPs(script, timeout = 30000) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return execAsync(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, {
    timeout,
    maxBuffer: 1024 * 1024 * 10
  });
}

class DriverManagerService {
  async scanDrivers() {
    const ps = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      $pnpErrors = @{}
      Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue | Where-Object { $_.ConfigManagerErrorCode -ne 0 } | ForEach-Object {
        $pnpErrors[$_.DeviceID] = [int]$_.ConfigManagerErrorCode
      }

      $drivers = Get-CimInstance Win32_PnPSignedDriver -ErrorAction SilentlyContinue | Where-Object { $_.DeviceName } | ForEach-Object {
        $devId = $_.DeviceID
        $errCode = if ($devId -and $pnpErrors.ContainsKey($devId)) { $pnpErrors[$devId] } else { 0 }
        $hwId = if ($_.HardwareID -and $_.HardwareID.Count -gt 0) { $_.HardwareID[0] } else { '' }
        $rawDate = $_.DriverDate
        $fmtDate = if ($rawDate) { ([datetime]$rawDate).ToString('dd/MM/yyyy') } else { '' }
        [PSCustomObject]@{
          device_name = $_.DeviceName
          device_class = $_.DeviceClass
          manufacturer = $_.Manufacturer
          driver_version = $_.DriverVersion
          driver_date = $fmtDate
          inf_name = $_.InfName
          hardware_id = $hwId
          device_id = $devId
          error_code = $errCode
          has_error = ($errCode -ne 0)
        }
      }

      # Também inclui dispositivos sem driver assinado que possuem erro no PnPEntity
      $signedIds = @{}
      $drivers | ForEach-Object { if ($_.device_id) { $signedIds[$_.device_id] = $true } }
      $extraErrors = Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue | Where-Object { $_.ConfigManagerErrorCode -ne 0 -and -not $signedIds.ContainsKey($_.DeviceID) } | ForEach-Object {
        $hwId = if ($_.HardwareID -and $_.HardwareID.Count -gt 0) { $_.HardwareID[0] } else { '' }
        [PSCustomObject]@{
          device_name = if ($_.Name) { $_.Name } else { $_.DeviceID }
          device_class = $_.PNPClass
          manufacturer = $_.Manufacturer
          driver_version = 'Sem driver'
          driver_date = ''
          inf_name = ''
          hardware_id = $hwId
          device_id = $_.DeviceID
          error_code = [int]$_.ConfigManagerErrorCode
          has_error = $true
        }
      }

      $all = @($extraErrors) + @($drivers)
      $sys = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue
      [PSCustomObject]@{
        system_manufacturer = if ($sys) { $sys.Manufacturer } else { '' }
        system_model = if ($sys) { $sys.Model } else { '' }
        total = $all.Count
        errors_count = (@($all | Where-Object { $_.has_error })).Count
        drivers = $all | Sort-Object @{Expression='has_error';Descending=$true}, device_class, device_name
      } | ConvertTo-Json -Depth 4 -Compress
    `;

    try {
      const { stdout } = await runPs(ps, 35000);
      if (!stdout || !stdout.trim()) {
        return { system_manufacturer: '', system_model: '', total: 0, errors_count: 0, drivers: [] };
      }
      const data = JSON.parse(stdout.trim());
      if (data && !Array.isArray(data.drivers)) {
        data.drivers = data.drivers ? [data.drivers] : [];
      }
      return data;
    } catch (e) {
      throw new Error(`Falha ao escanear drivers do sistema: ${e.message}`);
    }
  }

  async checkDriverUpdates() {
    const ps = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      try {
        $session = New-Object -ComObject Microsoft.Update.Session
        $searcher = $session.CreateUpdateSearcher()
        $result = $searcher.Search("IsInstalled=0 and Type='Driver'")
        $updates = @()
        foreach ($u in $result.Updates) {
          $updates += [PSCustomObject]@{
            update_id = $u.Identity.UpdateID
            title = $u.Title
            driver_class = $u.DriverClass
            driver_manufacturer = $u.DriverManufacturer
            driver_model = $u.DriverModel
            driver_provider = $u.DriverProvider
            driver_ver_date = if ($u.DriverVerDate) { ([datetime]$u.DriverVerDate).ToString('dd/MM/yyyy') } else { '' }
            size_mb = [math]::Round($u.MaxDownloadSize / 1MB, 2)
            is_downloaded = [bool]$u.IsDownloaded
            reboot_required = [bool]$u.RebootRequired
          }
        }
        [PSCustomObject]@{
          ok = $true
          count = $updates.Count
          updates = $updates
        } | ConvertTo-Json -Depth 4 -Compress
      } catch {
        [PSCustomObject]@{
          ok = $false
          count = 0
          updates = @()
          error = $_.Exception.Message
        } | ConvertTo-Json -Depth 3 -Compress
      }
    `;

    try {
      const { stdout } = await runPs(ps, 60000);
      if (!stdout || !stdout.trim()) {
        return { ok: false, count: 0, updates: [], error: 'Sem resposta do Windows Update Driver Search.' };
      }
      const parsed = JSON.parse(stdout.trim());
      if (parsed && !Array.isArray(parsed.updates)) {
        parsed.updates = parsed.updates ? [parsed.updates] : [];
      }
      return parsed;
    } catch (e) {
      return { ok: false, count: 0, updates: [], error: e.message };
    }
  }

  async installDriverUpdate({ updateId, infPath }) {
    if (infPath && typeof infPath === 'string' && infPath.trim()) {
      const cleanPath = infPath.trim().replace(/"/g, '');
      const { stdout, stderr } = await execAsync(`pnputil /add-driver "${cleanPath}" /install`, {
        timeout: 60000,
        maxBuffer: 1024 * 1024 * 5
      });
      return {
        ok: true,
        method: 'pnputil',
        message: stdout.trim() || stderr.trim() || 'Driver .inf instalado com sucesso.',
        reboot_required: /reboot|reiniciar/i.test(stdout)
      };
    }

    if (!updateId || typeof updateId !== 'string') {
      throw new Error('Informe o UpdateID do driver ou o caminho de um arquivo .inf.');
    }

    const safeId = updateId.replace(/[^a-zA-Z0-9-]/g, '');
    const ps = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      try {
        $session = New-Object -ComObject Microsoft.Update.Session
        $searcher = $session.CreateUpdateSearcher()
        $result = $searcher.Search("IsInstalled=0 and Type='Driver'")
        $toInstall = New-Object -ComObject Microsoft.Update.UpdateColl
        foreach ($u in $result.Updates) {
          if ($u.Identity.UpdateID -eq '${safeId}') {
            if (-not $u.EulaAccepted) { $u.AcceptEula() }
            $toInstall.Add($u) | Out-Null
          }
        }
        if ($toInstall.Count -eq 0) {
          [PSCustomObject]@{ ok = $false; message = 'Atualização de driver não encontrada ou já instalada.' } | ConvertTo-Json -Compress
          exit 0
        }
        $downloader = $session.CreateUpdateDownloader()
        $downloader.Updates = $toInstall
        $dlRes = $downloader.Download()

        $installer = $session.CreateUpdateInstaller()
        $installer.Updates = $toInstall
        $instRes = $installer.Install()

        [PSCustomObject]@{
          ok = ($instRes.ResultCode -eq 2 -or $instRes.ResultCode -eq 3)
          result_code = $instRes.ResultCode
          reboot_required = [bool]$instRes.RebootRequired
          message = if ($instRes.ResultCode -eq 2) { 'Driver baixado e instalado com sucesso.' } elseif ($instRes.ResultCode -eq 3) { 'Driver instalado com avisos.' } else { 'Falha na instalação (código ' + $instRes.ResultCode + ').' }
        } | ConvertTo-Json -Compress
      } catch {
        [PSCustomObject]@{ ok = $false; message = $_.Exception.Message } | ConvertTo-Json -Compress
      }
    `;

    const { stdout } = await runPs(ps, 120000);
    return JSON.parse(stdout.trim());
  }

  resolveExternalDriverUrl({ manufacturer = '', hardwareId = '', systemManufacturer = '', deviceName = '' }) {
    const mfg = `${manufacturer} ${systemManufacturer} ${deviceName}`.toLowerCase();
    if (mfg.includes('nvidia')) return 'https://www.nvidia.com/Download/index.aspx?lang=br';
    if (mfg.includes('amd') || mfg.includes('radeon') || mfg.includes('ryzen')) return 'https://www.amd.com/pt/support/download/drivers.html';
    if (mfg.includes('intel')) return 'https://www.intel.com.br/content/www/br/pt/support/detect.html';
    if (mfg.includes('realtek')) return 'https://www.realtek.com/Download/Index?cate_id=193';
    if (mfg.includes('dell')) return 'https://www.dell.com/support/home/pt-br?app=drivers';
    if (mfg.includes('lenovo')) return 'https://pcsupport.lenovo.com/br/pt';
    if (mfg.includes('hp') || mfg.includes('hewlett')) return 'https://support.hp.com/br-pt/drivers';
    if (mfg.includes('asus')) return 'https://www.asus.com/br/support/Download-Center/';
    if (mfg.includes('acer')) return 'https://www.acer.com/br-pt/support/drivers-and-manuals';

    if (hardwareId && hardwareId.trim()) {
      return `https://www.catalog.update.microsoft.com/Search.aspx?q=${encodeURIComponent(hardwareId.trim())}`;
    }
    return `https://www.catalog.update.microsoft.com/Search.aspx?q=${encodeURIComponent(deviceName || manufacturer || 'driver')}`;
  }

  openExternalUrl(url) {
    if (!url || !/^https?:\/\//i.test(url)) {
      throw new Error('URL externa inválida.');
    }
    const p = spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
    p.unref();
    return { opened: url };
  }
}

const driverManagerService = new DriverManagerService();

module.exports = { DriverManagerService, driverManagerService };
