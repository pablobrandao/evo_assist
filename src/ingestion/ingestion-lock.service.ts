import { PoolClient } from 'pg';
import { pool } from '../db/client';

export interface IngestionLockHandle {
  release: () => Promise<void>;
}

export class IngestionLockService {
  static async tryAcquireTenantLock(tenantId: string): Promise<IngestionLockHandle | null> {
    const client = await pool.connect();

    try {
      const res = await client.query(
        `SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS locked`,
        ['imap_ingestion', tenantId]
      );

      if (!res.rows[0]?.locked) {
        client.release();
        return null;
      }

      return {
        release: async () => {
          await this.releaseTenantLock(client, tenantId);
        },
      };
    } catch (error) {
      client.release();
      throw error;
    }
  }

  private static async releaseTenantLock(client: PoolClient, tenantId: string): Promise<void> {
    try {
      await client.query(
        `SELECT pg_advisory_unlock(hashtext($1), hashtext($2))`,
        ['imap_ingestion', tenantId]
      );
    } finally {
      client.release();
    }
  }
}
