'use strict';

const express = require('express');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const { validateHostname } = require('../validators/hostname.validator');
const { sessionStore } = require('../services/session.service');
const { adminElevationService } = require('../services/admin-elevation.service');
const { networkDoctorService } = require('../services/network-doctor.service');
const { softwareOptimizerService } = require('../services/software-optimizer.service');
const { helpdeskToolkitService } = require('../services/helpdesk-toolkit.service');
const { driverManagerService } = require('../services/driver-manager.service');
const { printerManagerService } = require('../services/printer-manager.service');
const { windowsUpdateService } = require('../services/windows-update.service');
const { userManagementService } = require('../services/user-management.service');
const { jobManagerService } = require('../services/job-manager.service');
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
      const { new_hostname } = req.body || {};
      validateHostname(new_hostname);
      const result = await bridge.call('system.hostname.set', { name: new_hostname });
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
      sessionStore.addAction(`Atualização/renomeação de conta local para o usuário '${req.body.target_username}'.`);
      res.json({ ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  router.get('/system/users/groups', async (req, res, next) => {
    try {
      const groups = await userManagementService.listLocalGroups();
      res.json({ ok: true, data: groups });
    } catch (e) {
      next(e);
    }
  });

  router.get('/system/users/:username/groups', async (req, res, next) => {
    try {
      const groups = await userManagementService.getUserGroups(req.params.username);
      res.json({ ok: true, data: groups });
    } catch (e) {
      next(e);
    }
  });

  router.post('/system/users/:username/groups', async (req, res, next) => {
    try {
      const result = await userManagementService.setUserGroups(req.params.username, req.body?.groups || []);
      sessionStore.addAction(`Alteração de grupos/permissões do usuário '${req.params.username}'.`);
      res.json({ ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  router.delete('/system/users/:username', async (req, res, next) => {
    try {
      const result = await userManagementService.deleteUser(req.params.username);
      sessionStore.addAction(`Remoção da conta local de usuário '${req.params.username}'.`);
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

  router.post('/email/outlook/test-auth', async (req, res, next) => {
    try {
      const result = await outlookConfigService.testAuthentication(req.body);
      res.json({ ok: result.ok, data: result });
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

  router.post('/service-order/session/clear', (req, res) => {
    sessionStore.clear();
    res.json({
      ok: true,
      data: {
        stationName: sessionStore.stationName,
        actions: []
      }
    });
  });

  router.post('/service-order/session/add-action', (req, res) => {
    const desc = (req.body?.description || '').trim();
    if (!desc) {
      return res.status(400).json({ ok: false, error: { message: 'Descrição da ação é obrigatória.' } });
    }
    const item = sessionStore.addAction(desc);
    res.json({ ok: true, data: item });
  });

  router.post('/service-order/generate', async (req, res, next) => {
    try {
      const output = await serviceOrderService.generateOrder(req.body);
      // Após gerar e salvar no histórico, limpa a sessão atual para o próximo atendimento começar do zero
      sessionStore.clear();
      res.json({ ok: true, data: output });
    } catch (e) {
      next(e);
    }
  });

  router.get('/service-order/history', (req, res) => {
    res.json({ ok: true, data: serviceOrderService.getHistory() });
  });

  router.post('/service-order/history/:orderId/restore', (req, res) => {
    const item = serviceOrderService.getHistoryById(req.params.orderId);
    if (!item) {
      return res.status(404).json({ ok: false, error: { message: 'Ordem de Serviço não encontrada no histórico.' } });
    }
    sessionStore.restoreActions(item.actions_performed, item.station_name);
    res.json({ ok: true, data: item });
  });

  router.delete('/service-order/history/:orderId', (req, res) => {
    const deleted = serviceOrderService.deleteHistory(req.params.orderId);
    res.json({ ok: true, data: { deleted } });
  });

  router.post('/service-order/ai-summary', async (req, res, next) => {
    try {
      const actions = Array.isArray(req.body?.actions) && req.body.actions.length > 0
        ? req.body.actions
        : sessionStore.getActions().map(a => a.description);
      if (actions.length === 0) {
        return res.json({ ok: true, data: { summary: '' } });
      }
      const prompt = `Gere uma síntese executiva técnica e concisa (máximo 4 linhas, sem markdown) para constar no campo "Resumo Técnico" de uma Ordem de Serviço de TI, baseada nos seguintes procedimentos executados:\n- ${actions.join('\n- ')}\n\nREGRAS OBRIGATÓRIAS DE REDAÇÃO:\n1. Escreva em Português do Brasil formal e ortograficamente perfeito.\n2. Utilize OBRIGATORIAMENTE todos os acentos gráficos e cedilhas corretos (ex.: remoção, temporários, êxito, liberação, espaço, diagnóstico, configuração, manutenção, conclusão).\n3. NUNCA remova acentos ou cedilhas das palavras.`;
      try {
        const aiRes = await aiAgentService.chat({
          messages: [{ role: 'user', content: prompt }]
        });
        return res.json({ ok: true, data: { summary: (aiRes.reply || '').trim(), used_ai: true } });
      } catch {
        // Fallback estruturado caso a API Key de IA não esteja configurada
        const fallback = `Atendimento técnico realizado na estação ${req.body?.station_name || sessionStore.stationName}, contemplando ${actions.length} procedimento(s) de diagnóstico, otimização e correção operacional.`;
        return res.json({ ok: true, data: { summary: fallback, used_ai: false } });
      }
    } catch (e) {
      next(e);
    }
  });

  // Abre arquivo ou pasta no explorer do Windows
  router.post('/service-order/open-file', (req, res) => {
    const targetPath = (req.body?.path || '').trim();
    if (!targetPath || !fs.existsSync(targetPath)) {
      return res.status(404).json({ ok: false, error: { message: 'Arquivo ou pasta não encontrado no disco.' } });
    }

    try {
      const isDir = fs.statSync(targetPath).isDirectory();
      if (isDir) {
        const p = spawn('explorer.exe', [targetPath], { detached: true, stdio: 'ignore' });
        p.unref();
      } else {
        const p = spawn('explorer.exe', ['/select,', targetPath], { detached: true, stdio: 'ignore' });
        p.unref();
      }
      res.json({ ok: true, data: { opened: targetPath } });
    } catch (err) {
      res.status(500).json({ ok: false, error: { message: err.message } });
    }
  });

  // Abre a pasta de Ordens de Serviço
  router.post('/service-order/open-folder', (req, res) => {
    const { serviceOrdersDir } = require('../utils/paths');
    const folder = serviceOrdersDir();
    try {
      const p = spawn('explorer.exe', [folder], { detached: true, stdio: 'ignore' });
      p.unref();
      res.json({ ok: true, data: { folder } });
    } catch (err) {
      res.status(500).json({ ok: false, error: { message: err.message } });
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

  // 8. Execução de Backup do Perfil (.tar)
  router.post('/helpdesk/backup-run', async (req, res, next) => {
    try {
      const result = await helpdeskToolkitService.runProfileBackup(req.body || {});
      sessionStore.addAction(`Backup do perfil gerado em .tar: '${result.tar_path}'.`);
      res.json({ ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  // 9. Parar Teste de Estresse
  router.post('/helpdesk/stress-test/stop', async (req, res, next) => {
    try {
      const result = await helpdeskToolkitService.stopStressTest();
      res.json({ ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  // 10. IDs de Acesso Remoto e Ferramentas Nativas
  router.get('/helpdesk/remote-ids', async (req, res, next) => {
    try {
      const ids = await helpdeskToolkitService.getRemoteAccessIds();
      res.json({ ok: true, data: ids });
    } catch (e) {
      next(e);
    }
  });

  router.post('/helpdesk/native-tool', (req, res, next) => {
    try {
      const result = helpdeskToolkitService.openNativeTool(req.body?.tool);
      res.json({ ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  // 11. Winget Upgrade & Softwares Instalados & Boot
  router.post('/software/winget-upgrade', async (req, res, next) => {
    try {
      const result = await softwareOptimizerService.upgradeWingetPackage(req.body?.package_id);
      sessionStore.addAction(`Atualização via Winget executada: ${req.body?.package_id || 'Todos'}.`);
      res.json({ ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  router.post('/startup/remove', async (req, res, next) => {
    try {
      const result = await softwareOptimizerService.removeStartupProgram(req.body || {});
      sessionStore.addAction(`Item de inicialização removido/desabilitado: '${req.body?.name}'.`);
      res.json({ ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  router.get('/software/installed', async (req, res, next) => {
    try {
      const list = await softwareOptimizerService.listInstalledSoftware();
      res.json({ ok: true, data: list });
    } catch (e) {
      next(e);
    }
  });

  router.post('/software/uninstall', async (req, res, next) => {
    try {
      const result = await softwareOptimizerService.uninstallSoftware(req.body || {});
      const modeLabel = req.body?.deep ? 'profunda (Revo)' : 'normal';
      sessionStore.addAction(`Desinstalação ${modeLabel} executada: '${req.body?.name || 'Programa'}'.`);
      res.json({ ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  router.post('/software/uninstall-batch', async (req, res, next) => {
    try {
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      const deep = Boolean(req.body?.deep);
      const result = await softwareOptimizerService.uninstallMultipleSoftware(items, deep);
      const modeLabel = deep ? 'profunda (Revo)' : 'normal';
      sessionStore.addAction(`Desinstalação em lote (${modeLabel}) de ${result.succeeded}/${result.total} software(s).`);
      res.json({ ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  // 12. Drivers (Estilo DriverEasy)
  router.get('/drivers/scan', async (req, res, next) => {
    try {
      const data = await driverManagerService.scanDrivers();
      res.json({ ok: true, data });
    } catch (e) {
      next(e);
    }
  });

  router.get('/drivers/updates', async (req, res, next) => {
    try {
      const data = await driverManagerService.checkDriverUpdates();
      res.json({ ok: true, data });
    } catch (e) {
      next(e);
    }
  });

  router.post('/drivers/install', async (req, res, next) => {
    try {
      const result = await driverManagerService.installDriverUpdate({
        updateId: req.body?.update_id,
        infPath: req.body?.inf_path
      });
      if (result.ok) {
        sessionStore.addAction(`Atualização de driver instalada: ${req.body?.title || req.body?.inf_path || req.body?.update_id}.`);
      }
      res.json({ ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  router.post('/drivers/open-external', (req, res, next) => {
    try {
      const url = req.body?.url || driverManagerService.resolveExternalDriverUrl(req.body || {});
      const result = driverManagerService.openExternalUrl(url);
      res.json({ ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  // 13. Inventário Técnico Completo
  router.get('/system/inventory', async (req, res, next) => {
    try {
      const inventory = await diagnosticService.getFullInventory();
      res.json({ ok: true, data: inventory });
    } catch (e) {
      next(e);
    }
  });

  // 14. Rede DHCP & Analisador de Espaço
  router.post('/network/dhcp-renew', async (req, res, next) => {
    try {
      const result = await networkDoctorService.renewDhcp();
      sessionStore.addAction('Renovação de endereço IP via DHCP (ipconfig /release & /renew).');
      res.json({ ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  router.get('/storage/analyze', async (req, res, next) => {
    try {
      const analysis = await cleanupService.analyzeDiskSpace(req.query?.drive || 'C:\\');
      res.json({ ok: true, data: analysis });
    } catch (e) {
      next(e);
    }
  });

  // 15. Gerenciador de Impressoras
  router.get('/printers', async (req, res, next) => {
    try {
      const list = await printerManagerService.listPrinters();
      res.json({ ok: true, data: list });
    } catch (e) {
      next(e);
    }
  });

  router.post('/printers/clear-queue', async (req, res, next) => {
    try {
      const result = await printerManagerService.clearQueue(req.body?.name);
      sessionStore.addAction(`Fila da impressora '${req.body?.name}' limpa.`);
      res.json({ ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  router.post('/printers/set-default', async (req, res, next) => {
    try {
      const result = await printerManagerService.setDefault(req.body?.name);
      sessionStore.addAction(`Impressora '${req.body?.name}' definida como padrão.`);
      res.json({ ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  router.post('/printers/test-page', async (req, res, next) => {
    try {
      const result = await printerManagerService.printTestPage(req.body?.name);
      sessionStore.addAction(`Página de teste enviada para '${req.body?.name}'.`);
      res.json({ ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  // 16. Windows Update (Status, Reparo, Desabilitação Permanente e Reativação)
  router.get('/windows-update/status', async (req, res, next) => {
    try {
      const status = await windowsUpdateService.getStatus();
      res.json({ ok: true, data: status });
    } catch (e) {
      next(e);
    }
  });

  router.post('/windows-update/repair', async (req, res, next) => {
    try {
      const result = await windowsUpdateService.repairWindowsUpdate();
      sessionStore.addAction('Reparo completo do Windows Update executado (SoftwareDistribution/catroot2).');
      res.json({ ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  router.post('/windows-update/disable-permanent', async (req, res, next) => {
    try {
      const result = await windowsUpdateService.disablePermanently();
      sessionStore.addAction('Windows Update desabilitado permanentemente (serviços, Registro e tarefas).');
      res.json({ ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  router.post('/windows-update/enable', async (req, res, next) => {
    try {
      const result = await windowsUpdateService.enableDefault();
      sessionStore.addAction('Windows Update reativado para o modo padrão.');
      res.json({ ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  // 17. Ponto de Restauração e CHKDSK
  router.post('/repair/restore-point', async (req, res, next) => {
    try {
      const result = await repairService.createRestorePoint(req.body?.description);
      sessionStore.addAction('Ponto de Restauração do Windows criado.');
      res.json({ ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  router.post('/repair/chkdsk-schedule', async (req, res, next) => {
    try {
      const result = await repairService.scheduleChkdsk(req.body?.drive || 'C:');
      sessionStore.addAction(`Verificação CHKDSK agendada para o próximo boot (${req.body?.drive || 'C:'}).`);
      res.json({ ok: true, data: result });
    } catch (e) {
      next(e);
    }
  });

  // 18. Jobs Assíncronos com Progresso em Tempo Real (ProgressBar)
  router.get('/jobs/:id', (req, res) => {
    const job = jobManagerService.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ ok: false, error: { message: 'Tarefa não encontrada.' } });
    }
    res.json({ ok: true, data: job });
  });

  router.post('/repair/sfc-async', (req, res) => {
    const job = jobManagerService.createJob('Verificação de Arquivos de Sistema (SFC)');
    repairService.runSfcScan((p) => jobManagerService.updateJob(job.id, p))
      .then((result) => {
        sessionStore.addAction('Verificação SFC de integridade do sistema executada.');
        jobManagerService.completeJob(job.id, result, result.output_summary);
      })
      .catch((err) => jobManagerService.failJob(job.id, err.message));
    res.json({ ok: true, data: { job_id: job.id } });
  });

  router.post('/repair/dism-async', (req, res) => {
    const job = jobManagerService.createJob('Restauração da Imagem do Windows (DISM)');
    repairService.runDismRestoreHealth((p) => jobManagerService.updateJob(job.id, p))
      .then((result) => {
        sessionStore.addAction('Restauração de imagem do Windows via DISM executada.');
        jobManagerService.completeJob(job.id, result, result.output_summary);
      })
      .catch((err) => jobManagerService.failJob(job.id, err.message));
    res.json({ ok: true, data: { job_id: job.id } });
  });

  router.post('/repair/full-suite-async', (req, res) => {
    const job = jobManagerService.createJob('Suíte Completa de Reparo');
    repairService.runFullSuite((p) => jobManagerService.updateJob(job.id, p))
      .then((result) => {
        sessionStore.addAction('Execução da suíte completa de integridade e reparo do sistema.');
        jobManagerService.completeJob(job.id, result, 'Suíte completa concluída.');
      })
      .catch((err) => jobManagerService.failJob(job.id, err.message));
    res.json({ ok: true, data: { job_id: job.id } });
  });

  router.post('/software/winget-upgrade-async', (req, res) => {
    const pkgId = req.body?.package_id || '__ALL__';
    const pkgIds = Array.isArray(req.body?.package_ids) ? req.body.package_ids : [];
    const job = jobManagerService.createJob(pkgId === '__ALL__' ? 'Atualização de Todos os Softwares (Winget)' : `Atualização Winget: ${pkgId}`);
    const runner = pkgId === '__ALL__'
      ? softwareOptimizerService.upgradeAllWingetPackages(pkgIds, (p) => jobManagerService.updateJob(job.id, p))
      : softwareOptimizerService.upgradeWingetPackage(pkgId, (p) => jobManagerService.updateJob(job.id, p));

    runner
      .then((result) => {
        sessionStore.addAction(`Atualização via Winget concluída: ${result.output}`);
        jobManagerService.completeJob(job.id, result, result.output);
      })
      .catch((err) => jobManagerService.failJob(job.id, err.message));
    res.json({ ok: true, data: { job_id: job.id } });
  });

  router.post('/helpdesk/backup-run-async', (req, res) => {
    const job = jobManagerService.createJob('Backup do Perfil (.tar)');
    helpdeskToolkitService.runProfileBackup(req.body || {}, (p) => jobManagerService.updateJob(job.id, p))
      .then((result) => {
        sessionStore.addAction(`Backup do perfil gerado em .tar: '${result.tar_path}' (${result.archived_files_count} arquivos).`);
        jobManagerService.completeJob(job.id, result, `Backup concluído: ${result.archived_files_count} arquivo(s) em ${result.size_mb} MB.`);
      })
      .catch((err) => jobManagerService.failJob(job.id, err.message));
    res.json({ ok: true, data: { job_id: job.id } });
  });

  return router;
}

module.exports = { createApiRouter };
