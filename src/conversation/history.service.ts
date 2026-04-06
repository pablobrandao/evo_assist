import { pool } from '../db/client';

export interface HistoryEntry {
  id: string;
  timestamp: string;
  tenant_id: string;
  from: string;
  question: string;
  answer: string;
  source?: 'user' | 'cron' | 'system' | 'admin';
  eventType?: string;
  documentName?: string;
  tokens?: number;
  tokens_embedding?: number;
}

export interface ChatFlow {
  id: string;
  tenant_id: string;
  from: string;
  questionCount: number;
  totalTokens: number;
  totalEmbeddingTokens: number;
  firstTimestamp: string;
  lastTimestamp: string;
  lastQuestion: string;
  entries: HistoryEntry[];
}

function mapRow(row: any): HistoryEntry {
  return {
    id: row.id,
    timestamp: new Date(row.timestamp).toISOString(),
    tenant_id: row.tenant_id,
    from: row.from,
    question: row.question,
    answer: row.answer,
    source: row.source,
    eventType: row.event_type,
    documentName: row.document_name,
    tokens: row.tokens,
    tokens_embedding: row.tokens_embedding,
  };
}

export class HistoryService {

  static async logInteraction(entry: Omit<HistoryEntry, 'id' | 'timestamp'>) {
    const newEntry: HistoryEntry = {
      ...entry,
      id: Math.random().toString(36).substring(2, 11),
      timestamp: new Date().toISOString(),
    };

    const query = `
      INSERT INTO conversation_history 
        (id, timestamp, tenant_id, "from", question, answer, source, event_type, document_name, tokens, tokens_embedding)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `;

    await pool.query(query, [
      newEntry.id,
      new Date(newEntry.timestamp),
      newEntry.tenant_id,
      newEntry.from,
      newEntry.question,
      newEntry.answer,
      newEntry.source || null,
      newEntry.eventType || null,
      newEntry.documentName || null,
      newEntry.tokens || null,
      newEntry.tokens_embedding || null,
    ]);

    return newEntry;
  }

  static async getHistory(): Promise<HistoryEntry[]> {
    try {
      const res = await pool.query('SELECT * FROM conversation_history ORDER BY timestamp ASC');
      return res.rows.map(mapRow);
    } catch {
      return [];
    }
  }

  static async getRecentConversation(
    tenant_id: string,
    from: string,
    limit = 6
  ): Promise<HistoryEntry[]> {
    const res = await pool.query(
      'SELECT * FROM conversation_history WHERE tenant_id = $1 AND "from" = $2 ORDER BY timestamp DESC LIMIT $3',
      [tenant_id, from, limit]
    );
    // Reverse again because conversation context expects chronological order
    return res.rows.map(mapRow).reverse();
  }

  static async getAnalytics() {
    const history = await this.getHistory(); // mantem a logica atual de grouping do MVP
    const totalQuestions = history.length;
    const tenants = [...new Set(history.map(h => h.tenant_id))];

    const statsPerTenant = tenants.map(tid => {
      const tenantCalls = history.filter(h => h.tenant_id === tid);
      return {
        tenant_id: tid,
        count: tenantCalls.length,
        lastInteraction: tenantCalls[tenantCalls.length - 1]?.timestamp,
      };
    });

    return {
      totalQuestions,
      activeTenants: tenants.length,
      statsPerTenant,
    };
  }

  static async getChatFlows(limit = 25, entriesPerFlow = 12): Promise<ChatFlow[]> {
    const history = await this.getHistory();
    const grouped = new Map<string, HistoryEntry[]>();

    history.forEach(entry => {
      const key = `${entry.tenant_id}::${entry.from}`;
      const existing = grouped.get(key) ?? [];
      existing.push(entry);
      grouped.set(key, existing);
    });

    return [...grouped.entries()]
      .map(([key, entries]) => {
        const sortedEntries = [...entries].sort((a, b) => {
          return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
        });
        const [tenant_id, from] = key.split('::');
        const lastEntry = sortedEntries[sortedEntries.length - 1];
        const firstEntry = sortedEntries[0];

        return {
          id: key,
          tenant_id,
          from,
          questionCount: sortedEntries.length,
          totalTokens: sortedEntries.reduce((sum, entry) => sum + (entry.tokens ?? 0), 0),
          totalEmbeddingTokens: sortedEntries.reduce((sum, entry) => sum + (entry.tokens_embedding ?? 0), 0),
          firstTimestamp: firstEntry?.timestamp ?? '',
          lastTimestamp: lastEntry?.timestamp ?? '',
          lastQuestion: lastEntry?.question ?? '',
          entries: sortedEntries.slice(-entriesPerFlow),
        };
      })
      .sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime())
      .slice(0, limit);
  }

  static async getRecentIngestedDocuments(tenant_id: string, limit = 10): Promise<{ name: string; date: string }[]> {
    try {
      const res = await pool.query(
        `SELECT DISTINCT document_name, MAX(timestamp) as last_seen
         FROM conversation_history 
         WHERE tenant_id = $1 AND event_type = 'document_forwarded' AND document_name IS NOT NULL
         GROUP BY document_name
         ORDER BY last_seen DESC 
         LIMIT $2`,
        [tenant_id, limit]
      );
      return res.rows.map(row => ({
        name: row.document_name,
        date: new Date(row.last_seen).toLocaleString('pt-BR')
      }));
    } catch {
      return [];
    }
  }
}
