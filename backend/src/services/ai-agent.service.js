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

SEUS PRINCÍPIOS E DIRETRIZES DE ATUAÇÃO:
1. REGRA MANDATÓRIA DE ELEVAÇÃO DE ADMINISTRADOR:
   Sempre que o usuário solicitar, autorizar ou confirmar privilégios de Administrador (por exemplo: "confirmo", "quero admin_elevated: true", "elevar administrador", "pode executar como admin"), você DEVE IMEDIATAMENTE acionar a ferramenta 'confirm_admin_elevation' com {"confirmed": true}. NUNCA diga que não é possível ou que o usuário precisa reiniciar manualmente antes de chamar essa ferramenta. Chame a ferramenta 'confirm_admin_elevation' imediatamente.
2. OBJETIVO: Atender à solicitação do usuário, diagnosticando e executando as manutenções e reparos necessários na máquina.
3. RESOLUÇÃO REAL: Não fique apenas dando conselhos teóricos; UTILIZE as ferramentas disponíveis para executar as checagens e correções reais no sistema.
4. INSTRUÇÕES APÓS A MANUTENÇÃO: Sempre que concluir um reparo ou comando, explique de forma clara e profissional:
   - O que foi detectado;
   - O que foi executado na máquina;
   - O resultado obtido;
   - Se é necessária reinicialização do Windows ou alguma ação posterior por parte do usuário.
4. EM CASO DE DÚVIDA OU AMBIGUIDADE: Se o pedido do usuário for vago ou envolver múltiplos caminhos de ação (ex: "meu pc tá lento", "a internet tá ruim", "quero liberar espaço"), NÃO faça suposições perigosas. Pergunte ao usuário o que ele prefere realizar, dando alternativas claras (Exemplo: Opção 1: Limpeza de temporários; Opção 2: Diagnóstico de integridade de disco; Opção 3: Varredura de arquivos corrompidos SFC).
5. RESPOSTA EM PORTUGUÊS DO BRASIL: Seja técnico, educado, preciso e transparente em relação às ações executadas.`;

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

    // Constrói lista de mensagens garantindo formato compatível
    const fullMessages = messages.filter(m => m.role !== 'system');

    const tools = this.toolRegistry.getToolsDefinitions().map(t => ({
      type: 'function',
      function: t
    }));

    // Loop de Tool Calling (máx 5 iterações para evitar loops infinitos)
    let iterations = 0;
    const currentMessages = [...fullMessages];

    while (iterations < 5) {
      iterations++;

      const payload = {
        provider: config.provider || 'GEMINI',
        model: config.model || 'gemini-3.1-flash-lite',
        systemInstruction: dynamicInstruction,
        messages: currentMessages,
        temperature: config.temperature ?? 0.2,
        tools: tools,
        tool_choice: 'auto'
      };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        let errText = await response.text();
        try {
          const errJson = JSON.parse(errText);
          errText = errJson.error || errJson.message || errText;
        } catch {}
        throw new Error(`Erro no Doce LLM Gateway (${response.status}): ${errText}`);
      }

      const resData = await response.json();
      const choice = resData.choices?.[0];
      const assistantMessage = choice?.message;

      if (!assistantMessage) {
        throw new Error('Resposta vazia ou inválida recebida do Gateway de IA.');
      }

      // Se a IA solicitou execução de ferramentas (tool_calls)
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        // Registra a intenção do assistente mantendo conformidade com o schema do Gateway
        const calledTools = assistantMessage.tool_calls.map(tc => tc.function?.name).join(', ');
        currentMessages.push({
          role: 'assistant',
          content: assistantMessage.content && assistantMessage.content.trim().length > 0
            ? assistantMessage.content
            : `[Iniciando execução da(s) ferramenta(s): ${calledTools}]`
        });

        for (const toolCall of assistantMessage.tool_calls) {
          const funcName = toolCall.function?.name;
          let funcArgs = {};
          try {
            funcArgs = typeof toolCall.function?.arguments === 'string'
              ? JSON.parse(toolCall.function.arguments)
              : (toolCall.function?.arguments || {});
          } catch (e) {
            console.warn('[AiAgentService] Falha ao fazer parse dos argumentos da tool:', e);
          }

          console.log(`[AI MCP Executando] ${funcName}:`, funcArgs);
          const toolResult = await this.toolRegistry.executeTool(funcName, funcArgs);

          // O Doce LLM Gateway exige role 'user'|'assistant'|'system'|'model' com content >= 1
          currentMessages.push({
            role: 'user',
            content: `[Resultado da execução da ferramenta MCP '${funcName}']:\n${JSON.stringify(toolResult, null, 2)}`
          });
        }
        // Continua o loop para a IA analisar o resultado das ferramentas
        continue;
      }

      // Sem tool calls, registra a resposta do assistente
      currentMessages.push({
        role: 'assistant',
        content: assistantMessage.content || 'Ação concluída.'
      });

      // Se não há chamadas de ferramentas, a resposta final está pronta
      return {
        reply: assistantMessage.content,
        usage: resData.usage,
        messagesHistory: currentMessages
      };
    }

    // Se atingiu o limite de iterações, retorna a última mensagem
    const lastMsg = currentMessages[currentMessages.length - 1];
    return {
      reply: lastMsg.content || 'Ações executadas com sucesso pelo agente.',
      messagesHistory: currentMessages
    };
  }
}

module.exports = { AiAgentService };

