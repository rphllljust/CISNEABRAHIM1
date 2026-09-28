import { readSecretValue } from '../../platform/runtime-config/secret-value';

export type ProdConfig = {
  cisneEnv: string;
  nodeEnv: string;
  publicApiUrl: string | null;
  publicWebUrl: string | null;
  databaseUrl: string;
  databasePoolMax: number;
  objectStorageProvider: string;
  objectStorageBucket: string | null;
  tlsRequired: boolean;
  secretStoreRequired: boolean;
};

function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadProdConfig(env: NodeJS.ProcessEnv = process.env): ProdConfig {
  const databaseUrl = readSecretValue(env, 'DATABASE_URL');
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for production configuration');
  }

  return {
    cisneEnv: env['CISNE_ENV'] ?? 'unknown',
    nodeEnv: env['NODE_ENV'] ?? 'unknown',
    publicApiUrl: env['PROD_PUBLIC_API_URL']?.trim() ?? env['PUBLIC_API_URL']?.trim() ?? null,
    publicWebUrl: env['PROD_PUBLIC_WEB_URL']?.trim() ?? env['PUBLIC_WEB_URL']?.trim() ?? null,
    databaseUrl,
    databasePoolMax: readPositiveInt(env['DATABASE_POOL_MAX'], 10),
    objectStorageProvider: env['OBJECT_STORAGE_PROVIDER']?.trim() ?? 'filesystem',
    objectStorageBucket: env['OBJECT_STORAGE_BUCKET']?.trim() ?? null,
    tlsRequired: env['PROD_REQUIRE_TLS'] !== 'false',
    secretStoreRequired: env['PROD_REQUIRE_SECRET_STORE'] === 'true',
  };
}

export function assertProductionEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  if (env['CISNE_ENV'] !== 'production') {
    throw new Error('CISNE_ENV must be "production" for production infrastructure');
  }
  if (env['NODE_ENV'] !== 'production') {
    throw new Error('NODE_ENV must be "production"');
  }
}
