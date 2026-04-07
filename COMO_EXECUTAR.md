# Guia de Execucao - Agente RAG WhatsApp (Evo Assist)

> Versao: 1.3 - 30/03/2026
> Stack: Node.js v22 - Evolution API v2.3.7 - Gemini 2.0 Flash - Embeddings locais (Python) - Qdrant local - PostgreSQL - Redis

---

## Fluxo Atual

```text
WhatsApp (usuario)
  -> envia /Agc
  -> se for primeiro acesso, informa e-mail e senha
  -> depois usa a conversa normalmente
Evolution API
  -> POST /webhook/whatsapp e /v2/webhook/whatsapp
Servidor principal
  -> executa o cron de IMAP
  -> monitora a caixa de entrada dos representantes cadastrados
  -> vetoriza PDFs com embeddings locais
  -> indexa os documentos no Qdrant local
  -> encaminha PDFs recebidos para o WhatsApp
Servidor V2
  -> entrega o painel admin em /admin
  -> expõe APIs do painel e webhook V2
```

---

## Regra de Uso no WhatsApp

- O assistente so inicia conversa quando o usuario envia `/Agc`.
- No primeiro acesso, depois do `/Agc`, o sistema pede e-mail e senha do representante.
- O servidor IMAP e fixo e ja vem configurado no backend.
- Se o usuario nao enviar `/Agc` e nao houver sessao ativa, o sistema nao responde nada.
- Depois da ativacao, a sessao fica ativa por 30 minutos para aquele numero.
- Durante a sessao, as ultimas interacoes do mesmo numero sao enviadas ao modelo como contexto recente.

Exemplo do primeiro acesso:

```text
/Agc
suporte@agcfrutas.com.br
senha-do-email
```

Exemplo depois do cadastro:

```text
/Agc Quais produtos de mamao foram vendidos?
E qual foi o valor total?
```

---

## Scripts Disponiveis

| Script | Funcao |
|---|---|
| `npm run dev` | Sobe o servidor principal com cron IMAP |
| `npm run dev:v2` | Sobe a V2 com painel em `http://localhost:4000/admin/` |
| `npm run dev:all` | Sobe principal + V2 juntos |
| `npm run test:ingest` | Executa a ingestao IMAP manualmente |
| `npm run test:rag -- "<pergunta>" <tenant_id>` | Executa uma consulta RAG manual |
| `.\Start_all.ps1` | Sobe Docker, Evolution do projeto antigo, servidor principal e V2 |
| `.\Stop_all.ps1` | Encerra Docker, Evolution, servidor principal e V2 |

---

## 1. Iniciar os Servicos

### Passo 1 - PostgreSQL, Redis e Qdrant

```powershell
cd "c:\Users\PABLO\Documents\Comercial assistent"
docker compose up -d postgres redis qdrant
docker ps --format "table {{.Names}}\t{{.Status}}"
```

### Passo 2 - Evolution API do projeto antigo

```powershell
cd "c:\Users\PABLO\Documents\evolution-api"
$env:NODE_OPTIONS="--dns-result-order=ipv4first"
node dist/main.js
```

### Passo 3 - Subir app Node com um comando

```powershell
cd "c:\Users\PABLO\Documents\Comercial assistent"
npm run dev:all
```

Para subir tudo de ponta a ponta com um unico script:

```powershell
cd "c:\Users\PABLO\Documents\Comercial assistent"
.\Start_all.ps1
```

Esse comando sobe:

- servidor principal na porta `3000`
- painel V2 na porta `4000`

O script `.\Start_all.ps1` sobe:

- PostgreSQL
- Redis
- Qdrant
- Evolution API do projeto antigo em `C:\Users\PABLO\Documents\evolution-api`
- servidor principal
- V2

Se quiser subir separado:

```powershell
npm run dev
npm run dev:v2
```

---

## 2. Verificar Status

### WhatsApp / Evolution

```powershell
Invoke-RestMethod `
  -Uri "http://localhost:8080/instance/fetchInstances?instanceName=AgcFrutas" `
  -Headers @{"apikey"="minha_chave_interna_secreta"} `
  -Method GET | ConvertTo-Json -Depth 2 | Select-String "connectionStatus|ownerJid|profileName"
```

### Servidor principal

```powershell
Invoke-WebRequest -Uri "http://localhost:3000/health" -UseBasicParsing
```

### Painel Admin

```powershell
Invoke-WebRequest -Uri "http://localhost:4000/admin/" -UseBasicParsing
```

### Qdrant local

```powershell
Invoke-WebRequest -Uri "http://localhost:6333/" -UseBasicParsing
```

Esperado:

```text
StatusCode : 200
```

---

## 3. Onboarding do Representante

Fluxo real no WhatsApp:

1. Enviar `/Agc`
2. Informar o e-mail corporativo
3. Informar a senha do e-mail

Quando a validacao IMAP passar:

- o representante fica salvo em `v2_data/representatives.json`
- o painel passa a mostrar esse representante em `http://localhost:4000/admin/`
- o cron de ingestao passa a monitorar a caixa desse representante

---

## 4. Encaminhamento de PDF

