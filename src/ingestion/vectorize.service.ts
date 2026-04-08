import { upsertQdrantPoints } from '../vector-store/qdrant.service';
import { createHash } from 'crypto';
import { embedTexts } from '../embeddings/local-embedding.service';
import { upsertDocumentGraph } from '../rag/graph.service';

const CHUNK_SIZE = 2500;
const CHUNK_OVERLAP = 250;
const BATCH_SIZE = 100;

function normalizeToken(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    chunks.push(text.slice(start, end).trim());
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks.filter(chunk => chunk.length > 20);
}

export interface DocumentMetadata {
  tenant_id: string;
  filename: string;
  source: string;
  email_uid?: number;
  email_subject?: string;
  email_from?: string;
  email_date?: string;
  email_message_id?: string;
  attachment_mimetype?: string;
}

function detectDocumentType(filename: string, text: string): string {
  const source = normalizeToken(`${filename} ${text.slice(0, 4000)}`);

  if (source.includes('vendas') && source.includes('metas') && source.includes('projecoes')) {
    return 'relatorio_vendas';
  }

  if (source.includes('boleto')) {
    return 'boleto';
  }

  if (source.includes('nfe') || source.includes('nota fiscal')) {
    return 'nota_fiscal';
  }

  return 'documento';
}

function collectKeywords(filename: string, text: string): string[] {
  const source = normalizeToken(`${filename} ${text.slice(0, 8000)}`);
  const candidates = [
    'vendas',
    'mes atual',
    'meta',
    'metas',
    'projecoes',
    'financeiro',
    'total faturado',
    'total em aberto',
    'total geral',
    'nota',
    'nfe',
    'boleto',
    'mamao',
    'melao',
  ];

  return candidates.filter(item => source.includes(item));
}

export function buildDocumentSummary(filename: string, text: string): {
  summaryText: string;
  documentType: string;
  keywords: string[];
} {
  const documentType = detectDocumentType(filename, text);
  const keywords = collectKeywords(filename, text);
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const totals = Array.from(
    new Set(
      lines.filter(line => /^(total faturado|total em aberto|total geral)/i.test(normalizeToken(line)))
    )
  ).slice(0, 12);

  const periods = Array.from(
    new Set(lines.filter(line => /\b\d{2}\/\d{2}\/\d{4}\b/.test(line)))
  ).slice(0, 6);

  const headings = Array.from(
    new Set(
      lines.filter(line =>
        /(vendas|metas|projecoes|visao de clientes|representante|valor parcela|valor total)/i.test(
          normalizeToken(line)
        )
      )
    )
  ).slice(0, 10);

  const summaryParts = [
    `Documento: ${filename}`,
    `Tipo: ${documentType}`,
    keywords.length ? `Palavras-chave: ${keywords.join(', ')}` : '',
    periods.length ? `Datas relevantes:\n- ${periods.join('\n- ')}` : '',
    headings.length ? `Cabecalhos e metricas:\n- ${headings.join('\n- ')}` : '',
    totals.length ? `Totais encontrados:\n- ${totals.join('\n- ')}` : '',
  ].filter(Boolean);

  return {
    summaryText: summaryParts.join('\n'),
    documentType,
    keywords,
  };
}

export async function vectorizeAndStore(
  text: string,
  metadata: DocumentMetadata
): Promise<void> {
  const { summaryText, documentType, keywords } = buildDocumentSummary(metadata.filename, text);
  const chunks = [summaryText, ...chunkText(text)];

  console.log(`[VECTORIZE] ${chunks.length} chunks para ${metadata.tenant_id}/${metadata.filename}`);

  const points: Array<{
    id: string;
    vector: number[];
    payload: {
      tenant_id: string;
      filename: string;
      source: string;
      chunk_index: number;
      text: string;
      document_type: string;
      keywords: string[];
      email_uid?: number;
      email_subject?: string;
      email_from?: string;
      email_date?: string;
      email_message_id?: string;
      attachment_mimetype?: string;
    };
  }> = [];

  const embeddings = await embedTexts(chunks);

  for (const [i, chunk] of chunks.entries()) {
    try {
      const embedding = embeddings[i];
      if (!embedding) {
        throw new Error('Embedding ausente para o chunk.');
      }

      const pointId = createHash('sha256')
        .update(`${metadata.tenant_id}|${metadata.filename}|${i}`)
        .digest('hex');

      points.push({
        id: `${pointId.slice(0, 8)}-${pointId.slice(8, 12)}-${pointId.slice(12, 16)}-${pointId.slice(16, 20)}-${pointId.slice(20, 32)}`,
        vector: embedding,
        payload: {
          ...metadata,
          text: chunk,
          chunk_index: i,
          document_type: documentType,
          keywords,
        },
      });
    } catch (error: any) {
      console.warn(`[VECTORIZE] Erro ao vetorizar chunk ${i}, ignorando... Detalhes: ${error.message}`);
    }
  }

  for (let i = 0; i < points.length; i += BATCH_SIZE) {
    await upsertQdrantPoints(points.slice(i, i + BATCH_SIZE));
  }

  await upsertDocumentGraph({
    tenantId: metadata.tenant_id,
    filename: metadata.filename,
    text,
    documentType,
    keywords,
    email_subject: metadata.email_subject,
    email_from: metadata.email_from,
    email_date: metadata.email_date,
  });

  console.log(`[QDRANT] Indexados ${points.length} chunks para ${metadata.tenant_id}`);
}
