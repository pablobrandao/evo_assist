import express from 'express';
import path from 'path';
import * as fs from 'fs';
import { HistoryService } from '../services/history.service';
import { getDefaultFilterFrom, loadAdminConfig, saveAdminConfig } from '../../config/admin-config';
import { getTenants, getTenantsConfigPath, saveTenantsConfig } from '../../config/tenants';
import { RepresentativeService } from '../../representatives/representative.service';
import { IngestionStatusService } from '../../ingestion/ingestion-status.service';
import { env } from '../../config/env';
import { sendWhatsAppMessage } from '../../whatsapp/evolution.service';

function maskValue(value: string): string {
  if (!value) return 'Não configurado';
  if (value.length <= 6) return '******';
  return `${value.slice(0, 3)}***${value.slice(-2)}`;
}

async function probeService(name: string, url: string) {
  try {
    const response = await fetch(url);
    return {
      name,
      url,
      ok: response.ok,
      status: response.status,
    };
  } catch {
    return {
      name,
      url,
      ok: false,
      status: null,
    };
  }
}

export const adminApp = express();

adminApp.use(express.json());
adminApp.use(express.static(path.join(__dirname, 'public')));

adminApp.get('/api/stats', async (_req, res) => {
  const stats = await HistoryService.getAnalytics();
  res.json(stats);
});

adminApp.get('/api/history', async (req, res) => {
  const history = await HistoryService.getHistory();
  return res.json(history);
});

adminApp.get('/api/tenants', (_req, res) => {
  res.json(getTenants());
});

adminApp.put('/api/tenants/:tenantId', async (req, res) => {
  const tenantId = decodeURIComponent(req.params.tenantId);
  const { name, whatsapp_instance, imap } = req.body ?? {};

  if (!name || !whatsapp_instance || !imap?.host || !imap?.port || !imap?.auth?.user || !imap?.auth?.pass) {
    return res.status(400).json({ error: 'TENANT_FIELDS_REQUIRED' });
  }

  const nextTenants = getTenants().map(tenant => {
    if (tenant.tenant_id !== tenantId) {
      return tenant;
    }

    return {
      ...tenant,
      name: String(name).trim(),
      whatsapp_instance: String(whatsapp_instance).trim(),
      imap: {
        host: String(imap.host).trim(),
        port: Number(imap.port),
        secure: Boolean(imap.secure),
        auth: {
          user: String(imap.auth.user).trim(),
          pass: String(imap.auth.pass),
        },
      },
    };
  });

  const updatedTenant = nextTenants.find(tenant => tenant.tenant_id === tenantId);
  if (!updatedTenant) {
    return res.status(404).json({ error: 'TENANT_NOT_FOUND' });
  }

  try {
    await RepresentativeService.verifyEmailCredentials(updatedTenant.imap.auth.user, updatedTenant.imap.auth.pass);
    saveTenantsConfig(nextTenants);
    return res.json(updatedTenant);
  } catch (error) {
    return res.status(400).json({ error: 'UPDATE_TENANT_FAILED' });
  }
});

adminApp.get('/api/representatives', async (_req, res) => {
  const representatives = await RepresentativeService.getAll();
  const statuses = await IngestionStatusService.getAll();
  const response = representatives.map(rep => ({
    ...rep,
    ingestionStatus: statuses.find(status => status.tenant_id === rep.tenant_id) ?? null,
  }));
  res.json(response);
});

adminApp.get('/api/settings', async (_req, res) => {
  const representatives = await RepresentativeService.getAll();
  const ingestionStatuses = await IngestionStatusService.getAll();
  const services = await Promise.all([
    probeService('Servidor principal', `http://localhost:${env.PORT}/health`),
    probeService('Painel V2', `http://localhost:${Number(env.PORT) + 1000}/health`),
    probeService('Qdrant', env.QDRANT_URL),
    probeService('Evolution API', env.EVOLUTION_API_URL),
  ]);

  res.json({
    parameters: {
      port: env.PORT,
      cronSchedule: '*/10 * * * *',
      embeddingsProvider: env.EMBEDDINGS_PROVIDER,
      localEmbeddingModel: env.LOCAL_EMBEDDING_MODEL,
      localEmbeddingPythonBin: env.LOCAL_EMBEDDING_PYTHON_BIN,
      qdrantUrl: env.QDRANT_URL,
      qdrantCollection: env.QDRANT_COLLECTION,
      qdrantRecreateOnMismatch: env.QDRANT_RECREATE_ON_DIMENSION_MISMATCH,
      evolutionApiUrl: env.EVOLUTION_API_URL,
      evolutionApiKey: maskValue(env.EVOLUTION_API_KEY),
      geminiApiKey: maskValue(env.GEMINI_API_KEY),
      openrouterConfigured: Boolean(env.OPENROUTER_API_KEY),
      pdfParserStrategy: env.PDF_PARSER_STRATEGY,
      senderFilterFrom: getDefaultFilterFrom() || 'Nao configurado',
      legacyCompanyEmail: env.COMPANY_EMAIL || 'Nao configurado',
      representativesCount: representatives.length,
      staticTenantsCount: getTenants().length,
    },
    services,
    representativeStatuses: representatives.map(rep => ({
      remoteJid: rep.remoteJid,
      tenant_id: rep.tenant_id,
      email: rep.email,
      whatsapp_instance: rep.whatsapp_instance,
      ingestionStatus: ingestionStatuses.find(status => status.tenant_id === rep.tenant_id) ?? null,
    })),
  });
});

