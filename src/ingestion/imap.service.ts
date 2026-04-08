import { ImapFlow, FetchMessageObject, SearchObject } from 'imapflow';
import { buildDocumentSummary, vectorizeAndStore } from './vectorize.service';
import { sendWhatsAppDocument, sendWhatsAppMessage } from '../whatsapp/evolution.service';
import { RepresentativeService, TenantRuntimeConfig } from '../representatives/representative.service';
import { IngestionStatusService } from './ingestion-status.service';
import { answerQuestion } from '../rag/query.service';
import { extractTextFromDocument, resolveSupportedDocument } from './document.service';
import { HistoryService } from '../conversation/history.service';
import { loadAdminConfig } from '../config/admin-config';
import { IngestionLockService } from './ingestion-lock.service';
import { ProcessedAttachmentService } from './processed-attachment.service';

type TenantConfig = TenantRuntimeConfig;

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

function getContextMessageTemplate(filename: string): string {
  let template = 'Este contexto refere-se ao arquivo: {{filename}}\nPara consultar este arquivo, responda qualquer pergunta que o assistente ira usar o documento como contexto.';
  const config = loadAdminConfig();
  if (config.contextMessageTemplate) {
    template = config.contextMessageTemplate;
  }
  return template.replace('{{filename}}', filename);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function* iterateParts(part: any): IterableIterator<any> {
  if (part?.childNodes) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const child of part.childNodes as any[]) {
      yield* iterateParts(child);
    }
  } else {
    yield part;
  }
}

function buildWhatsAppSummaryMessage(filename: string, text: string): string {
  const summary = buildDocumentSummary(filename, text);

  return [
    `Resumo do documento recebido: ${filename}`,
    `Tipo: ${summary.documentType}`,
    summary.keywords.length ? `Palavras-chave: ${summary.keywords.join(', ')}` : '',
    '',
    summary.summaryText
      .split('\n')
      .filter(line => !line.startsWith('Documento: '))
      .join('\n'),
  ]
    .filter(Boolean)
    .join('\n');
}

