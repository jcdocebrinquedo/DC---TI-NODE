'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { dataDir } = require('../utils/paths');

class AiConfigService {
  constructor() {
    this.configFile = path.join(dataDir(), 'ai_gateway_config.json');
    this.config = {
      gatewayUrl: process.env.GATEWAY_URL || 'http://docebrinquedo.local/sso-llm',
      apiKey: process.env.GATEWAY_TOKEN || 'gateway_app_dcti_c991754a11d1d779e1e2098c28dfbbd201b681f7f485993a',
      provider: 'GEMINI',
      model: 'gemini-3.1-flash-lite',
      temperature: 0.2
    };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.configFile)) {
        const raw = fs.readFileSync(this.configFile, 'utf8');
        const parsed = JSON.parse(raw);
        this.config = { ...this.config, ...parsed };
      }
    } catch (e) {
      console.error('[AiConfigService] Falha ao carregar configuração de IA:', e.message);
    }
  }

  save(newConfig) {
    this.config = { ...this.config, ...newConfig };
    try {
      fs.writeFileSync(this.configFile, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (e) {
      console.error('[AiConfigService] Falha ao salvar configuração de IA:', e.message);
    }
    return this.config;
  }

  getConfig() {
    return { ...this.config };
  }
}

module.exports = { AiConfigService, aiConfigService: new AiConfigService() };

