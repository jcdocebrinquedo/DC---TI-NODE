'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const BACKEND_ROOT = path.resolve(__dirname, '..', '..');

/** Diretório de dados da aplicação (sessão, logs). */
function dataDir() {
  const base = process.env.DCTI_DATA_DIR ||
    path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'DC-TI');
  fs.mkdirSync(base, { recursive: true });
  return base;
}

/** Diretório padrão das Ordens de Serviço (Documentos do técnico). */
function serviceOrdersDir() {
  const dir = process.env.DCTI_OS_DIR ||
    path.join(os.homedir(), 'Documents', 'DC-TI', 'Ordens de Servico');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Pasta estática com o build do Angular (gerada por `npm run build`). */
function publicDir() {
  return path.join(BACKEND_ROOT, 'public');
}

/**
 * Resolve o caminho do sidecar dc-core.exe, por ordem de prioridade:
 * 1. DCTI_CORE_PATH (override manual)
 * 2. resources/bin/dc-core.exe (aplicação empacotada pelo electron-builder)
 * 3. backend/bin/dc-core.exe (copiado por `npm run build:native`)
 * 4. native/dc-core/target/.../release/dc-core.exe (build direto via cargo)
 */
function resolveCorePath() {
  const candidates = [
    process.env.DCTI_CORE_PATH,
    process.resourcesPath && path.join(process.resourcesPath, 'bin', 'dc-core.exe'),
    path.join(BACKEND_ROOT, 'bin', 'dc-core.exe'),
    path.join(BACKEND_ROOT, '..', 'native', 'dc-core', 'target', 'x86_64-pc-windows-gnullvm', 'release', 'dc-core.exe'),
    path.join(BACKEND_ROOT, '..', 'native', 'dc-core', 'target', 'x86_64-pc-windows-msvc', 'release', 'dc-core.exe'),
  ].filter(Boolean);

  return candidates.find((p) => fs.existsSync(p)) || null;
}

module.exports = { BACKEND_ROOT, dataDir, serviceOrdersDir, publicDir, resolveCorePath };

