// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse');
import { env } from '../config/env';

/**
 * Extrai o texto bruto de um buffer PDF usando pdf-parse (local).
 */
async function extractWithPdfParse(buffer: Buffer): Promise<string> {
  console.log('[PDF] Usando pdf-parse local...');
  const data = await pdfParse(buffer);
  return data.text;
}

/**
 * Extrai texto avançado/tabular usando LlamaParse API.
 */
async function extractWithLlamaParse(buffer: Buffer): Promise<string> {
  const apiKey = env.LLAMACLOUD_API_KEY;
  if (!apiKey) {
    throw new Error('[LlamaParse] A variavel LLAMACLOUD_API_KEY é obrigatoria para usar a estrategia llamaparse.');
  }

  console.log('[PDF] Enviando documento para o LlamaParse...');
  
  const blob = new Blob([new Uint8Array(buffer)], { type: 'application/pdf' });
  const formData = new FormData();
  formData.append('file', blob, 'document.pdf');
  
  // 1. Upload
  const uploadRes = await fetch('https://api.cloud.llamaindex.ai/api/parsing/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json'
    },
    body: formData as any
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`[LlamaParse] Falha no upload: ${uploadRes.status} - ${errText}`);
  }

  const uploadData: any = await uploadRes.json();
  const jobId = uploadData.id;
  
  console.log(`[PDF] Upload concluido LlamaParse (Job ID: ${jobId}). Aguardando processamento...`);

  // 2. Poll for results
  const resultUrl = `https://api.cloud.llamaindex.ai/api/parsing/job/${jobId}/result/markdown`;
  
  let attempts = 0;
  const maxAttempts = 60; // 60 * 2s = 2 minutos maximo
  
  while (attempts < maxAttempts) {
    const statusRes = await fetch(resultUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

    if (statusRes.status === 200) {
      const data: any = await statusRes.json();
      console.log('[PDF] Processamento LlamaParse finalizado com sucesso.');
      return data.markdown;
    } else if (statusRes.status !== 202 && statusRes.status !== 404 && statusRes.status !== 400) {
       const errText = await statusRes.text();
       throw new Error(`[LlamaParse] Falha na extração (Status ${statusRes.status}): ${errText}`);
    }

    // Esperar 2 segundos antes de tentar novamente
    await new Promise(resolve => setTimeout(resolve, 2000));
    attempts++;
  }

  throw new Error('[LlamaParse] Tempo limite (Timeout) aguardando processamento do PDF.');
}

/**
 * Roteador principal de leitura de PDF
 */
export async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  if (env.PDF_PARSER_STRATEGY === 'llamaparse') {
    return await extractWithLlamaParse(buffer);
  } else {
    return await extractWithPdfParse(buffer);
  }
}
