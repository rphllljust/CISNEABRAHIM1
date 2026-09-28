import {
  readFirstSecretValue,
  readSecretValue,
} from '../../platform/runtime-config/secret-value';

export type PostgresBackupMode = 'pg_dump' | 'docker';
export type ObjectStorageBackupProvider = 'filesystem' | 's3';

export type BackupConfig = {
  destinationDir: string;
  offsiteDir: string | null;
  encryptionKeyBase64: string | null;
  statusFilePath: string;
  objectStorageProvider: ObjectStorageBackupProvider;
  objectStorageRoot: string | null;
  objectStorageBucket: string | null;
  objectStorageS3Endpoint: string | null;
  objectStorageS3Region: string;
  objectStorageS3AccessKeyId: string | null;
  objectStorageS3SecretAccessKey: string | null;
  objectStorageS3ForcePathStyle: boolean;
  databaseUrl: string | null;
  postgresBackupMode: PostgresBackupMode;
  dockerContainer: string;
  retentionDaily: number;
  retentionWeekly: number;
  enablePostgres: boolean;
  enableObjectStorage: boolean;
};

function readInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readBool(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function readTrimmed(env: NodeJS.ProcessEnv, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return null;
}

export function loadBackupConfig(env: NodeJS.ProcessEnv = process.env): BackupConfig {
  const postgresModeRaw = env['BACKUP_POSTGRES_MODE']?.trim().toLowerCase();
  const postgresBackupMode: PostgresBackupMode = postgresModeRaw === 'docker' ? 'docker' : 'pg_dump';
  const objectStorageProvider: ObjectStorageBackupProvider =
    env['OBJECT_STORAGE_PROVIDER']?.trim().toLowerCase() === 's3' ? 's3' : 'filesystem';
  const s3Endpoint = readTrimmed(env, 'OBJECT_STORAGE_S3_ENDPOINT', 'OBJECT_STORAGE_ENDPOINT');
  const forcePathStyleRaw = env['OBJECT_STORAGE_S3_FORCE_PATH_STYLE']?.trim().toLowerCase();

  return {
    destinationDir: env['BACKUP_DEST_DIR']?.trim() || '.backup/artifacts',
    offsiteDir: env['BACKUP_OFFSITE_DIR']?.trim() || null,
    encryptionKeyBase64: readSecretValue(env, 'BACKUP_ENCRYPTION_KEY') ?? null,
    statusFilePath: env['BACKUP_STATUS_FILE']?.trim() || '.backup/status/latest.json',
    objectStorageProvider,
    objectStorageRoot: env['OBJECT_STORAGE_ROOT']?.trim() || null,
    objectStorageBucket: env['OBJECT_STORAGE_BUCKET']?.trim() || null,
    objectStorageS3Endpoint: s3Endpoint,
    objectStorageS3Region:
      readTrimmed(env, 'OBJECT_STORAGE_S3_REGION', 'OBJECT_STORAGE_REGION') ?? 'us-east-1',
    objectStorageS3AccessKeyId:
      readFirstSecretValue(env, [
        { key: 'OBJECT_STORAGE_S3_ACCESS_KEY_ID' },
        { key: 'S3_ACCESS_KEY_ID' },
      ]) ?? null,
    objectStorageS3SecretAccessKey:
      readFirstSecretValue(env, [
        { key: 'OBJECT_STORAGE_S3_SECRET_ACCESS_KEY' },
        { key: 'S3_SECRET_ACCESS_KEY' },
      ]) ?? null,
    objectStorageS3ForcePathStyle:
      forcePathStyleRaw === 'true' ||
      forcePathStyleRaw === '1' ||
      (!forcePathStyleRaw && Boolean(s3Endpoint)),
    databaseUrl: readSecretValue(env, 'DATABASE_URL') ?? null,
    postgresBackupMode,
    dockerContainer: env['BACKUP_POSTGRES_DOCKER_CONTAINER']?.trim() || 'cisne_local_postgres',
    retentionDaily: readInt(env, 'BACKUP_RETENTION_DAILY', 7),
    retentionWeekly: readInt(env, 'BACKUP_RETENTION_WEEKLY', 4),
    enablePostgres: readBool(env, 'BACKUP_ENABLE_POSTGRES', true),
    enableObjectStorage: readBool(env, 'BACKUP_ENABLE_OBJECT_STORAGE', true),
  };
}

export function assertBackupEncryptionKeyForProduction(env: NodeJS.ProcessEnv = process.env): void {
  if (env['NODE_ENV'] !== 'production') {
    return;
  }
  const key = readSecretValue(env, 'BACKUP_ENCRYPTION_KEY');
  if (!key) {
    throw new Error('BACKUP_ENCRYPTION_KEY is required in production');
  }
  const decoded = Buffer.from(key, 'base64');
  if (decoded.length !== 32) {
    throw new Error('BACKUP_ENCRYPTION_KEY must decode to 32 bytes (AES-256)');
  }
}
