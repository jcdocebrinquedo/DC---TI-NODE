'use strict';

const express = require('express');
const { validateHostname } = require('../validators/hostname.validator');
const { sessionStore } = require('../services/session.service');
const { adminElevationService } = require('../services/admin-elevation.service');
const { networkDoctorService } = require('../services/network-doctor.service');
const { softwareOptimizerService } = require('../services/software-optimizer.service');
const { helpdeskToolkitService } = require('../services/helpdesk-toolkit.service');
const outlookConfigService = require('../services/outlook-config.service');

function createApiRouter(bridge, diagnosticService, cleanupService, repairService, serviceOrderService, aiAgentService, aiConfigService) {
  const router = express.Router();

  // --- CORE & SAÚDE ---
  router.get('/core/status', async (req, res, next) => {
    try {
      const ping = await bridge.call('core.ping');
      res.json({ ok: true, data: ping });
    } catch (e) {
      next(e);
    }
  });

  router.get('/system/admin-check', async (req, res, next) => {
    try {
      const check = await bridge.call('system.admin.check');
      const isElevated = adminElevationService.isElevated(check?.elevated);
      res.json({
        ok: true,
        data: {
          elevated: isElevated,
          native_elevated: Boolean(check?.elevated),
          user_confirmed: adminElevationService.userConfirmed
        }
      });
    } catch (e) {
      next(e);
    }
  });

  router.post('/system/admin-confirm', async (req, res) => {
    adminElevationService.confirmElevation();
    sessionStore.addAction('Privilégios de Administrador confirmados e ativados pelo usuário.');
    if (req.body?.trigger_windows_uac) {
      await adminElevationService.triggerWindowsUac();
    }
    res.json({
      ok: true,
      data: {
        elevated: true,
        user_confirmed: true
      }
    });
  });

  router.post('/system/admin-toggle', (req, res) => {
    const newState = adminElevationService.toggleElevation();
    sessionStore.addAction(`Privilégios de Administrador alternados para: ${newState ? 'TRUE (Ativo)' : 'FALSE (Inativo)'}`);
    res.json({
      ok: true,
      data: {
        elevated: newState,
        user_confirmed: newState
      }
    });
  });

  router.post('/system/admin-set', (req, res) => {
    const enable = Boolean(req.body?.elevated);
    const state = adminElevationService.setElevation(enable);
    sessionStore.addAction(`Privilégios de Administrador definidos como: ${state ? 'TRUE' : 'FALSE'}`);
    res.json({
      ok: true,
      data: {
        elevated: state,
        user_confirmed: state
      }
    });
  });

  router.post('/system/relaunch-elevated', async (req, res, next) => {
    try {
      adminElevationService.confirmElevation();
      const result = await adminElevationService.relaunchElevated();
      res.json({ ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  // --- HOSTNAME ---
  router.get('/system/hostname', async (req, res, next) => {
    try {
      const info = await bridge.call('system.hostname.get');
      res.json({ ok: true, data: info });
    } catch (e) {
      next(e);
    }
  });

  router.post('/system/hostname', async (req, res, next) => {
    try {
      const rawName = req.body.name;
      const validName = validateHostname(rawName);
      const result = await bridge.call('system.hostname.set', { name: validName });
      sessionStore.addAction(`Alteração de Hostname no HKLM de '${result.previous_name}' para '${result.new_name}'.`);
      sessionStore.setStationName(result.new_name);
      res.json({ ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  // --- DISCOS E SMART ---
  router.get('/system/disks/smart', async (req, res, next) => {
    try {
      const smart = await bridge.call('system.disk.smart');
      res.json({ ok: true, data: smart });
    } catch (e) {
      next(e);
    }
  });

  // --- USUÁRIOS LOCAIS ---
  router.get('/system/users', async (req, res, next) => {
    try {
      const users = await bridge.call('system.users.list');
      res.json({ ok: true, data: users });
    } catch (e) {
      next(e);
    }
  });

  router.post('/system/users/update', async (req, res, next) => {
    try {
      const result = await bridge.call('system.users.update', req.body);
      sessionStore.addAction(`Atualização de conta local para o usuário '${req.body.target_username}'.`);
      res.json({ ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  // --- DIAGNÓSTICO COMPLETO ---
  router.get('/diagnostic/full', async (req, res, next) => {
    try {
      const report = await diagnosticService.runFullDiagnostic();
      res.json({ ok: true, data: report });
    } catch (e) {
      next(e);
    }
  });

  // --- LIMPEZA ---
  router.post('/cleanup/deep', async (req, res, next) => {
    try {
      const report = await cleanupService.runDeepCleanup(req.body);
      sessionStore.addAction(`Limpeza profunda de temporários: ${report.megabytes_freed} MB liberados.`);
      res.json({ ok: true, data: report });
    } catch (e) {
      next(e);
    }
  });

  // --- REPAROS E INTEGRIDADE ---
  router.post('/repair/spooler', async (req, res, next) => {
    try {
      const result = await repairService.repairPrintSpooler();
      sessionStore.addAction('Reparo do Spooler de Impressão executado.');
      res.json({ ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  router.post('/repair/network', async (req, res, next) => {
    try {
      const result = await repairService.repairNetworkStack();
      sessionStore.addAction('Redefinição de Rede e DNS efetuada.');
      res.json({ ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  router.post('/repair/sfc', async (req, res, next) => {
    try {
      const result = await repairService.runSfcScan();
      sessionStore.addAction('Verificação SFC de integridade do sistema executada.');
      res.json({ ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  router.post('/repair/dism', async (req, res, next) => {
    try {
      const result = await repairService.runDismRestoreHealth();
      sessionStore.addAction('Restauração de imagem do Windows via DISM executada.');
      res.json({ ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  router.post('/repair/full-suite', async (req, res, next) => {
    try {
      const report = await repairService.runFullSuite();
      sessionStore.addAction('Execução da suíte completa de integridade e reparo do sistema.');
      res.json({ ok: true, data: report });
    } catch (e) {
      next(e);
    }
  });

  // --- CONFIGURAÇÃO DE E-MAIL OUTLOOK ---
  router.get('/email/outlook/detect', async (req, res, next) => {
    try {
      const detection = await outlookConfigService.detectProfile();
      res.json({ ok: true, data: detection });
    } catch (e) {
      next(e);
    }
  });

  router.get('/email/outlook/pst-candidates', async (req, res, next) => {
    try {
      const email = req.query.email || '';
      const candidates = await outlookConfigService.findPstCandidates(email);
      res.json({ ok: true, data: candidates });
    } catch (e) {
      next(e);
    }
  });

  router.post('/email/outlook/configure', async (req, res, next) => {
    try {
      const result = await outlookConfigService.configureEmail(req.body);
      const modeStr = req.body.use_existing_pst ? ' (PST sincronizado/vinculado)' : ' (novo PST padrão)';
      sessionStore.addAction(`Configuração corporativa de e-mail Outlook: '${req.body.email_address}'${modeStr}.`);
      res.json({ ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  router.post('/email/outlook/account/:slot/delete', async (req, res, next) => {
    try {
      const deletePst = Boolean(req.body?.delete_pst_file);
      const result = await outlookConfigService.removeAccount(req.params.slot, deletePst);
      const fileInfo = result.pst_file_deleted ? ' e arquivo .pst excluído do disco' : '';
      sessionStore.addAction(`Remoção da conta Outlook '${result.removed_account}' (slot ${result.removed_slot})${fileInfo}.`);
      res.json({ ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  router.post('/email/outlook/data-file/:key/delete', async (req, res, next) => {
    try {
      const deletePst = Boolean(req.body?.delete_pst_file);
      const result = await outlookConfigService.removeDataFile(req.params.key, deletePst);
      const fileInfo = result.pst_file_deleted ? ' e arquivo .pst excluído do disco' : '';
      sessionStore.addAction(`Remoção do arquivo de dados Outlook '${result.removed_key}'${fileInfo}.`);
      res.json({ ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  // --- ORDEM DE SERVIÇO ---
  router.get('/service-order/session', (req, res) => {
    res.json({
      ok: true,
      data: {
        stationName: sessionStore.stationName,
        actions: sessionStore.getActions()
      }
    });
  });

  router.post('/service-order/generate', async (req, res, next) => {
    try {
      const output = await serviceOrderService.generateOrder(req.body);
      sessionStore.addAction(`Geração da Ordem de Serviço ${output.order_id}.`);
      res.json({ ok: true, data: output });
    } catch (e) {
      next(e);
    }
  });

  // --- INTELIGÊNCIA ARTIFICIAL (DOCE LLM AI GATEWAY & MCP) ---
  router.get('/ai/config', (req, res) => {
    res.json({ ok: true, data: aiConfigService.getConfig() });
  });

  router.post('/ai/config', (req, res) => {
    const updated = aiConfigService.save(req.body);
    res.json({ ok: true, data: updated });
  });

  router.post('/ai/chat', async (req, res, next) => {
    try {
      const { messages } = req.body;
      if (!Array.isArray(messages)) {
        return res.status(400).json({ ok: false, error: { message: 'Formato de mensagens inválido.' } });
      }
      const response = await aiAgentService.chat({ messages });
      res.json({ ok: true, data: response });
    } catch (e) {
      next(e);
    }
  });

  // --- NOVAS FEATURES DE SUPORTE CORPORATIVO ---
  // 1. Network Doctor
  router.get('/network/doctor', async (req, res, next) => {
    try {
      const diag = await networkDoctorService.runFullDiagnostics();
      res.json({ ok: true, data: diag });
    } catch (e) {
      next(e);
    }
  });

  // 2. Auditoria de Segurança
  router.get('/security/audit', async (req, res, next) => {
    try {
      const audit = await softwareOptimizerService.auditSecurity();
      res.json({ ok: true, data: audit });
    } catch (e) {
      next(e);
    }
  });

  // 3. Programas de Inicialização
  router.get('/startup/list', async (req, res, next) => {
    try {
      const list = await softwareOptimizerService.listStartupPrograms();
      res.json({ ok: true, data: list });
    } catch (e) {
      next(e);
    }
  });

  // 4. Verificação de Updates via Winget
  router.get('/software/winget-updates', async (req, res, next) => {
    try {
      const updates = await softwareOptimizerService.checkWingetUpdates();
      res.json({ ok: true, data: updates });
    } catch (e) {
      next(e);
    }
  });

  // 5. Crash Minidumps & Event Viewer
  router.get('/helpdesk/crashes', async (req, res, next) => {
    try {
      const crashes = await helpdeskToolkitService.getCrashMinidumps();
      res.json({ ok: true, data: crashes });
    } catch (e) {
      next(e);
    }
  });

  // 6. Teste de Estresse da CPU
  router.post('/helpdesk/stress-test', async (req, res, next) => {
    try {
      const duration = parseInt(req.body?.duration, 10) || 10;
      const result = await helpdeskToolkitService.runQuickStressTest(duration);
      sessionStore.addAction(`Execução do Teste de Estresse e Estabilidade da CPU (${duration}s).`);
      res.json({ ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  // 7. Estimativa de Backup do Perfil
  router.get('/helpdesk/backup-estimate', async (req, res, next) => {
    try {
      const estimate = await helpdeskToolkitService.calculateProfileBackupSize();
      res.json({ ok: true, data: estimate });
    } catch (e) {
      next(e);
    }
  });

  return router;
}

module.exports = { createApiRouter };

