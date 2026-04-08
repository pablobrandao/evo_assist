import { pool } from '../db/client';

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueByCanonical<T extends { entityType: string; canonicalName: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = `${item.entityType}:${item.canonicalName}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

interface ExtractedEntity {
  entityType: string;
  name: string;
  canonicalName: string;
  metadata?: Record<string, unknown>;
}

interface ExtractedRelation {
  fromKey: string;
  toKey: string;
  relationType: string;
  confidence: number;
  metadata?: Record<string, unknown>;
}

interface GraphExtractionResult {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
}

export interface GraphContextResult {
  facts: string[];
  retrievalHints: string[];
  matchedEntities: Array<{ name: string; entityType: string }>;
}

function buildEntityKey(entityType: string, canonicalName: string): string {
  return `${entityType}:${canonicalName}`;
}

function cleanEntityValue(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/[:;,.\-]+$/g, '').trim();
}

function pushEntity(entities: ExtractedEntity[], entityType: string, name: string, metadata?: Record<string, unknown>): string | null {
  const cleanedName = cleanEntityValue(name);
  const canonicalName = normalizeText(cleanedName);
  if (!cleanedName || canonicalName.length < 2) {
    return null;
  }

  entities.push({
    entityType,
    name: cleanedName,
    canonicalName,
    metadata,
  });

  return buildEntityKey(entityType, canonicalName);
}

function collectRegexValues(text: string, patterns: RegExp[]): string[] {
  const values: string[] = [];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = cleanEntityValue(match[1] ?? '');
      if (value) {
        values.push(value);
      }
    }
  }

  return Array.from(new Set(values));
}

function extractGraphData(text: string, metadata: {
  filename: string;
  email_subject?: string;
  email_from?: string;
  email_date?: string;
}, documentType: string, keywords: string[]): GraphExtractionResult {
  const entities: ExtractedEntity[] = [];
  const relations: ExtractedRelation[] = [];

  const documentKey = pushEntity(entities, 'document', metadata.filename, {
    documentType,
    source: 'ingestion',
  });

  const documentTypeKey = pushEntity(entities, 'document_type', documentType);
  if (documentKey && documentTypeKey) {
    relations.push({
      fromKey: documentKey,
      toKey: documentTypeKey,
      relationType: 'document_has_type',
      confidence: 0.99,
    });
  }

  for (const keyword of keywords) {
    const keywordKey = pushEntity(entities, 'metric', keyword);
    if (documentKey && keywordKey) {
      relations.push({
        fromKey: documentKey,
        toKey: keywordKey,
        relationType: 'document_mentions_metric',
        confidence: 0.82,
      });
    }
  }

  if (metadata.email_subject) {
    const subjectKey = pushEntity(entities, 'email_subject', metadata.email_subject);
    if (documentKey && subjectKey) {
      relations.push({
        fromKey: documentKey,
        toKey: subjectKey,
        relationType: 'document_received_with_subject',
        confidence: 0.75,
      });
    }
  }

  if (metadata.email_from) {
    const senderKey = pushEntity(entities, 'email_sender', metadata.email_from);
    if (documentKey && senderKey) {
      relations.push({
        fromKey: documentKey,
        toKey: senderKey,
        relationType: 'document_received_from',
        confidence: 0.75,
      });
    }
  }

  if (metadata.email_date) {
    const emailDateKey = pushEntity(entities, 'period', metadata.email_date.slice(0, 10));
    if (documentKey && emailDateKey) {
      relations.push({
        fromKey: documentKey,
        toKey: emailDateKey,
        relationType: 'document_received_on',
        confidence: 0.7,
      });
    }
  }

  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 400);

  const representativeNames = collectRegexValues(text, [
    /(?:representante|vendedor|consultor(?:a)?)\s*[:\-]\s*([^\n|;]+)/gi,
  ]);
  for (const representative of representativeNames) {
    const representativeKey = pushEntity(entities, 'representative', representative);
    if (documentKey && representativeKey) {
      relations.push({
        fromKey: documentKey,
        toKey: representativeKey,
        relationType: 'document_mentions_representative',
        confidence: 0.88,
      });
    }
  }

  const clientNames = collectRegexValues(text, [
    /(?:cliente|razao social|comprador)\s*[:\-]\s*([^\n|;]+)/gi,
  ]);
  for (const client of clientNames) {
    const clientKey = pushEntity(entities, 'client', client);
    if (documentKey && clientKey) {
      relations.push({
        fromKey: documentKey,
        toKey: clientKey,
        relationType: 'document_mentions_client',
        confidence: 0.86,
      });
    }
  }

  const productCandidates = Array.from(
    new Set(
      lines
        .filter(line => /mamao|melao|abacaxi|banana|uva|laranja/i.test(line))
        .map(line => line.match(/mamao|melao|abacaxi|banana|uva|laranja/gi) ?? [])
        .flat()
    )
  );
  for (const product of productCandidates) {
    const productKey = pushEntity(entities, 'product', product);
    if (documentKey && productKey) {
      relations.push({
        fromKey: documentKey,
        toKey: productKey,
        relationType: 'document_mentions_product',
        confidence: 0.72,
      });
    }
  }

  const periods = Array.from(
    new Set([
      ...text.match(/\b\d{2}\/\d{2}\/\d{4}\b/g) ?? [],
      ...text.match(/\b\d{2}\/\d{4}\b/g) ?? [],
      ...text.match(/\b(?:mes atual|hoje|ontem)\b/gi) ?? [],
    ])
  ).slice(0, 20);

  for (const period of periods) {
    const periodKey = pushEntity(entities, 'period', period);
    if (documentKey && periodKey) {
      relations.push({
        fromKey: documentKey,
        toKey: periodKey,
        relationType: 'document_mentions_period',
        confidence: 0.8,
      });
    }
  }

  for (const representative of representativeNames) {
    const representativeKey = buildEntityKey('representative', normalizeText(representative));
    for (const client of clientNames) {
      const clientKey = buildEntityKey('client', normalizeText(client));
      relations.push({
        fromKey: representativeKey,
        toKey: clientKey,
        relationType: 'representative_handles_client',
        confidence: 0.65,
        metadata: { source: metadata.filename },
      });
    }
  }

  return {
    entities: uniqueByCanonical(entities),
    relations,
  };
}

async function upsertEntity(
  tenantId: string,
  entity: ExtractedEntity
): Promise<{ id: number; entityType: string; name: string; canonicalName: string }> {
  const res = await pool.query(
    `INSERT INTO rag_graph_entities (tenant_id, entity_type, name, canonical_name, metadata_json, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (tenant_id, entity_type, canonical_name)
     DO UPDATE SET
       name = EXCLUDED.name,
       metadata_json = rag_graph_entities.metadata_json || EXCLUDED.metadata_json,
       updated_at = CURRENT_TIMESTAMP
     RETURNING id, entity_type, name, canonical_name`,
    [tenantId, entity.entityType, entity.name, entity.canonicalName, JSON.stringify(entity.metadata ?? {})]
  );

  return {
    id: Number(res.rows[0].id),
    entityType: res.rows[0].entity_type,
    name: res.rows[0].name,
    canonicalName: res.rows[0].canonical_name,
  };
}

export async function upsertDocumentGraph(input: {
  tenantId: string;
  filename: string;
  text: string;
  documentType: string;
  keywords: string[];
  email_subject?: string;
  email_from?: string;
  email_date?: string;
}): Promise<void> {
  const extraction = extractGraphData(
    input.text,
    {
      filename: input.filename,
      email_subject: input.email_subject,
      email_from: input.email_from,
      email_date: input.email_date,
    },
    input.documentType,
    input.keywords
  );

  if (extraction.entities.length === 0) {
    return;
  }

  const entityMap = new Map<string, { id: number; entityType: string; name: string; canonicalName: string }>();

  for (const entity of extraction.entities) {
    const saved = await upsertEntity(input.tenantId, entity);
    entityMap.set(buildEntityKey(saved.entityType, saved.canonicalName), saved);
  }

  for (const entity of entityMap.values()) {
    await pool.query(
      `INSERT INTO rag_graph_document_entities (tenant_id, document_name, entity_id, relation_type)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, document_name, entity_id, relation_type) DO NOTHING`,
      [input.tenantId, input.filename, entity.id, 'document_mentions_entity']
    );
  }

  for (const relation of extraction.relations) {
    const fromEntity = entityMap.get(relation.fromKey);
    const toEntity = entityMap.get(relation.toKey);

    if (!fromEntity || !toEntity) {
      continue;
    }

    await pool.query(
      `INSERT INTO rag_graph_relations (
         tenant_id,
         from_entity_id,
         to_entity_id,
         relation_type,
         source_document,
         confidence,
         metadata_json,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, CURRENT_TIMESTAMP)
       ON CONFLICT (tenant_id, from_entity_id, to_entity_id, relation_type, source_document)
       DO UPDATE SET
         confidence = GREATEST(rag_graph_relations.confidence, EXCLUDED.confidence),
         metadata_json = rag_graph_relations.metadata_json || EXCLUDED.metadata_json,
         updated_at = CURRENT_TIMESTAMP`,
      [
        input.tenantId,
        fromEntity.id,
        toEntity.id,
        relation.relationType,
        input.filename,
        relation.confidence,
        JSON.stringify(relation.metadata ?? {}),
      ]
    );
  }
}

export async function getGraphContext(params: {
  tenantId: string;
  question: string;
  targetFilename?: string;
  limit?: number;
}): Promise<GraphContextResult> {
  const questionNormalized = normalizeText(params.question);
  const limit = params.limit ?? 8;

  const entityRes = await pool.query(
    `SELECT entity_rows.id, entity_rows.entity_type, entity_rows.name, entity_rows.canonical_name
     FROM (
       SELECT DISTINCT ON (e.id)
         e.id,
         e.entity_type,
         e.name,
         e.canonical_name,
         e.updated_at
       FROM rag_graph_entities e
       LEFT JOIN rag_graph_document_entities de
         ON de.entity_id = e.id
         AND de.tenant_id = e.tenant_id
       WHERE e.tenant_id = $1
         AND (
           $2::varchar IS NULL
           OR de.document_name = $2
           OR e.entity_type = 'document'
         )
       ORDER BY e.id, e.updated_at DESC
     ) AS entity_rows
     ORDER BY entity_rows.updated_at DESC
     LIMIT 250`,
    [params.tenantId, params.targetFilename ?? null]
  );

  const matchedEntities = entityRes.rows.filter(row => {
    const canonicalName = String(row.canonical_name ?? '');
    if (canonicalName.length < 3) {
      return false;
    }

    if (row.entity_type === 'document' && params.targetFilename) {
      return normalizeText(params.targetFilename) === canonicalName;
    }

    return questionNormalized.includes(canonicalName);
  });

  const documentRows = params.targetFilename
    ? entityRes.rows.filter(row => row.entity_type === 'document' && normalizeText(params.targetFilename!) === row.canonical_name)
    : [];

  const seedEntities = [...matchedEntities];
  for (const row of documentRows) {
    if (!seedEntities.find(item => item.id === row.id)) {
      seedEntities.push(row);
    }
  }

  if (seedEntities.length === 0) {
    return { facts: [], retrievalHints: [], matchedEntities: [] };
  }

  const seedIds = seedEntities.map(item => Number(item.id));
  const relationRes = await pool.query(
    `SELECT
       rf.name AS from_name,
       rf.entity_type AS from_type,
       rt.name AS to_name,
       rt.entity_type AS to_type,
       r.relation_type,
       r.source_document,
       r.confidence
     FROM rag_graph_relations r
     JOIN rag_graph_entities rf ON rf.id = r.from_entity_id
     JOIN rag_graph_entities rt ON rt.id = r.to_entity_id
     WHERE r.tenant_id = $1
       AND (r.from_entity_id = ANY($2::bigint[]) OR r.to_entity_id = ANY($2::bigint[]))
       AND ($3::varchar IS NULL OR r.source_document = $3 OR rf.name = $3)
     ORDER BY r.confidence DESC, r.updated_at DESC
     LIMIT $4`,
    [params.tenantId, seedIds, params.targetFilename ?? null, limit]
  );

  const facts: string[] = [];
  const retrievalHints = new Set<string>();

  for (const row of relationRes.rows) {
    const fromName = String(row.from_name ?? '');
    const toName = String(row.to_name ?? '');
    const relationType = String(row.relation_type ?? '');
    const sourceDocument = String(row.source_document ?? '');

    if (!fromName || !toName || !relationType) {
      continue;
    }

    facts.push(`${fromName} --${relationType}--> ${toName}${sourceDocument ? ` [fonte: ${sourceDocument}]` : ''}`);
    retrievalHints.add(fromName);
    retrievalHints.add(toName);
  }

  return {
    facts: Array.from(new Set(facts)).slice(0, limit),
    retrievalHints: Array.from(retrievalHints).slice(0, limit * 2),
    matchedEntities: seedEntities.map(row => ({
      name: String(row.name),
      entityType: String(row.entity_type),
    })),
  };
}
