import { GoogleGenerativeAI, Schema, SchemaType } from '@google/generative-ai';
import { env } from '../config/env';
import { loadAdminConfig } from '../config/admin-config';
import { buildRAGPrompt } from './prompt';
import { HistoryEntry, HistoryService } from '../conversation/history.service';
import { searchQdrantPoints } from '../vector-store/qdrant.service';
import { embedText } from '../embeddings/local-embedding.service';
import { getGraphContext } from './graph.service';

import * as fs from 'fs';
import * as path from 'path';

const FOLLOW_UP_ANALYSIS_COOLDOWN_MS = 5 * 60 * 1000;
let analyzeIntentCooldownUntil = 0;

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
  'Nao encontrei essa informacao nos documentos disponiveis. Por favor, consulte o seu supervisor.';

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function extractFilenames(text: string): string[] {
  const matches = text.match(/[A-Z0-9_./-]+\.(?:pdf|docx|xlsx|csv|txt)/gi) ?? [];
  return Array.from(new Set(matches.map(item => item.trim())));
}

function isGreeting(question: string): boolean {
  const normalized = normalizeText(question).trim();
  return /^(oi|ola|bom dia|boa tarde|boa noite|e ai|opa)\b/.test(normalized);
}

function shouldAnalyzeContext(question: string, history: HistoryEntry[]): boolean {
  if (history.length === 0) {
    return false;
  }

  const normalized = normalizeText(question);
  const filenameMentioned = extractFilenames(question).length > 0;
  if (filenameMentioned) {
    return false;
  }

  if (normalized.length <= 3) {
    return false;
  }

  const followUpSignals = [
    'dele',
    'deles',
    'delas',
    'disso',
    'nisso',
    'naquele',
    'naquela',
    'nessa',
    'nesse',
    'nesse arquivo',
    'neste arquivo',
    'esse arquivo',
    'essa pergunta',
    'esses dados',
    'esses clientes',
    'esses documentos',
    'entao',
    'qual deles',
    'quais sao eles',
    'quais sao elas',
    'os dados estao em',
    'de forma distinta',
    'entre os',
  ];

  return followUpSignals.some(signal => normalized.includes(signal));
}

function tryResolveTargetFilenameHeuristically(question: string, history: HistoryEntry[]): string | null {
  const explicitInQuestion = extractFilenames(question);
  if (explicitInQuestion.length > 0) {
    return explicitInQuestion[0];
  }

  for (let i = history.length - 1; i >= 0; i -= 1) {
    const entry = history[i];

    if (entry.documentName?.trim()) {
      return entry.documentName.trim();
    }

    const answerMatches = extractFilenames(entry.answer ?? '');
    if (answerMatches.length > 0) {
      return answerMatches[0];
    }

    const questionMatches = extractFilenames(entry.question ?? '');
    if (questionMatches.length > 0) {
      return questionMatches[0];
    }
  }

  return null;
}

