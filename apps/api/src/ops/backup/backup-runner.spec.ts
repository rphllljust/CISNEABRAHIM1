import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { randomBytes } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectBackupsForPruning } from './backup-retention';
import { runMonitoredBackup } from './backup-runner';
import { verifyObjectStorageArtifactAccessible } from './object-storage-backup';
import { verifyPostgresArtifactReadable } from './postgres-backup';
import { readBackupStatusSnapshot } from './backup-status-reader';
import { RPO_RTO_PRODUCTION_BLOCKER } from './backup-types';

describe('backup integration (Prompt 84)', () => {
  it('registers DDP-016 as READY_FOR_APPROVAL with technical proposal (not invented approval)', () => {
    expect(RPO_RTO_PRODUCTION_BLOCKER.status).toBe('READY_FOR_APPROVAL');
    expect(RPO_RTO_PRODUCTION_BLOCKER.rpo).toBe('READY_FOR_APPROVAL');
    expect(RPO_RTO_PRODUCTION_BLOCKER.proposalReference).toContain('ddp-016');
  });

  it('runs monitored backup with postgres + object storage artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cisne-backup-run-'));
    const objectRoot = join(root, 'objects');
    const destDir = join(root, 'artifacts');
    const statusFile = join(root, 'status', 'latest.json');
    const offsiteDir = join(root, 'offsite');
    const encryptionKey = randomBytes(32).toString('base64');

    await mkdir(join(objectRoot, 'billing'), { recursive: true });
    await mkdir(join(objectRoot, 'evidence'), { recursive: true });
    await writeFile(join(objectRoot, 'billing', 'invoice.pdf'), Buffer.from('%PDF-billing'));
    await writeFile(join(objectRoot, 'evidence', 'photo.jpg'), Buffer.from('jpeg-evidence'));

    const fakeDumpPath = join(destDir, 'postgres', 'ts', `postgres-ts.dump`);
    await mkdir(join(fakeDumpPath, '..'), { recursive: true });

    const result = await runMonitoredBackup(
      {
        BACKUP_DEST_DIR: destDir,
        BACKUP_STATUS_FILE: statusFile,
        BACKUP_OFFSITE_DIR: offsiteDir,
        BACKUP_ENCRYPTION_KEY: encryptionKey,
        BACKUP_ENABLE_POSTGRES: 'true',
        BACKUP_ENABLE_OBJECT_STORAGE: 'true',
        OBJECT_STORAGE_ROOT: objectRoot,
        DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/cisne',
        BACKUP_POSTGRES_MODE: 'pg_dump',
      },
      {
        now: () => new Date('2026-08-30T12:00:00.000Z'),
        runCommand: async (_command, args) => {
          const outputFlagIndex = args.indexOf('-f');
          const outputPath = outputFlagIndex >= 0 ? (args[outputFlagIndex + 1] ?? fakeDumpPath) : fakeDumpPath;
          await mkdir(join(outputPath, '..'), { recursive: true });
          await writeFile(outputPath, Buffer.from('PGDMP-fake-backup'));
          return { stdout: '', stderr: '' };
        },
      },
    );

    expect(result.status).toBe('ok');
    expect(result.artifacts).toHaveLength(2);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    const postgresArtifact = result.artifacts.find((artifact) => artifact.kind === 'postgres');
    const objectArtifact = result.artifacts.find((artifact) => artifact.kind === 'object_storage');
    expect(postgresArtifact?.encrypted).toBe(true);
    expect(objectArtifact?.encrypted).toBe(true);

    const snapshot = readBackupStatusSnapshot({ BACKUP_STATUS_FILE: statusFile });
    expect(snapshot.status).toBe('ok');
    expect(snapshot.artifactCount).toBe(2);
    expect(snapshot.sizeBytes).toBeGreaterThan(0);

    expect(await verifyPostgresArtifactReadable(postgresArtifact!, encryptionKey)).toBe(true);
    expect(await verifyObjectStorageArtifactAccessible(objectArtifact!.path)).toBe(true);

    const objectArtifactDir = join(objectArtifact!.path, '..');
    await expect(access(join(objectArtifactDir, 'snapshot'))).rejects.toThrow();
    await expect(
      access(objectArtifact!.path.replace(/\.enc$/, '')),
    ).rejects.toThrow();
    await expect(access(join(offsiteDir, 'object_storage', 'manifest.json'))).resolves.toBeUndefined();

    const statusRaw = await readFile(statusFile, 'utf8');
    expect(statusRaw).toContain('"durationMs"');
    expect(statusRaw).toContain('"sha256"');

    await rm(root, { recursive: true, force: true });
  });

  it('backs up S3 object storage instead of silently skipping it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cisne-backup-s3-'));
    const statusFile = join(root, 'status', 'latest.json');
    const sent: unknown[] = [];

    const result = await runMonitoredBackup(
      {
        BACKUP_DEST_DIR: join(root, 'artifacts'),
        BACKUP_STATUS_FILE: statusFile,
        BACKUP_ENABLE_POSTGRES: 'false',
        BACKUP_ENABLE_OBJECT_STORAGE: 'true',
        OBJECT_STORAGE_PROVIDER: 's3',
        OBJECT_STORAGE_BUCKET: 'cisne-prod-documents',
      },
      {
        s3Client: {
          send: async (command) => {
            sent.push(command);
            if (command instanceof ListObjectsV2Command) {
              return {
                Contents: [{ Key: 'objects/a.pdf' }, { Key: 'nested/evidence/photo.jpg' }],
                IsTruncated: false,
              };
            }
            if (command instanceof GetObjectCommand) {
              return {
                Body: {
                  transformToByteArray: async () => new Uint8Array(Buffer.from('s3-object')),
                },
              };
            }
            throw new Error('unexpected S3 command');
          },
        },
      },
    );

    expect(result.status).toBe('ok');
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]?.kind).toBe('object_storage');
    expect(sent.filter((command) => command instanceof ListObjectsV2Command)).toHaveLength(1);
    expect(sent.filter((command) => command instanceof GetObjectCommand)).toHaveLength(2);

    await rm(root, { recursive: true, force: true });
  });

  it('fails closed when object-storage backup is enabled but its source is not configured', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cisne-backup-storage-missing-'));
    const statusFile = join(root, 'status', 'latest.json');

    const result = await runMonitoredBackup({
      BACKUP_DEST_DIR: join(root, 'artifacts'),
      BACKUP_STATUS_FILE: statusFile,
      BACKUP_ENABLE_POSTGRES: 'false',
      BACKUP_ENABLE_OBJECT_STORAGE: 'true',
      OBJECT_STORAGE_PROVIDER: 's3',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('OBJECT_STORAGE_BUCKET');

    await rm(root, { recursive: true, force: true });
  });

  it('records failure status without throwing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cisne-backup-fail-'));
    const statusFile = join(root, 'status', 'latest.json');

    const result = await runMonitoredBackup(
      {
        BACKUP_DEST_DIR: join(root, 'artifacts'),
        BACKUP_STATUS_FILE: statusFile,
        BACKUP_ENABLE_POSTGRES: 'true',
        BACKUP_ENABLE_OBJECT_STORAGE: 'false',
        BACKUP_POSTGRES_MODE: 'pg_dump',
        DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/cisne',
      },
      {
        runCommand: async () => {
          throw new Error('pg_dump unavailable');
        },
      },
    );

    expect(result.status).toBe('failed');
    expect(result.error).toContain('pg_dump unavailable');
    const snapshot = readBackupStatusSnapshot({ BACKUP_STATUS_FILE: statusFile });
    expect(snapshot.status).toBe('failed');

    await rm(root, { recursive: true, force: true });
  });

  it('prunes engineering retention without touching legal retention policy', () => {
    const entries = [
      { path: '/a/1', mtimeMs: 3 },
      { path: '/a/2', mtimeMs: 2 },
      { path: '/a/3', mtimeMs: 1 },
    ];
    const pruned = selectBackupsForPruning(entries, 2);
    expect(pruned).toHaveLength(1);
    expect(pruned[0]?.path).toBe('/a/3');
  });
});