adminApp.post('/api/representatives', async (req, res) => {
  const { remoteJid, email, password, whatsapp_instance } = req.body ?? {};

  if (!remoteJid || !email || !password || !whatsapp_instance) {
    return res.status(400).json({ error: 'REMOTEJID_EMAIL_PASSWORD_INSTANCE_REQUIRED' });
  }

  try {
    await RepresentativeService.verifyEmailCredentials(email, password);
    const representative = await RepresentativeService.saveProfile({
      remoteJid,
      email,
      password,
      whatsapp_instance,
    });
    return res.status(201).json(representative);
  } catch (error) {
    return res.status(400).json({ error: 'CREATE_REPRESENTATIVE_FAILED' });
  }
});

adminApp.post('/api/representatives/test-imap', async (req, res) => {
  const { email, password } = req.body ?? {};

  if (!email || !password) {
    return res.status(400).json({ error: 'EMAIL_AND_PASSWORD_REQUIRED' });
  }

  try {
    await RepresentativeService.verifyEmailCredentials(email, password);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ ok: false, error: 'IMAP_AUTH_FAILED' });
  }
});

adminApp.put('/api/representatives/:remoteJid', async (req, res) => {
  const remoteJid = decodeURIComponent(req.params.remoteJid);
  const { email, password, whatsapp_instance } = req.body ?? {};

  if (!email || !password) {
    return res.status(400).json({ error: 'EMAIL_AND_PASSWORD_REQUIRED' });
  }

  try {
    const representative = await RepresentativeService.updateProfile(remoteJid, {
      email,
      password,
      whatsapp_instance,
    });
    return res.json(representative);
  } catch (error) {
    if ((error as Error).message === 'REPRESENTATIVE_NOT_FOUND') {
      return res.status(404).json({ error: 'REPRESENTATIVE_NOT_FOUND' });
    }
    return res.status(500).json({ error: 'UPDATE_FAILED' });
  }
});

adminApp.delete('/api/representatives/:remoteJid', async (req, res) => {
  const remoteJid = decodeURIComponent(req.params.remoteJid);
  const removed = await RepresentativeService.removeByRemoteJid(remoteJid);

  if (!removed) {
    return res.status(404).json({ error: 'REPRESENTATIVE_NOT_FOUND' });
  }

  return res.json({ ok: true });
});

adminApp.put('/api/settings', async (req, res) => {
  const { pdfParserStrategy, llamacloudApiKey } = req.body ?? {};

  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) {
      return res.status(404).json({ error: 'ENV_FILE_NOT_FOUND' });
    }

    let envContent = fs.readFileSync(envPath, 'utf8');

    if (/^PDF_PARSER_STRATEGY=/m.test(envContent)) {
      envContent = envContent.replace(/^PDF_PARSER_STRATEGY=.*$/m, `PDF_PARSER_STRATEGY=${pdfParserStrategy || 'local'}`);
    } else {
      envContent += `\nPDF_PARSER_STRATEGY=${pdfParserStrategy || 'local'}`;
    }

    if (llamacloudApiKey !== undefined) {
      if (/^LLAMACLOUD_API_KEY=/m.test(envContent)) {
        envContent = envContent.replace(/^LLAMACLOUD_API_KEY=.*$/m, `LLAMACLOUD_API_KEY=${llamacloudApiKey}`);
      } else {
        envContent += `\nLLAMACLOUD_API_KEY=${llamacloudApiKey}`;
      }
    }

    fs.writeFileSync(envPath, envContent, 'utf8');
    return res.json({ ok: true });
  } catch (error) {
    console.error('[ADMIN] Erro ao gravar .env:', error);
    return res.status(500).json({ error: 'UPDATE_FAILED' });
  }
});

