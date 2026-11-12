#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const backendDir = path.join(ROOT, 'backend');
const electronExe = path.join(backendDir, 'node_modules', 'electron', 'dist', 'electron.exe');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

console.log('[start-electron] Iniciando Electron com o backend...');
const child = spawn(electronExe, ['.'], {
  cwd: backendDir,
  env,
  stdio: 'inherit',
  windowsHide: false,
});

child.on('exit', (code) => {
  process.exit(code || 0);
});

