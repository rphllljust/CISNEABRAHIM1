import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  readFirstSecretValue,
  readSecretValue,
} from '../../platform/runtime-config/secret-value';

export type DocumentStorageConfig = {
  provider: 'filesystem' | 's3';
  rootPath: string;
  bucket: string;
  signedUrlTtlSeconds: number;
  downloadTokenSecret: string;
  s3Endpoint?: string;
  s3Region?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  s3ForcePathStyle: boolean;
};

/**
 * DOCUMENT_DOWNLOAD_TOKEN_SECRET signs download URLs. It never falls back to a
 * hardcoded constant: production-like runtimes must provide the secret (direct
 * or via JWT_SECRET), while dev/test processes get an ephemeral random key
 * (valid only within the process, matching the pre-existing test semantics).
 */
function resolveDownloadTokenSecret(
  explicit: string | undefined,
  jwtSecret: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (explicit) {
    return explicit;
  }
  if (jwtSecret) {
    return jwtSecret;
  }
  const isProductionLike = env['NODE_ENV'] === 'production' || env['CISNE_ENV'] === 'production';
  if (isProductionLike) {
    throw new Error(
      'CONFIGURATION_ERROR: DOCUMENT_DOWNLOAD_TOKEN_SECRET (or JWT_SECRET) is required when NODE_ENV/CISNE_ENV is production.',
    );
  }
  return randomBytes(32).toString('hex');
}

function readTrimmed(envName: string): string | undefined {
  const raw = process.env[envName];
  if (!raw) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function findMonorepoRoot(startDir: string = process.cwd()): string {
  let current = resolve(startDir);
  for (;;) {
    if (
      existsSync(join(current, 'pnpm-workspace.yaml')) ||
      existsSync(join(current, 'turbo.json'))
    ) {
      return current;
    }
    const parent = resolve(current, '..');
    if (parent === current) {
      return startDir;
    }
    current = parent;
  }
}

function resolveCisneRuntimeDir(): string {
  const explicit = readTrimmed('CISNE_RUNTIME_DIR');
  if (explicit) {
    return resolve(explicit);
  }
  return join(findMonorepoRoot(), '.runtime');
}

function resolveObjectStorageRootPath(): string {
  const raw = readTrimmed('OBJECT_STORAGE_ROOT');
  if (!raw) {
    return join(resolveCisneRuntimeDir(), 'object-storage');
  }
  if (raw.startsWith('/') || /^[A-Za-z]:[\\/]/.test(raw)) {
    return resolve(raw);
  }
  return resolve(resolveCisneRuntimeDir(), raw);
}

function readS3ForcePathStyle(s3Endpoint: string | undefined): boolean {
  const raw = readTrimmed('OBJECT_STORAGE_S3_FORCE_PATH_STYLE');
  if (raw) {
    return raw === 'true' || raw === '1';
  }
  // Custom endpoints (MinIO/S3-compatible) usually require path-style addressing.
  return Boolean(s3Endpoint);
}

export function loadDocumentStorageConfig(): DocumentStorageConfig {
  const provider = process.env['OBJECT_STORAGE_PROVIDER'] === 's3' ? 's3' : 'filesystem';
  const jwtSecret = readSecretValue(process.env, 'JWT_SECRET');
  const downloadTokenSecret = resolveDownloadTokenSecret(
    readSecretValue(process.env, 'DOCUMENT_DOWNLOAD_TOKEN_SECRET'),
    jwtSecret,
  );
  const s3Endpoint =
    readTrimmed('OBJECT_STORAGE_S3_ENDPOINT') ?? readTrimmed('OBJECT_STORAGE_ENDPOINT');
  const s3Region =
    readTrimmed('OBJECT_STORAGE_S3_REGION') ?? readTrimmed('OBJECT_STORAGE_REGION') ?? 'us-east-1';
  const s3AccessKeyId = readFirstSecretValue(process.env, [
    { key: 'OBJECT_STORAGE_S3_ACCESS_KEY_ID' },
    { key: 'S3_ACCESS_KEY_ID' },
  ]);
  const s3SecretAccessKey = readFirstSecretValue(process.env, [
    { key: 'OBJECT_STORAGE_S3_SECRET_ACCESS_KEY' },
    { key: 'S3_SECRET_ACCESS_KEY' },
  ]);

  return {
    provider,
    rootPath: resolveObjectStorageRootPath(),
    bucket: readTrimmed('OBJECT_STORAGE_BUCKET') ?? 'cisne-documents',
    signedUrlTtlSeconds: Number(process.env['OBJECT_STORAGE_SIGNED_URL_TTL_SECONDS'] ?? 600),
    downloadTokenSecret,
    s3Endpoint,
    s3Region,
    s3AccessKeyId,
    s3SecretAccessKey,
    s3ForcePathStyle: readS3ForcePathStyle(s3Endpoint),
  };
}
