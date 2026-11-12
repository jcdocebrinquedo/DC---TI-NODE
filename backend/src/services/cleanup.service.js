'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { exec } = require('node:child_process');
const { promisify } = require('node:util');
const { formatLocalDateTime } = require('../utils/local-date');

const execAsync = promisify(exec);

class CleanupService {
  async runDeepCleanup(options = {}) {
    const opts = {
      clean_user_temp: true,
      clean_windows_temp: true,
      clean_prefetch: true,
      clean_windows_update_cache: true,
      flush_dns_cache: true,
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

    const megabytesFreed = Math.round((bytesFreed / (1024 * 1024)) * 100) / 100;

    return {
      directories_targeted: directoriesTargeted,
      files_removed: filesRemoved,
      folders_removed: foldersRemoved,
      locked_items_skipped: lockedItemsSkipped,
      bytes_freed: bytesFreed,
      megabytes_freed: megabytesFreed,
      dns_flushed: dnsFlushed,
      executed_at_local: formatLocalDateTime()
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

