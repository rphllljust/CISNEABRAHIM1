import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { assertBackupEncryptionKeyForProduction, loadBackupConfig, type BackupConfig } from './backup-config';
import { pruneBackups } from './backup-retention';
import { runObjectStorageBackup, type S3BackupClient } from './object-storage-backup';
import { defaultCommandRunner, runPostgresBackup } from './postgres-backup';
import { writeBackupStatus } from './backup-status';
import type { BackupArtifact, BackupJobResult } from './backup-types';

export type BackupRunnerDeps = {
  now?: () => Date;
  runCommand?: typeof defaultCommandRunner;
  s3Client?: S3BackupClient;
};

function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

export async function runMonitoredBackup(
  env: NodeJS.ProcessEnv = process.env,
  deps: BackupRunnerDeps = {},
): Promise<BackupJobResult> {
  const startedAtDate = deps.now?.() ?? new Date();
  const startedAt = startedAtDate.toISOString();
  const timestamp = formatTimestamp(startedAtDate);
  const config = loadBackupConfig(env);
  assertBackupEncryptionKeyForProduction(env);

  const artifacts: BackupArtifact[] = [];
  try {
    await mkdir(config.destinationDir, { recursive: true });

    if (config.enablePostgres) {
      artifacts.push(
        await runPostgresBackup(config, timestamp, deps.runCommand ?? defaultCommandRunner),
      );
      await pruneBackups(join(config.destinationDir, 'postgres'), config.retentionDaily);
    }

    if (config.enableObjectStorage) {
      artifacts.push(await runObjectStorageBackup(config, timestamp, deps.s3Client));
      await pruneBackups(join(config.destinationDir, 'object-storage'), config.retentionDaily);
    }

    const expectedArtifacts =
      Number(config.enablePostgres) + Number(config.enableObjectStorage);
    if (artifacts.length !== expectedArtifacts) {
      throw new Error(
        `Backup incomplete: expected ${expectedArtifacts} artifact(s), created ${artifacts.length}`,
      );
    }

    const finishedAtDate = deps.now?.() ?? new Date();
    const result: BackupJobResult = {
      status: 'ok',
      startedAt,
      finishedAt: finishedAtDate.toISOString(),
      durationMs: finishedAtDate.getTime() - startedAtDate.getTime(),
      artifacts,
    };
    await writeBackupStatus(config.statusFilePath, result);
    return result;
  } catch (error) {
    const finishedAtDate = deps.now?.() ?? new Date();
    const result: BackupJobResult = {
      status: 'failed',
      startedAt,
      finishedAt: finishedAtDate.toISOString(),
      durationMs: finishedAtDate.getTime() - startedAtDate.getTime(),
      artifacts,
      error: error instanceof Error ? error.message : String(error),
    };
    await writeBackupStatus(config.statusFilePath, result);
    return result;
  }
}

export function summarizeBackupConfig(config: BackupConfig): Record<string, unknown> {
  return {
    destinationDir: config.destinationDir,
    offsiteConfigured: Boolean(config.offsiteDir),
    encryptionConfigured: Boolean(config.encryptionKeyBase64),
    postgresEnabled: config.enablePostgres,
    objectStorageEnabled: config.enableObjectStorage,
    objectStorageProvider: config.objectStorageProvider,
    objectStorageBucket: config.objectStorageBucket,
    postgresMode: config.postgresBackupMode,
    retentionDaily: config.retentionDaily,
    retentionWeekly: config.retentionWeekly,
  };
}
