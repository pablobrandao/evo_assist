/**
 * Script de teste RAG: faz uma pergunta diretamente no terminal.
 * Execute com: npx ts-node scripts/test-rag.ts "sua pergunta" rep_joao
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { answerQuestion } from '../src/rag/query.service';

const question  = process.argv[2] ?? 'Qual é o produto mais barato?';
const tenant_id = process.argv[3] ?? 'rep_exemplo';

console.log(`=== TESTE RAG ===`);
console.log(`Tenant:   ${tenant_id}`);
console.log(`Pergunta: ${question}`);
console.log('─────────────────────────────────\n');

answerQuestion(question, tenant_id)
  .then((answer: string) => {
    console.log('RESPOSTA:\n');
    console.log(answer);
    console.log('\n✅ Teste concluído!');
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error('\n❌ Erro:', err);
    process.exit(1);
  });
