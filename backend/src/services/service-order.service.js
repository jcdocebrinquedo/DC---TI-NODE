'use strict';

const fs = require('node:fs');
const path = require('node:path');
const docx = require('docx');
const PDFDocument = require('pdfkit');
const { serviceOrdersDir, dataDir, BACKEND_ROOT } = require('../utils/paths');
const { formatLocalDateTime, localTimestampSlug, localDateFolder } = require('../utils/local-date');
const { validationError } = require('../utils/app-error');

class ServiceOrderService {
  constructor() {
    this.logoPath = this._resolveLogoPath();
    this.historyFile = path.join(dataDir(), 'service_orders_history.json');
  }

  _readHistory() {
    try {
      if (fs.existsSync(this.historyFile)) {
        const parsed = JSON.parse(fs.readFileSync(this.historyFile, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch (e) {
      console.error('[ServiceOrderService] Falha ao ler histórico:', e.message);
    }
    return [];
  }

  _writeHistory(list) {
    try {
      fs.writeFileSync(this.historyFile, JSON.stringify(list, null, 2), 'utf8');
    } catch (e) {
      console.error('[ServiceOrderService] Falha ao gravar histórico:', e.message);
    }
  }

  _saveToHistory(entry) {
    const history = this._readHistory();
    history.unshift(entry);
    // Mantém até 200 registros no histórico local
    if (history.length > 200) {
      history.length = 200;
    }
    this._writeHistory(history);
  }

  getHistory() {
    return this._readHistory();
  }

  getHistoryById(orderId) {
    const history = this._readHistory();
    return history.find(item => item.order_id === orderId) || null;
  }

  deleteHistory(orderId) {
    const history = this._readHistory();
    const filtered = history.filter(item => item.order_id !== orderId);
    this._writeHistory(filtered);
    return filtered.length < history.length;
  }

  _resolveLogoPath() {
    const candidates = [
      path.resolve(BACKEND_ROOT, '..', 'docs', 'logo.png'),
      path.resolve(BACKEND_ROOT, 'docs', 'logo.png'),
      path.resolve(BACKEND_ROOT, 'public', 'logo.png'),
      path.resolve(process.cwd(), 'docs', 'logo.png'),
      'd:\\Garoto de Programa\\DC---TI-NODE\\docs\\logo.png'
    ];

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
    return null;
  }

  /**
   * Gera a Ordem de Serviço em DOCX, PDF, Markdown (.md) e Texto (.txt).
   * @param {{
   *   station_name: string,
   *   technician_name: string,
   *   user_name?: string,
   *   summary?: string,
   *   actions_performed: string[]
   * }} input
   */
  async generateOrder(input) {
    const station = (input.station_name || '').trim();
    const tech = (input.technician_name || '').trim();
    const user = (input.user_name || '').trim();
    const summary = (input.summary || '').trim();
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

    const dateFolder = localDateFolder();
    const baseDir = path.join(serviceOrdersDir(), dateFolder, orderId);
    fs.mkdirSync(baseDir, { recursive: true });

    const mdFile = path.join(baseDir, `${orderId}.md`);
    const txtFile = path.join(baseDir, `${orderId}.txt`);
    const docxFile = path.join(baseDir, `${orderId}.docx`);
    const pdfFile = path.join(baseDir, `${orderId}.pdf`);

    // 1. Gera Markdown (.md)
    let md = '# ORDEM DE SERVIÇO INTERNA - SUPORTE DE TI\n\n';
    md += `- **Protocolo Interno:** \`${orderId}\`\n`;
    md += `- **Data/Hora Local:** ${nowFormatted}\n`;
    md += `- **Nome da Estação (Hostname):** \`${station}\`\n`;
    md += `- **Técnico Responsável:** ${tech}\n`;
    if (user) {
      md += `- **Usuário da Estação:** ${user}\n`;
    }
    if (summary) {
      md += `\n---\n\n## Resumo Técnico (IA)\n\n${summary}\n`;
    }
    md += '\n---\n\n## Descrição das Ações Realizadas\n\n';
    actions.forEach((act, idx) => {
      md += `${idx + 1}. ${act.trim()}\n`;
    });
    md += '\n---\n*Documento técnico de controle interno de TI — Sem valor comercial.*\n';

    fs.writeFileSync(mdFile, md, 'utf8');

    // 2. Gera Texto Puro (.txt)
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
    if (summary) {
      txt += '------------------------------------------------------------------------\n';
      txt += `RESUMO TÉCNICO (IA):\n${summary}\n`;
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

    // 3. Gera DOCX elegante com logo
    await this._generateDocx({
      filePath: docxFile,
      orderId,
      nowFormatted,
      station,
      tech,
      user,
      summary,
      actions
    });

    // 4. Gera PDF com design profissional e logo
    await this._generatePdf({
      filePath: pdfFile,
      orderId,
      nowFormatted,
      station,
      tech,
      user,
      summary,
      actions
    });

    const result = {
      order_id: orderId,
      created_at_local: nowFormatted,
      station_name: station,
      technician_name: tech,
      user_name: user,
      summary,
      actions_performed: actions.map(a => a.trim()),
      order_dir: baseDir,
      markdown_path: mdFile,
      txt_path: txtFile,
      docx_path: docxFile,
      pdf_path: pdfFile
    };

    this._saveToHistory(result);

    return result;
  }

  async _generateDocx({ filePath, orderId, nowFormatted, station, tech, user, summary, actions }) {
    const {
      Document,
      Packer,
      Paragraph,
      TextRun,
      Table,
      TableRow,
      TableCell,
      WidthType,
      AlignmentType,
      BorderStyle,
      ImageRun,
      ShadingType
    } = docx;

    const children = [];

    // Header com Logo e Título
    let headerLogoRun = null;
    if (this.logoPath && fs.existsSync(this.logoPath)) {
      try {
        const imgBuffer = fs.readFileSync(this.logoPath);
        headerLogoRun = new ImageRun({
          data: imgBuffer,
          transformation: {
            width: 140,
            height: 67
          }
        });
      } catch (err) {
        console.error('[ServiceOrder] Falha ao carregar logo para docx:', err.message);
      }
    }

    if (headerLogoRun) {
      children.push(
        new Paragraph({
          children: [headerLogoRun],
          alignment: AlignmentType.CENTER,
          spacing: { after: 140 }
        })
      );
    }

    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: 'ORDEM DE SERVIÇO INTERNA',
            bold: true,
            size: 32, // 16pt
            color: '0F172A',
            font: 'Segoe UI'
          })
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 }
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: 'DEPARTAMENTO CORPORATIVO DE TECNOLOGIA DA INFORMAÇÃO',
            bold: true,
            size: 18, // 9pt
            color: '2563EB',
            font: 'Segoe UI'
          })
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 260 }
      })
    );

    // Tabela de Metadados / Informações do Atendimento
    const metaBorders = {
      top: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
      left: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
      right: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' }
    };

    const makeMetaCell = (label, val, widthPercent) => new TableCell({
      width: { size: widthPercent, type: WidthType.PERCENTAGE },
      borders: metaBorders,
      shading: { fill: 'F8FAFC', type: ShadingType.CLEAR },
      margins: { top: 100, bottom: 100, left: 140, right: 140 },
      children: [
        new Paragraph({
          children: [
            new TextRun({ text: `${label}: `, bold: true, size: 19, color: '475569', font: 'Segoe UI' }),
            new TextRun({ text: val || '—', size: 19, color: '0F172A', font: 'Segoe UI' })
          ]
        })
      ]
    });

    const metaRows = [
      new TableRow({
        children: [
          makeMetaCell('Protocolo Interno', orderId, 50),
          makeMetaCell('Data/Hora Local', nowFormatted, 50)
        ]
      }),
      new TableRow({
        children: [
          makeMetaCell('Estação (Hostname)', station, 50),
          makeMetaCell('Técnico Responsável', tech, 50)
        ]
      })
    ];

    if (user) {
      metaRows.push(
        new TableRow({
          children: [
            makeMetaCell('Usuário Solicitante', user, 100)
          ]
        })
      );
    }

    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: metaRows
      }),
      new Paragraph({ spacing: { after: 240 } })
    );

    // Seção de Resumo da IA (caso haja)
    if (summary) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: 'SÍNTESE EXECUTIVA DO ATENDIMENTO (IA)',
              bold: true,
              size: 22,
              color: '1E3A8A',
              font: 'Segoe UI'
            })
          ],
          spacing: { before: 120, after: 100 }
        }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  width: { size: 100, type: WidthType.PERCENTAGE },
                  borders: {
                    left: { style: BorderStyle.SINGLE, size: 16, color: '3B82F6' },
                    top: { style: BorderStyle.NONE },
                    bottom: { style: BorderStyle.NONE },
                    right: { style: BorderStyle.NONE }
                  },
                  shading: { fill: 'EFF6FF', type: ShadingType.CLEAR },
                  margins: { top: 120, bottom: 120, left: 160, right: 160 },
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: summary,
                          size: 19,
                          color: '1E293B',
                          font: 'Segoe UI'
                        })
                      ]
                    })
                  ]
                })
              ]
            })
          ]
        }),
        new Paragraph({ spacing: { after: 240 } })
      );
    }

    // Seção de Ações Realizadas
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: 'AÇÕES E PROCEDIMENTOS EXECUTADOS',
            bold: true,
            size: 22,
            color: '1E3A8A',
            font: 'Segoe UI'
          })
        ],
        spacing: { before: 120, after: 120 }
      })
    );

    const actionRows = [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 10, type: WidthType.PERCENTAGE },
            shading: { fill: '2563EB', type: ShadingType.CLEAR },
            borders: metaBorders,
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: 'ITEM', bold: true, size: 18, color: 'FFFFFF', font: 'Segoe UI' })
                ]
              })
            ]
          }),
          new TableCell({
            width: { size: 90, type: WidthType.PERCENTAGE },
            shading: { fill: '2563EB', type: ShadingType.CLEAR },
            borders: metaBorders,
            margins: { top: 100, bottom: 100, left: 120, right: 120 },
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: 'DESCRIÇÃO TÉCNICA DA AÇÃO', bold: true, size: 18, color: 'FFFFFF', font: 'Segoe UI' })
                ]
              })
            ]
          })
        ]
      })
    ];

    actions.forEach((act, idx) => {
      const isEven = idx % 2 === 0;
      const fill = isEven ? 'FFFFFF' : 'F8FAFC';
      actionRows.push(
        new TableRow({
          children: [
            new TableCell({
              width: { size: 10, type: WidthType.PERCENTAGE },
              shading: { fill, type: ShadingType.CLEAR },
              borders: metaBorders,
              margins: { top: 80, bottom: 80, left: 80, right: 80 },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({ text: String(idx + 1).padStart(2, '0'), bold: true, size: 18, color: '475569', font: 'Segoe UI' })
                  ]
                })
              ]
            }),
            new TableCell({
              width: { size: 90, type: WidthType.PERCENTAGE },
              shading: { fill, type: ShadingType.CLEAR },
              borders: metaBorders,
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: act.trim(), size: 19, color: '0F172A', font: 'Segoe UI' })
                  ]
                })
              ]
            })
          ]
        })
      );
    });

    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: actionRows
      }),
      new Paragraph({ spacing: { after: 360 } })
    );

    // Bloco de Assinaturas
    const sigCell = (role, nameText) => new TableCell({
      width: { size: 50, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.NONE },
        bottom: { style: BorderStyle.NONE },
        left: { style: BorderStyle.NONE },
        right: { style: BorderStyle.NONE }
      },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: '________________________________________', size: 18, color: '94A3B8' })
          ]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 60 },
          children: [
            new TextRun({ text: role, bold: true, size: 18, color: '1E293B', font: 'Segoe UI' })
          ]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: nameText || '—', size: 16, color: '64748B', font: 'Segoe UI' })
          ]
        })
      ]
    });

    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              sigCell('Técnico de Suporte', tech),
              sigCell('Usuário / Responsável', user || station)
            ]
          })
        ]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 300 },
        children: [
          new TextRun({
            text: 'Documento técnico de controle interno de TI — Gerado automaticamente pelo DC-TI Corporate Support Engine.',
            italics: true,
            size: 15,
            color: '94A3B8',
            font: 'Segoe UI'
          })
        ]
      })
    );

    const doc = new Document({
      sections: [{
        properties: {
          page: {
            margin: {
              top: 1000,
              bottom: 1000,
              left: 1200,
              right: 1200
            }
          }
        },
        children
      }]
    });

    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(filePath, buffer);
  }

  async _generatePdf({ filePath, orderId, nowFormatted, station, tech, user, summary, actions }) {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
        info: {
          Title: `Ordem de Serviço ${orderId}`,
          Author: tech || 'DC-TI Support',
          Subject: 'Ordem de Serviço Técnica Interna',
          CreationDate: new Date()
        }
      });

      const writeStream = fs.createWriteStream(filePath);
      doc.pipe(writeStream);

      // Cores do tema corporativo
      const primaryColor = '#1e3a8a';
      const secondaryColor = '#2563eb';
      const textColor = '#0f172a';
      const mutedText = '#64748b';
      const lightBg = '#f8fafc';
      const borderColor = '#e2e8f0';

      const left = 40;
      const right = 555;
      const contentWidth = right - left;

      // 1. Cabeçalho com Logo
      let headerY = 40;
      if (this.logoPath && fs.existsSync(this.logoPath)) {
        try {
          const imgBuffer = fs.readFileSync(this.logoPath);
          doc.image(imgBuffer, left, headerY, { width: 110 });
        } catch (e) {
          console.error('[ServiceOrder] Falha ao renderizar logo no PDF:', e.message);
        }
      }

      // Título e Subtítulo alinhados à direita / topo
      doc.font('Helvetica-Bold')
        .fontSize(16)
        .fillColor(primaryColor)
        .text('ORDEM DE SERVIÇO INTERNA', 165, headerY + 8, { align: 'right', width: contentWidth - 125 });

      doc.font('Helvetica-Bold')
        .fontSize(9)
        .fillColor(secondaryColor)
        .text('DEPARTAMENTO CORPORATIVO DE TI', 165, headerY + 28, { align: 'right', width: contentWidth - 125 });

      doc.font('Helvetica')
        .fontSize(8)
        .fillColor(mutedText)
        .text(`Protocolo: ${orderId}  |  Emissão: ${nowFormatted}`, 165, headerY + 42, { align: 'right', width: contentWidth - 125 });

      // Linha divisória horizontal
      let currentY = 105;
      doc.strokeColor(secondaryColor).lineWidth(1.5).moveTo(left, currentY).lineTo(right, currentY).stroke();
      currentY += 15;

      // 2. Tabela de Metadados / Informações
      const metaBoxHeight = user ? 64 : 48;
      doc.roundedRect(left, currentY, contentWidth, metaBoxHeight, 4).fillAndStroke(lightBg, borderColor);

      doc.fillColor(textColor).fontSize(9);

      // Coluna 1
      doc.font('Helvetica-Bold').text('Estação (Hostname): ', left + 14, currentY + 10, { continued: true })
        .font('Helvetica').text(station);

      doc.font('Helvetica-Bold').text('Técnico Responsável: ', left + 14, currentY + 26, { continued: true })
        .font('Helvetica').text(tech);

      if (user) {
        doc.font('Helvetica-Bold').text('Usuário Solicitante: ', left + 14, currentY + 42, { continued: true })
          .font('Helvetica').text(user);
      }

      // Coluna 2
      const col2Left = left + (contentWidth / 2) + 10;
      doc.font('Helvetica-Bold').text('Protocolo Interno: ', col2Left, currentY + 10, { continued: true })
        .font('Helvetica').text(orderId);

      doc.font('Helvetica-Bold').text('Data/Hora Local: ', col2Left, currentY + 26, { continued: true })
        .font('Helvetica').text(nowFormatted);

      currentY += metaBoxHeight + 15;

      // 3. Síntese Técnica da IA (se houver)
      if (summary) {
        doc.font('Helvetica-Bold').fontSize(11).fillColor(primaryColor).text('SÍNTESE EXECUTIVA DO ATENDIMENTO (IA)', left, currentY);
        currentY += 16;

        const summaryBoxY = currentY;
        const summaryTextY = currentY + 8;
        const textHeight = doc.font('Helvetica').fontSize(9).heightOfString(summary, { width: contentWidth - 24 });
        const boxHeight = Math.max(textHeight + 16, 36);

        // Fundo azul suave com barra lateral azul intensa
        doc.roundedRect(left, summaryBoxY, contentWidth, boxHeight, 4).fillAndStroke('#eff6ff', '#bfdbfe');
        doc.rect(left, summaryBoxY, 4, boxHeight).fill('#3b82f6');

        doc.fillColor('#1e293b').font('Helvetica').fontSize(9)
          .text(summary, left + 14, summaryTextY, { width: contentWidth - 24 });

        currentY = summaryBoxY + boxHeight + 18;
      }

      // 4. Ações e Procedimentos Executados
      doc.font('Helvetica-Bold').fontSize(11).fillColor(primaryColor).text('AÇÕES E PROCEDIMENTOS EXECUTADOS', left, currentY);
      currentY += 16;

      // Cabeçalho da Lista de Ações
      const tableHeaderHeight = 20;
      doc.rect(left, currentY, contentWidth, tableHeaderHeight).fill(secondaryColor);
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8.5);
      doc.text('ITEM', left + 10, currentY + 5, { width: 35, align: 'center' });
      doc.text('DESCRIÇÃO TÉCNICA DA AÇÃO REALIZADA', left + 55, currentY + 5, { width: contentWidth - 65 });
      currentY += tableHeaderHeight;

      // Itens
      actions.forEach((act, idx) => {
        const itemNumber = String(idx + 1).padStart(2, '0');
        const text = act.trim();
        const textHeight = doc.font('Helvetica').fontSize(8.5).heightOfString(text, { width: contentWidth - 70 });
        const rowHeight = Math.max(textHeight + 10, 22);

        // Quebra de página caso necessário
        if (currentY + rowHeight > 730) {
          doc.addPage();
          currentY = 40;
          doc.rect(left, currentY, contentWidth, tableHeaderHeight).fill(secondaryColor);
          doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8.5);
          doc.text('ITEM', left + 10, currentY + 5, { width: 35, align: 'center' });
          doc.text('DESCRIÇÃO TÉCNICA DA AÇÃO REALIZADA (CONT.)', left + 55, currentY + 5, { width: contentWidth - 65 });
          currentY += tableHeaderHeight;
        }

        const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
        doc.rect(left, currentY, contentWidth, rowHeight).fillAndStroke(bg, borderColor);

        doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(8.5)
          .text(itemNumber, left + 10, currentY + 6, { width: 35, align: 'center' });

        doc.fillColor(textColor).font('Helvetica').fontSize(8.5)
          .text(text, left + 55, currentY + 6, { width: contentWidth - 70 });

        currentY += rowHeight;
      });

      currentY += 30;

      // 5. Bloco de Assinaturas (verifica espaço na página)
      if (currentY + 80 > 760) {
        doc.addPage();
        currentY = 50;
      }

      const sigWidth = 200;
      const sig1X = left + 20;
      const sig2X = right - sigWidth - 20;

      // Linhas de assinatura
      doc.strokeColor('#94a3b8').lineWidth(1)
        .moveTo(sig1X, currentY).lineTo(sig1X + sigWidth, currentY).stroke()
        .moveTo(sig2X, currentY).lineTo(sig2X + sigWidth, currentY).stroke();

      currentY += 8;
      doc.font('Helvetica-Bold').fontSize(9).fillColor(textColor)
        .text('Técnico de Suporte', sig1X, currentY, { width: sigWidth, align: 'center' })
        .text('Usuário / Responsável', sig2X, currentY, { width: sigWidth, align: 'center' });

      currentY += 12;
      doc.font('Helvetica').fontSize(8).fillColor(mutedText)
        .text(tech, sig1X, currentY, { width: sigWidth, align: 'center' })
        .text(user || station, sig2X, currentY, { width: sigWidth, align: 'center' });

      // Rodapé
      doc.font('Helvetica-Oblique').fontSize(7.5).fillColor('#94a3b8')
        .text('Documento técnico de controle interno de TI — Gerado automaticamente pelo DC-TI Corporate Support Engine.', left, 780, {
          width: contentWidth,
          align: 'center'
        });

      doc.end();

      writeStream.on('finish', () => resolve(filePath));
      writeStream.on('error', (err) => reject(err));
    });
  }
}

module.exports = { ServiceOrderService };
