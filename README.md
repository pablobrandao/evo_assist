# Evo Assistent

Assistente comercial com ingestao IMAP, RAG sobre documentos, integracao com WhatsApp via Evolution API e painel administrativo web.

## Requisitos

- Node.js 22+
- Docker e Docker Compose
- Python disponivel no PATH para embeddings locais
- Chaves/API configuradas no `.env`

## Setup rapido

1. Instale dependencias:

```bash
npm install
```

2. Crie seu arquivo de ambiente:

```bash
cp .env.example .env
```

3. Suba a infraestrutura local:

```bash
docker compose up -d postgres redis qdrant evolution-api
```

4. Ajuste os arquivos locais de configuracao:

- `.env`
- `src/config/tenants.json` ja vem com placeholders seguros
- opcionalmente crie `src/config/tenants.local.json` para manter credenciais locais fora do Git

5. Inicie a aplicacao:

```bash
npm run dev:all
```

## Endpoints locais

- App principal: `http://localhost:3000`
- Painel admin V2: `http://localhost:4000/admin/`
- Evolution API: `http://localhost:8080`
- Qdrant: `http://localhost:6333`

## Arquivos de exemplo

- `.env.example`
- `src/config/tenants.example.json`
- `v2_data/admin_config.example.json`

Esses arquivos existem para bootstrap. Nao publique credenciais reais em `.env`, `src/config/tenants.json` ou em `v2_data/*.json`.

## Dados locais que nao devem ir para o Git

O `.gitignore` exclui artefatos locais como:

- `.env`
- `v2_data/`
- `webhook_logs.txt`
- `node_modules/`
- `dist/`

Se algum desses arquivos ja estiver rastreado no Git, remova do indice antes de publicar.

## Operacao

Veja instrucoes detalhadas em [COMO_EXECUTAR.md](./COMO_EXECUTAR.md).
