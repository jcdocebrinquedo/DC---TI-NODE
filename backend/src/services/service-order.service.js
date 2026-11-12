'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { serviceOrdersDir } = require('../utils/paths');
const { formatLocalDateTime, localTimestampSlug } = require('../utils/local-date');
const { validationError } = require('../utils/app-error');

class ServiceOrderService {
  /**
   * Gera a Ordem de Serviço em Markdown (.md) e Texto (.txt).
   * @param {{ station_name: string, technician_name: string, user_name?: string, actions_performed: string[] }} input
   */
  async generateOrder(input) {
    const station = (input.station_name || '').trim();
    const tech = (input.technician_name || '').trim();
    const user = (input.user_name || '').trim();
    const actions = Array.isArray(input.actions_performed)
      ? input.actions_performed.filter(a => typeof a === 'string' && a.trim().length > 0)
      : [];

    if (!station) {
      throw validationError('O Nome da Estação é obrigatório para gerar a Ordem de Serviço.');
    }
    if (!tech) {
      throw validationError('O nome do Técnico Responsável é obrigatório.');
    }
    if (actions.length === 0) {
      throw validationError('A Descrição das Ações Realizadas deve conter pelo menos um item.');
    }

    const nowFormatted = formatLocalDateTime();
    const slug = localTimestampSlug();
    const safeStation = station.replace(/[^a-zA-Z0-9_-]/g, '_');
    const orderId = `OS-${safeStation}-${slug}`;

    const baseDir = serviceOrdersDir();

    const mdFile = path.join(baseDir, `${orderId}.md`);
    const txtFile = path.join(baseDir, `${orderId}.txt`);

    // 1. Gera Markdown
    let md = '# ORDEM DE SERVIÇO INTERNA - SUPORTE DE TI\n\n';
    md += `- **Protocolo Interno:** \`${orderId}\`\n`;
    md += `- **Data/Hora Local:** ${nowFormatted}\n`;
    md += `- **Nome da Estação (Hostname):** \`${station}\`\n`;
    md += `- **Técnico Responsável:** ${tech}\n`;
    if (user) {
      md += `- **Usuário da Estação:** ${user}\n`;
    }
    md += '\n---\n\n## Descrição das Ações Realizadas\n\n';
    actions.forEach((act, idx) => {
      md += `${idx + 1}. ${act.trim()}\n`;
    });
    md += '\n---\n*Documento técnico de controle interno de TI — Sem valor comercial.*\n';

    fs.writeFileSync(mdFile, md, 'utf8');

    // 2. Gera Texto Puro
    let txt = '========================================================================\n';
    txt += '               ORDEM DE SERVIÇO INTERNA - SUPORTE DE TI                 \n';
    txt += '========================================================================\n';
    txt += `Protocolo Interno : ${orderId}\n`;
    txt += `Data/Hora (Local) : ${nowFormatted}\n`;
    txt += `Nome da Estação   : ${station}\n`;
    txt += `Técnico           : ${tech}\n`;
    if (user) {
      txt += `Usuário           : ${user}\n`;
    }
    txt += '------------------------------------------------------------------------\n';
    txt += 'DESCRIÇÃO DAS AÇÕES REALIZADAS:\n\n';
    actions.forEach((act, idx) => {
      txt += `  [${idx + 1}] ${act.trim()}\n`;
    });
    txt += '\n------------------------------------------------------------------------\n';
    txt += 'Assinatura do Técnico: _________________________________________________\n';
    txt += '========================================================================\n';

    fs.writeFileSync(txtFile, txt, 'utf8');

    return {
      order_id: orderId,
      created_at_local: nowFormatted,
      markdown_path: mdFile,
      txt_path: txtFile,
      docx_path: '',
      pdf_path: ''
    };
  }
}

module.exports = { ServiceOrderService };

