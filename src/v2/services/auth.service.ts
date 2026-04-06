import path from 'path';
import fs from 'fs/promises';

const DATA_DIR = path.join(process.cwd(), 'v2_data');
const AUTH_FILE = path.join(DATA_DIR, 'auth_sessions.json');

// Interface para controle de sessão de PIN
export interface AuthSession {
  remoteJid: string;
  authenticated: boolean;
  expires: number;
}

export class AuthService {
  private static async ensureDir() {
    try { await fs.access(DATA_DIR); } catch { await fs.mkdir(DATA_DIR, { recursive: true }); }
  }

  static async getSession(remoteJid: string): Promise<AuthSession | null> {
    await this.ensureDir();
    try {
      const sessions: AuthSession[] = JSON.parse(await fs.readFile(AUTH_FILE, 'utf-8'));
      const session = sessions.find(s => s.remoteJid === remoteJid);
      if (session && session.expires > Date.now()) return session;
      return null;
    } catch { return null; }
  }

  static async saveSession(remoteJid: string, authenticated: boolean) {
    await this.ensureDir();
    let sessions: AuthSession[] = [];
    try { sessions = JSON.parse(await fs.readFile(AUTH_FILE, 'utf-8')); } catch {}
    
    const index = sessions.findIndex(s => s.remoteJid === remoteJid);
    const newSession = {
      remoteJid,
      authenticated,
      expires: Date.now() + (24 * 60 * 60 * 1000) // 24h de validade
    };

    if (index >= 0) sessions[index] = newSession;
    else sessions.push(newSession);

    await fs.writeFile(AUTH_FILE, JSON.stringify(sessions, null, 2));
  }

  /** Lógica de validação de PIN (Exemplo: 1234) */
  static validatePIN(input: string): boolean {
    const VALID_PIN = process.env.V2_ACCESS_PIN || '1234';
    return input.trim() === VALID_PIN;
  }
}
