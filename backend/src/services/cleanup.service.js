'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { exec } = require('node:child_process');
const { promisify } = require('node:util');
const { Worker } = require('node:worker_threads');
const { formatLocalDateTime } = require('../utils/local-date');

const execAsync = promisify(exec);

const DISK_ANALYZER_WORKER = `
const fs = require('node:fs');
const path = require('node:path');
const { parentPort, workerData } = require('worker_threads');

function getDirSizeFast(dirPath, maxDepth = 3, maxEntries = 25000) {
  let total = 0;
  let visited = 0;
  const stack = [{ p: dirPath, d: 0 }];
  while (stack.length > 0 && visited < maxEntries) {
    const { p, d } = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(p, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (visited++ >= maxEntries) break;
      if (entry.isSymbolicLink()) continue;
      const full = path.join(p, entry.name);
      if (entry.isDirectory()) {
        if (d < maxDepth && entry.name !== 'node_modules' && entry.name !== '.git') {
          stack.push({ p: full, d: d + 1 });
        }
      } else if (entry.isFile()) {
        try {
          total += fs.statSync(full).size;
        } catch {}
      }
    }
  }
  return total;
}

const results = [];
for (const item of workerData.foldersToCheck) {
  if (!fs.existsSync(item.path)) continue;
  const bytes = getDirSizeFast(item.path, 3, 25000);
  results.push({
    label: item.label,
    path: item.path,
    size_mb: Math.round((bytes / (1024 * 1024)) * 10) / 10,
    size_gb: Math.round((bytes / (1024 * 1024 * 1024)) * 100) / 100
  });
}
results.sort((a, b) => b.size_mb - a.size_mb);
parentPort.postMessage(results.slice(0, 15));
`;

class CleanupService {
  async runDeepCleanup(options = {}) {
    const opts = {
      clean_user_temp: true,
      clean_windows_temp: true,
      clean_prefetch: true,
      clean_windows_update_cache: true,
      flush_dns_cache: true,
      clean_browser_cache: false,
      clean_teams_cache: false,
      clean_winsxs: false,
      ...options
    };

    const targets = [];
    if (opts.clean_user_temp) {
      const userTemp = process.env.TEMP || process.env.TMP;
      if (userTemp && fs.existsSync(userTemp)) targets.push(userTemp);
    }

    const systemRoot = process.env.SystemRoot || 'C:\\Windows';

    if (opts.clean_windows_temp) {
      const winTemp = path.join(systemRoot, 'Temp');
      if (fs.existsSync(winTemp) && !targets.includes(winTemp)) targets.push(winTemp);
    }

    if (opts.clean_prefetch) {
      const prefetch = path.join(systemRoot, 'Prefetch');
      if (fs.existsSync(prefetch)) targets.push(prefetch);
    }

    if (opts.clean_windows_update_cache) {
      const wu = path.join(systemRoot, 'SoftwareDistribution', 'Download');
      if (fs.existsSync(wu)) targets.push(wu);
    }

    if (opts.clean_browser_cache) {
      const localAppData = process.env.LOCALAPPDATA || '';
      if (localAppData) {
        const browserCaches = [
          path.join(localAppData, 'Google', 'Chrome', 'User Data', 'Default', 'Cache'),
          path.join(localAppData, 'Google', 'Chrome', 'User Data', 'Default', 'Code Cache'),
          path.join(localAppData, 'Microsoft', 'Edge', 'User Data', 'Default', 'Cache'),
          path.join(localAppData, 'Microsoft', 'Edge', 'User Data', 'Default', 'Code Cache')
        ];
        for (const c of browserCaches) {
          if (fs.existsSync(c) && !targets.includes(c)) targets.push(c);
        }
      }
    }

    if (opts.clean_teams_cache) {
      const appData = process.env.APPDATA || '';
      const localAppData = process.env.LOCALAPPDATA || '';
      const teamsCaches = [
        path.join(appData, 'Microsoft', 'Teams', 'Cache'),
        path.join(appData, 'Microsoft', 'Teams', 'Code Cache'),
        path.join(localAppData, 'Packages', 'MSTeams_8wekyb3d8bbwe', 'LocalCache', 'Microsoft', 'MSTeams')
      ];
      for (const tc of teamsCaches) {
        if (fs.existsSync(tc) && !targets.includes(tc)) targets.push(tc);
      }
    }

    let filesRemoved = 0;
    let foldersRemoved = 0;
    let lockedItemsSkipped = 0;
    let bytesFreed = 0;
    const directoriesTargeted = [];

    for (const dir of targets) {
      directoriesTargeted.push(dir);
      const res = this.#cleanDirectory(dir);
      filesRemoved += res.files;
      foldersRemoved += res.folders;
      lockedItemsSkipped += res.skipped;
      bytesFreed += res.bytes;
    }

    let dnsFlushed = false;
    if (opts.flush_dns_cache) {
      try {
        await execAsync('ipconfig /flushdns');
        dnsFlushed = true;
      } catch {
        dnsFlushed = false;
      }
    }

    let winsxsCleaned = false;
    if (opts.clean_winsxs) {
      try {
        await execAsync('Dism.exe /online /Cleanup-Image /StartComponentCleanup', { timeout: 180000 });
        winsxsCleaned = true;
      } catch {
        winsxsCleaned = false;
      }
    }

    const megabytesFreed = Math.round((bytesFreed / (1024 * 1024)) * 100) / 100;

    return {
      directories_targeted: directoriesTargeted,
      files_removed: filesRemoved,
      folders_removed: foldersRemoved,
      locked_items_skipped: lockedItemsSkipped,
      bytes_freed: bytesFreed,
      megabytes_freed: megabytesFreed,
      dns_flushed: dnsFlushed,
      winsxs_cleaned: winsxsCleaned,
      executed_at_local: formatLocalDateTime()
    };
  }

