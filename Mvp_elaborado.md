# Arquitetura MVP: Agente RAG WhatsApp com Ingestão via Email (IMAP Multi-Conta)

> **Versão Elaborada** — Expansão técnica completa do documento original  
> Data: Março 2026 | Stack: Node.js · LlamaIndex.TS · Gemini API · Pinecone · Evolution API

---

## Visão Geral do Sistema

Este documento detalha a arquitetura de um sistema **multi-tenant de IA conversacional** para equipes comerciais. A empresa distribui conhecimento (tabelas de preços, catálogos, políticas) por email aos representantes. Um agente automatizado monitora essas caixas, vetoriza o conhecimento e o disponibiliza via WhatsApp com segurança por tenant.

```
┌─────────────────────────────────────────────────────────────────┐
│                    FLUXO GERAL DO SISTEMA                       │
│                                                                 │
│  EMPRESA (admin)                                                │
│     │ envia PDF por email                                       │
│     ▼                                                           │
│  [Caixa IMAP do Representante]                                  │
│     │ Cron Job (10 min)                                         │
│     ▼                                                           │
│  [Motor de Ingestão Node.js]                                    │
│     │ extrai PDF → chunking (LlamaIndex)                        │
│     │ → embeddings (Gemini Multimodal)                          │
│     ▼                                                           │
│  [Pinecone — tenant_id isolado]                                 │
│                                                                 │
│  REPRESENTANTE                                                  │
│     │ pergunta via WhatsApp                                     │
│     ▼                                                           │
│  [Evolution API Webhook → Node.js]                              │
│     │ busca vetorial filtrada por tenant_id                     │
│     │ → gemini-1.5-flash gera resposta                          │
│     ▼                                                           │
│  REPRESENTANTE recebe resposta precisa no WhatsApp              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 1. Stack Tecnológica Detalhada

| Camada | Tecnologia | Versão Recomendada | Justificativa |
|---|---|---|---|
| Runtime | Node.js | ≥ 20 LTS | Suporte nativo a ESM, `fetch` e streams |
| Framework HTTP | Express.js | 4.x | Leveza para MVP; migrar p/ NestJS na V2 |
| IMAP Client | `imapflow` | latest | API moderna com `async/await`, idle push |
| PDF Parser | `pdf-parse` ou `llamaparse` | latest | Extração de texto estruturado |
| Orquestrador IA | LlamaIndex.TS | latest | Chunking, indexing e query engine integrados |
| Embeddings | Gemini `text-embedding-004` | via API | 768 dims (gratuito); ou `gemini-embedding-exp-03-07` (3072 dims) |
| Geração de Texto | `gemini-2.0-flash` | via API | Melhor custo-benefício para respostas RAG |
| Banco Vetorial | Pinecone | Serverless | Auto-escala, filtro por metadados nativo |
| WhatsApp | Evolution API | v2 | Docker-ready, webhook configurável |
| Agendamento | `node-cron` | latest | Cron jobs dentro do próprio Node.js |
| Segredos | `.env` + `dotenv` | — | Nunca commitar credenciais no código |

---

## 2. Estrutura de Pastas do Projeto

```
comercial-assistant/
├── src/
│   ├── config/
│   │   ├── tenants.json          # Lista de representantes e contas IMAP
│   │   └── env.ts                # Validação e exportação de variáveis de ambiente
│   ├── ingestion/
│   │   ├── imap.service.ts       # Conexão IMAP multi-conta (imapflow)
│   │   ├── pdf.service.ts        # Extração de texto do PDF
│   │   └── vectorize.service.ts  # Chunking + Embeddings + Upsert no Pinecone
│   ├── rag/
│   │   ├── query.service.ts      # Busca vetorial filtrada por tenant
│   │   └── prompt.ts             # Templates de prompt para o Gemini
│   ├── whatsapp/
│   │   ├── webhook.controller.ts # Recebe eventos da Evolution API
│   │   └── evolution.service.ts  # Envia mensagens via Evolution API REST
│   ├── scheduler/
│   │   └── cron.ts               # Cron job de 10 minutos para varredura IMAP
│   └── main.ts                   # Entry point do servidor Express
├── .env.example
├── docker-compose.yml            # Evolution API + dependências
├── package.json
└── tsconfig.json
```

---

## 3. Configuração de Tenants (`tenants.json`)

Este arquivo (ou tabela no banco) mapeia cada representante às suas credenciais IMAP:

```json
{
  "tenants": [
    {
      "tenant_id": "rep_joao",
      "name": "João Silva",
      "whatsapp_instance": "rep_joao",
      "imap": {
        "host": "imap.gmail.com",
        "port": 993,
        "secure": true,
        "auth": {
          "user": "joao@empresa.com",
          "pass": "SENHA_DE_APLICACAO_AQUI"
        }
      },
      "filter_from": "admin@empresa.com"
    },
    {
      "tenant_id": "rep_maria",
      "name": "Maria Oliveira",
      "whatsapp_instance": "rep_maria",
      "imap": {
        "host": "imap.gmail.com",
        "port": 993,
        "secure": true,
        "auth": {
          "user": "maria@empresa.com",
          "pass": "SENHA_DE_APLICACAO_AQUI"
        }
      },
      "filter_from": "admin@empresa.com"
    }
  ]
}
```

> ⚠️ **Segurança**: No MVP use senhas de aplicação do Gmail (não a senha real). Em produção, armazene no banco de dados com criptografia (ex: AES-256 via `crypto` do Node).

---

## 4. Variáveis de Ambiente (`.env.example`)

```env
# Google AI
GEMINI_API_KEY=sua_chave_aqui

