import fs from 'fs/promises';
import path from 'path';

export interface ChatSession {
  remoteJid: string;
  tenant_id: string;
  activeUntil: number;
}

const DATA_DIR = path.join(process.cwd(), 'v2_data');
const SESSION_FILE = path.join(DATA_DIR, 'chat_sessions.json');
const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;

export class ChatSessionService {
  private static async ensureDir() {
    try {
      await fs.access(DATA_DIR);
    } catch {
      await fs.mkdir(DATA_DIR, { recursive: true });
    }
  }

  private static async getAllSessions(): Promise<ChatSession[]> {
    await this.ensureDir();
    try {
      const content = await fs.readFile(SESSION_FILE, 'utf-8');
      const sessions = JSON.parse(content) as ChatSession[];
      return sessions.filter(session => session.activeUntil > Date.now());
    } catch {
      return [];
    }
  }

  private static async saveAllSessions(sessions: ChatSession[]) {
    await this.ensureDir();
    await fs.writeFile(SESSION_FILE, JSON.stringify(sessions, null, 2));
  }

  static async getSession(
    remoteJid: string,
    tenant_id: string
  ): Promise<ChatSession | null> {
    const sessions = await this.getAllSessions();
    const session =
      sessions.find(item => item.remoteJid === remoteJid && item.tenant_id === tenant_id) ?? null;

    await this.saveAllSessions(sessions);
    return session;
  }

  static async activateSession(
    remoteJid: string,
    tenant_id: string,
    ttlMs = DEFAULT_SESSION_TTL_MS
  ) {
    const sessions = await this.getAllSessions();
    const activeUntil = Date.now() + ttlMs;
    const nextSession: ChatSession = { remoteJid, tenant_id, activeUntil };
    const index = sessions.findIndex(
      item => item.remoteJid === remoteJid && item.tenant_id === tenant_id
    );

    if (index >= 0) {
      sessions[index] = nextSession;
    } else {
      sessions.push(nextSession);
    }

    await this.saveAllSessions(sessions);
    return nextSession;
  }
}