/* ============================================================
   ADMIN CONFIG — Configurações Dinâmicas (Prompts, etc)
   ============================================================ */
adminApp.get('/api/settings/config', (_req, res) => {
  res.json(loadAdminConfig());
});

adminApp.put('/api/settings/config', (req, res) => {
  try {
    const { defaultSystemPrompt, contextMessageTemplate, defaultFilterFrom } = req.body ?? {};
    const config = loadAdminConfig();
    if (defaultSystemPrompt !== undefined) config.defaultSystemPrompt = defaultSystemPrompt;
    if (contextMessageTemplate !== undefined) config.contextMessageTemplate = contextMessageTemplate;
    if (defaultFilterFrom !== undefined) config.defaultFilterFrom = String(defaultFilterFrom).trim();
    saveAdminConfig(config);
    return res.json({ ok: true, config });
  } catch (error) {
    console.error('[ADMIN] Erro ao salvar admin_config.json:', error);
    return res.status(500).json({ error: 'ADMIN_CONFIG_SAVE_FAILED' });
  }
});

/* ============================================================
   AI PROMPTS — Prompts por arquivo (Assistente de IA)
   ============================================================ */

const AI_PROMPTS_PATH = path.resolve(process.cwd(), 'v2_data', 'ai_prompts.json');

function loadAiPrompts(): Record<string, string> {
  if (fs.existsSync(AI_PROMPTS_PATH)) {
    try { return JSON.parse(fs.readFileSync(AI_PROMPTS_PATH, 'utf8')); } catch { return {}; }
  }
  return {};
}

function saveAiPrompts(prompts: Record<string, string>): void {
  fs.writeFileSync(AI_PROMPTS_PATH, JSON.stringify(prompts, null, 2), 'utf8');
}

/** GET /api/explorer/ai-prompts — todos os prompts salvos */
adminApp.get('/api/explorer/ai-prompts', (_req, res) => {
  res.json(loadAiPrompts());
});

/** POST /api/explorer/ai-prompts — salva prompt para tenantId:filename */
adminApp.post('/api/explorer/ai-prompts', (req, res) => {
  const { tenantId, filename, prompt } = req.body ?? {};
  if (!tenantId || !filename || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'TENANT_FILENAME_PROMPT_REQUIRED' });
  }
  const prompts = loadAiPrompts();
  prompts[`${tenantId}:${filename}`] = prompt;
  saveAiPrompts(prompts);
  return res.json({ ok: true });
});

/** DELETE /api/explorer/ai-prompts — remove prompt de um arquivo (volta ao padrão) */
adminApp.delete('/api/explorer/ai-prompts', (req, res) => {
  const { tenantId, filename } = req.body ?? {};
  if (!tenantId || !filename) {
    return res.status(400).json({ error: 'TENANT_FILENAME_REQUIRED' });
  }
  const prompts = loadAiPrompts();
  delete prompts[`${tenantId}:${filename}`];
  saveAiPrompts(prompts);
  return res.json({ ok: true });
});

/* ============================================================
   EXPLORER — Árvore de arquivos por representante
   ============================================================ */

/**
 * GET /api/explorer
 * Retorna a árvore de arquivos indexados agrupada por representante.
 */
