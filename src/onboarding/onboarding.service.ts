import fs from 'fs/promises';
import path from 'path';

export interface OnboardingSession {
  remoteJid: string;
  instance: string;
  step: 'awaiting_email' | 'awaiting_password';
  email?: string;
  updatedAt: string;
}

const DATA_DIR = path.join(process.cwd(), 'v2_data');
const ONBOARDING_FILE = path.join(DATA_DIR, 'onboarding_sessions.json');

export class OnboardingService {
  private static async ensureDir() {
    try {
      await fs.access(DATA_DIR);
    } catch {
      await fs.mkdir(DATA_DIR, { recursive: true });
    }
  }

  private static async getAllSessions(): Promise<OnboardingSession[]> {
    await this.ensureDir();
    try {
      const content = await fs.readFile(ONBOARDING_FILE, 'utf-8');
      return JSON.parse(content) as OnboardingSession[];
    } catch {
      return [];
    }
  }

  private static async saveAllSessions(sessions: OnboardingSession[]) {
    await this.ensureDir();
    await fs.writeFile(ONBOARDING_FILE, JSON.stringify(sessions, null, 2));
  }

  static async getSession(remoteJid: string): Promise<OnboardingSession | null> {
    const sessions = await this.getAllSessions();
    return sessions.find(item => item.remoteJid === remoteJid) ?? null;
  }

  static async start(remoteJid: string, instance: string) {
    const sessions = await this.getAllSessions();
    const nextSession: OnboardingSession = {
      remoteJid,
      instance,
      step: 'awaiting_email',
      updatedAt: new Date().toISOString(),
    };
    const index = sessions.findIndex(item => item.remoteJid === remoteJid);

    if (index >= 0) {
      sessions[index] = nextSession;
    } else {
      sessions.push(nextSession);
    }

    await this.saveAllSessions(sessions);
    return nextSession;
  }

  static async saveEmail(remoteJid: string, email: string) {
    const sessions = await this.getAllSessions();
    const index = sessions.findIndex(item => item.remoteJid === remoteJid);
    if (index < 0) {
      throw new Error('ONBOARDING_SESSION_NOT_FOUND');
    }

    sessions[index] = {
      ...sessions[index],
      step: 'awaiting_password',
      email,
      updatedAt: new Date().toISOString(),
    };

    await this.saveAllSessions(sessions);
    return sessions[index];
  }

  static async clear(remoteJid: string) {
    const sessions = await this.getAllSessions();
    const nextSessions = sessions.filter(item => item.remoteJid !== remoteJid);
    await this.saveAllSessions(nextSessions);
  }
}