# Pinecone
PINECONE_API_KEY=sua_chave_aqui
PINECONE_INDEX_NAME=comercial-assistant
PINECONE_ENVIRONMENT=us-east-1

# Evolution API
EVOLUTION_API_URL=http://localhost:8080
EVOLUTION_API_KEY=sua_chave_interna_aqui

# Servidor
PORT=3000
WEBHOOK_SECRET=segredo_para_validar_webhooks

# Email da empresa (remetente autorizado)
COMPANY_EMAIL=admin@empresa.com
```

---

## 5. Motor de Ingestão IMAP (`imap.service.ts`)

```typescript
import { ImapFlow } from 'imapflow';
import tenants from '../config/tenants.json';
import { processPDF } from './pdf.service';
import { vectorizeAndStore } from './vectorize.service';

export async function runIngestionForAllTenants() {
  for (const tenant of tenants.tenants) {
    console.log(`[IMAP] Processando conta: ${tenant.tenant_id}`);
    const client = new ImapFlow({
      host: tenant.imap.host,
      port: tenant.imap.port,
      secure: tenant.imap.secure,
      auth: tenant.imap.auth,
      logger: false,
    });

    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    try {
      // Busca apenas emails NÃO LIDOS vindos do email da empresa
      const messages = await client.search({
        unseen: true,
        from: tenant.filter_from,
      });

      for (const uid of messages) {
        const message = await client.fetchOne(`${uid}`, {
          bodyStructure: true,
          source: true,
        });

        // Itera sobre os anexos PDF
        for (const part of iterateParts(message.bodyStructure)) {
          if (part.type === 'application' && part.subtype === 'pdf') {
            const { content } = await client.download(`${uid}`, part.part);
            const pdfBuffer = await streamToBuffer(content);
            const filename = part.parameters?.name ?? 'documento.pdf';

            // Extrai texto e vetoriza
            const text = await processPDF(pdfBuffer);
            await vectorizeAndStore(text, {
              tenant_id: tenant.tenant_id,
              filename,
              source: 'email_empresa',
            });
          }
        }

        // Marca como LIDO para não reprocessar
        await client.messageFlagsAdd(`${uid}`, ['\\Seen']);
      }
    } finally {
      lock.release();
      await client.logout();
    }
  }
}
```

---

## 6. Chunking e Vetorização (`vectorize.service.ts`)

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Pinecone } from '@pinecone-database/pinecone';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });

// Parâmetros de chunking
const CHUNK_SIZE = 800;     // caracteres por chunk
const CHUNK_OVERLAP = 100;  // sobreposição entre chunks

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    chunks.push(text.slice(start, end));
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
}

export async function vectorizeAndStore(
  text: string,
  metadata: { tenant_id: string; filename: string; source: string }
) {
  const index = pinecone.index(process.env.PINECONE_INDEX_NAME!);
  const embeddingModel = genAI.getGenerativeModel({ model: 'text-embedding-004' });

  const chunks = chunkText(text);
  const vectors = [];

  for (let i = 0; i < chunks.length; i++) {
    const result = await embeddingModel.embedContent(chunks[i]);
    const embedding = result.embedding.values;

    vectors.push({
      id: `${metadata.tenant_id}_${metadata.filename}_chunk_${i}`,
      values: embedding,
      metadata: {
        ...metadata,
        chunk_index: i,
        text: chunks[i], // guardamos o texto para recuperação
      },
    });
  }

  // Upsert em lotes de 100 vetores (limite do Pinecone)
  const BATCH_SIZE = 100;
  for (let i = 0; i < vectors.length; i += BATCH_SIZE) {
    await index.upsert(vectors.slice(i, i + BATCH_SIZE));
  }

  console.log(`[PINECONE] ${vectors.length} chunks indexados para ${metadata.tenant_id}`);
}
```

