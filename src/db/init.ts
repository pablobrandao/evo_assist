import fs from 'fs/promises';
import path from 'path';
import { pool } from './client';

const DATA_DIR = path.join(process.cwd(), 'v2_data');

export async function initDB() {
  console.log('[DB] Iniciando verificação/criação das tabelas no PostgreSQL...');
  const client = await pool.connect();
  
  try {
    // 1. Representatives Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS representatives (
        remote_jid VARCHAR(255) PRIMARY KEY,
        tenant_id VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        password VARCHAR(255) NOT NULL,
        whatsapp_instance VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Ingestion Status Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS ingestion_status (
        tenant_id VARCHAR(255) PRIMARY KEY,
        last_check_at TIMESTAMP WITH TIME ZONE,
        last_status VARCHAR(50) NOT NULL,
        last_message TEXT NOT NULL,
        last_document_at TIMESTAMP WITH TIME ZONE,
        last_filename VARCHAR(255)
      );
    `);

    // 3. Conversation History Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversation_history (
        id VARCHAR(50) PRIMARY KEY,
        timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
        tenant_id VARCHAR(255) NOT NULL,
        "from" VARCHAR(255) NOT NULL,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        source VARCHAR(50),
        event_type VARCHAR(100),
        document_name VARCHAR(255),
        tokens INTEGER,
        tokens_embedding INTEGER
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS conversation_history_tenant_from_idx 
      ON conversation_history(tenant_id, "from");
    `);

    console.log('[DB] Tabelas verificadas. Verificando necessidade de migração JSON...');

    // Migration logic
    const repCheck = await client.query('SELECT COUNT(*) as count FROM representatives');
    if (parseInt(repCheck.rows[0].count) === 0) {
      console.log('[DB] Tabela representatives vazia. Migrando dados do JSON...');
      try {
        const repData = await fs.readFile(path.join(DATA_DIR, 'representatives.json'), 'utf-8');
        const reps = JSON.parse(repData);
        for (const r of reps) {
          await client.query(
            `INSERT INTO representatives (remote_jid, tenant_id, email, password, whatsapp_instance, name, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
            [r.remoteJid, r.tenant_id, r.email, r.password, r.whatsapp_instance, r.name, r.createdAt, r.updatedAt]
          );
        }
      } catch (e) {
         // ignore
      }
    }

    const statCheck = await client.query('SELECT COUNT(*) as count FROM ingestion_status');
    if (parseInt(statCheck.rows[0].count) === 0) {
      console.log('[DB] Tabela ingestion_status vazia. Migrando dados do JSON...');
      try {
        const statData = await fs.readFile(path.join(DATA_DIR, 'ingestion_status.json'), 'utf-8');
        const stats = JSON.parse(statData);
        for (const s of stats) {
          await client.query(
            `INSERT INTO ingestion_status (tenant_id, last_check_at, last_status, last_message, last_document_at, last_filename)
             VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
            [s.tenant_id, s.lastCheckAt, s.lastStatus, s.lastMessage, s.lastDocumentAt, s.lastFilename]
          );
        }
      } catch (e) {
        // ignore
      }
    }

    const histCheck = await client.query('SELECT COUNT(*) as count FROM conversation_history');
    if (parseInt(histCheck.rows[0].count) === 0) {
      console.log('[DB] Tabela conversation_history vazia. Migrando dados do JSON...');
      try {
        const histData = await fs.readFile(path.join(DATA_DIR, 'history.json'), 'utf-8');
        const history = JSON.parse(histData);
        for (const h of history) {
          await client.query(
            `INSERT INTO conversation_history (id, timestamp, tenant_id, "from", question, answer, source, event_type, document_name, tokens, tokens_embedding)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT DO NOTHING`,
             [h.id, h.timestamp, h.tenant_id, h.from, h.question, h.answer, h.source, h.eventType, h.documentName, h.tokens, h.tokens_embedding]
          );
        }
      } catch (e) {
        // ignore
      }
    }

    console.log('[DB] Processo de migração concluído com sucesso.');
  } catch (error) {
    console.error('[DB] Erro ao criar tabelas e migrar:', error);
    throw error;
  } finally {
    client.release();
  }
}
