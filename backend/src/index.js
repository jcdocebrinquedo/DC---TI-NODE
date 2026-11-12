'use strict';

const path = require('node:path');
const express = require('express');
const { NativeBridge } = require('./native/native-bridge');
const { DiagnosticService } = require('./services/diagnostic.service');
const { CleanupService } = require('./services/cleanup.service');
const { RepairService } = require('./services/repair.service');
const { ServiceOrderService } = require('./services/service-order.service');
const { ToolRegistry } = require('./services/tool-registry');
const { AiAgentService } = require('./services/ai-agent.service');
const { aiConfigService } = require('./services/ai-config.service');
const { createApiRouter } = require('./routes/api.routes');
const { publicDir } = require('./utils/paths');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Inicia as pontes de serviço
const bridge = new NativeBridge();
const diagnosticService = new DiagnosticService(bridge);
const cleanupService = new CleanupService();
const repairService = new RepairService();
const serviceOrderService = new ServiceOrderService();

const toolRegistry = new ToolRegistry({ bridge, cleanupService, repairService });
const aiAgentService = new AiAgentService(toolRegistry);

// Rotas de API
app.use('/api', createApiRouter(
  bridge,
  diagnosticService,
  cleanupService,
  repairService,
  serviceOrderService,
  aiAgentService,
  aiConfigService
));

// Servir frontend compilado em backend/public
const staticPath = publicDir();
app.use(express.static(staticPath));

// Fallback SPA (HTML5 PushState) para rotas do Angular
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api')) {
    return next();
  }
  const indexPath = path.join(staticPath, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      res.status(200).send(`
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head><meta charset="utf-8"><title>DC-TI Support</title></head>
        <body style="font-family: sans-serif; padding: 40px; text-align: center;">
          <h2>DC-TI Corporate Support Engine</h2>
          <p>API Node.js ativa na porta ${PORT}.</p>
          <p>Frontend Angular ainda não compilado em <code>backend/public</code>.<br>
             Execute <code>npm run build</code> na raiz para compilar o Angular Material.</p>
        </body>
        </html>
      `);
    }
  });
});

// Middleware de Erros Centralizado
app.use((err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).json({
    ok: false,
    error: {
      code: err.code || 'E_INTERNAL',
      message: err.message || 'Erro interno do servidor',
      details: err.details
    }
  });
});

function startServer() {
  return new Promise((resolve) => {
    const server = app.listen(PORT, () => {
      console.log(`[DC-TI Server] Rodando em http://localhost:${PORT}`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer, bridge, toolRegistry, aiAgentService, aiConfigService };

