import express from 'express';
import { webhookRouter } from './whatsapp/webhook.controller';
import { startIngestionCron } from './scheduler/cron';
import { env } from './config/env';
import { initDB } from './db/init';

const app = express();

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rotas
app.use('/', webhookRouter);

// Inicializa servidor
app.listen(Number(env.PORT), async () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║    Agente RAG WhatsApp — Comercial MVP       ║');
  console.log(`║    Servidor rodando na porta ${env.PORT}            ║`);
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  await initDB().catch(err => console.error('[MAIN] Falha crítica no banco:', err));

  // Inicia cron de ingestão IMAP
  startIngestionCron();

  // Executa uma varredura imediata ao iniciar
  console.log('[MAIN] Executando varredura IMAP inicial...');
  Promise.resolve().then(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const imapService = require('./ingestion/imap.service');
    imapService.runIngestionForAllTenants().catch((err: unknown) => {
      console.error('[MAIN] Erro na varredura inicial:', err);
    });
  });
});
