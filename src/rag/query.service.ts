import { GoogleGenerativeAI, Schema, SchemaType } from '@google/generative-ai';
import { env } from '../config/env';
import { loadAdminConfig } from '../config/admin-config';
import { buildRAGPrompt } from './prompt';
import { HistoryEntry, HistoryService } from '../conversation/history.service';
import { searchQdrantPoints } from '../vector-store/qdrant.service';
import { embedText } from '../embeddings/local-embedding.service';

import * as fs from 'fs';
import * as path from 'path';

function getSystemPromptForFile(tenantId: string, filename?: string): string {
  if (filename) {
    const aiPromptsPath = path.resolve(process.cwd(), 'v2_data', 'ai_prompts.json');
    if (fs.existsSync(aiPromptsPath)) {
      try {
        const prompts = JSON.parse(fs.readFileSync(aiPromptsPath, 'utf8'));
        if (prompts[`${tenantId}:${filename}`]) {
          return prompts[`${tenantId}:${filename}`];
        }
      } catch (e) {}
    }
  }
  
  const config = loadAdminConfig();
  if (config.defaultSystemPrompt) {
    return config.defaultSystemPrompt;
  }
  return '';
}

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

const NO_CONTEXT_REPLY =
  'Não encontrei essa informação nos documentos disponíveis. Por favor, consulte o seu supervisor.';

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function buildRetrievalVariants(question: string, conversationHistory: string): string[] {
  const normalizedQuestion = normalizeText(question);
  const variants = new Set<string>();

  variants.add(question);

  if (conversationHistory !== 'Sem histórico recente.') {
    variants.add(`${conversationHistory}\n\nPergunta atual: ${question}`);
  }

  if (normalizedQuestion.includes('mes atual')) {
    variants.add(`${question}\nFoque em total faturado, total geral, período atual e vendas do mês atual.`);
    variants.add('Vendas Mês Atual, Vendas Dia Hoje, Meta Mês, Meta Realizada, Projeção do Mês, Ticket Médio.');
  }

  if (normalizedQuestion.includes('metrica') || normalizedQuestion.includes('indicador')) {
    variants.add(`${question}\nFoque em cabeçalhos, colunas, métricas, totais e seções do relatório.`);
  }

  if (normalizedQuestion.includes('meta')) {
    variants.add(`${question}\nFoque em metas, projeções, vendas e resumo executivo do documento.`);
    variants.add('Meta Mês (R$), Meta Realizada, Projeção do Mês, Meta Dia, Peso Mês Atual, Meta Mês (KG).');
  }

  if (normalizedQuestion.includes('recebeu hoje') || normalizedQuestion.includes('dados recebeu hoje')) {
    variants.add(`${question}\nFoque em nome do arquivo, tipo do documento, assunto e dados recebidos hoje.`);
  }

  if (normalizedQuestion.includes('faturado')) {
    variants.add(`${question}\nFoque em total faturado, total geral, valor total e vendas do período.`);
  }

  return Array.from(variants);
}

async function withGeminiCatch<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  try {
    return await fn();
  } catch (err: unknown) {
    const error = err as {
      status?: number;
      message?: string;
    };

    const isRateLimit =
      error?.status === 429 ||
      String(error?.message ?? '').includes('429') ||
      String(error?.message ?? '').toLowerCase().includes('quota');

    if (isRateLimit) {
      if (retries > 0) {
        console.warn(`[RAG] Gemini Free Tier Rate Limit detectado. Pausando 4 segundos suavemente para a fila da API (${retries} tentativas restantes)...`);
        await new Promise(r => setTimeout(r, 4000));
        return withGeminiCatch(fn, retries - 1);
      }
      throw new Error('RATE_LIMIT');
    }
    throw err;
  }
}