  async analyzeDiskSpace(drive = 'C:\\') {
    const foldersToCheck = [
      { label: 'Windows Temp', path: 'C:\\Windows\\Temp' },
      { label: 'Windows SoftwareDistribution', path: 'C:\\Windows\\SoftwareDistribution' },
      { label: 'Windows WinSxS', path: 'C:\\Windows\\WinSxS' },
      { label: 'Windows.old', path: 'C:\\Windows.old' }
    ];

    // Adiciona perfis de usuários em C:\Users
    const usersDir = 'C:\\Users';
    if (fs.existsSync(usersDir)) {
      try {
        const users = fs.readdirSync(usersDir, { withFileTypes: true });
        for (const u of users) {
          if (u.isDirectory() && !['Public', 'Default', 'Default User', 'All Users'].includes(u.name)) {
            foldersToCheck.push({
              label: `Perfil: ${u.name}`,
              path: path.join(usersDir, u.name)
            });
          }
        }
      } catch {}
    }

    const folders = await new Promise((resolve, reject) => {
      const worker = new Worker(DISK_ANALYZER_WORKER, {
        eval: true,
        workerData: { foldersToCheck }
      });
      const timer = setTimeout(() => {
        worker.terminate().catch(() => {});
        resolve([]);
      }, 20000);

      worker.on('message', (data) => {
        clearTimeout(timer);
        resolve(data);
      });
      worker.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    return {
      drive,
      analyzed_at_local: formatLocalDateTime(),
      folders
    };
  }

  #cleanDirectory(dirPath) {
    let files = 0;
    let folders = 0;
    let skipped = 0;
    let bytes = 0;

    let entries = [];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return { files, folders, skipped: skipped + 1, bytes };
    }

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          const sub = this.#cleanDirectory(fullPath);
          files += sub.files;
          folders += sub.folders;
          skipped += sub.skipped;
          bytes += sub.bytes;
          try {
            fs.rmdirSync(fullPath);
            folders++;
          } catch {
            skipped++;
          }
        } else {
          try {
            const stat = fs.statSync(fullPath);
            const size = stat.size;
            fs.unlinkSync(fullPath);
            files++;
            bytes += size;
          } catch {
            skipped++;
          }
        }
      } catch {
        skipped++;
      }
    }

    return { files, folders, skipped, bytes };
  }
}

module.exports = { CleanupService };

