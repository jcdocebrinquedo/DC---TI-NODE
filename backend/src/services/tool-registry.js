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

const execAsync = promisify(exec);

class ToolRegistry {
  constructor({ bridge, cleanupService, repairService }) {
    this.bridge = bridge;
    this.cleanupService = cleanupService;
    this.repairService = repairService;
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
      }
    ];
  }

  async executeTool(name, args = {}) {
    sessionStore.addAction(`IA executando ferramenta nativa: ${name}`);

    switch (name) {
      case 'execute_command': {
        const shellType = args.shell === 'cmd' ? 'cmd /c' : 'powershell -NoProfile -Command';
        const fullCmd = `${shellType} "${args.command.replace(/"/g, '\\"')}"`;
        try {
          const { stdout, stderr } = await execAsync(fullCmd, { maxBuffer: 1024 * 1024 * 10 });
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
        const sName = args.service_name;
        let ps = '';
        if (args.action === 'status') {
          ps = `Get-Service -Name "${sName}" | Select-Object Name, DisplayName, Status, StartType | ConvertTo-Json`;
        } else if (args.action === 'start') {
          ps = `Start-Service -Name "${sName}"; Get-Service -Name "${sName}" | Select-Object Name, Status | ConvertTo-Json`;
        } else if (args.action === 'stop') {
          ps = `Stop-Service -Name "${sName}" -Force; Get-Service -Name "${sName}" | Select-Object Name, Status | ConvertTo-Json`;
        } else if (args.action === 'restart') {
          ps = `Restart-Service -Name "${sName}" -Force; Get-Service -Name "${sName}" | Select-Object Name, Status | ConvertTo-Json`;
        }
        try {
          const { stdout } = await execAsync(`powershell -NoProfile -Command "${ps}"`);
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

      default:
        return { error: `Ferramenta ${name} não implementada.` };
    }
  }
}

module.exports = { ToolRegistry };

