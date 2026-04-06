export function buildRAGPrompt(
  context: string,
  question: string,
  conversationHistory = 'Sem histórico recente.',
  customSystemPrompt?: string
): { systemInstruction: string; userMessage: string; monolith: string } {
  const defaultPrompt = `Você é um assistente interno de vendas de alta precisão para representantes comerciais.

INSTRUÇÕES IMPORTANTES:
- Responda de forma clara, direta e profissional.
- Use APENAS as informações do contexto abaixo para responder.
- Use o histórico recente apenas para entender referências da pergunta atual.
- Se a resposta não estiver no contexto, diga exatamente: "Não encontrei essa informação nos documentos disponíveis. Consulte o administrador."
- NUNCA invente preços, prazos, especificações ou qualquer dado.
- Quando mencionar valores numéricos ou preços, transcreva exatamente como consta no documento.
- Responda sempre em português (pt-BR).`;

  const systemInstruction = customSystemPrompt?.trim() || defaultPrompt;

  const userMessage = `HISTÓRICO RECENTE DA CONVERSA:
${conversationHistory}

CONTEXTO DOS DOCUMENTOS OFICIAIS:
${context}

PERGUNTA DO REPRESENTANTE:
${question}

!! ATENÇÃO (SOBREPOSIÇÃO DE DIRETRIZ) !!
A instrução a seguir DEVE OBRIGATORIAMENTE anular e sobrepor a Pergunta do Representante:
${systemInstruction}

RESPOSTA:`;

  return {
    systemInstruction,
    userMessage,
    monolith: `${systemInstruction}\n\n${userMessage}`,
  };
}
