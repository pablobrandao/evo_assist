import * as dotenv from 'dotenv';
dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[ENV] Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

export const env = {
  GEMINI_API_KEY: required('GEMINI_API_KEY'),
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '',
  EMBEDDINGS_PROVIDER: process.env.EMBEDDINGS_PROVIDER ?? 'local',
  LOCAL_EMBEDDING_MODEL:
    process.env.LOCAL_EMBEDDING_MODEL ?? 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
  LOCAL_EMBEDDING_PYTHON_BIN: process.env.LOCAL_EMBEDDING_PYTHON_BIN ?? 'python',
  LOCAL_EMBEDDING_CACHE_DIR: process.env.LOCAL_EMBEDDING_CACHE_DIR ?? 'v2_data/huggingface',
  QDRANT_URL: process.env.QDRANT_URL ?? 'http://localhost:6333',
  QDRANT_API_KEY: process.env.QDRANT_API_KEY || '',
  QDRANT_COLLECTION: process.env.QDRANT_COLLECTION ?? 'comercial-assistant',
  QDRANT_RECREATE_ON_DIMENSION_MISMATCH:
    (process.env.QDRANT_RECREATE_ON_DIMENSION_MISMATCH ?? 'true') === 'true',
  EVOLUTION_API_URL: required('EVOLUTION_API_URL'),
  EVOLUTION_API_KEY: required('EVOLUTION_API_KEY'),
  COMPANY_EMAIL: process.env.COMPANY_EMAIL ?? '',
  PORT: process.env.PORT ?? '3000',
  PDF_PARSER_STRATEGY: process.env.PDF_PARSER_STRATEGY ?? 'local',
  LLAMACLOUD_API_KEY: process.env.LLAMACLOUD_API_KEY ?? '',
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/evolution?schema=public',
};
