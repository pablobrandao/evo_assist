import fs from 'fs/promises';
import path from 'path';

interface InboundMessageMarker {
  id: string;
  expiresAt: number;
}

const DATA_DIR = path.join(process.cwd(), 'v2_data');
const DEDUPE_FILE = path.join(DATA_DIR, 'inbound_message_dedupe.json');
const TTL_MS = 10 * 60 * 1000;

export class InboundDedupeService {
  private static async ensureDir() {
    try {
      await fs.access(DATA_DIR);
    } catch {
      await fs.mkdir(DATA_DIR, { recursive: true });
    }
  }

  private static async getAll(): Promise<InboundMessageMarker[]> {
    await this.ensureDir();
    try {
      const content = await fs.readFile(DEDUPE_FILE, 'utf-8');
      const items = JSON.parse(content) as InboundMessageMarker[];
      return items.filter(item => item.expiresAt > Date.now());
    } catch {
      return [];
    }
  }

  private static async saveAll(items: InboundMessageMarker[]) {
    await this.ensureDir();
    await fs.writeFile(DEDUPE_FILE, JSON.stringify(items, null, 2));
  }

  static async shouldProcess(id: string): Promise<boolean> {
    const items = await this.getAll();
    if (items.some(item => item.id === id)) {
      await this.saveAll(items);
      return false;
    }

    items.push({
      id,
      expiresAt: Date.now() + TTL_MS,
    });
    await this.saveAll(items);
    return true;
  }
}
