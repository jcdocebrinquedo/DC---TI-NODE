'use strict';

const { formatLocalDateTime } = require('../utils/local-date');

/**
 * Port do algoritmo de pontuação e recomendações analíticas de analyzer.rs
 * Avalia Saúde do Sistema de 0 a 100 com base em Hardware, Discos SMART, Bateria e Event Viewer.
 */
class DiagnosticService {
  /**
   * @param {import('../native/native-bridge').NativeBridge} bridge
   */
  constructor(bridge) {
    this.bridge = bridge;
  }

  async runFullDiagnostic(existingSmart = null, maxEventsLog = 600) {
    // Executa em paralelo no core Rust
    const [hwResult, smartResult, batResult, evtResult] = await Promise.allSettled([
      this.bridge.call('system.hardware'),
      existingSmart ? Promise.resolve(existingSmart) : this.bridge.call('system.disk.smart'),
      this.bridge.call('system.battery'),
      this.bridge.call('system.events.shutdown', { max_events: maxEventsLog })
    ]);

    const hardware = hwResult.status === 'fulfilled' ? hwResult.value : null;
    const diskSmart = smartResult.status === 'fulfilled' ? smartResult.value : {
      disks: [],
      overall_status: 'Indisponível',
      has_critical_failure: false,
      trim_enabled: true,
      summary_notes: [smartResult.reason?.message || 'Falha ao obter SMART'],
      collected_at_local: formatLocalDateTime()
    };
    const battery = batResult.status === 'fulfilled' ? batResult.value : { is_present: false };
    const shutdownAnalysis = evtResult.status === 'fulfilled' ? evtResult.value : {
      normal_shutdowns_count: 0,
      forced_shutdowns_count: 0,
      bsod_count: 0,
      total_events_inspected: 0,
      recent_critical_events: [],
      stability_verdict: 'Desconhecida'
    };

    let score = 100;
    const recommendations = [];

    // 1. Avaliação de Discos e TRIM
    if (diskSmart.has_critical_failure) {
      score -= 45;
      recommendations.push({
        severity: 'CRÍTICO',
        component: 'Armazenamento (SMART)',
        issue: 'Um ou mais discos reportaram falha preditiva crítica via SMART.',
        action: 'Realizar backup imediato dos dados do usuário e substituir a unidade de armazenamento.'
      });
    } else if (diskSmart.disks && diskSmart.disks.length > 0) {
      const minDisk = diskSmart.disks.reduce((prev, curr) => (prev.health_score < curr.health_score ? prev : curr), diskSmart.disks[0]);
      if (minDisk && minDisk.health_score < 80) {
        const deduction = Math.min(Math.floor((100 - minDisk.health_score) / 2), 25);
        score -= deduction;
        recommendations.push({
          severity: 'ALTA',
          component: `Disco #${minDisk.index} (${minDisk.model})`,
          issue: `Saúde do disco reduzida (${minDisk.health_score}/100 - ${minDisk.health_verdict}).`,
          action: 'Agendar substituição preventiva do disco e verificar integridade do sistema de arquivos (chkdsk /f).'
        });
      }
    }

    const hasSsd = diskSmart.disks && diskSmart.disks.some(d => d.is_ssd);
    if (hasSsd && !diskSmart.trim_enabled) {
      score -= 8;
      recommendations.push({
        severity: 'MÉDIA',
        component: 'Otimização de SSD (TRIM)',
        issue: 'Unidade SSD/NVMe detectada, porém o comando NTFS TRIM (DisableDeleteNotify) está desativado no Registro.',
        action: "Habilitar TRIM executando 'fsutil behavior set DisableDeleteNotify 0' como Administrador."
      });
    }

    if (diskSmart.disks && diskSmart.disks.length > 0 && !hasSsd) {
      score -= 10;
      recommendations.push({
        severity: 'MÉDIA',
        component: 'Desempenho de Armazenamento',
        issue: 'A estação utiliza exclusivamente disco mecânico (HDD), limitando severamente o I/O do Windows.',
        action: 'Recomendar upgrade para SSD NVMe ou SATA para ganho expressivo de produtividade.'
      });
    }

    // 2. Avaliação de Volumes e Memória
    if (hardware) {
      if (hardware.volumes) {
        for (const vol of hardware.volumes) {
          if (!vol.is_removable && vol.used_percent >= 90.0) {
            score -= 15;
            recommendations.push({
              severity: 'ALTA',
              component: `Volume ${vol.mount_point}`,
              issue: `Espaço crítico em disco: ${vol.used_percent.toFixed(1)}% ocupado (apenas ${vol.available_gb.toFixed(2)} GB livres de ${vol.total_gb.toFixed(2)} GB).`,
              action: 'Executar a Limpeza de Temporários e remover caches/perfis antigos.'
            });
          } else if (!vol.is_removable && vol.used_percent >= 80.0) {
            score -= 7;
            recommendations.push({
              severity: 'MÉDIA',
              component: `Volume ${vol.mount_point}`,
              issue: `Volume com ${vol.used_percent.toFixed(1)}% de ocupação (${vol.available_gb.toFixed(2)} GB livres).`,
              action: 'Executar limpeza preventiva de arquivos temporários e cache do Windows Update.'
            });
          }
        }
      }

      if (hardware.ram_total_gb < 7.5) {
        score -= 15;
        recommendations.push({
          severity: 'ALTA',
          component: 'Memória RAM',
          issue: `Capacidade total de RAM insuficiente para padrões corporativos atuais (${hardware.ram_total_gb.toFixed(2)} GB instalados).`,
          action: 'Planejar expansão de memória física para no mínimo 8 GB ou 16 GB.'
        });
      }

      if (hardware.ram_usage_percent >= 85.0) {
        score -= 10;
        recommendations.push({
          severity: 'MÉDIA',
          component: 'Consumo de Memória RAM',
          issue: `Uso de memória RAM elevado no momento da coleta (${hardware.ram_usage_percent.toFixed(1)}% em uso).`,
          action: 'Auditar aplicativos de inicialização no Gerenciador de Tarefas e serviços em background.'
        });
      }

      if (hardware.uptime_hours > 168.0) {
        recommendations.push({
          severity: 'BAIXA',
          component: 'Tempo de Atividade (Uptime)',
          issue: `A máquina está ligada continuamente há ${hardware.uptime_hours.toFixed(1)} horas (> 7 dias), possivelmente devido ao Fast Startup.`,
          action: 'Reiniciar a estação para aplicar patches pendentes do Windows e limpar o pool de memória do kernel.'
        });
      }
    }

    // 3. Avaliação de Bateria
    if (battery && battery.is_present && battery.wear_level_percent !== null && battery.wear_level_percent !== undefined) {
      if (battery.wear_level_percent >= 40.0) {
        score -= 15;
        recommendations.push({
          severity: 'ALTA',
          component: 'Bateria do Notebook',
          issue: `Desgaste severo na vida útil da bateria (${battery.wear_level_percent.toFixed(1)}% de perda de capacidade de projeto).`,
          action: 'Solicitar substituição da bateria para evitar desligamentos abruptos fora da tomada.'
        });
      } else if (battery.wear_level_percent >= 25.0) {
        score -= 7;
        recommendations.push({
          severity: 'BAIXA',
          component: 'Bateria do Notebook',
          issue: `Desgaste moderado da bateria (${battery.wear_level_percent.toFixed(1)}%).`,
          action: 'Monitorar autonomia da bateria nas próximas manutenções preventivas.'
        });
      }
    }

    // 4. Avaliação de Event Viewer (BSOD e Desligamentos)
    if (shutdownAnalysis.bsod_count > 0) {
      const bsodPenalty = Math.min(shutdownAnalysis.bsod_count * 12, 30);
      score -= bsodPenalty;
      recommendations.push({
        severity: 'CRÍTICO',
        component: 'Estabilidade do Kernel (BSOD)',
        issue: `Foram registradas ${shutdownAnalysis.bsod_count} ocorrências de Tela Azul (Event ID 1001 BugCheck) no histórico do sistema.`,
        action: "Executar o Módulo de Stress Test de CPU/Memória, atualizar drivers/BIOS e rodar 'sfc /scannow' + DISM."
      });
    }

    if (shutdownAnalysis.forced_shutdowns_count >= 3) {
      const forcedPenalty = Math.min(shutdownAnalysis.forced_shutdowns_count * 2, 15);
      score -= forcedPenalty;
      recommendations.push({
        severity: 'MÉDIA',
        component: 'Energia e Desligamento (Event ID 41/6008)',
        issue: `Foram contabilizados ${shutdownAnalysis.forced_shutdowns_count} desligamentos forçados por botão ou quedas de energia.`,
        action: 'Orientar o usuário a encerrar o Windows pelo menu Iniciar e verificar nobreak/fonte de alimentação.'
      });
    }

    if (recommendations.length === 0) {
      recommendations.push({
        severity: 'INFO',
        component: 'Diagnóstico Global',
        issue: 'Nenhuma anomalia de hardware, armazenamento ou estabilidade foi detectada.',
        action: 'Manter rotina periódica de atualização do sistema operacional.'
      });
    }

    const finalScore = Math.max(0, Math.min(100, Math.round(score)));
    let scoreClassification = 'CRÍTICO (Intervenção Técnica Imediata Necessária)';
    if (finalScore >= 90) {
      scoreClassification = 'EXCELENTE (Estação em Estado Ótimo)';
    } else if (finalScore >= 75) {
      scoreClassification = 'BOM (Operação Saudável com Ajustes Menores)';
    } else if (finalScore >= 50) {
      scoreClassification = 'ATENÇÃO (Requer Manutenção Preventiva/Upgrade)';
    }

    return {
      generated_at_local: formatLocalDateTime(),
      machine_score: finalScore,
      score_classification: scoreClassification,
      hardware,
      disk_smart: diskSmart,
      battery,
      shutdown_analysis: shutdownAnalysis,
      recommendations
    };
  }
}

module.exports = { DiagnosticService };

