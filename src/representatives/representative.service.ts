import { ImapFlow } from 'imapflow';
import { getDefaultFilterFrom } from '../config/admin-config';
import { getTenants } from '../config/tenants';
import { pool } from '../db/client';

export interface RepresentativeProfile {
  remoteJid: string;
  tenant_id: string;
  email: string;
  password: string;
  whatsapp_instance: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface TenantRuntimeConfig {
  tenant_id: string;
  name: string;
  whatsapp_instance: string;
  remoteJid?: string;
  imap: {
    host: string;
    port: number;
    secure: boolean;
    auth: {
      user: string;
      pass: string;
    };
  };
  filter_from: string;
}

function getImapDefaults() {
  const fallbackTenant = getTenants()[0];

  return {
    host: process.env.IMAP_HOST || fallbackTenant?.imap?.host || 'imap.kinghost.net',
    port: Number(process.env.IMAP_PORT || fallbackTenant?.imap?.port || 993),
    secure: String(process.env.IMAP_SECURE || fallbackTenant?.imap?.secure || 'true') !== 'false',
  };
}

function buildTenantId(remoteJid: string): string {
  return `rep_${remoteJid.replace(/\\D/g, '')}`;
}

function buildDisplayName(email: string): string {
  return email.split('@')[0] || email;
}

function mapRowToProfile(row: any): RepresentativeProfile {
  return {
    remoteJid: row.remote_jid,
    tenant_id: row.tenant_id,
    email: row.email,
    password: row.password,
    whatsapp_instance: row.whatsapp_instance,
    name: row.name,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export class RepresentativeService {
  static async getAll(): Promise<RepresentativeProfile[]> {
    try {
      const res = await pool.query('SELECT * FROM representatives ORDER BY created_at DESC');
      return res.rows.map(mapRowToProfile);
    } catch (e) {
      console.error('[DB] getAll reps error', e);
      return [];
    }
  }

  static async getByRemoteJid(remoteJid: string): Promise<RepresentativeProfile | null> {
    const res = await pool.query('SELECT * FROM representatives WHERE remote_jid = $1', [remoteJid]);
    if (res.rowCount === 0) return null;
    return mapRowToProfile(res.rows[0]);
  }

  static async saveProfile(input: {
    remoteJid: string;
    email: string;
    password: string;
    whatsapp_instance: string;
  }): Promise<RepresentativeProfile> {
    const tenant_id = buildTenantId(input.remoteJid);
    const email = input.email.trim().toLowerCase();
    const name = buildDisplayName(email);
    const now = new Date();

    const query = `
      INSERT INTO representatives 
        (remote_jid, tenant_id, email, password, whatsapp_instance, name, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (remote_jid) DO UPDATE SET
        email = EXCLUDED.email,
        password = EXCLUDED.password,
        whatsapp_instance = EXCLUDED.whatsapp_instance,
        name = EXCLUDED.name,
        updated_at = EXCLUDED.updated_at
      RETURNING *;
    `;

    const res = await pool.query(query, [
      input.remoteJid, tenant_id, email, input.password, input.whatsapp_instance, name, now, now
    ]);

    return mapRowToProfile(res.rows[0]);
  }

  static async updateProfile(
    remoteJid: string,
    input: {
      email: string;
      password: string;
      whatsapp_instance?: string;
    }
  ): Promise<RepresentativeProfile> {
    const existing = await this.getByRemoteJid(remoteJid);
    if (!existing) {
      throw new Error('REPRESENTATIVE_NOT_FOUND');
    }

    return this.saveProfile({
      remoteJid,
      email: input.email,
      password: input.password,
      whatsapp_instance: input.whatsapp_instance || existing.whatsapp_instance,
    });
  }

  static async removeByRemoteJid(remoteJid: string): Promise<boolean> {
    const res = await pool.query('DELETE FROM representatives WHERE remote_jid = $1', [remoteJid]);
    return (res.rowCount ?? 0) > 0;
  }

  static async verifyEmailCredentials(email: string, password: string): Promise<void> {
    const imapDefaults = getImapDefaults();
    const client = new ImapFlow({
      host: imapDefaults.host,
      port: imapDefaults.port,
      secure: imapDefaults.secure,
      tls: { rejectUnauthorized: false },
      auth: {
        user: email,
        pass: password,
      },
      logger: false,
    });

    try {
      await client.connect();
    } finally {
      try {
        await client.logout();
      } catch {}
    }
  }

  static async getRuntimeTenants(): Promise<TenantRuntimeConfig[]> {
    const imapDefaults = getImapDefaults();
    const defaultFilterFrom = getDefaultFilterFrom();
    const representatives = await this.getAll();
    const dynamicTenants: TenantRuntimeConfig[] = representatives.map(rep => ({
      tenant_id: rep.tenant_id,
      name: rep.name,
      whatsapp_instance: rep.whatsapp_instance,
      remoteJid: rep.remoteJid,
      imap: {
        host: imapDefaults.host,
        port: imapDefaults.port,
        secure: imapDefaults.secure,
        auth: {
          user: rep.email,
          pass: rep.password,
        },
      },
      filter_from: defaultFilterFrom,
    }));

    const dynamicEmails = new Set(dynamicTenants.map(item => item.imap.auth.user.toLowerCase()));
    const dynamicInstances = new Set(dynamicTenants.map(item => item.whatsapp_instance));

    const staticTenants = (getTenants() as TenantRuntimeConfig[])
      .filter(item => {
        const email = item.imap.auth.user.toLowerCase();
        return !dynamicEmails.has(email) && !dynamicInstances.has(item.whatsapp_instance);
      })
      .map(item => ({
        ...item,
        filter_from: defaultFilterFrom,
      }));

    return [...staticTenants, ...dynamicTenants];
  }
}
