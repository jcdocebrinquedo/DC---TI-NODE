'use strict';

const { aiConfigService } = require('./ai-config.service');
const { adminElevationService } = require('./admin-elevation.service');

const SYSTEM_PROMPT = `Você é o "Agente Autônomo de Suporte e Reparo de TI" do DC-TI, executando diretamente na máquina do usuário Windows com privilégios elevados.
Você possui ACESSO TOTAL ao sistema operacional através das ferramentas nativas MCP disponibilizadas:
- 'execute_command': Permite rodar qualquer comando no PowerShell ou CMD do Windows.
- 'get_system_overview': Obtém status do processador, memória, uptime, discos e privilégio de administrador.
- 'get_disks_smart': Faz a leitura profunda de saúde dos discos/SSDs/NVMe, bad blocks e temperatura.
- 'run_deep_cleanup': Executa a limpeza profunda de arquivos temporários e caches.
- 'repair_service_or_network': Repara Spooler de impressão, redefinição de rede TCP/IP/DNS, SFC e DISM.
- 'manage_windows_service': Inicia, para ou reinicia serviços do Windows.
- 'set_hostname': Altera o nome do computador no registro.
- 'confirm_admin_elevation': Confirma e eleva os privilégios de Administrador do sistema, definindo admin_elevated como true.
- 'network_doctor_check': Diagnóstico completo de conectividade, interfaces de rede, pings e resolução DNS.
- 'security_audit_check': Auditoria de conformidade (Windows Defender, Firewall e BitLocker).
- 'list_startup_programs': Lista programas de inicialização automática do Windows (HKLM/HKCU Run).
- 'analyze_crash_minidumps': Inspeciona arquivos Minidump de tela azul (BSOD) e eventos críticos do Kernel.
- 'run_stress_test': Teste de estresse rápido da CPU (10 segundos) para teste de estabilidade.
- 'get_session_audit_log': Inspeciona tudo o que foi realizado no software desde que foi aberto na sessão atual.
- 'generate_service_order': Gera a Ordem de Serviço formal nos formatos DOCX (Word), PDF, Markdown (.md) e Texto (.txt) com o cabeçalho e logotipo oficial da empresa.

SEUS PRINCÍPIOS E DIRETRIZES DE ATUAÇÃO:
1. REGRA MANDATÓRIA DE ELEVAÇÃO DE ADMINISTRADOR:
   Sempre que o usuário solicitar, autorizar ou confirmar privilégios de Administrador (por exemplo: "confirmo", "quero admin_elevated: true", "elevar administrador", "pode executar como admin"), você DEVE IMEDIATAMENTE acionar a ferramenta 'confirm_admin_elevation' com {"confirmed": true}. NUNCA diga que não é possível ou que o usuário precisa reiniciar manualmente antes de chamar essa ferramenta. Chame a ferramenta 'confirm_admin_elevation' imediatamente.
2. GERAÇÃO DE ORDEM DE SERVIÇO COM IA:
   Quando o usuário solicitar a geração de Ordem de Serviço (OS), relatório de atendimento ou formalização dos trabalhos feitos:
   - Chame 'get_session_audit_log' para analisar todo o histórico de comandos, reparos e diagnósticos executados na sessão.
   - Formule um resumo executivo técnico claro dos problemas identificados e das soluções adotadas.
   - Chame a ferramenta 'generate_service_order' com a lista completa de ações estruturadas, gerando os documentos em DOCX e PDF com a logomarca da empresa.
   - Informe os caminhos dos arquivos gerados para o usuário.
3. OBJETIVO: Atender à solicitação do usuário, diagnosticando e executando as manutenções e reparos necessários na máquina.
4. RESOLUÇÃO REAL: Não fique apenas dando conselhos teóricos; UTILIZE as ferramentas disponíveis para executar as checagens e correções reais no sistema.
5. INSTRUÇÕES APÓS A MANUTENÇÃO: Sempre que concluir um reparo ou comando, explique de forma clara e profissional:
   - O que foi detectado;
   - O que foi executado na máquina;
   - O resultado obtido;
   - Se é necessária reinicialização do Windows ou alguma ação posterior por parte do usuário.
6. EM CASO DE DÚVIDA OU AMBIGUIDADE: Se o pedido do usuário for vago ou envolver múltiplos caminhos de ação, NÃO faça suposições perigosas. Pergunte ao usuário o que ele prefere realizar, dando alternativas claras.
7. RESPOSTA EM PORTUGUÊS DO BRASIL: Seja técnico, educado, preciso e transparente em relação às ações executadas. Utilize sempre ortografia correta do Português do Brasil com acentuação gráfica e cedilhas completas (nunca omita acentos ou cedilhas).`;

class AiAgentService {
  constructor(toolRegistry) {
    this.toolRegistry = toolRegistry;
  }

