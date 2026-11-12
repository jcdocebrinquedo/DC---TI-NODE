'use strict';

/**
 * NativeBridge — cliente JSON-RPC do sidecar Rust `dc-core.exe`.
 *
 * Protocolo (JSON-Lines sobre stdio):
 *   → {"id":1,"method":"system.hostname.get","params":{}}
 *   ← {"id":1,"ok":true,"result":{...}} | {"id":1,"ok":false,"error":{"code","message"}}
 *   ← {"id":1,"event":"tick","data":{...}}   (progresso de operações longas)
 *
 * Recursos: inicialização sob demanda, correlação por id, timeout por chamada,
 * eventos de progresso, reinício automático se o processo nativo cair.
 */

const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { EventEmitter } = require('node:events');
const { AppError } = require('../utils/app-error');
const { resolveCorePath } = require('../utils/paths');

const DEFAULT_TIMEOUT_MS = 60_000;

class NativeBridge extends EventEmitter {
  /**
   * @param {{ corePath?: string, logger?: Console }} [options]
   */
  constructor(options = {}) {
    super();
    this.corePath = options.corePath || resolveCorePath();
    this.logger = options.logger || console;
    this.child = null;
    this.nextId = 1;
    /** @type {Map<number, {resolve:Function, reject:Function, timer:NodeJS.Timeout|null, onEvent?:Function, method:string}>} */
    this.pending = new Map();
    this.stopping = false;
  }

  /** Inicia o processo nativo (idempotente). */
  start() {
    if (this.child) return;
    if (!this.corePath) {
      throw new AppError(
        'E_CORE_UNAVAILABLE',
        'Core nativo dc-core.exe não encontrado. Execute "npm run build:native" na raiz do projeto.'
      );
    }

    this.stopping = false;
    const child = spawn(this.corePath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;

    readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
      .on('line', (line) => this.#handleLine(line));

    readline.createInterface({ input: child.stderr, crlfDelay: Infinity })
      .on('line', (line) => this.logger.info(`[dc-core] ${line}`));

    child.on('error', (err) => {
      this.logger.error('[native-bridge] Falha ao iniciar dc-core:', err.message);
      this.#failAll(new AppError('E_CORE_UNAVAILABLE', `Falha ao iniciar o core nativo: ${err.message}`));
      this.child = null;
    });

    child.on('exit', (code, signal) => {
      this.child = null;
      this.#failAll(new AppError('E_CORE_EXITED', `Core nativo encerrado inesperadamente (código ${code ?? signal}).`));
      if (!this.stopping) {
        this.logger.warn('[native-bridge] dc-core caiu; será reiniciado na próxima chamada.');
        this.emit('exit', { code, signal });
      }
    });
  }

  /**
   * Chama um método nativo.
   * @param {string} method
   * @param {object} [params]
   * @param {{ timeoutMs?: number, onEvent?: (event:string, data:any) => void }} [options]
   * @returns {Promise<any>}
   */
  call(method, params = {}, options = {}) {
    this.start();
    const id = this.nextId++;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      const timer = timeoutMs > 0
        ? setTimeout(() => {
          this.pending.delete(id);
          reject(new AppError('E_TIMEOUT', `Tempo limite excedido em '${method}' (${timeoutMs} ms).`));
        }, timeoutMs)
        : null;

      this.pending.set(id, { resolve, reject, timer, onEvent: options.onEvent, method });

      const payload = JSON.stringify({ id, method, params }) + '\n';
      this.child.stdin.write(payload, 'utf8', (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(new AppError('E_CORE_UNAVAILABLE', `Falha ao enviar requisição ao core: ${err.message}`));
        }
      });
    });
  }

  /** Encerra o sidecar (fecha stdin → o Rust finaliza o loop). */
  stop() {
    if (!this.child) return;
    this.stopping = true;
    try {
      this.child.stdin.end();
    } catch { /* ignora */ }
    const child = this.child;
    setTimeout(() => { if (!child.killed) child.kill(); }, 1500).unref();
  }

  #handleLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      this.logger.warn('[native-bridge] Linha não-JSON ignorada:', line);
      return;
    }

    const entry = this.pending.get(msg.id);
    if (!entry) return;

    if (msg.event) {
      entry.onEvent?.(msg.event, msg.data);
      return;
    }

    this.pending.delete(msg.id);
    if (entry.timer) clearTimeout(entry.timer);

    if (msg.ok) {
      entry.resolve(msg.result);
    } else {
      const err = msg.error || {};
      entry.reject(new AppError(err.code || 'E_NATIVE', err.message || 'Erro desconhecido no core nativo.'));
    }
  }

  #failAll(error) {
    for (const [id, entry] of this.pending) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(error);
      this.pending.delete(id);
    }
  }
}

module.exports = { NativeBridge };