async function callOpenRouter(systemInstruction: string, userMessage: string): Promise<string> {
  if (!env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY_NOT_CONFIGURED');
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Comercial Assistent RAG',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openrouter/auto:free',
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenRouter Error: ${response.status} - ${errorBody}`);
  }

  const data = (await response.json()) as any;
  return data?.choices?.[0]?.message?.content ?? 'Resposta em branco do OpenRouter.';
}

async function analyzeQueryIntent(question: string, history: HistoryEntry[]): Promise<{
  query: string;
  targetFilename: string | null;
}> {
  if (history.length === 0) return { query: question, targetFilename: null };

  const schema: Schema = {
    type: SchemaType.OBJECT,
    properties: {
      query: { type: SchemaType.STRING, description: "A pergunta reescrita/isolada mantendo os detalhes intactos para busca vetorial." },
      targetFilename: { type: SchemaType.STRING, description: "O nome completo do arquivo referenciado EXATAMENTE como no histórico (ex: VENDAS_P/_VENDEDOR.pdf), caso exista menção isoladora na pergunta. Se for busca global, retorne ''.", nullable: true }
    },
    required: ["query"]
  };

  const contextStr = history.slice(-4).map((h, i) => `Histórico ${i + 1}:\nUsuario: ${h.question}\nAssistente: ${h.answer}`).join('\n---\n');

  try {
    const generativeModel = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature: 0,
      }
    });

    const prompt = `Analise a pergunta do Usuário atual cruzando com o Histórico Recente. Se o usuário restringir a intenção a uma listagem/arquivo específico mencionado no assistente antes (exemplo: referenciando o 'relatório 8'), encontre o NOME DO ARQUIVO COMPLETO correspondente neste histórico e retorne-o.\n\nHISTÓRICO:\n${contextStr}\n\nPERGUNTA: ${question}\n\nRetorne as variáveis usando o schema requerido.`;
    const res = await withGeminiCatch(() => generativeModel.generateContent(prompt));
    const jsonStr = res.response.text();
    const json = JSON.parse(jsonStr);
    
    let extractedFilename = (json.targetFilename && json.targetFilename.trim() !== '') ? json.targetFilename : null;
    if (extractedFilename) {
      extractedFilename = extractedFilename.replace(/\*/g, '').trim();
    }
    
    return {
      query: json.query || question,
      targetFilename: extractedFilename
    };
  } catch (e) {
    console.error('[RAG] Erro no analyzeQueryIntent:', e);
    return { query: question, targetFilename: null };
  }
}

export async function answerQuestion(
  question: string,
  tenant_id: string,
  options?: {
    recentConversation?: HistoryEntry[];
    targetFilename?: string;
  }
): Promise<string> {
  const recentConversation = options?.recentConversation ?? [];
  const conversationHistory = recentConversation.length > 0
    ? recentConversation
      .map(entry => `Usuario: ${entry.question}\nAssistente: ${entry.answer}`)
      .join('\n\n')
    : 'Sem histórico recente.';

  let effectiveQuestion = question;
  let effectiveTargetFilename = options?.targetFilename;

  if (!effectiveTargetFilename && recentConversation.length > 0) {
    const analysis = await analyzeQueryIntent(question, recentConversation);
    effectiveQuestion = analysis.query;
    if (analysis.targetFilename) {
      effectiveTargetFilename = analysis.targetFilename;
      console.log(`[RAG] Inteligência detectou foco em arquivo: ${effectiveTargetFilename}`);
    }
  }

  try {
    const retrievalVariants = buildRetrievalVariants(effectiveQuestion, conversationHistory);
    const resultsMap = new Map<string, { payload?: any; score: number }>();

    for (const variant of retrievalVariants) {
      const questionEmbedding = await embedText(variant);
      const results = await searchQdrantPoints({
        vector: questionEmbedding,
        tenant_id,
        limit: 6,
        filename: effectiveTargetFilename || undefined
      });

      for (const match of results) {
        const key = `${match.payload?.filename ?? 'documento'}:${match.payload?.chunk_index ?? 'x'}`;
        const current = resultsMap.get(key);
        if (!current || match.score > current.score) {
          resultsMap.set(key, match);
        }
      }
    }

    const results = Array.from(resultsMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    if (!results.length) {
      return NO_CONTEXT_REPLY;
    }

    let topFilename = effectiveTargetFilename;
    if (!topFilename && results.length > 0) {
      topFilename = results[0].payload?.filename;
    }
    const customSystemPrompt = getSystemPromptForFile(tenant_id, topFilename);

    console.log(`[RAG] topFilename identificado para fallback de prompt: ${topFilename}`);
    console.log(`[RAG] customSystemPrompt selecionado: ${customSystemPrompt ? 'SIM (Personalizado)' : 'NÃO (Padrão)'}`);
    console.log(`[RAG] Conteúdo System Instruction: ${customSystemPrompt}`);

    const recentDocs = await HistoryService.getRecentIngestedDocuments(tenant_id, 10);
    const sqlAuditContext = recentDocs.length > 0
      ? `[AUDITORIA DO BANCO DE DADOS] Os arquivos mais recentes registrados oficialmente no sistema são:\n` + recentDocs.map(d => `- ${d.name} (Registrado/Indexado em ${d.date})`).join('\n')
      : '';

    const context = results
      .map((match, i) => {
        const text = match.payload?.text ?? '';
        const filename = match.payload?.filename ?? 'documento';
        const documentType = match.payload?.document_type ? ` (${match.payload.document_type})` : '';
        return `[Trecho ${i + 1} - ${filename}${documentType}]:\n${text}`;
      })
      .join('\n\n---\n\n') + (sqlAuditContext ? `\n\n---\n\n${sqlAuditContext}` : '');

    const promptData = buildRAGPrompt(context, effectiveQuestion, conversationHistory, customSystemPrompt);

    if (env.OPENROUTER_API_KEY) {
      try {
        return await callOpenRouter(promptData.systemInstruction, promptData.userMessage);
      } catch (err: any) {
        console.warn('[RAG] Fallback: Falha no OpenRouter, tentando Gemini Direto...', err.message);
      }
    }

    const generativeModel = genAI.getGenerativeModel({ 
      model: 'gemini-2.0-flash',
      systemInstruction: promptData.systemInstruction
    });
    
    const response = await withGeminiCatch(() => generativeModel.generateContent(promptData.userMessage));

    return response.response.text();
  } catch (error: any) {
    if (error.message === 'RATE_LIMIT') {
      return '🚦 *Aviso:* Essa informação não está indexada na minha base, consulte seu Supervisor!';
    }
    throw error;
  }
}
