import cron from 'node-cron';
import { runIngestionForAllTenants } from '../ingestion/imap.service';

/**
 * Inicia o cron job de varredura IMAP.
 * Executa a cada 10 minutos: '* /10 * * * *'
 */
export function startIngestionCron(): void {
  console.log('[CRON] Agendando varredura IMAP a cada 10 minutos...');

  cron.schedule('*/10 * * * *', async () => {
    const startTime = new Date();
    console.log(`\n[CRON] ════ Iniciando varredura — ${startTime.toLocaleString('pt-BR')} ════`);
    try {
      await runIngestionForAllTenants();
      const elapsed = ((Date.now() - startTime.getTime()) / 1000).toFixed(1);
      console.log(`[CRON] ════ Concluída em ${elapsed}s ════\n`);
    } catch (error) {
      console.error('[CRON] ❌ Erro durante varredura:', error);
    }
  });
}
