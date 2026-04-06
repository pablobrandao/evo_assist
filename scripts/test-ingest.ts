/**
 * Script de teste: executa a ingestão IMAP para todos os tenants.
 * Execute com: npx ts-node scripts/test-ingest.ts
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { runIngestionForAllTenants } from '../src/ingestion/imap.service';

console.log('=== TESTE DE INGESTÃO IMAP ===\n');

runIngestionForAllTenants()
  .then(() => {
    console.log('\n✅ Ingestão concluída com sucesso!');
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error('\n❌ Erro durante a ingestão:', err);
    process.exit(1);
  });
