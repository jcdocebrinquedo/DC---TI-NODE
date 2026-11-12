#!/usr/bin/env node
/**
 * Compila o core nativo Rust (dc-core.exe) e copia o binário para backend/bin/.
 *
 * - Toolchain padrão: stable-x86_64-pc-windows-gnullvm (não exige Visual Studio).
 *   O linker rust-lld.exe é localizado dinamicamente dentro do RUSTUP_HOME.
 * - Para usar MSVC (com VS Build Tools instalado): `set DCTI_NATIVE_TARGET=msvc`.
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const CRATE_DIR = path.join(ROOT, 'native', 'dc-core');
const BACKEND_BIN = path.join(ROOT, 'backend', 'bin');

const useMsvc = (process.env.DCTI_NATIVE_TARGET || '').toLowerCase() === 'msvc';
const target = useMsvc ? 'x86_64-pc-windows-msvc' : 'x86_64-pc-windows-gnullvm';
const toolchain = useMsvc ? 'stable-x86_64-pc-windows-msvc' : 'stable-x86_64-pc-windows-gnullvm';

const userHome = os.homedir();
const cargoBin = path.join(process.env.CARGO_HOME || path.join(userHome, '.cargo'), 'bin');
const rustupHome = process.env.RUSTUP_HOME || path.join(userHome, '.rustup');

const env = {
  ...process.env,
  PATH: `${cargoBin}${path.delimiter}${process.env.PATH}`,
  RUSTUP_TOOLCHAIN: toolchain,
};

if (!useMsvc) {
  const lld = path.join(
    rustupHome, 'toolchains', toolchain,
    'lib', 'rustlib', 'x86_64-pc-windows-gnullvm', 'bin', 'rust-lld.exe'
  );
  if (!fs.existsSync(lld)) {
    console.error(`[build-native] rust-lld.exe não encontrado em:\n  ${lld}\n` +
      `Instale o toolchain com: rustup toolchain install ${toolchain}`);
    process.exit(1);
  }
  env.CARGO_TARGET_X86_64_PC_WINDOWS_GNULLVM_LINKER = lld;
}

console.log(`[build-native] Compilando dc-core (${target})...`);
const result = spawnSync('cargo', ['build', '--release', '--target', target], {
  cwd: CRATE_DIR,
  env,
  stdio: 'inherit',
  shell: true,
});

if (result.status !== 0) {
  console.error('[build-native] Falha na compilação do core nativo.');
  process.exit(result.status || 1);
}

const builtExe = path.join(CRATE_DIR, 'target', target, 'release', 'dc-core.exe');
fs.mkdirSync(BACKEND_BIN, { recursive: true });
fs.copyFileSync(builtExe, path.join(BACKEND_BIN, 'dc-core.exe'));
console.log(`[build-native] OK → ${path.join(BACKEND_BIN, 'dc-core.exe')}`);

