import express from 'express';
import { v2WebhookRouter } from './v2/whatsapp/v2_webhook.controller';
import { adminApp } from './v2/admin/server';
import { startIngestionCron } from './scheduler/cron';
import { env } from './config/env';
import { initDB } from './db/init';

const app = express();
const PORT_V2 = Number(env.PORT) + 1000; // Ex: 4000

app.use(express.json({ limit: '10mb' }));

// Rotas V2
app.use('/v2', v2WebhookRouter);
app.use('/admin', adminApp);

// Saúde
app.get('/health', (req, res) => res.json({ status: 'v2-active' }));

app.listen(PORT_V2, async () => {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║    Agente COMERCIAL V2 — Premium Extension   ║');
  console.log(`║    Dashboard: http://localhost:${PORT_V2}/admin    ║`);
  console.log(`║    Webhook V2: http://localhost:${PORT_V2}/v2      ║`);
  console.log('╚══════════════════════════════════════════════╝');

  await initDB().catch(err => console.error('[V2_MAIN] Falha crítica no banco:', err));

  // O Cron pode continuar rodando aqui ou no processo original
  // startIngestionCron(); 
});