---

## 7. Configuração do Pinecone

```
Index Name:  comercial-assistant
Dimensions:  768   (para text-embedding-004)
             3072  (para gemini-embedding-exp-03-07 — qualidade superior)
Metric:      cosine
Cloud:       AWS  |  Region: us-east-1 (serverless)
```

> **Atenção:** ao trocar de modelo de embeddings, é necessário recriar o index e reprocessar todos os documentos, pois as dimensões são incompatíveis.

---

## 8. Motor de Resposta RAG (`query.service.ts`)

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Pinecone } from '@pinecone-database/pinecone';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });

export async function answerQuestion(question: string, tenant_id: string): Promise<string> {
  const index = pinecone.index(process.env.PINECONE_INDEX_NAME!);
  const embeddingModel = genAI.getGenerativeModel({ model: 'text-embedding-004' });

  // 1. Transforma a pergunta em vetor
  const questionEmbedding = await embeddingModel.embedContent(question);

  // 2. Busca vetorial RESTRITA ao tenant_id (segurança crítica)
  const results = await index.query({
    vector: questionEmbedding.embedding.values,
    topK: 5,
    filter: { tenant_id: { $eq: tenant_id } }, // ← ISOLAMENTO DO TENANT
    includeMetadata: true,
  });

  if (!results.matches || results.matches.length === 0) {
    return 'Não encontrei informações sobre isso nos documentos disponíveis para você. Por favor, verifique se o documento foi enviado pelo administrador.';
  }

  // 3. Monta o contexto com os chunks recuperados
  const context = results.matches
    .map((m, i) => `[Trecho ${i + 1} de "${m.metadata?.filename}"]:\n${m.metadata?.text}`)
    .join('\n\n---\n\n');

  // 4. Gera resposta com Gemini
  const generativeModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const prompt = `Você é um assistente interno de vendas de alta precisão.
Responda à dúvida do representante comercial de forma clara, direta e profissional.
Use APENAS as informações do contexto abaixo. Se a resposta não estiver no contexto, diga que não encontrou a informação.
Nunca invente dados, preços ou especificações.

CONTEXTO DOS DOCUMENTOS OFICIAIS:
${context}

PERGUNTA DO REPRESENTANTE: ${question}

RESPOSTA:`;

  const response = await generativeModel.generateContent(prompt);
  return response.response.text();
}
```

---

## 9. Webhook e Resposta WhatsApp

### 9.1 Controller do Webhook (`webhook.controller.ts`)

```typescript
import { Request, Response, Router } from 'express';
import { answerQuestion } from '../rag/query.service';
import { sendWhatsAppMessage } from './evolution.service';

export const webhookRouter = Router();