adminApp.get('/api/explorer', async (_req, res) => {
  try {
    const history = await HistoryService.getHistory() as any[];
    const representatives = await RepresentativeService.getAll();

    const docMap = new Map<string, Map<string, { name: string; firstSeen: string; lastSeen: string; count: number }>>();

    history.forEach(entry => {
      if (entry.eventType !== 'document_forwarded' || !entry.documentName) return;
      const tid = entry.tenant_id || '';
      if (!docMap.has(tid)) docMap.set(tid, new Map());

      const files = docMap.get(tid)!;
      if (!files.has(entry.documentName)) {
        files.set(entry.documentName, {
          name: entry.documentName,
          firstSeen: entry.timestamp,
          lastSeen: entry.timestamp,
          count: 1,
        });
      } else {
        const existing = files.get(entry.documentName)!;
        existing.count++;
        if (entry.timestamp > existing.lastSeen) existing.lastSeen = entry.timestamp;
        if (entry.timestamp < existing.firstSeen) existing.firstSeen = entry.timestamp;
      }
    });

    const result = [...docMap.entries()].map(([tenant_id, files]) => {
      const rep = representatives.find(r => r.tenant_id === tenant_id);
      return {
        tenant_id,
        name: rep?.name || rep?.email || tenant_id,
        email: rep?.email || '',
        remoteJid: rep?.remoteJid || '',
        whatsapp_instance: rep?.whatsapp_instance || '',
        files: [...files.values()].sort(
          (a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime()
        ),
      };
    });

    return res.json(result);
  } catch (err) {
    console.error('[EXPLORER] Erro ao montar árvore:', err);
    return res.status(500).json({ error: 'EXPLORER_TREE_FAILED' });
  }
});

/**
 * GET /api/explorer/:tenantId/file/:filename
 * Retorna o histórico de chat relacionado ao arquivo selecionado.
 */
adminApp.get('/api/explorer/:tenantId/file/:filename', async (req, res) => {
  try {
    const tenantId = decodeURIComponent(req.params.tenantId);
    const filename = decodeURIComponent(req.params.filename);

    const history = await HistoryService.getHistory() as any[];
    const tenantHistory = history
      .filter(e => e.tenant_id === tenantId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const firstIngest = tenantHistory.find(
      e => e.eventType === 'document_forwarded' && e.documentName === filename
    );

    if (!firstIngest) {
      return res.json({ filename, conversations: [], documentEntries: [], adminMessages: [] });
    }

    const startTime = new Date(firstIngest.timestamp).getTime();

    const nextDoc = tenantHistory.find(
      e =>
        e.eventType === 'document_forwarded' &&
        e.documentName !== filename &&
        new Date(e.timestamp).getTime() > startTime
    );
    const endTime = nextDoc ? new Date(nextDoc.timestamp).getTime() : Infinity;

    const documentEntries = tenantHistory.filter(e => e.documentName === filename);

    const conversations = tenantHistory.filter(e => {
      if (e.source === 'cron' || e.source === 'admin') return false;
      const t = new Date(e.timestamp).getTime();
      return t >= startTime && t < endTime;
    });

    const adminMessages = tenantHistory.filter(
      e => e.source === 'admin' && e.documentName === filename
    );

    return res.json({ filename, conversations, documentEntries, adminMessages });
  } catch (err) {
    console.error('[EXPLORER] Erro ao buscar histórico do arquivo:', err);
    return res.status(500).json({ error: 'EXPLORER_FILE_HISTORY_FAILED' });
  }
});

adminApp.post('/api/explorer/:tenantId/send', async (req, res) => {
  try {
    const tenantId = decodeURIComponent(req.params.tenantId);
    const { message, filename, remoteJid, whatsapp_instance, customPrompt } = req.body ?? {};

    if (!message || !remoteJid || !whatsapp_instance) {
      return res.status(400).json({ error: 'MESSAGE_REMOTEJID_INSTANCE_REQUIRED' });
    }

    // Monta a mensagem principal para o representante
    let fullMessage: string;
    if (filename) {
      fullMessage = `\u{1F5C2}\uFE0F *Mensagem do Administrador*\n\n${message}\n\n---\n\u{1F4CC} _Este contexto refere-se ao arquivo:_  *${filename}*\n_Para consultar este arquivo, responda qualquer pergunta que o assistente irá usar o documento como contexto._`;
    } else {
      fullMessage = `\u{1F5C2}\uFE0F *Mensagem do Administrador*\n\n${message}`;
    }

    await sendWhatsAppMessage(whatsapp_instance, remoteJid, fullMessage);

    // Se houver prompt customizado diferente do padrão, envia como segunda mensagem de contexto
    if (customPrompt && customPrompt.trim()) {
      const promptMsg = `\u{1F916} *Prompt do Assistente (configurado pelo Administrador)*\n\n\`\`\`\n${customPrompt.trim()}\n\`\`\`\n\n_Este prompt orientará o assistente ao processar perguntas sobre o arquivo *${filename || 'informado'}*._`;
      await sendWhatsAppMessage(whatsapp_instance, remoteJid, promptMsg);
    }

    await HistoryService.logInteraction({
      tenant_id: tenantId,
      from: 'admin',
      question: `[ADMIN] ${message}`,
      answer: fullMessage,
      source: 'admin',
      eventType: 'admin_message',
      documentName: filename || null,
    });

    return res.json({ ok: true, sent: fullMessage });
  } catch (err) {
    console.error('[EXPLORER] Erro ao enviar mensagem admin:', err);
    return res.status(500).json({ error: 'SEND_FAILED', detail: String(err) });
  }
});

adminApp.get('*all', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
