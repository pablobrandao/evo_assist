import { sendWhatsAppMessage } from '../whatsapp/evolution.service';
import { OnboardingService } from './onboarding.service';
import { RepresentativeService } from '../representatives/representative.service';

const EMAIL_PROMPT =
  'Primeiro acesso detectado. Informe seu e-mail corporativo para conectar sua caixa de entrada.';
const PASSWORD_PROMPT =
  'Agora informe a senha do e-mail. O servidor IMAP ja esta configurado automaticamente.';
const INVALID_EMAIL_REPLY =
  'Nao consegui validar esse e-mail. Envie um endereco valido no formato nome@empresa.com.';
const INVALID_CREDENTIALS_REPLY =
  'Nao foi possivel autenticar esse e-mail no servidor configurado. Confira a senha e envie novamente.';
const ONBOARDING_SUCCESS_REPLY =
  'Seu acesso foi configurado. Quando novos documentos chegarem na sua caixa de entrada, eles serao encaminhados aqui e indexados no RAG. Envie /Agc para iniciar uma consulta.';

function isValidEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.trim());
}

export async function handleRepresentativeOnboarding(params: {
  instance: string;
  from: string;
  text: string;
}): Promise<boolean> {
  const { instance, from, text } = params;
  const session = await OnboardingService.getSession(from);

  if (!session) {
    return false;
  }

  if (session.step === 'awaiting_email') {
    if (!isValidEmail(text)) {
      await sendWhatsAppMessage(instance, from, INVALID_EMAIL_REPLY);
      return true;
    }

    await OnboardingService.saveEmail(from, text.trim().toLowerCase());
    await sendWhatsAppMessage(instance, from, PASSWORD_PROMPT);
    return true;
  }

  const email = session.email;
  if (!email) {
    await OnboardingService.start(from, instance);
    await sendWhatsAppMessage(instance, from, EMAIL_PROMPT);
    return true;
  }

  try {
    await RepresentativeService.verifyEmailCredentials(email, text);
    await RepresentativeService.saveProfile({
      remoteJid: from,
      email,
      password: text,
      whatsapp_instance: instance,
    });
    await OnboardingService.clear(from);
    await sendWhatsAppMessage(instance, from, ONBOARDING_SUCCESS_REPLY);
  } catch {
    await sendWhatsAppMessage(instance, from, INVALID_CREDENTIALS_REPLY);
  }

  return true;
}

export async function startRepresentativeOnboarding(instance: string, from: string): Promise<void> {
  await OnboardingService.start(from, instance);
  await sendWhatsAppMessage(instance, from, EMAIL_PROMPT);
}
