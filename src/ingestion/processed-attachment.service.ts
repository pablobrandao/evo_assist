import { createHash } from 'crypto';
import { pool } from '../db/client';

export interface ProcessedAttachmentInput {
  tenantId: string;
  messageKey: string;
  filename: string;
  attachmentBuffer: Buffer;
}

export class ProcessedAttachmentService {
  static buildMessageKey(emailMessageId: string, uid: number): string {
    const normalizedMessageId = emailMessageId.trim();
    if (normalizedMessageId) {
      return `message-id:${normalizedMessageId}`;
    }

    return `uid:${uid}`;
  }

  static buildAttachmentHash(filename: string, attachmentBuffer: Buffer): string {
    return createHash('sha256')
      .update(filename)
      .update('|')
      .update(attachmentBuffer)
      .digest('hex');
  }

  static async isAlreadyProcessed(input: ProcessedAttachmentInput): Promise<boolean> {
    const attachmentHash = this.buildAttachmentHash(input.filename, input.attachmentBuffer);
    const res = await pool.query(
      `SELECT 1
       FROM processed_ingestion_attachments
       WHERE tenant_id = $1
         AND (
           (message_key = $2 AND filename = $3)
           OR attachment_hash = $4
         )
       LIMIT 1`,
      [input.tenantId, input.messageKey, input.filename, attachmentHash]
    );

    return (res.rowCount ?? 0) > 0;
  }

  static async markProcessed(input: ProcessedAttachmentInput): Promise<void> {
    const attachmentHash = this.buildAttachmentHash(input.filename, input.attachmentBuffer);
    await pool.query(
      `INSERT INTO processed_ingestion_attachments (
         tenant_id,
         message_key,
         filename,
         attachment_hash,
         processed_at
       )
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (tenant_id, message_key, filename) DO NOTHING`,
      [input.tenantId, input.messageKey, input.filename, attachmentHash]
    );
  }
}
