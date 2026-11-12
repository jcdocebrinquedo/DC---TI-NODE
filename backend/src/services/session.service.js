'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { dataDir } = require('../utils/paths');
const { formatLocalDateTime, localIsoString } = require('../utils/local-date');

class SessionStore {
  constructor() {
    this.sessionFile = path.join(dataDir(), 'current_session.json');
    this.actions = [];
    this.startTime = formatLocalDateTime();
    this.stationName = process.env.COMPUTERNAME || 'ESTACAO-TI';
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.sessionFile)) {
        const data = JSON.parse(fs.readFileSync(this.sessionFile, 'utf8'));
        this.actions = Array.isArray(data.actions) ? data.actions : [];
        this.stationName = data.stationName || this.stationName;
        this.startTime = data.startTime || this.startTime;
      }
    } catch {
      this.actions = [];
    }
  }

  save() {
    try {
      const data = {
        stationName: this.stationName,
        startTime: this.startTime,
        updatedAt: formatLocalDateTime(),
        updatedAtIso: localIsoString(),
        actions: this.actions
      };
      fs.writeFileSync(this.sessionFile, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.error('[SessionStore] Falha ao salvar sessão:', e.message);
    }
  }

  setStationName(name) {
    this.stationName = name;
    this.save();
  }

  addAction(description) {
    if (!description || typeof description !== 'string') return;
    const item = {
      timestamp: formatLocalDateTime(),
      description: description.trim()
    };
    this.actions.push(item);
    this.save();
    return item;
  }

  getActions() {
    return [...this.actions];
  }

  clear() {
    this.actions = [];
    this.startTime = formatLocalDateTime();
    this.save();
  }
}

module.exports = { SessionStore, sessionStore: new SessionStore() };

