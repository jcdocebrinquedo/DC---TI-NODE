'use strict';

const { exec } = require('node:child_process');
const { promisify } = require('node:util');

const execAsync = promisify(exec);

function runPs(script, timeout = 20000) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return execAsync(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, {
    timeout,
    maxBuffer: 1024 * 1024 * 5
  });
}

class PrinterManagerService {
  async listPrinters() {
    const ps = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      $defaultName = ''
      try {
        $def = Get-CimInstance Win32_Printer -ErrorAction SilentlyContinue | Where-Object { $_.Default -eq $true } | Select-Object -First 1
        if ($def) { $defaultName = $def.Name }
      } catch {}

      $printers = Get-Printer -ErrorAction SilentlyContinue | ForEach-Object {
        $jobsCount = 0
        try {
          $jobs = Get-PrintJob -PrinterName $_.Name -ErrorAction SilentlyContinue
          if ($jobs) { $jobsCount = @($jobs).Count }
        } catch {}

        [PSCustomObject]@{
          name = $_.Name
          driver_name = $_.DriverName
          port_name = $_.PortName
          printer_status = $_.PrinterStatus.ToString()
          shared = [bool]$_.Shared
          is_default = ($_.Name -eq $defaultName)
          jobs_count = $jobsCount
          type = if ($_.PortName -match '^\\d+\\.\\d+\\.\\d+\\.\\d+|^IP_|^WSD') { 'Rede / IP' } elseif ($_.PortName -match 'USB') { 'USB Local' } else { 'Sistema / Virtual' }
        }
      }
      @($printers) | ConvertTo-Json -Depth 3 -Compress
    `;

    try {
      const { stdout } = await runPs(ps);
      if (!stdout || !stdout.trim()) return [];
      const parsed = JSON.parse(stdout.trim());
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch (e) {
      throw new Error(`Falha ao listar impressoras: ${e.message}`);
    }
  }

  async clearQueue(printerName) {
    if (!printerName || typeof printerName !== 'string') {
      throw new Error('Nome da impressora é obrigatório.');
    }
    const safeName = printerName.replace(/'/g, "''");
    const ps = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      $jobs = Get-PrintJob -PrinterName '${safeName}' -ErrorAction SilentlyContinue
      $count = if ($jobs) { @($jobs).Count } else { 0 }
      if ($count -gt 0) {
        $jobs | Remove-PrintJob -ErrorAction SilentlyContinue
      }
      [PSCustomObject]@{ ok = $true; printer = '${safeName}'; cleared_jobs = $count } | ConvertTo-Json -Compress
    `;
    const { stdout } = await runPs(ps);
    return JSON.parse(stdout.trim());
  }

  async setDefault(printerName) {
    if (!printerName || typeof printerName !== 'string') {
      throw new Error('Nome da impressora é obrigatório.');
    }
    const safeName = printerName.replace(/'/g, "''");
    const ps = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      $p = Get-CimInstance Win32_Printer -Filter "Name='${safeName}'"
      if (-not $p) { throw "Impressora não encontrada." }
      $res = Invoke-CimMethod -InputObject $p -MethodName SetDefaultPrinter
      [PSCustomObject]@{ ok = ($res.ReturnValue -eq 0); printer = '${safeName}' } | ConvertTo-Json -Compress
    `;
    const { stdout } = await runPs(ps);
    return JSON.parse(stdout.trim());
  }

  async printTestPage(printerName) {
    if (!printerName || typeof printerName !== 'string') {
      throw new Error('Nome da impressora é obrigatório.');
    }
    const safeName = printerName.replace(/'/g, "''");
    const ps = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      $p = Get-CimInstance Win32_Printer -Filter "Name='${safeName}'"
      if (-not $p) { throw "Impressora não encontrada." }
      $res = Invoke-CimMethod -InputObject $p -MethodName PrintTestPage
      [PSCustomObject]@{ ok = ($res.ReturnValue -eq 0); printer = '${safeName}' } | ConvertTo-Json -Compress
    `;
    const { stdout } = await runPs(ps);
    return JSON.parse(stdout.trim());
  }
}

const printerManagerService = new PrinterManagerService();

module.exports = { PrinterManagerService, printerManagerService };