function buildPostIngestionQuestion(filename: string, text: string): string {
  const normalized = `${filename} ${text.slice(0, 4000)}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const baseName = filename.replace(/\.[a-z0-9]+$/i, '');

  if (normalized.includes('vendas') && normalized.includes('metas') && normalized.includes('projec')) {
    return `quais as metricas de ${baseName}?`;
  }

  if (normalized.includes('boleto')) {
    return `resuma os principais dados do documento ${baseName}`;
  }

  if (normalized.includes('nfe') || normalized.includes('nota fiscal')) {
    return `resuma os principais dados da nota ${baseName}`;
  }

  return `resuma o documento ${baseName}`;
}

function resolveEnvelopeFrom(message: FetchMessageObject): string {
  const fromList = message?.envelope?.from ?? [];
  return fromList
    .map((item: { address?: string; name?: string }) => {
      const email = item.address ?? '';
      return item.name ? `${item.name} <${email || 'sem-email'}>` : email;
    })
    .filter(Boolean)
    .join(', ');
}

function extractEnvelopeEmails(message: FetchMessageObject): string[] {
  const fromList = (message?.envelope?.from ?? []) as Array<{ address?: string }>;
  return fromList
    .map(item => {
      return item.address?.trim().toLowerCase() ?? '';
    })
    .filter(Boolean);
}

function extractHeaderEmails(message: FetchMessageObject): string[] {
  const headerText = message.headers?.toString('utf8') ?? '';
  if (!headerText) {
    return [];
  }

  const fromLine = headerText
    .split(/\r?\n/)
    .find(line => line.trim().toLowerCase().startsWith('from:'));

  if (!fromLine) {
    return [];
  }

  const normalized = fromLine
    .replace(/^from:\s*/i, '')
    .match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);

  return (normalized ?? []).map(email => email.trim().toLowerCase());
}

function resolveHeaderFrom(message: FetchMessageObject): string {
  const headerText = message.headers?.toString('utf8') ?? '';
  if (!headerText) {
    return '';
  }

  const fromLine = headerText
    .split(/\r?\n/)
    .find(line => line.trim().toLowerCase().startsWith('from:'));

  return fromLine?.replace(/^from:\s*/i, '').trim() ?? '';
}

function matchesFilterFrom(message: FetchMessageObject, filterFrom?: string): boolean {
  const normalizedFilter = filterFrom?.trim().toLowerCase();
  if (!normalizedFilter) {
    return true;
  }

  const candidateEmails = [...extractEnvelopeEmails(message), ...extractHeaderEmails(message)];
  return candidateEmails.some(email => email === normalizedFilter);
}

async function ingestTenant(tenant: TenantConfig): Promise<void> {
  const ingestionLock = await IngestionLockService.tryAcquireTenantLock(tenant.tenant_id);
  if (!ingestionLock) {
    console.warn(`[IMAP] ${tenant.tenant_id}: ingestao ja esta em execucao. Ignorando nova disparada.`);
    return;
  }

  const client = new ImapFlow({
    host: tenant.imap.host,
    port: tenant.imap.port,
    secure: tenant.imap.secure,
    tls: { rejectUnauthorized: false },
    auth: tenant.imap.auth,
    logger: false,
  });

  await client.connect();
  const lock = await client.getMailboxLock('INBOX');

  try {
    const query: SearchObject = {
      seen: false,
    };
    if (tenant.filter_from?.trim()) {
      query.from = tenant.filter_from.trim();
    }

    const result = await client.search(query, { uid: true });
    const uids: number[] = result === false ? [] : result;

    if (uids.length === 0) {
      console.log(`[IMAP] ${tenant.tenant_id}: nenhuma mensagem nova.`);
      await IngestionStatusService.upsert({
        tenant_id: tenant.tenant_id,
        lastCheckAt: new Date().toISOString(),
        lastStatus: 'idle',
        lastMessage: 'Nenhuma mensagem nova.',
      });
      return;
    }

    console.log(`[IMAP] ${tenant.tenant_id}: ${uids.length} mensagem(ns) encontrada(s).`);

    for (const uid of uids) {
      let message: FetchMessageObject | false;
      let hasSupportedAttachments = false;
      let hasProcessingFailure = false;
      try {
        message = await client.fetchOne(`${uid}`, { bodyStructure: true, envelope: true, headers: ['from'] }, { uid: true });
      } catch (err) {
        console.error(`[IMAP] Erro ao buscar mensagem UID ${uid}:`, err);
        continue;
      }

      if (!message) continue;
      const subject = message.envelope?.subject ?? '(sem assunto)';
      const emailDate = message.envelope?.date?.toISOString?.() ?? '';
      const emailFrom = resolveEnvelopeFrom(message) || resolveHeaderFrom(message);
      const emailMessageId = message.envelope?.messageId ?? '';
      const messageKey = ProcessedAttachmentService.buildMessageKey(emailMessageId, uid);
      console.log(`[IMAP] UID ${uid} assunto: ${subject}`);

      if (!matchesFilterFrom(message, tenant.filter_from)) {
        console.log(`[IMAP] UID ${uid} ignorado: remetente fora do filtro (${emailFrom || 'sem remetente'}).`);
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const part of iterateParts((message as any).bodyStructure)) {
        const partName = part?.parameters?.name ?? part?.dispositionParameters?.filename ?? '(sem nome)';
        console.log(
          `[IMAP] Parte encontrada UID ${uid}: type=${part?.type ?? '-'} subtype=${part?.subtype ?? '-'} disposition=${part?.disposition ?? '-'} name=${partName}`
        );

        const filename = partName !== '(sem nome)' ? partName : `documento_${uid}`;
        const supportedDocument = resolveSupportedDocument(filename, part);

        if (!supportedDocument) {
          continue;
        }
        hasSupportedAttachments = true;
        console.log(`[IMAP] Documento reconhecido. Baixando anexo: ${filename}`);

        try {
          const dl = await client.download(`${uid}`, part?.part ?? '1', { uid: true });
          const buf = await streamToBuffer(dl.content as NodeJS.ReadableStream);
          console.log(`[IMAP] Download concluido: ${filename} (${buf.length} bytes)`);

          const isAlreadyProcessed = await ProcessedAttachmentService.isAlreadyProcessed({
            tenantId: tenant.tenant_id,
            messageKey,
            filename,
            attachmentBuffer: buf,
          });

          if (isAlreadyProcessed) {
            console.log(`[IMAP] Anexo duplicado detectado e ignorado: ${filename}`);
            continue;
          }

          const txt = await extractTextFromDocument(buf, supportedDocument);
          console.log(`[IMAP] Texto extraido de ${filename}: ${txt.length} caracteres`);

          await vectorizeAndStore(txt, {
            tenant_id: tenant.tenant_id,
            filename,
            source: 'email_empresa',
            email_uid: uid,
            email_subject: subject,
            email_from: emailFrom,
            email_date: emailDate,
            email_message_id: emailMessageId,
            attachment_mimetype: supportedDocument.mimetype,
          });
          console.log(`[IMAP] Documento "${filename}" indexado para tenant ${tenant.tenant_id}.`);

          await ProcessedAttachmentService.markProcessed({
            tenantId: tenant.tenant_id,
            messageKey,
            filename,
            attachmentBuffer: buf,
          });

          if (tenant.remoteJid) {
            try {
              console.log(`[IMAP] Encaminhando documento "${filename}" para ${tenant.remoteJid} via Evolution...`);
              await sendWhatsAppDocument(
                tenant.whatsapp_instance,
                tenant.remoteJid,
                filename,
                buf,
                `Novo documento recebido em ${tenant.imap.auth.user}: ${filename}`,
                supportedDocument.mimetype
              );
              console.log(`[IMAP] Documento "${filename}" encaminhado para ${tenant.remoteJid}.`);
              await HistoryService.logInteraction({
                tenant_id: tenant.tenant_id,
                from: tenant.remoteJid,
                question: `[CRON] Documento recebido por e-mail: ${filename}`,
                answer: 'Arquivo vetorizado, indexado e encaminhado automaticamente para o WhatsApp.',
                source: 'cron',
                eventType: 'document_forwarded',
                documentName: filename,
              });

              let summaryMessage = buildWhatsAppSummaryMessage(filename, txt);
              try {
                const postIngestionQuestion = buildPostIngestionQuestion(filename, txt);
                summaryMessage = await answerQuestion(postIngestionQuestion, tenant.tenant_id, {
                  targetFilename: filename,
                });
              } catch (err) {
                console.warn(`[IMAP] Falha ao gerar resposta RAG pos-ingestao para "${filename}". Usando resumo estruturado.`, err);
              }

              const contextFooter = getContextMessageTemplate(filename);
              const finalMessage = `${summaryMessage}\n\n---\n${contextFooter}`;

              await sendWhatsAppMessage(
                tenant.whatsapp_instance,
                tenant.remoteJid,
                finalMessage
              );
              console.log(`[IMAP] Resposta pos-ingestao do documento "${filename}" enviada para ${tenant.remoteJid}.`);
              await HistoryService.logInteraction({
                tenant_id: tenant.tenant_id,
                from: tenant.remoteJid,
                question: `[CRON] Resposta automatica pos-ingestao: ${filename}`,
                answer: finalMessage,
                source: 'cron',
                eventType: 'post_ingestion_summary',
                documentName: filename,
              });
            } catch (err) {
              console.error(`[IMAP] Erro ao encaminhar documento ou resposta pos-ingestao "${filename}" para ${tenant.remoteJid}:`, err);
            }
          }

          await IngestionStatusService.upsert({
            tenant_id: tenant.tenant_id,
            lastCheckAt: new Date().toISOString(),
            lastStatus: 'success',
            lastMessage: `Documento processado com sucesso: ${filename}`,
            lastDocumentAt: new Date().toISOString(),
            lastFilename: filename,
          });
        } catch (err) {
          hasProcessingFailure = true;
          console.error(`[IMAP] Erro ao processar "${filename}":`, err);
          await IngestionStatusService.upsert({
            tenant_id: tenant.tenant_id,
            lastCheckAt: new Date().toISOString(),
            lastStatus: 'error',
            lastMessage: `Erro ao processar ${filename}`,
            lastFilename: filename,
          });
        }
      }

      if (hasSupportedAttachments && !hasProcessingFailure) {
        try {
          await client.messageFlagsAdd(`${uid}`, ['\\Seen'], { uid: true });
          console.log(`[IMAP] UID ${uid} marcado como lido.`);
        } catch (err) {
          const error = err as { code?: string };
          if (error?.code === 'NoConnection') {
            console.warn(`[IMAP] Conexao encerrada antes de marcar UID ${uid} como lido. Seguindo sem falha critica.`);
          } else {
            throw err;
          }
        }
      }
    }
  } finally {
    lock.release();
    try {
      await client.logout();
    } catch (err) {
      const error = err as { code?: string };
      if (error?.code !== 'NoConnection') {
        throw err;
      }
      console.warn('[IMAP] Conexao ja encerrada antes do logout; seguindo sem erro.');
    } finally {
      await ingestionLock.release();
    }
  }
}

export async function runIngestionForAllTenants(): Promise<void> {
  const tenants = await RepresentativeService.getRuntimeTenants();

  for (const tenant of tenants) {
    console.log(`\n[IMAP] --- ${tenant.name} (${tenant.tenant_id}) ---`);
    try {
      await ingestTenant(tenant);
    } catch (err) {
      console.error(`[IMAP] Erro no tenant "${tenant.tenant_id}":`, err);
      await IngestionStatusService.upsert({
        tenant_id: tenant.tenant_id,
        lastCheckAt: new Date().toISOString(),
        lastStatus: 'error',
        lastMessage: 'Falha ao executar a ingestao deste representante.',
      });
    }
  }
}
