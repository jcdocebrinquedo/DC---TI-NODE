'use strict';

const { exec } = require('node:child_process');
const { promisify } = require('node:util');
const os = require('node:os');
const fs = require('node:fs');
const { formatLocalDateTime } = require('../utils/local-date');
const { sessionStore } = require('../services/session.service');
const { adminElevationService } = require('./admin-elevation.service');
const { networkDoctorService } = require('./network-doctor.service');
const { softwareOptimizerService } = require('./software-optimizer.service');
const { helpdeskToolkitService } = require('./helpdesk-toolkit.service');
const { driverManagerService } = require('./driver-manager.service');
const { printerManagerService } = require('./printer-manager.service');
const { windowsUpdateService } = require('./windows-update.service');

const execAsync = promisify(exec);

class ToolRegistry {
  constructor({ bridge, cleanupService, repairService, serviceOrderService }) {
    this.bridge = bridge;
    this.cleanupService = cleanupService;
    this.repairService = repairService;
    this.serviceOrderService = serviceOrderService;
  }

  getToolsDefinitions() {
    return [
      {
        name: 'execute_command',
        description: 'Executa comandos diretos em PowerShell ou CMD no Windows com acesso total ao sistema (processos, serviços, rede, registro, pastas, instalações, reparos). Use quando precisar rodar diagnósticos, comandos do sistema operacional, scripts ou comandos de reparo.',
        parameters: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'Comando PowerShell/CMD a ser executado.'
            },
            shell: {
              type: 'string',
              enum: ['powershell', 'cmd'],
              description: 'Interpretador a ser utilizado. Default: powershell'
            }
          },
          required: ['command']
        }
      },
      {
        name: 'get_system_overview',
        description: 'Obtém resumo em tempo real do computador: CPU, RAM, Uptime, Discos, Hostname e status de elevação Administrador.',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'get_disks_smart',
        description: 'Verifica a saúde física de todos os discos e SSDs/NVMe conectados via WMI e IOCTL (bad blocks, temperatura, desgaste, predição de falhas).',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'run_deep_cleanup',
        description: 'Executa a limpeza expressa de arquivos temporários do usuário (%TEMP%), C:\\Windows\\Temp, Prefetch, SoftwareDistribution e esvaziamento de cache DNS.',
        parameters: {
          type: 'object',
          properties: {
            clean_user_temp: { type: 'boolean', description: 'Limpar %TEMP%' },
            clean_windows_temp: { type: 'boolean', description: 'Limpar C:\\Windows\\Temp' },
            clean_prefetch: { type: 'boolean', description: 'Limpar Prefetch' },
            clean_windows_update: { type: 'boolean', description: 'Limpar cache Windows Update' },
            flush_dns: { type: 'boolean', description: 'Esvaziar cache DNS' }
          }
        }
      },
      {
        name: 'repair_service_or_network',
        description: 'Executa rotinas prontas de reparo do sistema: Spooler de impressão, redefinição de rede/DNS/Winsock, SFC ou DISM.',
        parameters: {
          type: 'object',
          properties: {
            target: {
              type: 'string',
              enum: ['spooler', 'network', 'sfc', 'dism', 'full_suite'],
              description: 'Alvo do reparo automático.'
            }
          },
          required: ['target']
        }
      },
      {
        name: 'manage_windows_service',
        description: 'Gerencia serviços do Windows (iniciar, parar, reiniciar ou verificar status).',
        parameters: {
          type: 'object',
          properties: {
            service_name: { type: 'string', description: 'Nome do serviço no Windows (ex: Spooler, wuauserv, dnscache)' },
            action: { type: 'string', enum: ['status', 'start', 'stop', 'restart'], description: 'Ação desejada' }
          },
          required: ['service_name', 'action']
        }
      },
      {
        name: 'set_hostname',
        description: 'Altera o Hostname da máquina diretamente no Registro HKLM e atualiza a API Win32.',
        parameters: {
          type: 'object',
          properties: {
            new_hostname: { type: 'string', description: 'Novo nome do computador (máx 15 caracteres NetBIOS alfanuméricos)' }
          },
          required: ['new_hostname']
        }
      },
      {
        name: 'confirm_admin_elevation',
        description: 'Eleva e confirma os privilégios de Administrador do sistema quando solicitado ou confirmado pelo usuário (tornando admin_elevated: true). Deve ser acionada sempre que o usuário confirmar a elevação de permissões ou quando aprovar ações que exigem administrador.',
        parameters: {
          type: 'object',
          properties: {
            confirmed: {
              type: 'boolean',
              description: 'Confirmação para conceder e ativar os privilégios elevados de administrador (true).'
            },
            trigger_windows_uac: {
              type: 'boolean',
              description: 'Se true, dispara a elevação de processo no Windows via UAC (User Account Control).'
            }
          },
          required: ['confirmed']
        }
      },
      {
        name: 'network_doctor_check',
        description: 'Executa diagnóstico completo de conectividade de rede: interfaces IPv4, latência de ping (Gateway, Cloudflare, Google) e resolução de DNS.',
        parameters: { type: 'object', properties: {} }
      },
      {
        name: 'security_audit_check',
        description: 'Audita a postura de segurança local da estação: status do Windows Defender, assinaturas de antivírus, firewall do Windows e BitLocker.',
        parameters: { type: 'object', properties: {} }
      },
      {
        name: 'list_startup_programs',
        description: 'Lista softwares configurados para inicializar junto com o Windows no Registro (HKLM/HKCU Run), permitindo identificar lentidões de boot.',
        parameters: { type: 'object', properties: {} }
      },
      {
        name: 'analyze_crash_minidumps',
        description: 'Inspeciona arquivos Minidump de tela azul (BSOD) em C:\\Windows\\Minidump e eventos recentes de falha crítica no Visualizador de Eventos (Event Viewer).',
        parameters: { type: 'object', properties: {} }
      },
      {
        name: 'run_stress_test',
        description: 'Executa um teste rápido de estresse e estabilidade de CPU de 10 segundos para verificar throttling e integridade de processamento.',
        parameters: { type: 'object', properties: {} }
      },
      {
        name: 'scan_drivers_and_updates',
        description: 'Escaneia dispositivos com erro de driver e verifica atualizações de drivers disponíveis via Windows Update.',
        parameters: { type: 'object', properties: {} }
      },
      {
        name: 'list_printers',
        description: 'Lista todas as impressoras instaladas, portas, status e quantidade de trabalhos na fila.',
        parameters: { type: 'object', properties: {} }
      },
      {
        name: 'windows_update_control',
        description: 'Consulta status, executa reparo completo, desabilita permanentemente ou reativa o Windows Update.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['status', 'repair', 'disable_permanent', 'enable'],
              description: 'Ação desejada no Windows Update.'
            }
          },
          required: ['action']
        }
      },
      {
        name: 'get_session_audit_log',
        description: 'Consulta o histórico completo de tudo o que foi realizado no software desde que foi aberto nesta sessão (ações técnicas, limpezas, reparos, diagnósticos e testes executados).',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'generate_service_order',
        description: 'Gera formalmente a Ordem de Serviço nos formatos DOCX (Microsoft Word), PDF, Markdown (.md) e Texto (.txt) com o design corporativo oficial e a logomarca da empresa.',
        parameters: {
          type: 'object',
          properties: {
            station_name: {
              type: 'string',
              description: 'Nome da estação ou computador (Hostname).'
            },
            technician_name: {
              type: 'string',
              description: 'Nome do técnico responsável pelo atendimento.'
            },
            user_name: {
              type: 'string',
              description: 'Nome do usuário ou solicitante atendido (opcional).'
            },
            summary: {
              type: 'string',
              description: 'Síntese executiva ou resumo técnico gerado pela IA descrevendo os problemas encontrados e as soluções aplicadas.'
            },
            actions_performed: {
              type: 'array',
              items: { type: 'string' },
              description: 'Lista detalhada de procedimentos e ações técnicas realizadas durante o atendimento.'
            }
          },
          required: ['station_name', 'technician_name', 'actions_performed']
        }
      }
    ];
  }

  async executeTool(name, args = {}) {
    sessionStore.addAction(`IA executando ferramenta nativa: ${name}`);

    switch (name) {
      case 'execute_command': {
        let fullCmd = '';
        if (args.shell === 'cmd') {
          fullCmd = `cmd /c "${String(args.command || '').replace(/"/g, '\\"')}"`;
        } else {
          const ps = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n${args.command || ''}`;
          const encoded = Buffer.from(ps, 'utf16le').toString('base64');
          fullCmd = `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`;
        }
        try {
          const { stdout, stderr } = await execAsync(fullCmd, { timeout: 60000, maxBuffer: 1024 * 1024 * 10 });
          return {
            success: true,
            stdout: stdout.trim(),
            stderr: stderr.trim()
          };
        } catch (e) {
          return {
            success: false,
            error: e.message,
            stdout: e.stdout ? e.stdout.toString().trim() : '',
            stderr: e.stderr ? e.stderr.toString().trim() : ''
          };
        }
      }

      case 'get_system_overview': {
        try {
          const hw = await this.bridge.call('system.hardware');
          const admin = await this.bridge.call('system.admin.check');
          return {
            hostname: os.hostname(),
            platform: os.platform(),
            release: os.release(),
            admin_elevated: adminElevationService.isElevated(admin?.elevated),
            cpu: hw.cpu_brand,
            cores: hw.cpu_physical_cores,
            threads: hw.cpu_logical_cores,
            ram_total_gb: hw.ram_total_gb,
            ram_used_gb: hw.ram_used_gb,
            ram_usage_percent: hw.ram_usage_percent,
            uptime_hours: hw.uptime_hours,
            volumes: hw.volumes
          };
        } catch (e) {
          return { error: e.message };
        }
      }

      case 'get_disks_smart': {
        try {
          const smart = await this.bridge.call('system.disk.smart');
          return smart;
        } catch (e) {
          return { error: e.message };
        }
      }

      case 'run_deep_cleanup': {
        try {
          const rep = await this.cleanupService.runDeepCleanup({
            clean_user_temp: args.clean_user_temp ?? true,
            clean_windows_temp: args.clean_windows_temp ?? true,
            clean_prefetch: args.clean_prefetch ?? true,
            clean_windows_update_cache: args.clean_windows_update ?? true,
            flush_dns_cache: args.flush_dns ?? true
          });
          return rep;
        } catch (e) {
          return { error: e.message };
        }
      }

      case 'repair_service_or_network': {
        try {
          switch (args.target) {
            case 'spooler': return await this.repairService.repairPrintSpooler();
            case 'network': return await this.repairService.repairNetworkStack();
            case 'sfc': return await this.repairService.runSfcScan();
            case 'dism': return await this.repairService.runDismRestoreHealth();
            case 'full_suite': return await this.repairService.runFullSuite();
            default: return { error: `Alvo de reparo desconhecido: ${args.target}` };
          }
        } catch (e) {
          return { error: e.message };
        }
      }

      case 'manage_windows_service': {
        const sName = String(args.service_name || '').replace(/'/g, "''");
        let ps = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n';
        if (args.action === 'status') {
          ps += `Get-Service -Name '${sName}' | Select-Object Name, DisplayName, Status, StartType | ConvertTo-Json`;
        } else if (args.action === 'start') {
          ps += `Start-Service -Name '${sName}'; Get-Service -Name '${sName}' | Select-Object Name, Status | ConvertTo-Json`;
        } else if (args.action === 'stop') {
          ps += `Stop-Service -Name '${sName}' -Force; Get-Service -Name '${sName}' | Select-Object Name, Status | ConvertTo-Json`;
        } else if (args.action === 'restart') {
          ps += `Restart-Service -Name '${sName}' -Force; Get-Service -Name '${sName}' | Select-Object Name, Status | ConvertTo-Json`;
        }
        try {
          const encoded = Buffer.from(ps, 'utf16le').toString('base64');
          const { stdout } = await execAsync(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, { timeout: 30000 });
          return { output: stdout.trim() };
        } catch (e) {
          return { error: e.message };
        }
      }

      case 'set_hostname': {
        try {
          const res = await this.bridge.call('system.hostname.set', { name: args.new_hostname });
          return res;
        } catch (e) {
          return { error: e.message };
        }
      }

      case 'confirm_admin_elevation': {
        try {
          if (args.confirmed) {
            adminElevationService.confirmElevation();
            sessionStore.addAction('Privilégios de Administrador confirmados e ativados pelo usuário via Agente IA.');
            let uacTriggered = false;
            if (args.trigger_windows_uac) {
              const uacRes = await adminElevationService.triggerWindowsUac();
              uacTriggered = uacRes.success;
            }
            return {
              success: true,
              admin_elevated: true,
              message: 'Privilégios de Administrador confirmados com sucesso! O parâmetro admin_elevated agora é true.',
              uac_triggered: uacTriggered
            };
          } else {
            return {
              success: false,
              admin_elevated: adminElevationService.isElevated(),
              message: 'Elevação não confirmada pelo usuário.'
            };
          }
        } catch (e) {
          return { success: false, error: e.message };
        }
      }

      case 'network_doctor_check': {
        try {
          return await networkDoctorService.runFullDiagnostics();
        } catch (e) {
          return { error: e.message };
        }
      }

      case 'security_audit_check': {
        try {
          return await softwareOptimizerService.auditSecurity();
        } catch (e) {
          return { error: e.message };
        }
      }

      case 'list_startup_programs': {
        try {
          return await softwareOptimizerService.listStartupPrograms();
        } catch (e) {
          return { error: e.message };
        }
      }

      case 'analyze_crash_minidumps': {
        try {
          return await helpdeskToolkitService.getCrashMinidumps();
        } catch (e) {
          return { error: e.message };
        }
      }

      case 'run_stress_test': {
        try {
          return await helpdeskToolkitService.runQuickStressTest(args.duration_seconds || 10);
        } catch (e) {
          return { error: e.message };
        }
      }

      case 'scan_drivers_and_updates': {
        try {
          const [scan, updates] = await Promise.all([
            driverManagerService.scanDrivers(),
            driverManagerService.checkDriverUpdates()
          ]);
          return {
            system_manufacturer: scan.system_manufacturer,
            system_model: scan.system_model,
            total_drivers: scan.total,
            drivers_with_errors: scan.drivers.filter(d => d.has_error),
            available_updates: updates.updates || []
          };
        } catch (e) {
          return { error: e.message };
        }
      }

      case 'list_printers': {
        try {
          return await printerManagerService.listPrinters();
        } catch (e) {
          return { error: e.message };
        }
      }

      case 'windows_update_control': {
        try {
          if (args.action === 'status') return await windowsUpdateService.getStatus();
          if (args.action === 'repair') return await windowsUpdateService.repairWindowsUpdate();
          if (args.action === 'disable_permanent') return await windowsUpdateService.disablePermanently();
          if (args.action === 'enable') return await windowsUpdateService.enableDefault();
          return { error: 'Ação inválida para Windows Update.' };
        } catch (e) {
          return { error: e.message };
        }
      }

      case 'get_session_audit_log': {
        try {
          return {
            station_name: sessionStore.stationName,
            start_time: sessionStore.startTime,
            actions_count: sessionStore.actions.length,
            actions: sessionStore.getActions()
          };
        } catch (e) {
          return { error: e.message };
        }
      }

      case 'generate_service_order': {
        try {
          if (!this.serviceOrderService) {
            throw new Error('Serviço de geração de OS não instanciado no ToolRegistry.');
          }

          let actions = args.actions_performed;
          if (!Array.isArray(actions) || actions.length === 0) {
            // Se não veio uma lista de ações explícita, aproveita os registros da sessão
            const sessionActions = sessionStore.getActions();
            if (sessionActions.length > 0) {
              actions = sessionActions.map(a => `${a.timestamp} — ${a.description}`);
            } else {
              actions = ['Manutenção preventiva e suporte técnico executado pela equipe de TI.'];
            }
          }

          const res = await this.serviceOrderService.generateOrder({
            station_name: args.station_name || sessionStore.stationName || os.hostname(),
            technician_name: args.technician_name || 'Técnico de Suporte TI',
            user_name: args.user_name || '',
            summary: args.summary || '',
            actions_performed: actions
          });

          sessionStore.clear();
          return {
            success: true,
            order_id: res.order_id,
            created_at: res.created_at_local,
            docx_path: res.docx_path,
            pdf_path: res.pdf_path,
            markdown_path: res.markdown_path,
            txt_path: res.txt_path,
            message: `Ordem de Serviço ${res.order_id} gerada com sucesso em DOCX, PDF, MD e TXT com a logomarca da empresa.`
          };
        } catch (e) {
          return { success: false, error: e.message };
        }
      }

      default:
        return { error: `Ferramenta ${name} não implementada.` };
    }
  }
}

module.exports = { ToolRegistry };
