import { spawn } from 'child_process';
import { env } from '../config/env';

interface LocalEmbeddingResponse {
  embeddings: number[][];
}

interface PythonCommand {
  command: string;
  args: string[];
}

function buildPythonCommandCandidates(): PythonCommand[] {
  const configured = env.LOCAL_EMBEDDING_PYTHON_BIN.trim();
  const candidates: PythonCommand[] = [];

  if (configured) {
    candidates.push({
      command: configured,
      args: ['scripts/embed_local.py'],
    });
  }

  // Windows often exposes a blocked store alias for `python`; `py -3` is a safer fallback.
  if (configured.toLowerCase() === 'python') {
    candidates.push({
      command: 'py',
      args: ['-3', 'scripts/embed_local.py'],
    });
    candidates.push({
      command: 'python3',
      args: ['scripts/embed_local.py'],
    });
  }

  return candidates;
}

async function runSingleLocalEmbeddingCommand(
  texts: string[],
  pythonCommand: PythonCommand
): Promise<LocalEmbeddingResponse> {
  return await new Promise((resolve, reject) => {
    const child = spawn(pythonCommand.command, pythonCommand.args, {
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
        reject(new Error(`[EMBEDDINGS] Processo Python falhou (${code}) em "${pythonCommand.command} ${pythonCommand.args.join(' ')}": ${stderr || stdout}`));
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

async function runLocalEmbeddingScript(texts: string[]): Promise<LocalEmbeddingResponse> {
  const candidates = buildPythonCommandCandidates();
  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      return await runSingleLocalEmbeddingCommand(texts, candidate);
    } catch (error) {
      lastError = error;
      const errorMessage = String((error as Error)?.message ?? error);
      const isSpawnPermissionIssue =
        errorMessage.includes('spawn EPERM') ||
        errorMessage.includes('ENOENT') ||
        errorMessage.includes('EACCES');

      if (!isSpawnPermissionIssue) {
        throw error;
      }

      console.warn(`[EMBEDDINGS] Falha ao iniciar "${candidate.command}". Tentando fallback...`);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('[EMBEDDINGS] Nao foi possivel iniciar o processo Python local.');
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
