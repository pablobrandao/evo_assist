import { spawn } from 'child_process';
import { env } from '../config/env';

interface LocalEmbeddingResponse {
  embeddings: number[][];
}

async function runLocalEmbeddingScript(texts: string[]): Promise<LocalEmbeddingResponse> {
  return await new Promise((resolve, reject) => {
    const child = spawn(env.LOCAL_EMBEDDING_PYTHON_BIN, ['scripts/embed_local.py'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HF_HOME: env.LOCAL_EMBEDDING_CACHE_DIR,
        TRANSFORMERS_CACHE: env.LOCAL_EMBEDDING_CACHE_DIR,
        SENTENCE_TRANSFORMERS_HOME: env.LOCAL_EMBEDDING_CACHE_DIR,
      },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      stdout += String(chunk);
    });

    child.stderr.on('data', chunk => {
      stderr += String(chunk);
    });

    child.on('error', reject);

    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`[EMBEDDINGS] Processo Python falhou (${code}): ${stderr || stdout}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout) as LocalEmbeddingResponse);
      } catch {
        reject(new Error(`[EMBEDDINGS] Resposta invalida do Python: ${stdout || stderr}`));
      }
    });

    child.stdin.write(JSON.stringify({
      model: env.LOCAL_EMBEDDING_MODEL,
      texts,
    }));
    child.stdin.end();
  });
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const result = await runLocalEmbeddingScript(texts);
  return result.embeddings;
}

export async function embedText(text: string): Promise<number[]> {
  const [embedding] = await embedTexts([text]);
  if (!embedding) {
    throw new Error('[EMBEDDINGS] Nenhum embedding retornado.');
  }

  return embedding;
}
