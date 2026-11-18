'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { exec, execSync } = require('node:child_process');
const { promisify } = require('node:util');
const { dataDir } = require('../utils/paths');

const execAsync = promisify(exec);

class AdminElevationService {
  constructor() {
    this.configFile = path.join(dataDir(), 'admin_elevation.json');
    this.userConfirmed = false;
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.configFile)) {
        const raw = fs.readFileSync(this.configFile, 'utf8');
        const data = JSON.parse(raw);
        this.userConfirmed = Boolean(data.userConfirmed);
      }
    } catch {
      this.userConfirmed = false;
    }
  }

  save() {
    try {
      fs.writeFileSync(this.configFile, JSON.stringify({ userConfirmed: this.userConfirmed }, null, 2), 'utf8');
    } catch (e) {
      console.error('[AdminElevationService] Falha ao persistir status de elevação:', e.message);
    }
  }

  isProcessElevated() {
    if (process.platform !== 'win32') return true;
    try {
      const out = execSync('whoami /groups', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      return out.includes('S-1-16-12288') || out.includes('S-1-16-16384');
    } catch {
      return false;
    }
  }

  isElevated(nativeElevated = false) {
    this.load();
    return Boolean(nativeElevated || this.isProcessElevated() || this.userConfirmed);
  }

  confirmElevation() {
    this.userConfirmed = true;
    this.save();
    return true;
  }

  revokeElevation() {
    this.userConfirmed = false;
    this.save();
    return false;
  }

  setElevation(enabled) {
    this.userConfirmed = Boolean(enabled);
    this.save();
    return this.userConfirmed;
  }

  toggleElevation() {
    this.userConfirmed = !this.userConfirmed;
    this.save();
    return this.userConfirmed;
  }

  async triggerWindowsUac() {
    try {
      const script = `Start-Process powershell -ArgumentList '-NoProfile -Command Write-Host DC-TI Privilégios Elevados' -Verb RunAs -WindowStyle Hidden`;
      await execAsync(`powershell.exe -NoProfile -Command "${script}"`);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async relaunchElevated() {
    try {
      const rootDir = path.resolve(__dirname, '..', '..');
      const startScript = path.join(rootDir, 'scripts', 'start-electron.js');
      const cmd = `Start-Process node -ArgumentList '\"${startScript}\"' -Verb RunAs`;
      await execAsync(`powershell.exe -NoProfile -Command "${cmd}"`);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}

const adminElevationService = new AdminElevationService();

module.exports = { AdminElevationService, adminElevationService };
