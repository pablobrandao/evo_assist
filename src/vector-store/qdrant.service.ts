import { env } from '../config/env';

export interface QdrantPayload {
  tenant_id: string;
  filename: string;
  source: string;
  chunk_index: number;
  text: string;
  document_type?: string;
  keywords?: string[];
  email_uid?: number;
  email_subject?: string;
  email_from?: string;
  email_date?: string;
  email_message_id?: string;
  attachment_mimetype?: string;
}

interface QdrantCollectionResponse {
  result?: {
    points_count?: number;
    config?: {
      params?: {
        vectors?: {
          size?: number;
        };
      };
    };
  };
}

interface QdrantSearchResponse {
  result?: Array<{
    id: string | number;
    score: number;
    payload?: QdrantPayload;
  }>;
}

let ensuredVectorSize: number | null = null;

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (env.QDRANT_API_KEY) {
    headers['api-key'] = env.QDRANT_API_KEY;
  }

  return headers;
}

async function qdrantRequest(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${env.QDRANT_URL}${path}`, {
    ...init,
    headers: {
      ...getHeaders(),
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`[QDRANT] Falha em ${path} (${response.status}): ${body}`);
  }

  return response;
}

export async function ensureQdrantCollection(vectorSize: number): Promise<void> {
  if (ensuredVectorSize === vectorSize) {
    return;
  }

  try {
    const response = await qdrantRequest(`/collections/${env.QDRANT_COLLECTION}`);
    const data = await response.json() as QdrantCollectionResponse;
    const currentSize = data.result?.config?.params?.vectors?.size;
    const pointsCount = data.result?.points_count ?? 0;

    if (typeof currentSize === 'number' && currentSize !== vectorSize) {
      if (!env.QDRANT_RECREATE_ON_DIMENSION_MISMATCH) {
        throw new Error(
          `[QDRANT] Collection "${env.QDRANT_COLLECTION}" ja existe com dimensao ${currentSize}, esperada ${vectorSize}.`
        );
      }

      console.warn(
        `[QDRANT] Recriando collection "${env.QDRANT_COLLECTION}" por mudanca de dimensao (${currentSize} -> ${vectorSize}). Pontos atuais: ${pointsCount}.`
      );

      await qdrantRequest(`/collections/${env.QDRANT_COLLECTION}`, {
        method: 'DELETE',
      });
    } else {
      ensuredVectorSize = vectorSize;
      return;
    }
  } catch (error) {
    if (!(error as Error).message.includes('(404)')) {
      throw error;
    }
  }

  await qdrantRequest(`/collections/${env.QDRANT_COLLECTION}`, {
    method: 'PUT',
    body: JSON.stringify({
      vectors: {
        size: vectorSize,
        distance: 'Cosine',
      },
    }),
  });

  ensuredVectorSize = vectorSize;
}

export async function upsertQdrantPoints(
  points: Array<{
    id: string;
    vector: number[];
    payload: QdrantPayload;
  }>
): Promise<void> {
  if (points.length === 0) {
    return;
  }

  await ensureQdrantCollection(points[0].vector.length);

  await qdrantRequest(`/collections/${env.QDRANT_COLLECTION}/points?wait=true`, {
    method: 'PUT',
    body: JSON.stringify({ points }),
  });
}

export async function searchQdrantPoints(params: {
  vector: number[];
  tenant_id: string;
  limit: number;
  filename?: string;
}): Promise<Array<{ payload?: QdrantPayload; score: number }>> {
  await ensureQdrantCollection(params.vector.length);

  const mustConditions: any[] = [
    {
      key: 'tenant_id',
      match: {
        value: params.tenant_id,
      },
    },
  ];

  if (params.filename) {
    mustConditions.push({
      key: 'filename',
      match: { value: params.filename },
    });
  }

  const response = await qdrantRequest(`/collections/${env.QDRANT_COLLECTION}/points/search`, {
    method: 'POST',
    body: JSON.stringify({
      vector: params.vector,
      limit: params.limit,
      with_payload: true,
      filter: {
        must: mustConditions,
      },
    }),
  });

  const data = await response.json() as QdrantSearchResponse;
  return (data.result ?? []).map(item => ({
    payload: item.payload,
    score: item.score,
  }));
}
