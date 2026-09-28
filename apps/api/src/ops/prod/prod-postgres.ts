import { readSecretValue } from '../../platform/runtime-config/secret-value';
import { deriveComputeSizing } from './prod-sizing';

export type PostgresProductionRequirements = {
  durableStorage: boolean;
  backupEnabled: boolean;
  maxConnections: number;
  tlsRequired: boolean;
  restrictedNetwork: boolean;
};

export function derivePostgresRequirements(env: NodeJS.ProcessEnv = process.env): PostgresProductionRequirements {
  const sizing = deriveComputeSizing(env);
  const tlsRequired = env['PROD_REQUIRE_DB_TLS'] !== 'false';
  const backupEnabled = env['BACKUP_ENABLE_POSTGRES'] !== 'false';

  return {
    durableStorage: true,
    backupEnabled,
    maxConnections: sizing.postgresMaxConnections,
    tlsRequired,
    restrictedNetwork: true,
  };
}

export function assertPostgresProductionRequirements(
  requirements: PostgresProductionRequirements,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!requirements.durableStorage) {
    throw new Error('PostgreSQL durable storage is mandatory in production');
  }
  if (!requirements.backupEnabled) {
    throw new Error('PostgreSQL backup must be enabled in production (BACKUP_ENABLE_POSTGRES)');
  }
  if (requirements.maxConnections < 20) {
    throw new Error('PostgreSQL max_connections must cover app pool + workers + admin reserve');
  }

  if (requirements.tlsRequired) {
    const sslMode =
      env['PGSSLMODE']?.trim() ??
      readSslModeFromDatabaseUrl(readSecretValue(env, 'DATABASE_URL'));
    if (!sslMode || !['require', 'verify-ca', 'verify-full'].includes(sslMode)) {
      throw new Error('PostgreSQL TLS required — set PGSSLMODE=require (or verify-*) or sslmode in DATABASE_URL');
    }
  }
}

function readSslModeFromDatabaseUrl(databaseUrl: string | undefined): string | null {
  if (!databaseUrl) {
    return null;
  }
  try {
    return new URL(databaseUrl).searchParams.get('sslmode');
  } catch {
    return null;
  }
}
