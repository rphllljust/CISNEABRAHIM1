import {
  assertNoInlineSecrets,
  readFirstSecretValue,
  readSecretValue,
} from '../../platform/runtime-config/secret-value';
import type { SecretRotationPlan } from './prod-types';

const INLINE_SECRET_KEYS = [
  'JWT_SECRET',
  'DOCUMENT_DOWNLOAD_TOKEN_SECRET',
  'DATABASE_URL',
  'BACKUP_ENCRYPTION_KEY',
  'OBJECT_STORAGE_S3_SECRET_ACCESS_KEY',
  'S3_SECRET_ACCESS_KEY',
  'PROD_POSTGRES_PASSWORD',
] as const;

export function defaultSecretRotationPlan(): SecretRotationPlan {
  return {
    jwtRotationDays: 90,
    databaseCredentialRotationDays: 90,
    objectStorageKeyRotationDays: 90,
    dualKeySupported: true,
  };
}

export function assertTlsUrls(config: { publicApiUrl: string | null; publicWebUrl: string | null }): void {
  for (const url of [config.publicApiUrl, config.publicWebUrl]) {
    if (!url) {
      continue;
    }
    if (!url.startsWith('https://')) {
      throw new Error(`HTTPS required for production public URLs — invalid: ${url}`);
    }
  }
}

function assertJwtSigningMaterial(env: NodeJS.ProcessEnv): void {
  const jwt = readSecretValue(env, 'JWT_SECRET');
  if (!jwt) {
    throw new Error('JWT signing material required (JWT_SECRET_FILE in hardened production)');
  }
  if (jwt.length < 32) {
    throw new Error('JWT signing material must be at least 32 characters');
  }
}

function assertRequiredStoreBackedSecrets(env: NodeJS.ProcessEnv): void {
  const databaseUrl = readSecretValue(env, 'DATABASE_URL');
  if (!databaseUrl) {
    throw new Error('DATABASE_URL_FILE is required when production secret store is enabled');
  }

  assertJwtSigningMaterial(env);

  const backupEnabled =
    env['BACKUP_ENABLE_POSTGRES'] !== 'false' ||
    env['BACKUP_ENABLE_OBJECT_STORAGE'] !== 'false';
  if (backupEnabled && !readSecretValue(env, 'BACKUP_ENCRYPTION_KEY')) {
    throw new Error(
      'BACKUP_ENCRYPTION_KEY_FILE is required when production backups are enabled',
    );
  }

  if (
    env['OBJECT_STORAGE_PROVIDER'] === 's3' &&
    env['OBJECT_STORAGE_IAM_ROLE'] !== 'true'
  ) {
    const accessKey = readFirstSecretValue(env, [
      { key: 'OBJECT_STORAGE_S3_ACCESS_KEY_ID' },
      { key: 'S3_ACCESS_KEY_ID' },
    ]);
    const secretKey = readFirstSecretValue(env, [
      { key: 'OBJECT_STORAGE_S3_SECRET_ACCESS_KEY' },
      { key: 'S3_SECRET_ACCESS_KEY' },
    ]);
    if (!accessKey || !secretKey) {
      throw new Error(
        'S3 static credentials must be mounted from secret files when IAM role is unavailable',
      );
    }
  }
}

export function assertProductionSecrets(env: NodeJS.ProcessEnv = process.env): void {
  const requireStore = env['PROD_REQUIRE_SECRET_STORE'] === 'true';

  if (requireStore) {
    assertNoInlineSecrets(env, INLINE_SECRET_KEYS);
    assertRequiredStoreBackedSecrets(env);
    return;
  }

  assertJwtSigningMaterial(env);
}

export function assertSecretRotationPlan(plan: SecretRotationPlan): void {
  if (plan.jwtRotationDays > 90) {
    throw new Error('JWT rotation interval must not exceed 90 days');
  }
  if (!plan.dualKeySupported) {
    throw new Error('Dual-key JWT rotation required for zero-downtime credential rotation');
  }
}

export function scanConfigForEmbeddedSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  const violations: string[] = [];
  const patterns = [
    /AKIA[0-9A-Z]{16}/,
    /BEGIN (RSA |EC )?PRIVATE KEY/,
    /password\s*=\s*['"][^'"]{8,}['"]/i,
  ];

  for (const [key, value] of Object.entries(env)) {
    if (!value || key.endsWith('_FILE')) {
      continue;
    }
    for (const pattern of patterns) {
      if (pattern.test(value)) {
        violations.push(key);
        break;
      }
    }
  }

  return violations;
}