Quando um PDF chega como mensagem nao lida no e-mail do representante:

1. o cron IMAP encontra o e-mail
2. reconhece o anexo PDF
3. baixa o arquivo
4. extrai o texto
5. gera embeddings locais em Python
6. grava os vetores no Qdrant local
7. encaminha o PDF no WhatsApp do representante via Evolution

Para testar manualmente:

```powershell
cd "c:\Users\PABLO\Documents\Comercial assistent"
npm run test:ingest
```

Sinais esperados no terminal:

```text
[IMAP] PDF reconhecido. Baixando anexo: ...
[QDRANT] ...
[IMAP] Documento "...pdf" encaminhado para 5527999840201@s.whatsapp.net.
```

---

## 5. Painel de Representantes

No menu `Representantes` do painel em `http://localhost:4000/admin/` existem:

- visualizacao dos representantes cadastrados
- status da ultima ingestao
- ultimo arquivo processado
- acao `Testar IMAP`
- acao `Editar`
- acao `Remover`

---

## 5.1 Configurações de Infraestrutura (PDF e BD)

No menu `Configurações` do painel (Aba de engrenagem), você pode ver dinamicamente os parâmetros da sua plataforma e modificar a **Estratégia do Módulo de Ingestão de PDF**:

- É nativamente possível trocar de `Local (pdf-parse)` para `LlamaParse API` caso seu foco sejam tabelas, dados financeiros ou listas de produtos sensíveis.
- Insira sua `LLAMACLOUD_API_KEY`. Após clicar em salvar, os dados serão escritos com segurança no seu `.env`. Lembre-se de rodar um `Stop_all.ps1` seguido de `Start_all.ps1` para que o serviço Cron atualize seu parser em memória RAM.
- **Sobre Seus Dados:** Eles não são mais salvos num arquivo frágil em HD. O seu script Node agora usa um pool do PostgreSQL embutido nas imagens Docker do inicio. Nunca perca histórico de chats de seus Representantes novamente!

---

## 6. Recuperacao RAG

O RAG atual foi ajustado para relatorios tabulares, como `VENDAS P_ VENDEDOR`.

Melhorias ativas:

- cada documento recebe um resumo estruturado antes dos chunks normais;
- o indice grava `document_type` e `keywords`;
- perguntas curtas como `Vendas Mês Atual` e `qual é a meta de vendas?` sao expandidas antes da busca vetorial;
- o historico recente continua sendo usado apenas para resolver referencias conversacionais.

Exemplos de perguntas que agora tendem a funcionar melhor:

- `Vendas Mês Atual`
- `qual é a meta de vendas?`
- `quais as métricas de VENDAS P_ VENDEDOR`
- `qual o total faturado em março de 2026?`

---

## 7. Diagnostico

### Sem resposta do bot

Causa comum: o usuario enviou mensagem sem ativar a sessao com `/Agc`.

Solucao:
1. Enviar `/Agc`
2. Se for primeiro acesso, concluir o onboarding
3. Depois enviar a pergunta

### Falha no onboarding

Causa comum: e-mail invalido ou senha incorreta no IMAP.

Solucao:
1. Confirmar e-mail do representante
2. Confirmar a senha do e-mail
3. Testar no painel pela acao `Testar IMAP`

### `http://localhost:4000/admin/` fora do ar

Causa comum: a V2 nao foi iniciada.

Solucao:

```powershell
cd "c:\Users\PABLO\Documents\Comercial assistent"
npm run dev:v2
```

ou:

```powershell
npm run dev:all
```

### PDF nao foi encaminhado no WhatsApp

Checklist:
1. O e-mail estava nao lido no momento da varredura
2. O anexo era realmente `.pdf`
3. A Evolution estava conectada
4. O terminal mostrou `Documento "...pdf" encaminhado`

### `"Nao encontrei essa informacao nos documentos"`

Causa comum:

1. o PDF ainda nao foi indexado
2. a pergunta esta genérica demais para o tipo de documento
3. o documento nao contem explicitamente aquele dado
4. a mensagem falhou antes da vetorizacao e por isso nao deveria ter sido marcada como lida

Solucao:
1. Verificar se o PDF chegou na caixa do representante
2. Confirmar a indexacao no Qdrant pelo fluxo de ingestao
3. Repetir a pergunta de forma mais especifica, por exemplo:
4. `qual o total faturado no periodo 01/03/2026 a 30/03/2026?`
5. `quais metricas aparecem no relatorio VENDAS P_ VENDEDOR?`
6. Confirmar se o arquivo foi encaminhado no WhatsApp apenas apos a indexacao

---

## 8. Checklist

- [ ] `connectionStatus: "open"` na instancia `AgcFrutas`
- [ ] `http://localhost:3000/health` responde `200`
- [ ] `http://localhost:4000/admin/` responde `200`
- [ ] Representante aparece no menu `Representantes`
- [ ] Acao `Testar IMAP` valida as credenciais
- [ ] PDF recebido por e-mail e encaminhado ao WhatsApp do representante
- [ ] `http://localhost:6333/` responde `200`
- [ ] Documento indexado no Qdrant local
- [ ] Pergunta via `/Agc` retorna resposta com RAG
