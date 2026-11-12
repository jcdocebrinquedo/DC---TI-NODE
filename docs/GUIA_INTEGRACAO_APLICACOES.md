# Guia de Integração de Aplicações — Doce LLM AI Gateway

Este guia fornece instruções completas, padrões arquiteturais e exemplos práticos em diversas linguagens para conectar qualquer software consumidor (bots, web apps, mobile, microsserviços, ERPs, CRMs) ao **Doce LLM AI Gateway**.

---

## 📌 Sumário
1. [Visão Geral da Arquitetura](#1-visão-geral-da-arquitetura)
2. [Tipos de Aplicação (DEV vs USER)](#2-tipos-de-aplicação-dev-vs-user)
3. [Autenticação e Endpoints](#3-autenticação-e-endpoints)
4. [Especificação da Requisição (OpenAI Compatible)](#4-especificação-da-requisição-openai-compatible)
5. [Exemplos de Código Prático](#5-exemplos-de-código-prático)
   - [cURL](#curl)
   - [Node.js / TypeScript (Fetch Nativo)](#nodejs--typescript)
   - [Python (Requests)](#python-requests)
   - [C# / .NET (HttpClient)](#c--net-httpclient)
   - [PHP (cURL)](#php)
6. [Streaming em Tempo Real (Server-Sent Events - SSE)](#6-streaming-em-tempo-real-server-sent-events---sse)
7. [Recursos de Segurança e Governança (DLP & Guardrails)](#7-recursos-de-segurança-e-governança-dlp--guardrails)
8. [Tratamento de Erros e Códigos de Status](#8-tratamento-de-erros-e-códigos-de-status)
9. [Boas Práticas de Integração](#9-boas-práticas-de-integração)

---

## 1. Visão Geral da Arquitetura

O **Doce LLM Gateway** atua como uma camada inteligente intermediária entre seus sistemas e as principais APIs de Inteligência Artificial do mercado:

```
[ Sua Aplicação Consumidora ]
 (ERP / Chatbot / App Web / Mobile)
             │
             │ HTTP POST /api/v1/chat/completions
             │ Header: Authorization: Bearer <APP_BEARER_TOKEN>
             ▼
┌────────────────────────────────────────────────────────┐
│               DOCE LLM - AI GATEWAY                    │
│  ├─ Autenticação & Rastreamento por Aplicação          │
│  ├─ Limite de Taxa (RPM / TPM) & Quota Mensal          │
│  ├─ DLP (Mascaramento de CPF, CNPJ, Cartões, E-mails)  │
│  ├─ Guardrails (Bloqueio de Prompt Injection)          │
│  ├─ Cache Semântico de Respostas                       │
│  ├─ Rotação Automática de Chaves & Quarentena (429)    │
│  └─ Failover Híbrido Automático entre Provedores       │
└────────────────────────────────────────────────────────┘
             │
             ├──► Google Gemini API
             ├──► OpenAI (GPT-4o, o3-mini)
             ├──► Anthropic (Claude 3.5/3.7)
             ├──► xAI (Grok 2 / Grok 3)
             └──► Groq Cloud (Llama 3, Mixtral)
```

---

## 2. Tipos de Aplicação (DEV vs USER)

Ao cadastrar sua aplicação na aba **/applications** do Gateway, você escolhe entre dois perfis:

| Recurso | Perfil `DEV` (Autonomia Técnica) | Perfil `USER` (Consumo Padronizado) |
| :--- | :--- | :--- |
| **Público-alvo** | Engenheiros, microsserviços, automações avançadas | Usuários de negócio, chatbots prontos, interfaces simples |
| **Escolha de Modelo** | Livre (pode enviar qualquer `provider` e `model`) | Travado no modelo/provedor padrão configurado no cadastro |
| **System Instruction** | Definido dinamicamente via código da requisição | Injetado automaticamente pelo Gateway de forma padronizada |
| **Temperatura / Tokens** | Parâmetros livres enviados no JSON da requisição | Padronizados nas configurações fixas da aplicação |

---

## 3. Autenticação e Endpoints

### Endpoint Oficial de Inferência
* **URL:** `POST http://<IP_DO_GATEWAY>:3000/api/v1/chat/completions`
* *(Ou através de Proxy Reverso SSL/HTTPS: `POST https://seu-dominio.com/api/v1/chat/completions`)*

### Headers Obrigatórios
```http
POST /api/v1/chat/completions HTTP/1.1
Host: localhost:3000
Authorization: Bearer doce_app_a1b2c3d4e5f6...
Content-Type: application/json; charset=utf-8
```

> [!CAUTION]
> **Segurança:** Nunca exponha o seu Bearer Token em aplicações frontend clientes (Single Page Apps públicas ou scripts de navegador). Faça as chamadas exclusivamente a partir do backend da sua aplicação consumidora.

---

## 4. Especificação da Requisição (OpenAI Compatible)

O Gateway segue o padrão de requisições compatível com a OpenAI, facilitando a portabilidade.

### Payload de Exemplo (JSON)
```json
{
  "provider": "GEMINI",
  "model": "gemini-3.1-flash-lite",
  "messages": [
    { "role": "system", "content": "Você é um assistente técnico conciso." },
    { "role": "user", "content": "Qual a diferença entre REST e GraphQL?" }
  ],
  "temperature": 0.7,
  "max_tokens": 1000,
  "stream": false
}
```

### Principais Parâmetros
* **`provider`** *(opcional)*: `"GEMINI"`, `"OPENAI"`, `"ANTHROPIC"`, `"XAI"` ou `"GROQ"`. *(Se omitido, utiliza o padrão configurado para a aplicação ou setor).*
* **`model`** *(opcional)*: Nome do modelo desejado (ex: `gemini-3.1-flash-lite`, `gpt-4o`, `claude-3-5-sonnet`, `grok-2`).
* **`messages`** *(obrigatório)*: Array de objetos com `role` (`"system"`, `"user"` ou `"assistant"`) e `content` (texto da mensagem).
* **`stream`** *(opcional, default `false`)*: Se `true`, retorna a resposta via Server-Sent Events (SSE).
* **`temperature`** *(opcional)*: Número entre `0.0` e `2.0` (criatividade da resposta).
* **`max_tokens`** *(opcional)*: Limite de tokens gerados na resposta.
* **`store`** *(opcional, default `true`)*: Define se a conversa deve ser persistida no banco do Gateway para consulta em **/conversations**.

---

## 5. Exemplos de Código Prático

### cURL
```bash
curl -X POST "http://localhost:3000/api/v1/chat/completions" \
  -H "Authorization: Bearer SEU_BEARER_TOKEN_AQUI" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "GEMINI",
    "messages": [
      { "role": "user", "content": "Explique microsserviços em 2 parágrafos." }
    ]
  }'
```

---

### Node.js / TypeScript
*Compatível com Node 18+ nativo (sem dependências externas):*

```typescript
async function chamarIA(pergunta: string) {
  const GATEWAY_URL = process.env.GATEWAY_URL || "http://localhost:3000";
  const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || "SEU_BEARER_TOKEN";

  const response = await fetch(`${GATEWAY_URL}/api/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GATEWAY_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      provider: "GEMINI",
      model: "gemini-3.1-flash-lite",
      messages: [{ role: "user", content: pergunta }],
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Erro Gateway (${response.status}): ${errorData.error || response.statusText}`);
  }

  const data = await response.json();
  const respostaTexto = data.choices[0].message.content;
  console.log("Tokens consumidos:", data.usage);
  return respostaTexto;
}

chamarIA("Olá! Como você pode me ajudar?").then(console.log).catch(console.error);
```

---

### Python (Requests)
```python
import os
import requests

GATEWAY_URL = os.getenv("GATEWAY_URL", "http://localhost:3000")
GATEWAY_TOKEN = os.getenv("GATEWAY_TOKEN", "SEU_BEARER_TOKEN")

payload = {
    "provider": "OPENAI",
    "model": "gpt-4o-mini",
    "messages": [
        {"role": "system", "content": "Você é um assistente prestativo."},
        {"role": "user", "content": "Gere um resumo de 3 pontos sobre computação em nuvem."}
    ],
    "temperature": 0.5
}

headers = {
    "Authorization": f"Bearer {GATEWAY_TOKEN}",
    "Content-Type": "application/json"
}

response = requests.post(
    f"{GATEWAY_URL}/api/v1/chat/completions",
    json=payload,
    headers=headers,
    timeout=60
)

if response.status_code == 200:
    dados = response.json()
    conteudo = dados["choices"][0]["message"]["content"]
    print("Resposta:\n", conteudo)
    print("Métricas de Uso:", dados.get("usage"))
else:
    print(f"Falha na requisição: {response.status_code} - {response.text}")
```

---

### C# / .NET (HttpClient)
```csharp
using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

class Program
{
    private static readonly HttpClient client = new HttpClient();

    static async Task Main()
    {
        string gatewayUrl = "http://localhost:3000/api/v1/chat/completions";
        string bearerToken = "SEU_BEARER_TOKEN";

        var payload = new
        {
            provider = "GEMINI",
            model = "gemini-3.1-flash-lite",
            messages = new[]
            {
                new { role = "user", content = "Qual a vantagem de usar um AI Gateway corporativo?" }
            }
        };

        var request = new HttpRequestMessage(HttpMethod.Post, gatewayUrl);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
        request.Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");

        var response = await client.SendAsync(request);
        var responseString = await response.Content.ReadAsStringAsync();

        if (response.IsSuccessStatusCode)
        {
            using var doc = JsonDocument.Parse(responseString);
            string resposta = doc.RootElement
                .GetProperty("choices")[0]
                .GetProperty("message")
                .GetProperty("content")
                .GetString();

            Console.WriteLine("Resposta da IA:");
            Console.WriteLine(resposta);
        }
        else
        {
            Console.WriteLine($"Erro HTTP {response.StatusCode}: {responseString}");
        }
    }
}
```

---

### PHP
```php
<?php
$gatewayUrl = 'http://localhost:3000/api/v1/chat/completions';
$token = 'SEU_BEARER_TOKEN';

$payload = [
    'provider' => 'ANTHROPIC',
    'messages' => [
        ['role' => 'user', 'content' => 'Escreva uma mensagem de boas-vindas para clientes.']
    ]
];

$ch = curl_init($gatewayUrl);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Authorization: Bearer ' . $token,
    'Content-Type: application/json'
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($httpCode === 200) {
    $data = json_decode($response, true);
    echo $data['choices'][0]['message']['content'];
} else {
    echo "Erro HTTP {$httpCode}: " . $response;
}
```

---

## 6. Streaming em Tempo Real (Server-Sent Events - SSE)

Para exibir o texto gerado caractere a caractere em interfaces de chat, passe `"stream": true`:

```bash
curl -N -X POST "http://localhost:3000/api/v1/chat/completions" \
  -H "Authorization: Bearer SEU_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "GEMINI",
    "stream": true,
    "messages": [{ "role": "user", "content": "Escreva um poema sobre tecnologia." }]
  }'
```

### Formato de Retorno SSE:
```http
data: {"id":"chat-123","choices":[{"delta":{"content":"A"},"index":0}]}

data: {"id":"chat-123","choices":[{"delta":{"content":" tecnologia"},"index":0}]}

data: [DONE]
```

---

## 7. Recursos de Segurança e Governança (DLP & Guardrails)

Ao integrar via aplicação registrada, o Gateway aplica proteções automáticas configuradas no painel:

1. **DLP (Data Loss Prevention):** Mascara automaticamente dados sensíveis contidos nos prompts (ex: CPFs, CNPJs, cartões de crédito e telefones) antes de despachar a chamada aos provedores externos de IA.
2. **Anti-Prompt Injection:** Interrompe requisições que tentem burlar instruções de sistema (Jailbreak) retornando HTTP 400 com mensagem explicativa.
3. **Cache Semântico:** Perguntas repetidas respondidas recentemente são entregues instantaneamente do cache local, com latência inferior a 15ms e sem consumir cota de tokens das APIs externas.

---

## 8. Tratamento de Erros e Códigos de Status

| Código HTTP | Significado | Como Resolver na Aplicação |
| :--- | :--- | :--- |
| **`400 Bad Request`** | Parâmetros ausentes, JSON inválido ou bloqueio de Guardrail | Verifique a estrutura do body ou o conteúdo da mensagem |
| **`401 Unauthorized`** | Bearer Token inválido, expirado ou revogado | Obtenha um novo token na aba `/applications` ou `/sectors` |
| **`403 Forbidden`** | Aplicação inativa ou quota mensal esgotada | Solicite ao administrador a reativação ou aumento do limite de tokens |
| **`429 Too Many Requests`**| Limite por minuto (RPM/TPM) atingido | Aguarde alguns segundos antes de disparar novas requisições |
| **`503 Service Unavailable`**| Todas as chaves do provedor estão em quarentena | O Gateway tenta o Failover Híbrido automaticamente. Se persistir, contate o administrador |

---

## 9. Boas Práticas de Integração

1. **Reaproveitamento de Conexões:** Mantenha clientes HTTP (como `HttpClient` no C# ou conexões persistentes com Keep-Alive) instanciados como singletons para reduzir a latência de handshake TCP.
2. **Definição de Timeouts:** Estabeleça um timeout razoável no cliente consumidor (ex: 60 a 120 segundos), especialmente para gerações extensas de código ou respostas complexas.
3. **Mantenha os Tokens no `.env`:** Armazene a URL base do Gateway e o Bearer Token em variáveis de ambiente, nunca diretamente no código-fonte ou versionados no Git.
4. **Utilize o `store: true` para Rastreamento:** Mantenha o parâmetro `store` ativo para que as conversas e métricas de latência possam ser auditadas detalhadamente pelo dashboard corporativo.

