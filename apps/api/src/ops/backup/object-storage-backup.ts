import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type { BackupConfig } from './backup-config';
import type { BackupArtifact } from './backup-types';
import { encryptBuffer, sha256Hex } from './backup-crypto';

type ManifestEntry = {
  relativePath: string;
  sizeBytes: number;
  sha256: string;
};

export type S3BackupClient = {
  send(command: unknown): Promise<unknown>;
};

type ListObjectsResponse = {
  Contents?: Array<{ Key?: string }>;
  IsTruncated?: boolean;
  NextContinuationToken?: string;
};

type GetObjectResponse = {
  Body?: unknown;
};

async function walkFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(root, fullPath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

async function buildManifest(sourceRoot: string, files: string[]): Promise<ManifestEntry[]> {
  const manifest: ManifestEntry[] = [];
  for (const filePath of files) {
    const buffer = await readFile(filePath);
    manifest.push({
      relativePath: relative(sourceRoot, filePath).replace(/\\/g, '/'),
      sizeBytes: buffer.byteLength,
      sha256: sha256Hex(buffer),
    });
  }
  return manifest.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function chunkToBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) {
    return chunk;
  }
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk);
  }
  if (chunk instanceof ArrayBuffer) {
    return Buffer.from(chunk);
  }
  if (typeof chunk === 'string') {
    return Buffer.from(chunk, 'utf8');
  }
  throw new Error('Unsupported S3 backup response body');
}

async function readS3Body(body: unknown): Promise<Buffer> {
  if (!body) {
    return Buffer.alloc(0);
  }
  if (
    typeof body === 'object' &&
    'transformToByteArray' in body &&
    typeof (body as { transformToByteArray?: unknown }).transformToByteArray === 'function'
  ) {
    return Buffer.from(
      await (body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray(),
    );
  }
  if (
    typeof body === 'object' &&
    Symbol.asyncIterator in body &&
    typeof (body as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
  ) {
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<unknown>) {
      chunks.push(chunkToBuffer(chunk));
    }
    return Buffer.concat(chunks);
  }
  return chunkToBuffer(body);
}

function safeSnapshotPath(snapshotDir: string, key: string): string {
  const normalized = key.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`Unsafe S3 object key in backup: ${key}`);
  }
  const root = resolve(snapshotDir);
  const target = resolve(root, ...normalized.split('/'));
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error(`Unsafe S3 object key in backup: ${key}`);
  }
  return target;
}

function createS3Client(config: BackupConfig): S3BackupClient {
  const clientConfig: S3ClientConfig = {
    region: config.objectStorageS3Region,
    forcePathStyle: config.objectStorageS3ForcePathStyle,
  };

  if (config.objectStorageS3Endpoint) {
    clientConfig.endpoint = config.objectStorageS3Endpoint;
  }

  const accessKeyId = config.objectStorageS3AccessKeyId;
  const secretAccessKey = config.objectStorageS3SecretAccessKey;
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new Error('S3 backup credentials must provide both access key id and secret access key');
  }
  if (accessKeyId && secretAccessKey) {
    clientConfig.credentials = { accessKeyId, secretAccessKey };
  }

  return new S3Client(clientConfig);
}

async function snapshotFilesystem(config: BackupConfig, snapshotDir: string): Promise<void> {
  if (!config.objectStorageRoot) {
    throw new Error(
      'OBJECT_STORAGE_ROOT is required when BACKUP_ENABLE_OBJECT_STORAGE=true and OBJECT_STORAGE_PROVIDER=filesystem',
    );
  }

  const sourceFiles = await walkFiles(config.objectStorageRoot);
  for (const sourcePath of sourceFiles) {
    const relativePath = relative(config.objectStorageRoot, sourcePath);
    const targetPath = join(snapshotDir, relativePath);
    await mkdir(join(targetPath, '..'), { recursive: true });
    await copyFile(sourcePath, targetPath);
  }
}

async function snapshotS3(
  config: BackupConfig,
  snapshotDir: string,
  client: S3BackupClient = createS3Client(config),
): Promise<void> {
  const bucket = config.objectStorageBucket?.trim();
  if (!bucket) {
    throw new Error(
      'OBJECT_STORAGE_BUCKET is required when BACKUP_ENABLE_OBJECT_STORAGE=true and OBJECT_STORAGE_PROVIDER=s3',
    );
  }

  let continuationToken: string | undefined;
  do {
    const listed = (await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
      }),
    )) as ListObjectsResponse;

    for (const entry of listed.Contents ?? []) {
      const key = entry.Key;
      if (!key || key.endsWith('/')) {
        continue;
      }
      const targetPath = safeSnapshotPath(snapshotDir, key);
      await mkdir(join(targetPath, '..'), { recursive: true });
      const response = (await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      )) as GetObjectResponse;
      if (!response.Body) {
        throw new Error(`S3 backup object has no body: ${key}`);
      }
      await writeFile(targetPath, await readS3Body(response.Body));
    }

    if (listed.IsTruncated && !listed.NextContinuationToken) {
      throw new Error('S3 backup pagination truncated without continuation token');
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);
}

export async function runObjectStorageBackup(
  config: BackupConfig,
  timestamp: string,
  s3Client?: S3BackupClient,
): Promise<BackupArtifact> {
  const outputDir = join(config.destinationDir, 'object-storage', timestamp);
  const snapshotDir = join(outputDir, 'snapshot');
  await mkdir(snapshotDir, { recursive: true });

  if (config.objectStorageProvider === 's3') {
    await snapshotS3(config, snapshotDir, s3Client);
  } else {
    await snapshotFilesystem(config, snapshotDir);
  }

  const manifest = await buildManifest(snapshotDir, await walkFiles(snapshotDir));
  const manifestPath = join(outputDir, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify({ generatedAt: timestamp, entries: manifest }, null, 2)}\n`);

  const archivePath = join(outputDir, `object-storage-${timestamp}.tar`);
  await createTarArchive(snapshotDir, archivePath);
  await rm(snapshotDir, { recursive: true, force: true });

  let finalPath = archivePath;
  let encrypted = false;
  const plain = await readFile(archivePath);
  const checksum = sha256Hex(plain);

  if (config.encryptionKeyBase64) {
    const encryptedBuffer = encryptBuffer(plain, config.encryptionKeyBase64);
    finalPath = `${archivePath}.enc`;
    await writeFile(finalPath, encryptedBuffer);
    await rm(archivePath, { force: true });
    encrypted = true;
  }

  const fileStats = await stat(finalPath);
  if (config.offsiteDir) {
    const offsiteDir = join(config.offsiteDir, 'object_storage');
    await mkdir(offsiteDir, { recursive: true });
    const offsitePath = join(
      offsiteDir,
      finalPath.split(/[/\\]/).pop() ?? 'artifact',
    );
    await copyFile(finalPath, offsitePath);
    await copyFile(manifestPath, join(offsiteDir, 'manifest.json'));
  }

  return {
    kind: 'object_storage',
    path: finalPath,
    sizeBytes: fileStats.size,
    sha256: checksum,
    encrypted,
  };
}

async function createTarArchive(sourceDir: string, archivePath: string): Promise<void> {
  const { spawn } = await import('node:child_process');
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn('tar', ['-cf', archivePath, '-C', sourceDir, '.'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`tar exited with code ${code}: ${stderr}`));
    });
  });
}

export async function verifyObjectStorageArtifactAccessible(artifactPath: string): Promise<boolean> {
  const stats = await stat(artifactPath);
  return stats.isFile() && stats.size > 0;
}
