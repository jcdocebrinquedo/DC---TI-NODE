#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const args = process.argv.slice(2);
const builderArgs = args.length > 0 ? args : ['--win', 'portable', '--x64'];

const backendDir = path.resolve(__dirname, '..');
const localBuilderBin = path.join(
  backendDir,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder'
);

const STAGES = [
  { match: /loaded configuration/i, pct: 10, ceil: 19, label: 'Carregando configuração...' },
  { match: /installing native dependencies/i, pct: 20, ceil: 34, label: 'Preparando dependências nativas...' },
  { match: /packaging\s+platform=/i, pct: 35, ceil: 49, label: 'Empacotando Electron (win-unpacked)...' },
  { match: /downloading|downloaded\s+electron/i, pct: 50, ceil: 59, label: 'Extraindo runtime Electron...' },
  { match: /searching for node modules/i, pct: 60, ceil: 71, label: 'Coletando dependências Node.js...' },
  { match: /updating asar/i, pct: 72, ceil: 82, label: 'Atualizando ASAR e manifesto UAC...' },
  { match: /building\s+target=nsis/i, pct: 80, ceil: 93, label: 'Gerando instalador NSIS (.exe)...' },
  { match: /building\s+target=portable/i, pct: 83, ceil: 97, label: 'Gerando executável portátil (.exe)...' },
  { match: /building block map/i, pct: 95, ceil: 98, label: 'Finalizando blockmap...' }
];

let currentPct = 2;
let currentCeil = 9;
let currentLabel = 'Iniciando electron-builder...';
const startMs = Date.now();
const isTty = Boolean(process.stdout.isTTY);

function renderBar(forceNewline = false) {
  const width = 30;
  const filled = Math.round((currentPct / 100) * width);
  const bar = '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
  const elapsed = Math.floor((Date.now() - startMs) / 1000);
  const line = `[${bar}] ${String(currentPct).padStart(3, ' ')}% | ${currentLabel} (${elapsed}s)`;

  if (isTty) {
    process.stdout.write(`\r\x1b[K${line}${forceNewline ? '\n' : ''}`);
  } else if (forceNewline) {
    console.log(line);
  }
}

console.log(`[DC-TI Dist] Executando: electron-builder ${builderArgs.join(' ')}`);
renderBar(false);

const tick = setInterval(() => {
  if (currentPct < currentCeil) {
    currentPct++;
  }
  renderBar(false);
}, 500);

const child = spawn(localBuilderBin, builderArgs, {
  cwd: backendDir,
  shell: process.platform === 'win32',
  stdio: ['inherit', 'pipe', 'pipe']
});

const errorLines = [];

function processOutput(chunk, isErr = false) {
  const text = chunk.toString('utf8');
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (isErr || /⨯|error:|EBUSY|locked for writing/i.test(line)) {
      errorLines.push(line);
    }

    if (/locked for writing/i.test(line)) {
      currentLabel = 'Arquivo .exe em uso! Feche o DC-TI Support aberto...';
      renderBar(true);
    }

    for (const st of STAGES) {
      if (st.match.test(line)) {
        if (st.pct > currentPct) currentPct = st.pct;
        currentCeil = st.ceil;
        currentLabel = st.label;
        renderBar(!isTty);
        break;
      }
    }
  }
}

child.stdout.on('data', (c) => processOutput(c, false));
child.stderr.on('data', (c) => processOutput(c, true));

child.on('close', (code) => {
  clearInterval(tick);
  if (code === 0) {
    currentPct = 100;
    currentLabel = 'Build concluído com sucesso!';
    renderBar(true);
    process.exit(0);
  } else {
    renderBar(true);
    console.error(`\n[DC-TI Dist] Falha no build (código ${code}).`);
    if (errorLines.length > 0) {
      console.error(errorLines.slice(-10).join('\n'));
    }
    process.exit(code || 1);
  }
});