webhookRouter.post('/webhook/whatsapp', async (req: Request, res: Response) => {
  const { event, instance, data } = req.body;

  // Só processa mensagens recebidas de texto
  if (event !== 'messages.upsert' || data?.key?.fromMe) {
    return res.sendStatus(200);
  }

  const question = data?.message?.conversation || data?.message?.extendedTextMessage?.text;
  const from = data?.key?.remoteJid; // número do WhatsApp do representante

  if (!question || !from) return res.sendStatus(200);

  // O tenant_id é inferido a partir da instância da Evolution API
  const tenant_id = instance; // ex: "rep_joao"

  try {
    const answer = await answerQuestion(question, tenant_id);
    await sendWhatsAppMessage(instance, from, answer);
  } catch (error) {
    console.error('[WEBHOOK] Erro ao processar pergunta:', error);
    await sendWhatsAppMessage(instance, from, '⚠️ Ocorreu um erro ao processar sua pergunta. Tente novamente em instantes.');
  }

  res.sendStatus(200);
});
```

### 9.2 Cliente da Evolution API (`evolution.service.ts`)

```typescript
export async function sendWhatsAppMessage(
  instance: string,
  to: string,
  message: string
): Promise<void> {
  const url = `${process.env.EVOLUTION_API_URL}/message/sendText/${instance}`;

  await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': process.env.EVOLUTION_API_KEY!,
    },
    body: JSON.stringify({
      number: to,
      text: message,
    }),
  });
}
```

---

## 10. Docker Compose (Evolution API)

```yaml
version: '3.8'
services:
  evolution-api:
    image: atendai/evolution-api:v2.1.1
    container_name: evolution_api
    restart: always
    ports:
      - "8080:8080"
    environment:
      - SERVER_URL=http://localhost:8080
      - AUTHENTICATION_API_KEY=${EVOLUTION_API_KEY}
      - AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true
      - WEBHOOK_GLOBAL_ENABLED=true
      - WEBHOOK_GLOBAL_URL=http://host.docker.internal:3000/webhook/whatsapp
      - WEBHOOK_EVENTS_MESSAGES_UPSERT=true
    volumes:
      - evolution_instances:/evolution/instances
      - evolution_store:/evolution/store

volumes:
  evolution_instances:
  evolution_store:
```

---

## 11. Scheduler (Cron Job) (`cron.ts`)

```typescript
import cron from 'node-cron';
import { runIngestionForAllTenants } from '../ingestion/imap.service';

