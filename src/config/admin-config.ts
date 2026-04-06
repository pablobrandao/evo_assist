import * as fs from 'fs';
import * as path from 'path';
import { env } from './env';

export interface AdminConfig {
  defaultSystemPrompt?: string;
  contextMessageTemplate?: string;
  defaultFilterFrom?: string;
}

const ADMIN_CONFIG_PATH = path.resolve(process.cwd(), 'v2_data', 'admin_config.json');

export function loadAdminConfig(): AdminConfig {
  if (!fs.existsSync(ADMIN_CONFIG_PATH)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(ADMIN_CONFIG_PATH, 'utf8')) as AdminConfig;
  } catch {
    return {};
  }
}

export function saveAdminConfig(config: AdminConfig): void {
  fs.mkdirSync(path.dirname(ADMIN_CONFIG_PATH), { recursive: true });
  fs.writeFileSync(ADMIN_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

export function getDefaultFilterFrom(): string {
  const configured = loadAdminConfig().defaultFilterFrom?.trim();
  if (configured) {
    return configured;
  }

  return env.COMPANY_EMAIL.trim();
}
