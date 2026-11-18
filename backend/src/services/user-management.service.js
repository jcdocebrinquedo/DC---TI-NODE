'use strict';

const { exec } = require('node:child_process');
const { promisify } = require('node:util');
const { validationError } = require('../utils/app-error');

const execAsync = promisify(exec);

function runPs(script, timeout = 25000) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return execAsync(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, {
    timeout,
    maxBuffer: 1024 * 1024 * 5
  });
}

const PROTECTED_SYSTEM_ACCOUNTS = new Set([
  'wdagutilityaccount',
  'defaultaccount',
  'guest',
  'convidado',
  'administrator',
  'administrador'
]);

class UserManagementService {
  async listLocalGroups() {
    const ps = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      $groups = Get-LocalGroup -ErrorAction Stop | ForEach-Object {
        [PSCustomObject]@{
          name = $_.Name
          description = $_.Description
        }
      } | Sort-Object name
      @($groups) | ConvertTo-Json -Depth 3 -Compress
    `;
    const { stdout } = await runPs(ps);
    if (!stdout || !stdout.trim()) return [];
    const parsed = JSON.parse(stdout.trim());
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  async getUserGroups(username) {
    const clean = (username || '').trim();
    if (!clean) throw validationError('Nome de usuário é obrigatório.');
    const safeUser = clean.replace(/'/g, "''");

    const ps = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      $target = '${safeUser}'
      $memberOf = @()
      Get-LocalGroup -ErrorAction SilentlyContinue | ForEach-Object {
        $grp = $_.Name
        $match = Get-LocalGroupMember -Group $grp -ErrorAction SilentlyContinue | Where-Object {
          $_.Name -eq $target -or $_.Name -like "*\\$target"
        }
        if ($match) {
          $memberOf += $grp
        }
      }
      @($memberOf) | ConvertTo-Json -Compress
    `;

    const { stdout } = await runPs(ps);
    if (!stdout || !stdout.trim()) return [];
    const parsed = JSON.parse(stdout.trim());
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  async setUserGroups(username, targetGroups = []) {
    const clean = (username || '').trim();
    if (!clean) throw validationError('Nome de usuário é obrigatório.');
    if (!Array.isArray(targetGroups)) throw validationError('Lista de grupos inválida.');

    const currentGroups = await this.getUserGroups(clean);
    const desiredSet = new Set(targetGroups.map(g => String(g).trim()).filter(Boolean));
    const currentSet = new Set(currentGroups);

    const toAdd = [...desiredSet].filter(g => !currentSet.has(g));
    const toRemove = [...currentSet].filter(g => !desiredSet.has(g));

    const safeUser = clean.replace(/'/g, "''");
    const addJson = JSON.stringify(toAdd).replace(/'/g, "''");
    const remJson = JSON.stringify(toRemove).replace(/'/g, "''");

    const ps = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      $user = '${safeUser}'
      $toAdd = ConvertFrom-Json '${addJson}'
      $toRemove = ConvertFrom-Json '${remJson}'
      $added = @()
      $removed = @()
      $errors = @()

      foreach ($g in $toAdd) {
        try {
          Add-LocalGroupMember -Group $g -Member $user -ErrorAction Stop
          $added += $g
        } catch {
          $netOut = & net.exe localgroup "$g" "$user" /add 2>&1
          if ($LASTEXITCODE -eq 0) {
            $added += $g
          } else {
            $errors += "Adicionar '$g': $($_.Exception.Message)"
          }
        }
      }

      foreach ($g in $toRemove) {
        try {
          Remove-LocalGroupMember -Group $g -Member $user -ErrorAction Stop
          $removed += $g
        } catch {
          $netOut = & net.exe localgroup "$g" "$user" /delete 2>&1
          if ($LASTEXITCODE -eq 0) {
            $removed += $g
          } else {
            $errors += "Remover '$g': $($_.Exception.Message)"
          }
        }
      }

      [PSCustomObject]@{
        ok = ($errors.Count -eq 0)
        username = $user
        added = @($added)
        removed = @($removed)
        errors = @($errors)
      } | ConvertTo-Json -Depth 3 -Compress
    `;

    const { stdout } = await runPs(ps);
    const result = JSON.parse(stdout.trim());
    if (!result.ok && result.errors?.length) {
      throw new Error(result.errors.join(' | '));
    }
    return {
      ...result,
      current_groups: await this.getUserGroups(clean)
    };
  }

  async deleteUser(username) {
    const clean = (username || '').trim();
    if (!clean) throw validationError('Nome de usuário é obrigatório.');

    const currentSessionUser = (process.env.USERNAME || '').trim();
    if (currentSessionUser && clean.toLowerCase() === currentSessionUser.toLowerCase()) {
      throw validationError(`Não é permitido remover a conta da sessão atual (${clean}).`);
    }

    if (PROTECTED_SYSTEM_ACCOUNTS.has(clean.toLowerCase())) {
      throw validationError(`A conta '${clean}' é uma conta interna protegida do Windows e não pode ser removida.`);
    }

    const safeUser = clean.replace(/'/g, "''");
    const ps = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      try {
        Remove-LocalUser -Name '${safeUser}' -ErrorAction Stop
        [PSCustomObject]@{ ok = $true; removed_username = '${safeUser}' } | ConvertTo-Json -Compress
      } catch {
        $errMsg = $_.Exception.Message
        $netOut = & net.exe user "${safeUser}" /delete 2>&1
        if ($LASTEXITCODE -eq 0) {
          [PSCustomObject]@{ ok = $true; removed_username = '${safeUser}' } | ConvertTo-Json -Compress
        } else {
          [PSCustomObject]@{ ok = $false; error = $errMsg } | ConvertTo-Json -Compress
        }
      }
    `;

    const { stdout } = await runPs(ps);
    const parsed = JSON.parse(stdout.trim());
    if (!parsed.ok) {
      const msg = parsed.error || 'Falha ao remover usuário.';
      if (/3221225764|built-in|protected|protegida/i.test(msg)) {
        throw validationError(`O Windows não permite remover a conta '${clean}' (conta protegida/sistema ou erro interno SAM).`);
      }
      throw new Error(msg);
    }
    return parsed;
  }
}

const userManagementService = new UserManagementService();

module.exports = { UserManagementService, userManagementService };
