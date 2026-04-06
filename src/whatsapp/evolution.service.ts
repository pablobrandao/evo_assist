import { env } from '../config/env';

/**
 * Envia uma mensagem de texto para um número via Evolution API.
 * @param instance Nome da instância (= tenant_id / whatsapp_instance)
 * @param to       JID do destinatário (formato: "5511999999999@s.whatsapp.net")
 * @param text     Texto da mensagem
 */
export async function sendWhatsAppMessage(
  instance: string,
  to:       string,
  text:     string
): Promise<void> {
  const url = `${env.EVOLUTION_API_URL}/message/sendText/${instance}`;

  const response = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey':       env.EVOLUTION_API_KEY,
    },
    body: JSON.stringify({ number: to, text }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`[EVOLUTION] Falha ao enviar mensagem (${response.status}): ${body}`);
  }
}

export async function sendWhatsAppDocument(
  instance: string,
  to: string,
  filename: string,
  buffer: Buffer,
  caption = '',
  mimetype = 'application/pdf'
): Promise<void> {
  const url = `${env.EVOLUTION_API_URL}/message/sendMedia/${instance}`;
  const media = buffer.toString('base64');
  const number = to.replace(/@s\.whatsapp\.net$/, '');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': env.EVOLUTION_API_KEY,
    },
    body: JSON.stringify({
      number,
      mediatype: 'document',
      mimetype,
      caption,
      media,
      fileName: filename,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`[EVOLUTION] Falha ao enviar documento (${response.status}): ${body}`);
  }
}

/**
 * Cria uma instância na Evolution API (sem tentar obter QR code imediatamente).
 * Na v2, o QR code é obtido via /instance/connect após a criação.
 */
export async function createInstance(instanceName: string): Promise<void> {
  const url = `${env.EVOLUTION_API_URL}/instance/create`;

  const response = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey':       env.EVOLUTION_API_KEY,
    },
    body: JSON.stringify({ 
      instanceName, 
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',  // obrigatório na v2
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`[EVOLUTION] Falha ao criar instância (${response.status}): ${body}`);
  }
}

/**
 * Conecta uma instância existente e retorna o QR Code base64.
 * Na Evolution API v2, o QR code é obtido via /instance/connect/{instanceName}.
 *
 * @param instanceName  Nome da instância já criada
 * @returns             QR code em base64 (sem o prefixo "data:image/...")
 */
export async function getInstanceQRCode(instanceName: string): Promise<string> {
  const url = `${env.EVOLUTION_API_URL}/instance/connect/${instanceName}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'apikey':       env.EVOLUTION_API_KEY,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`[EVOLUTION] Falha ao obter QR code (${response.status}): ${body}`);
  }

  const data = await response.json() as {
    base64?: string;          // Evolution v2.x
    qrcode?: { base64?: string }; // fallback v1.x
    code?: string;            // algumas versões retornam 'code'
  };

  // Tenta os diferentes formatos de resposta da Evolution API
  const qrBase64 =
    data?.base64 ??
    data?.qrcode?.base64 ??
    data?.code ??
    '';

  if (!qrBase64) {
    console.warn('[EVOLUTION] QR code não encontrado na resposta:', JSON.stringify(data));
  }

  return qrBase64;
}

/**
 * Cria uma instância e retorna seu QR Code para conexão via WhatsApp.
 * Combina createInstance + getInstanceQRCode em uma única operação.
 *
 * @param instanceName  Nome desejado para a instância
 * @returns             QR code em base64
 */
export async function createInstanceAndGetQRCode(instanceName: string): Promise<string> {
  // 1. Cria a instância
  await createInstance(instanceName);

  // 2. Aguarda um momento para a instância inicializar
  await new Promise(resolve => setTimeout(resolve, 1500));

  // 3. Obtém o QR code via connect
  return getInstanceQRCode(instanceName);
}