function buildRetrievalVariants(
  question: string,
  conversationHistory: string,
  graphHints: string[] = []
): string[] {
  const normalizedQuestion = normalizeText(question);
  const variants = new Set<string>();

  variants.add(question);

  if (conversationHistory !== 'Sem historico recente.') {
    variants.add(`${conversationHistory}\n\nPergunta atual: ${question}`);
  }

  if (graphHints.length > 0) {
    variants.add(`${question}\nEntidades e relacoes relevantes: ${graphHints.join(', ')}`);
  }

  if (normalizedQuestion.includes('mes atual')) {
    variants.add(`${question}\nFoque em total faturado, total geral, periodo atual e vendas do mes atual.`);
    variants.add('Vendas Mes Atual, Vendas Dia Hoje, Meta Mes, Meta Realizada, Projecao do Mes, Ticket Medio.');
  }

  if (normalizedQuestion.includes('metrica') || normalizedQuestion.includes('indicador')) {
    variants.add(`${question}\nFoque em cabecalhos, colunas, metricas, totais e secoes do relatorio.`);
  }

  if (normalizedQuestion.includes('meta')) {
    variants.add(`${question}\nFoque em metas, projecoes, vendas e resumo executivo do documento.`);
    variants.add('Meta Mes (R$), Meta Realizada, Projecao do Mes, Meta Dia, Peso Mes Atual, Meta Mes (KG).');
  }

  if (normalizedQuestion.includes('recebeu hoje') || normalizedQuestion.includes('dados recebeu hoje')) {
    variants.add(`${question}\nFoque em nome do arquivo, tipo do documento, assunto e dados recebidos hoje.`);
  }

  if (normalizedQuestion.includes('faturado')) {
    variants.add(`${question}\nFoque em total faturado, total geral, valor total e vendas do periodo.`);
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
        { role: 'user', content: userMessage },
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

  if (Date.now() < analyzeIntentCooldownUntil) {
    const heuristicTarget = tryResolveTargetFilenameHeuristically(question, history);
    return { query: question, targetFilename: heuristicTarget };
  }

  const schema: Schema = {
    type: SchemaType.OBJECT,
    properties: {
      query: { type: SchemaType.STRING, description: 'A pergunta reescrita/isolada mantendo os detalhes intactos para busca vetorial.' },
      targetFilename: { type: SchemaType.STRING, description: "O nome completo do arquivo referenciado EXATAMENTE como no historico (ex: VENDAS_P/_VENDEDOR.pdf), caso exista mencao isoladora na pergunta. Se for busca global, retorne ''.", nullable: true },
    },
    required: ['query'],
  };

  const contextStr = history
    .slice(-4)
    .map((h, i) => `Historico ${i + 1}:\nUsuario: ${h.question}\nAssistente: ${h.answer}`)
    .join('\n---\n');

  try {
    const generativeModel = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schema,
        temperature: 0,
      },
    });

    const prompt = `Analise a pergunta do Usuario atual cruzando com o Historico Recente. Se o usuario restringir a intencao a uma listagem/arquivo especifico mencionado no assistente antes (exemplo: referenciando o 'relatorio 8'), encontre o NOME DO ARQUIVO COMPLETO correspondente neste historico e retorne-o.\n\nHISTORICO:\n${contextStr}\n\nPERGUNTA: ${question}\n\nRetorne as variaveis usando o schema requerido.`;
    const res = await withGeminiCatch(() => generativeModel.generateContent(prompt));
    const jsonStr = res.response.text();
    const json = JSON.parse(jsonStr);

    let extractedFilename = json.targetFilename && json.targetFilename.trim() !== '' ? json.targetFilename : null;
    if (extractedFilename) {
      extractedFilename = extractedFilename.replace(/\*/g, '').trim();
    }

    return {
      query: json.query || question,
      targetFilename: extractedFilename ?? tryResolveTargetFilenameHeuristically(question, history),
    };
  } catch (e) {
    if ((e as Error)?.message === 'RATE_LIMIT') {
      analyzeIntentCooldownUntil = Date.now() + FOLLOW_UP_ANALYSIS_COOLDOWN_MS;
      console.warn('[RAG] analyzeQueryIntent entrou em cooldown temporario por rate limit. Usando heuristica local.');
    } else {
      console.error('[RAG] Erro no analyzeQueryIntent:', e);
    }

    return {
      query: question,
      targetFilename: tryResolveTargetFilenameHeuristically(question, history),
    };
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
    : 'Sem historico recente.';

  if (isGreeting(question) && recentConversation.length === 0) {
    return 'Boa tarde! Como posso ajudar com os documentos ou relatorios?';
  }

  let effectiveQuestion = question;
  let effectiveTargetFilename: string | undefined =
    options?.targetFilename ?? tryResolveTargetFilenameHeuristically(question, recentConversation) ?? undefined;

  if (!effectiveTargetFilename && shouldAnalyzeContext(question, recentConversation)) {
    const analysis = await analyzeQueryIntent(question, recentConversation);
    effectiveQuestion = analysis.query;
    if (analysis.targetFilename) {
      effectiveTargetFilename = analysis.targetFilename ?? undefined;
      console.log(`[RAG] Inteligencia detectou foco em arquivo: ${effectiveTargetFilename}`);
    }
  }

  try {
    const graphContext = await getGraphContext({
      tenantId: tenant_id,
      question: effectiveQuestion,
      targetFilename: effectiveTargetFilename,
      limit: 10,
    });

    if (graphContext.facts.length > 0) {
      console.log(`[RAG] Contexto de grafo encontrado com ${graphContext.facts.length} relacoes relevantes.`);
    }

    const retrievalVariants = buildRetrievalVariants(
      effectiveQuestion,
      conversationHistory,
      graphContext.retrievalHints
    );
    const resultsMap = new Map<string, { payload?: any; score: number }>();

    for (const variant of retrievalVariants) {
      const questionEmbedding = await embedText(variant);
      const results = await searchQdrantPoints({
        vector: questionEmbedding,
        tenant_id,
        limit: 6,
        filename: effectiveTargetFilename || undefined,
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
    console.log(`[RAG] customSystemPrompt selecionado: ${customSystemPrompt ? 'SIM (Personalizado)' : 'NAO (Padrao)'}`);

    const recentDocs = await HistoryService.getRecentIngestedDocuments(tenant_id, 10);
    const sqlAuditContext = recentDocs.length > 0
      ? `[AUDITORIA DO BANCO DE DADOS] Os arquivos mais recentes registrados oficialmente no sistema sao:\n${recentDocs.map(d => `- ${d.name} (Registrado/Indexado em ${d.date})`).join('\n')}`
      : '';

    const graphFactsContext = graphContext.facts.length > 0
      ? `[CONTEXTO RELACIONAL DO GRAFO]\n${graphContext.facts.map(fact => `- ${fact}`).join('\n')}`
      : '';

    const graphEntityContext = graphContext.matchedEntities.length > 0
      ? `[ENTIDADES RELACIONAIS IDENTIFICADAS]\n${graphContext.matchedEntities.map(entity => `- ${entity.name} (${entity.entityType})`).join('\n')}`
      : '';

    const retrievedContext = results
      .map((match, i) => {
        const text = match.payload?.text ?? '';
        const filename = match.payload?.filename ?? 'documento';
        const documentType = match.payload?.document_type ? ` (${match.payload.document_type})` : '';
        return `[Trecho ${i + 1} - ${filename}${documentType}]:\n${text}`;
      })
      .join('\n\n---\n\n');

    const contextSections = [
      graphFactsContext,
      graphEntityContext,
      retrievedContext,
      sqlAuditContext,
    ].filter(Boolean);

    const promptData = buildRAGPrompt(
      contextSections.join('\n\n---\n\n'),
      effectiveQuestion,
      conversationHistory,
      customSystemPrompt
    );

    if (env.OPENROUTER_API_KEY) {
      try {
        return await callOpenRouter(promptData.systemInstruction, promptData.userMessage);
      } catch (err: any) {
        console.warn('[RAG] Fallback: Falha no OpenRouter, tentando Gemini Direto...', err.message);
      }
    }

    const generativeModel = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction: promptData.systemInstruction,
    });

    const response = await withGeminiCatch(() => generativeModel.generateContent(promptData.userMessage));

    return response.response.text();
  } catch (error: any) {
    if (error.message === 'RATE_LIMIT') {
      return '*Aviso:* Essa informacao nao esta indexada na minha base, consulte seu Supervisor!';
    }
    throw error;
  }
}