// Executa a cada 10 minutos
cron.schedule('*/10 * * * *', async () => {
  console.log('[CRON] Iniciando varredura IMAP...');
  try {
    await runIngestionForAllTenants();
    console.log('[CRON] Varredura concluída.');
  } catch (error) {
    console.error('[CRON] Erro durante a varredura:', error);
  }
});
```

---

## 12. Protocolo VLAEG — Roteiro de Implementação

### Fase 1 — Visão (Semana 1)
- [ ] Definir lista final de representantes e obter credenciais IMAP
- [ ] Criar organização no Pinecone e o index com dimensionalidade correta
- [ ] Criar projeto no Google AI Studio e gerar a chave Gemini API
- [ ] Criar repositório Git com a estrutura de pastas definida

### Fase 2 — Link (Semana 1-2)
- [ ] Configurar `.env` com todas as credenciais
- [ ] Testar conectividade IMAP com `imapflow` (script isolado)
- [ ] Subir Evolution API via Docker Compose
- [ ] Criar instância de teste para um representante e validar QR Code

### Fase 3 — Arquitetura (Semana 2-3)
- [ ] Implementar `imap.service.ts` com busca e download de PDFs
- [ ] Implementar `pdf.service.ts` com extração de texto
- [ ] Implementar `vectorize.service.ts` com chunking e upsert no Pinecone
- [ ] Testar ingestão de ponta a ponta com um PDF de exemplo
- [ ] Validar os vetores no console do Pinecone

### Fase 4 — Estilo (Semana 3)
- [ ] Implementar `query.service.ts` com busca filtrada por `tenant_id`
- [ ] Ajustar o prompt do Gemini para o tom e contexto corretos
- [ ] Testar o RAG com perguntas sobre os documentos ingeridos

### Fase 5 — Gatilho (Semana 4)
- [ ] Implementar `webhook.controller.ts` para receber eventos da Evolution
- [ ] Configurar o webhook na Evolution API apontando para o Node.js
- [ ] Teste de ponta a ponta: enviar pergunta no WhatsApp → receber resposta
- [ ] Validar isolamento entre tenants (rep_joao NÃO acessa dados da rep_maria)

---

## 13. Estimativa de Custos (MVP)

| Serviço | Plano | Custo Estimado/mês |
|---|---|---|
| Pinecone Serverless | Free tier (≤ 2GB) | **Grátis** no MVP |
| Gemini API | Pay-per-use | ~$0.10 / 1M tokens (flash) |
| Evolution API | Self-hosted Docker | **Grátis** (infraestrutura própria) |
| Node.js Hosting | Railway / Render free | **Grátis** no MVP |
| **Total MVP** | — | **< $5/mês** para volume baixo |

---

## 14. Próximos Passos (V2 — Pós-MVP)

1. **Interface de Admin Web**: painel para cadastrar representantes, monitorar ingestões e visualizar logs
2. **Histórico de Conversa**: armazenar par (pergunta, resposta) por `tenant_id` para contexto conversacional
3. **Suporte a XLSX e imagens**: usar Gemini Vision para extrair dados de tabelas em imagem
4. **Autenticação por Senha no WhatsApp**: o representante digita um PIN antes de acessar as informações
5. **Alertas de Novos Documentos**: notificar o representante quando um novo arquivo for ingerido
6. **Dashboard de Analytics**: volume de perguntas, documentos indexados, custo por tenant

---

## 15. Adendo Operacional - Ativacao por `/Agc` e Contexto das Ultimas Mensagens

Este comportamento passa a ser obrigatorio no fluxo do WhatsApp:

1. O assistente so deve responder perguntas quando o usuario enviar `/Agc` ou quando ja existir uma sessao ativa para o mesmo `remoteJid`.
2. O comando `/Agc` pode abrir a sessao sozinho ou acompanhado da pergunta.
3. A sessao deve expirar automaticamente apos um TTL curto, recomendado em 30 minutos.
4. As ultimas mensagens do mesmo usuario devem ser persistidas por `tenant_id` e `remoteJid`.
5. Esse historico recente deve ser enviado ao modelo para interpretar referencias como "ele", "isso", "o valor total", "e depois?".
6. Se nao houver `/Agc` nem sessao ativa, o webhook deve ignorar a mensagem sem notificar o usuario.

### Ajustes de arquitetura recomendados

- Criar um `ChatSessionService` para controlar a ativacao e expiracao da sessao iniciada por `/Agc`.
- Persistir historico em um `HistoryService` compartilhado entre o fluxo principal e a V2.
- Alterar `answerQuestion()` para aceitar `recentConversation` como parametro opcional.
- Usar o historico recente em dois pontos:
  - na query de embedding para melhorar recuperacao vetorial;
  - no prompt final para dar continuidade sem inventar contexto.

### Exemplo de fluxo esperado

```text
Usuario: /Agc
Bot: Conversa AGC iniciada. Envie sua pergunta.
Usuario: Quais produtos de mamao foram vendidos?
Bot: ...
Usuario: E qual foi o valor total?
Bot: responde usando historico recente + documentos recuperados
```

### Observacao de seguranca

O historico recente complementa a interpretacao da pergunta, mas nao substitui a regra principal do RAG: a resposta final continua limitada ao contexto recuperado dos documentos do tenant.

---

## 16. Adendo Operacional - Onboarding do Representante e Painel Admin

O fluxo operacional atual evoluiu para um cadastro dinamico de representantes via WhatsApp:

1. No primeiro `/Agc`, o representante inicia o onboarding.
2. O sistema solicita o e-mail corporativo.
3. Em seguida, solicita a senha do e-mail.
4. O servidor valida essas credenciais no mesmo servidor IMAP configurado para a operacao.
5. Apos validacao, o representante passa a ser persistido como um tenant dinamico associado ao `remoteJid`.

### Comportamento da ingestao

- O cron IMAP continua rodando no servidor principal.
- Cada representante cadastrado passa a ter sua caixa monitorada.
- Quando um PDF novo chega como mensagem nao lida:
  - o arquivo e baixado;
  - o texto e extraido;
  - os embeddings locais sao gerados em Python;
  - os chunks sao indexados no Qdrant;
  - o documento e encaminhado ao proprio representante via Evolution API apos a indexacao;
  - o status da ultima ingestao fica disponivel para consulta no painel.

### Painel Admin V2

O painel em `http://localhost:4000/admin/` agora tem um modulo funcional de representantes, com:

