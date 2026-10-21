import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');

function walkFiles(current) {
  const entries = readdirSync(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function computeArtifactDigest(artifactPaths) {
  const hash = createHash('sha256');
  const files = artifactPaths
    .flatMap((path) => {
      const stats = statSync(path);
      return stats.isDirectory() ? walkFiles(path) : [path];
    })
    .sort((left, right) => left.localeCompare(right));

  for (const file of files) {
    hash.update(relative(root, file).replace(/\\/g, '/'));
    hash.update(readFileSync(file));
  }
  return `sha256:${hash.digest('hex')}`;
}

const artifactPaths = [
  resolve(root, 'apps/api/dist'),
  resolve(root, 'apps/web/dist'),
  resolve(root, 'packages/database/dist'),
  resolve(root, 'packages/database/migrations'),
  resolve(root, 'package.json'),
  resolve(root, 'pnpm-workspace.yaml'),
  resolve(root, 'pnpm-lock.yaml'),
  resolve(root, 'apps/api/package.json'),
  resolve(root, 'apps/web/package.json'),
  resolve(root, 'packages/database/package.json'),
  resolve(root, 'packages/eslint-config/package.json'),
  resolve(root, 'packages/tsconfig/package.json'),
  resolve(root, 'docker/release/Dockerfile.api'),
  resolve(root, 'docker/release/Dockerfile.web'),
  resolve(root, 'docker/railway/nginx.conf'),
];

const buildMetadataPath = resolve(root, 'artifacts/ci/build-metadata.json');
const buildMetadata = JSON.parse(readFileSync(buildMetadataPath, 'utf8'));

const manifest = {
  version: '0.0.0',
  commitSha: buildMetadata.commitSha,
  artifactDigest: computeArtifactDigest(artifactPaths),
  buildRunId: buildMetadata.buildRunId,
  timestamp: buildMetadata.timestamp,
  environment: 'ci',
};

const outputDir = resolve(root, 'artifacts/cd');
mkdirSync(outputDir, { recursive: true });
writeFileSync(resolve(outputDir, 'deploy-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Deploy manifest: ${manifest.artifactDigest}`);
