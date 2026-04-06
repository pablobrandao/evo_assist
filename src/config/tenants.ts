import * as fs from 'fs';
import * as path from 'path';
import baseTenantsConfig from './tenants.json';

export interface StaticTenantConfig {
  tenant_id: string;
  name: string;
  whatsapp_instance: string;
  imap: {
    host: string;
    port: number;
    secure: boolean;
    auth: {
      user: string;
      pass: string;
    };
  };
}

interface TenantsFileShape {
  tenants: StaticTenantConfig[];
}

const BASE_TENANTS_PATH = path.resolve(process.cwd(), 'src', 'config', 'tenants.json');
const LOCAL_TENANTS_PATH = path.resolve(process.cwd(), 'src', 'config', 'tenants.local.json');

export function getTenantsConfigPath(): string {
  return fs.existsSync(LOCAL_TENANTS_PATH) ? LOCAL_TENANTS_PATH : BASE_TENANTS_PATH;
}

export function loadTenantsConfig(): TenantsFileShape {
  const targetPath = getTenantsConfigPath();

  if (!fs.existsSync(targetPath)) {
    return baseTenantsConfig as TenantsFileShape;
  }

  try {
    return JSON.parse(fs.readFileSync(targetPath, 'utf8')) as TenantsFileShape;
  } catch {
    return baseTenantsConfig as TenantsFileShape;
  }
}

export function getTenants(): StaticTenantConfig[] {
  return loadTenantsConfig().tenants ?? [];
}

export function saveTenantsConfig(tenants: StaticTenantConfig[]): void {
  const targetPath = getTenantsConfigPath();
  const content = JSON.stringify({ tenants }, null, 2);
  fs.writeFileSync(targetPath, content, 'utf8');
}