- listagem dos representantes cadastrados via onboarding;
- ultimo status de ingestao;
- ultimo arquivo processado;
- acao para testar IMAP;
- acao para editar credenciais;
- acao para remover o representante.

### Forma recomendada de subir o ambiente

Foi adicionado o script:

```text
npm run dev:all
```

Esse comando sobe em conjunto:

- o servidor principal, responsavel pelo cron IMAP e fluxo RAG;
- o servidor V2, responsavel pelo painel admin e webhook V2.

### Atualizacao de armazenamento vetorial

Na implementacao atual do projeto, o armazenamento vetorial deixou de usar Pinecone e passou a usar Qdrant local.

Estado atual:

- o servico vetorial roda localmente em `http://localhost:6333`;
- a ingestao grava embeddings no collection `comercial-assistant`;
- a consulta RAG aplica filtro por `tenant_id` no Qdrant;
- o `docker-compose.yml` ja sobe o servico `qdrant`;
- as variaveis ativas sao `QDRANT_URL`, `QDRANT_API_KEY` e `QDRANT_COLLECTION`.

Arquivos principais da migracao:

- `src/vector-store/qdrant.service.ts`
- `src/ingestion/vectorize.service.ts`
- `src/rag/query.service.ts`
- `src/config/env.ts`
- `.env.example`
- `docker-compose.yml`

### Atualizacao da recuperacao RAG

Para melhorar perguntas curtas e ambiguas sobre relatorios tabulares, o fluxo atual passou a:

- gerar um resumo estruturado por documento durante a ingestao;
- adicionar `document_type` e `keywords` aos pontos no Qdrant;
- expandir semanticamente perguntas curtas antes da busca vetorial;
- manter o historico recente apenas como apoio para desambiguacao.

Isso melhora consultas como:

- `Vendas Mês Atual`
- `qual é a meta de vendas?`
- `quais as métricas de VENDAS P_ VENDEDOR`

---

## 17. Infraestrutura de Persistência e Documentos Tabulares

### Banco de Dados Profissional (PostgreSQL)
A persistência local por arquivos isolados `.json` na pasta `v2_data/` foi inteiramente abolida para melhorar o desempenho, resolver possíveis conflitos de acesso assíncrono e garantir consistência na leitura de históricos longos. 
Durante a inicialização do Node (`src/main.ts` e `src/v2_main.ts`), o utilitário `src/db/init.ts` executa as migrações automáticas das tabelas `representatives`, `ingestion_status` e `conversation_history`. Se o banco for novo, ele transcreve seu JSON antigo e passa a rodar puramente no container SQL.

### Extração Tabular via LlamaParse
Para que o RAG leia relatórios, guias comerciais e notas fiscais em PDF sem agrupá-las erroneamente via simples `pdf-parse`, adicionamos o "Roteador de Estratégia de Extração". No próprio painel VIP em `http://localhost:4000/admin`, o administrador seleciona **LlamaParse API**. Modificando o `.env` ao vivo de forma criptografada, o Node.js passará a subir anexos IMAP para o LlamaCloud e resgatá-los formatados em *Markdown perfeito* prontos para o Pinecone/Qdrant.
