import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolveArtifactPaths } from './cd-paths';
import { assertNoInlineSecrets } from '../../platform/runtime-config/secret-value';

const SECRET_PATTERNS = [
  /JWT_SECRET\s*=\s*['"][^'"]{8,}['"]/i,
  /password\s*[:=]\s*['"][^'"]{8,}['"]/i,
  /BEGIN (RSA |EC )?PRIVATE KEY/,
  /AKIA[0-9A-Z]{16}/,
];

function walkFiles(root: string, current = root): string[] {
  const entries = readdirSync(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(root, fullPath));
      continue;
    }
    if (entry.isFile() && (fullPath.endsWith('.js') || fullPath.endsWith('.json'))) {
      files.push(fullPath);
    }
  }
  return files;
}

export function scanArtifactPathsForSecrets(artifactPaths: string[]): string[] {
  const violations: string[] = [];
  for (const path of resolveArtifactPaths(artifactPaths)) {
    const stats = statSync(path);
    const files = stats.isDirectory() ? walkFiles(path) : [path];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.test(content)) {
          violations.push(file);
          break;
        }
      }
    }
  }
  return violations;
}

export function assertNoSecretsInArtifact(artifactPaths: string[]): void {
  const violations = scanArtifactPathsForSecrets(artifactPaths);
  if (violations.length > 0) {
    throw new Error(`Secrets detected in build artifact: ${violations.join(', ')}`);
  }
}

export function assertSecretsFromStoreOnly(env: NodeJS.ProcessEnv = process.env): void {
  if (env['PROD_REQUIRE_SECRET_STORE'] !== 'true') {
    throw new Error(
      'Production promotion requires PROD_REQUIRE_SECRET_STORE=true; inline-secret mode is not allowed',
    );
  }

  if (env['CD_SECRET_STORE_CONFIGURED'] !== 'true') {
    throw new Error(
      'Production promotion requires CD_SECRET_STORE_CONFIGURED=true from the protected production environment',
    );
  }

  assertNoInlineSecrets(env, [
    'JWT_SECRET',
    'DOCUMENT_DOWNLOAD_TOKEN_SECRET',
    'DATABASE_URL',
    'BACKUP_ENCRYPTION_KEY',
    'OBJECT_STORAGE_S3_SECRET_ACCESS_KEY',
    'S3_SECRET_ACCESS_KEY',
    'PROD_POSTGRES_PASSWORD',
  ]);
}
