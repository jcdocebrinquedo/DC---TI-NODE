'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { dataDir } = require('../utils/paths');

let DatabaseSync = null;
try {
  const sqlite = require('node:sqlite');
  DatabaseSync = sqlite.DatabaseSync;
} catch (e) {
  console.warn('[DatabaseService] node:sqlite nativo não disponível neste runtime:', e.message);
}

class DatabaseService {
  constructor() {
    this.dbPath = path.join(dataDir(), 'dcti_local.db');
    this.db = null;
    this.init();
  }

  init() {
    try {
      if (DatabaseSync) {
        this.db = new DatabaseSync(this.dbPath);
        // Cria tabelas padrão integradas
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            action TEXT NOT NULL,
            details TEXT
          );
          CREATE TABLE IF NOT EXISTS app_kv (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
        `);
        console.log(`[DatabaseService] SQLite integrado inicializado com sucesso em: ${this.dbPath}`);
      } else {
        console.log('[DatabaseService] Operando em modo de persistência JSON fallback (node:sqlite indisponível).');
      }
    } catch (err) {
      console.error('[DatabaseService] Falha ao inicializar SQLite nativo:', err.message);
    }
  }

  logAction(action, details = '') {
    if (!this.db) return;
    try {
      const stmt = this.db.prepare('INSERT INTO audit_logs (timestamp, action, details) VALUES (?, ?, ?)');
      stmt.run(new Date().toISOString(), action, details);
    } catch (e) {
      console.warn('[DatabaseService] Erro ao gravar log no SQLite:', e.message);
    }
  }

  getRecentLogs(limit = 50) {
    if (!this.db) return [];
    try {
      const stmt = this.db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?');
      return stmt.all(limit);
    } catch {
      return [];
    }
  }
}

const databaseService = new DatabaseService();

module.exports = { DatabaseService, databaseService };