  async chat({ messages }) {
    const config = aiConfigService.getConfig();

    if (!config.apiKey) {
      throw new Error('Chave de API do Doce LLM Gateway não configurada. Acesse as configurações da IA e informe seu Bearer Token.');
    }

    const gatewayUrl = (config.gatewayUrl || 'http://localhost:3000').replace(/\/+$/, '');
    const endpoint = `${gatewayUrl}/api/v1/chat/completions`;

    // Detecta intenção de confirmação de elevação de administrador
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    const userText = lastUserMsg?.content || '';
    const elevationIntent = /(?:confirmo|confirmar|confirmado|elevar|eleva(?:ção)?|tornar|definir).*(?:admin|administrador|admin_elevated)/i.test(userText) ||
      /(?:admin|administrador|admin_elevated).*(?:true|confirmo|confirmar|ativar|verdadeiro)/i.test(userText);

    if (elevationIntent) {
      adminElevationService.confirmElevation();
    }

    const isElevated = adminElevationService.isElevated();
    const dynamicInstruction = `${SYSTEM_PROMPT}\n\n[STATUS ATUAL DE PRIVILÉGIOS NO SISTEMA]:
- Privilégios de Administrador (admin_elevated): ${isElevated ? 'true (CONFIRMADO E ATIVO COM CONTROLE TOTAL)' : 'false (NÃO ELEVADO)'}
${isElevated ? 'Atenção: Os privilégios de Administrador JÁ FORAM confirmados e ativados. Se o usuário perguntar ou solicitar o status, confirme com entusiasmo e certeza técnica que admin_elevated agora é true e você está pronto para operações avançadas.' : ''}`;

    // Constrói lista de mensagens garantindo formato estritamente compatível com o Doce LLM Gateway
    const allowedRoles = new Set(['user', 'assistant', 'system', 'model']);
    const fullMessages = messages
      .filter(m => m && m.role !== 'system' && allowedRoles.has(m.role) && typeof m.content === 'string' && m.content.trim().length > 0)
      .map(m => ({ role: m.role, content: m.content.trim() }));

    const tools = this.toolRegistry.getToolsDefinitions().map(t => ({
      type: 'function',
      function: t
    }));

    // Loop de Tool Calling (máx 5 iterações para evitar loops infinitos)
    let iterations = 0;
    const currentMessages = [...fullMessages];
    const executedCalls = new Set();
    let forceNoToolsNext = false;

    while (iterations < 5) {
      iterations++;

      const payload = {
        provider: config.provider || 'GEMINI',
        model: config.model || 'gemini-3.1-flash-lite',
        systemInstruction: dynamicInstruction,
        messages: currentMessages,
        temperature: config.temperature ?? 0.2,
        tools: tools,
        tool_choice: (forceNoToolsNext || iterations === 5) ? 'none' : 'auto'
      };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json; charset=utf-8',
          'Accept': 'application/json; charset=utf-8'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        let errText = await response.text();
        try {
          const parsed = JSON.parse(errText);
          errText = parsed.error?.message || errText;
        } catch {
          // Mantém errText original
        }
        throw new Error(`Erro no Gateway de IA (${response.status}): ${errText}`);
      }

      const resData = await response.json();
      const choice = resData.choices?.[0];
      const assistantMessage = choice?.message;

      if (!assistantMessage) {
        throw new Error('Resposta vazia recebida do Gateway de IA.');
      }

      // Se a IA solicitou chamadas de ferramentas (Tool Calling)
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        const executedNames = [];
        const toolResults = [];
        let repeatedCall = false;

        for (const toolCall of assistantMessage.tool_calls) {
          const fnName = toolCall.function?.name;
          let fnArgs = {};
          try {
            fnArgs = JSON.parse(toolCall.function?.arguments || '{}');
          } catch (e) {
            console.warn('[AiAgentService] Falha ao fazer parse de argumentos da ferramenta:', e.message);
          }

          const callSig = `${fnName}:${JSON.stringify(fnArgs)}`;
          if (executedCalls.has(callSig)) {
            repeatedCall = true;
          }
          executedCalls.add(callSig);
          executedNames.push(fnName);

          console.log(`[AiAgentService] Executando tool: ${fnName}`, fnArgs);
          const toolResult = await this.toolRegistry.executeTool(fnName, fnArgs);
          toolResults.push(`### Ferramenta: ${fnName}\n${JSON.stringify(toolResult, null, 2)}`);
        }

        // O Doce LLM Gateway aceita apenas { role: 'user'|'assistant'|'system'|'model', content: string (>=1 char) }
        const assistantNote = (assistantMessage.content && assistantMessage.content.trim())
          ? assistantMessage.content.trim()
          : `Executando ferramenta(s) de diagnóstico/manutenção: ${executedNames.join(', ')}.`;

        currentMessages.push({
          role: 'assistant',
          content: assistantNote
        });

        currentMessages.push({
          role: 'user',
          content: `[RESULTADO REAL DAS FERRAMENTAS EXECUTADAS NA MÁQUINA]:\n\n${toolResults.join('\n\n')}\n\nCom base exclusivamente nos dados reais acima, forneça a resposta técnica final ao usuário em Português do Brasil.`
        });

        if (repeatedCall) {
          forceNoToolsNext = true;
        }
        continue;
      }

      // Se não há tool calls, temos a resposta textual final do agente
      return {
        reply: assistantMessage.content || 'Ação concluída com sucesso.',
        model: resData.model || config.model,
        usage: resData.usage
      };
    }

    return {
      reply: 'Atingido limite de iterações de ferramentas com o sistema operacional.',
      model: config.model
    };
  }
}

module.exports = { AiAgentService };
