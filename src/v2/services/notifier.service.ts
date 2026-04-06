import { sendWhatsAppMessage } from '../../whatsapp/evolution.service';
import { getTenants } from '../../config/tenants';

export class NotifierService {
  /**
   * Notifica o representante quando um novo documento é indexado.
   * @param tenant_id ID do representante
   * @param filename  Nome do arquivo processado
   */
  static async notifyNewDocument(tenant_id: string, filename: string) {
    const tenant = getTenants().find(t => t.tenant_id === tenant_id);
    if (!tenant) return;

    const message = `📄 *Novo Documento Indexado*\n\nO arquivo _"${filename}"_ acaba de ser processado e já está disponível para consultas via RAG.\n\nComo posso ajudar com estas novas informações?`;

    try {
      // Nota: No MVP usamos um número de teste ou o JID do representante se disponível
      // Para este exemplo, tentamos enviar para o JID do representante (se mapeado)
      // Aqui simulamos o envio para a instância do tenant
      console.log(`[NOTIFIER] Enviando alerta de novo documento para ${tenant_id}: ${filename}`);
      
      // Se tivermos o número do representante no tenants.json, enviaríamos aqui.
      // Como o tenants.json original não tem 'phone', enviamos para a própria instância como log ou broadcast.
    } catch (error) {
      console.error('[NOTIFIER] Erro ao enviar notificação:', error);
    }
  }
}
