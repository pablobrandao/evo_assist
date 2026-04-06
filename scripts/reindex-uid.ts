import { ImapFlow } from 'imapflow';
import { RepresentativeService } from '../src/representatives/representative.service';
import { extractTextFromPDF } from '../src/ingestion/pdf.service';
import { vectorizeAndStore } from '../src/ingestion/vectorize.service';

function* iterateParts(part: any): IterableIterator<any> {
  if (part?.childNodes) {
    for (const child of part.childNodes as any[]) {
      yield* iterateParts(child);
    }
    return;
  }

  if (part) {
    yield part;
  }
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

async function main(): Promise<void> {
  const uid = Number(process.argv[2] || '0');
  const remoteJid = process.argv[3] || '5527999840201@s.whatsapp.net';

  if (!uid) {
    throw new Error('UID obrigatorio. Exemplo: ts-node scripts/reindex-uid.ts 23571');
  }

  const rep = await RepresentativeService.getByRemoteJid(remoteJid);
  if (!rep) {
    throw new Error(`Representante nao encontrado para ${remoteJid}`);
  }

  const tenants = await RepresentativeService.getRuntimeTenants();
  const tenant = tenants.find(item => item.tenant_id === rep.tenant_id);
  if (!tenant) {
    throw new Error(`Tenant runtime nao encontrado para ${rep.tenant_id}`);
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
    const message = await client.fetchOne(`${uid}`, { bodyStructure: true, envelope: true }, { uid: true });
    if (!message) {
      throw new Error(`Mensagem UID ${uid} nao encontrada`);
    }

    const subject = message.envelope?.subject ?? '(sem assunto)';
    console.log(`[REINDEX] UID ${uid} assunto: ${subject}`);

    let indexed = 0;

    for (const part of iterateParts((message as any).bodyStructure)) {
      const partName = part?.parameters?.name ?? part?.dispositionParameters?.filename ?? '(sem nome)';
      const isPDF =
        (part?.type === 'application' && part?.subtype === 'pdf') ||
        (part?.disposition === 'attachment' && String(partName).toLowerCase().endsWith('.pdf'));

      if (!isPDF) {
        continue;
      }

      const filename = partName !== '(sem nome)' ? partName : `documento_${uid}.pdf`;
      console.log(`[REINDEX] Baixando anexo: ${filename}`);

      const dl = await client.download(`${uid}`, part?.part ?? '1', { uid: true });
      const buf = await streamToBuffer(dl.content as NodeJS.ReadableStream);
      console.log(`[REINDEX] Download concluido: ${buf.length} bytes`);

      const txt = await extractTextFromPDF(buf);
      console.log(`[REINDEX] Texto extraido: ${txt.length} caracteres`);

      await vectorizeAndStore(txt, {
        tenant_id: tenant.tenant_id,
        filename,
        source: 'email_empresa',
      });

      indexed += 1;
      console.log(`[REINDEX] Indexacao concluida para ${filename}`);
    }

    if (indexed === 0) {
      console.log('[REINDEX] Nenhum PDF encontrado na mensagem.');
    }
  } finally {
    lock.release();
    await client.logout();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
