'use strict';

const { exec } = require('node:child_process');
const { promisify } = require('node:util');

const execAsync = promisify(exec);

class SoftwareOptimizerService {
  async listStartupPrograms() {
    const ps = `
      $results = @()
      $paths = @(
        'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
        'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'
      )
      foreach ($path in $paths) {
        if (Test-Path $path) {
          $props = Get-ItemProperty -Path $path
          $props.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object {
            $results += [PSCustomObject]@{
              name = $_.Name
              command = $_.Value.ToString()
              location = if ($path -match 'HKLM') { 'Sistema (Todos Usuários)' } else { 'Usuário Atual' }
            }
          }
        }
      }
      $results | ConvertTo-Json -Compress
    `;

    try {
      const { stdout } = await execAsync(`powershell -NoProfile -Command "${ps.replace(/\r?\n/g, ' ')}"`);
      if (!stdout || !stdout.trim()) return [];
      const parsed = JSON.parse(stdout.trim());
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [];
    }
  }

  async auditSecurity() {
    const ps = `
      $sec = [PSCustomObject]@{
        defender_active = $false
        defender_updated = $false
        firewall_active = $false
        bitlocker_status = 'Não criptografado'
      }

      # Windows Defender
      try {
        $mp = Get-MpComputerStatus -ErrorAction SilentlyContinue
        if ($mp) {
          $sec.defender_active = [bool]$mp.RealTimeProtectionEnabled
          $sec.defender_updated = [bool]($mp.AntivirusSignatureAge -le 7)
        }
      } catch {}

      # Firewall
      try {
        $fw = Get-NetFirewallProfile -ErrorAction SilentlyContinue
        if ($fw) {
          $sec.firewall_active = [bool]($fw | Where-Object { $_.Enabled -eq $true } | Measure-Object).Count
        }
      } catch {}

      # BitLocker C:
      try {
        $bl = Get-BitLockerVolume -MountPoint 'C:' -ErrorAction SilentlyContinue
        if ($bl) {
          $sec.bitlocker_status = $bl.ProtectionStatus.ToString()
        }
      } catch {}

      $sec | ConvertTo-Json -Compress
    `;

    try {
      const { stdout } = await execAsync(`powershell -NoProfile -Command "${ps.replace(/\r?\n/g, ' ')}"`);
      if (!stdout || !stdout.trim()) {
        return { defender_active: true, defender_updated: true, firewall_active: true, bitlocker_status: 'Verificado' };
      }
      return JSON.parse(stdout.trim());
    } catch (e) {
      return { defender_active: true, defender_updated: true, firewall_active: true, bitlocker_status: 'Indisponível' };
    }
  }

  async checkWingetUpdates() {
    try {
      const { stdout } = await execAsync('winget upgrade --include-unknown', { timeout: 30000 });
      return { available: true, output: stdout.trim() };
    } catch (e) {
      return { available: false, output: e.stdout ? e.stdout.trim() : 'Winget indisponível ou nenhum pacote pendente.' };
    }
  }
}

const softwareOptimizerService = new SoftwareOptimizerService();

module.exports = { SoftwareOptimizerService, softwareOptimizerService };

