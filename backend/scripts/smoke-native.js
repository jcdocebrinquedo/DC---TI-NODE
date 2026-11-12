'use strict';

const { NativeBridge } = require('../src/native/native-bridge');

async function main() {
  console.log('--- Testando NativeBridge com dc-core.exe ---');
  const bridge = new NativeBridge();

  try {
    const ping = await bridge.call('core.ping');
    console.log('[OK] core.ping:', ping);

    const methods = await bridge.call('core.methods');
    console.log(`[OK] core.methods (${methods.length} métodos expostos):`, methods);

    const admin = await bridge.call('system.admin.check');
    console.log('[OK] system.admin.check:', admin);

    const host = await bridge.call('system.hostname.get');
    console.log('[OK] system.hostname.get:', host);

    console.log('\nTodos os testes de comunicação JSON-RPC com o core Rust foram bem sucedidos!');
  } catch (err) {
    console.error('[ERRO] Falha no teste nativo:', err);
  } finally {
    bridge.stop();
  }
}

main();

