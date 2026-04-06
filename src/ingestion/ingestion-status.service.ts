import { pool } from '../db/client';

export interface IngestionStatusEntry {
  tenant_id: string;
  lastCheckAt: string;
  lastStatus: 'success' | 'warning' | 'error' | 'idle';
  lastMessage: string;
  lastDocumentAt?: string;
  lastFilename?: string;
}

function mapRowToEntry(row: any): IngestionStatusEntry {
  return {
    tenant_id: row.tenant_id,
    lastCheckAt: row.last_check_at ? new Date(row.last_check_at).toISOString() : '',
    lastStatus: row.last_status,
    lastMessage: row.last_message,
    lastDocumentAt: row.last_document_at ? new Date(row.last_document_at).toISOString() : undefined,
    lastFilename: row.last_filename ?? undefined,
  };
}

export class IngestionStatusService {
  static async getAll(): Promise<IngestionStatusEntry[]> {
    try {
      const res = await pool.query('SELECT * FROM ingestion_status');
      return res.rows.map(mapRowToEntry);
    } catch (e) {
      console.error('[DB] getAll ingestion_status error', e);
      return [];
    }
  }

  static async upsert(entry: IngestionStatusEntry): Promise<void> {
    const query = `
      INSERT INTO ingestion_status 
        (tenant_id, last_check_at, last_status, last_message, last_document_at, last_filename)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (tenant_id) DO UPDATE SET
        last_check_at = EXCLUDED.last_check_at,
        last_status = EXCLUDED.last_status,
        last_message = EXCLUDED.last_message,
        last_document_at = EXCLUDED.last_document_at,
        last_filename = EXCLUDED.last_filename;
    `;

    await pool.query(query, [
      entry.tenant_id,
      entry.lastCheckAt ? new Date(entry.lastCheckAt) : null,
      entry.lastStatus,
      entry.lastMessage,
      entry.lastDocumentAt ? new Date(entry.lastDocumentAt) : null,
      entry.lastFilename ?? null,
    ]);
  }

  static async getByTenantId(tenant_id: string): Promise<IngestionStatusEntry | null> {
    const res = await pool.query('SELECT * FROM ingestion_status WHERE tenant_id = $1', [tenant_id]);
    if (res.rowCount === 0) return null;
    return mapRowToEntry(res.rows[0]);
  }
}
