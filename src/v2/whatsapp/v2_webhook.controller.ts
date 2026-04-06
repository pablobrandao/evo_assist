import { Router, Request, Response } from 'express';
import { getTenants } from '../../config/tenants';
import { answerQuestion } from '../../rag/query.service';
import { HistoryService } from '../../conversation/history.service';
import { ChatSessionService } from '../../conversation/chat-session.service';
import { sendWhatsAppMessage } from '../../whatsapp/evolution.service';
import { RepresentativeService } from '../../representatives/representative.service';
import {
  handleRepresentativeOnboarding,
  startRepresentativeOnboarding,
} from '../../onboarding/onboarding.handlers';
import { InboundDedupeService } from '../../whatsapp/inbound-dedupe.service';

export const v2WebhookRouter = Router();

const ACTIVATION_REPLY =
  'Conversa AGC iniciada. Envie sua pergunta agora e eu também vou considerar o histórico recente desta conversa.';
const ACTIVATION_COMMAND_REGEX = /^\/agc\b/i;

function resolveTenantId(instanceName: string): string | null {
  const tenant = getTenants().find(t => t.whatsapp_instance === instanceName);
  return tenant?.tenant_id ?? null;
}

function extractPromptText(message: string): { activatesSession: boolean; prompt: string } {
  const trimmed = String(message ?? '').trim();
  if (!ACTIVATION_COMMAND_REGEX.test(trimmed)) {
    return { activatesSession: false, prompt: trimmed };
  }

  const prompt = trimmed.replace(ACTIVATION_COMMAND_REGEX, '').trim();
  return { activatesSession: true, prompt };
}

v2WebhookRouter.post(['/webhook/whatsapp', '/webhook/whatsapp/:event'], async (req: Request, res: Response) => {
  const { event, instance, data } = req.body;

  if (event !== 'messages.upsert' || data?.key?.fromMe) {
    return res.sendStatus(200);
  }

  const question = data?.message?.conversation || data?.message?.extendedTextMessage?.text || '';
  const from = data?.key?.remoteJid ?? '';
  const messageId = data?.key?.id ?? '';

  if (!question.trim() || !from) return res.sendStatus(200);

  if (messageId) {
    const shouldProcess = await InboundDedupeService.shouldProcess(`${instance}:${from}:${messageId}`);
    if (!shouldProcess) return res.sendStatus(200);
  }

  const representative = await RepresentativeService.getByRemoteJid(from);
  const fallbackTenantId = resolveTenantId(instance);
  if (!representative && !fallbackTenantId) return res.sendStatus(200);

  res.sendStatus(200);

  try {
    const { activatesSession, prompt } = extractPromptText(question);
    const effectiveTenantId = representative?.tenant_id ?? fallbackTenantId;

    if (await handleRepresentativeOnboarding({ instance, from, text: question.trim() })) {
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
      const chatSession = await ChatSessionService.getSession(from, effectiveTenantId);
      if (!chatSession) {
        return;
      }
    }

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
  } catch (error) {
    console.error('[V2 WEBHOOK] Erro:', error);
    try {
      await sendWhatsAppMessage(instance, from, '⚠️ Desculpe, tive um problema técnico. Tente novamente.');
    } catch {}
  }
});
