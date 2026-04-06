import fs from 'fs';
import { Router, Request, Response } from 'express';
import { getTenants } from '../config/tenants';
import { answerQuestion } from '../rag/query.service';
import { HistoryService } from '../conversation/history.service';
import { ChatSessionService } from '../conversation/chat-session.service';
import { sendWhatsAppMessage } from './evolution.service';
import { RepresentativeService } from '../representatives/representative.service';
import {
  handleRepresentativeOnboarding,
  startRepresentativeOnboarding,
} from '../onboarding/onboarding.handlers';
import { InboundDedupeService } from './inbound-dedupe.service';

export const webhookRouter = Router();

const ERROR_REPLY =
  '⚠️ Ocorreu um erro ao processar sua pergunta. Tente novamente em instantes.';
const ACTIVATION_REPLY =
  'Conversa AGC iniciada. Envie sua pergunta agora e eu também vou considerar o histórico recente desta conversa.';
const ACTIVATION_COMMAND_REGEX = /^\/agc\b/i;

interface WebhookBody {
  event: string;
  instance: string;
  data?: {
    key?: {
      fromMe: boolean;
      remoteJid: string;
      id?: string;
    };
    message?: {
      conversation?: string;
      extendedTextMessage?: { text?: string };
    };
  };
}

function resolveTenantId(instanceName: string): string | null {
  const tenant = getTenants().find(
    t => t.whatsapp_instance === instanceName
  );
  return tenant?.tenant_id ?? null;
}

function extractPromptText(message: string): { activatesSession: boolean; prompt: string } {
  const trimmed = message.trim();
  if (!ACTIVATION_COMMAND_REGEX.test(trimmed)) {
    return { activatesSession: false, prompt: trimmed };
  }

  const prompt = trimmed.replace(ACTIVATION_COMMAND_REGEX, '').trim();
  return { activatesSession: true, prompt };
}

webhookRouter.post(['/webhook/whatsapp', '/webhook/whatsapp/:event'], async (req: Request, res: Response) => {
  const { event, instance, data } = req.body as WebhookBody;

  fs.appendFileSync('webhook_logs.txt', `\n\n--- NOVA REQUISICAO ---\n${JSON.stringify(req.body, null, 2)}`);

  if (event !== 'messages.upsert' || data?.key?.fromMe) {
    return res.sendStatus(200);
  }

  const incomingText =
    data?.message?.conversation ||
    data?.message?.extendedTextMessage?.text ||
    '';
  const from = data?.key?.remoteJid ?? '';
  const messageId = data?.key?.id ?? '';

  if (!incomingText.trim() || !from) {
    return res.sendStatus(200);
  }

  if (messageId) {
    const shouldProcess = await InboundDedupeService.shouldProcess(`${instance}:${from}:${messageId}`);
    if (!shouldProcess) {
      return res.sendStatus(200);
    }
  }

  const representative = await RepresentativeService.getByRemoteJid(from);
  const fallbackTenantId = resolveTenantId(instance);
  if (!representative && !fallbackTenantId) {
    console.warn(`[WEBHOOK] Instância desconhecida: ${instance} - ignorando.`);
    return res.sendStatus(200);
  }

  res.sendStatus(200);

  try {
    const { activatesSession, prompt } = extractPromptText(incomingText);
    const effectiveTenantId = representative?.tenant_id ?? fallbackTenantId;

    if (await handleRepresentativeOnboarding({ instance, from, text: incomingText.trim() })) {
      return;
    }

    if (!effectiveTenantId) {
      return;
    }

    if (!representative && !fallbackTenantId) {
      if (activatesSession) {
        await startRepresentativeOnboarding(instance, from);
      }
      return;
    }

    if (activatesSession) {
      await ChatSessionService.activateSession(from, effectiveTenantId);
      if (!prompt) {
        await sendWhatsAppMessage(instance, from, ACTIVATION_REPLY);
        return;
      }
    } else {
      const session = await ChatSessionService.getSession(from, effectiveTenantId);
      if (!session) {
        return;
      }
    }

    console.log(`[WEBHOOK] Pergunta de ${instance} -> tenant:${effectiveTenantId} (${from}): "${prompt}"`);

    const recentConversation = await HistoryService.getRecentConversation(effectiveTenantId, from);
    const answer = await answerQuestion(prompt, effectiveTenantId, { recentConversation });

    await HistoryService.logInteraction({
      tenant_id: effectiveTenantId,
      from,
      question: prompt,
      answer,
      source: 'user',
      eventType: 'chat_question',
    });

    await sendWhatsAppMessage(instance, from, answer);
    console.log(`[WEBHOOK] Resposta enviada para ${from}`);
  } catch (error) {
    console.error('[WEBHOOK] Erro ao processar:', error);
    try {
      await sendWhatsAppMessage(instance, from, ERROR_REPLY);
    } catch {}
  }
});

webhookRouter.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
