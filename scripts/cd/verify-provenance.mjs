import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_ARTIFACT_PATHS = [
  'apps/api/dist',
  'apps/web/dist',
  'packages/database/dist',
];

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

export function computeArtifactDigest(root, artifactPaths = DEFAULT_ARTIFACT_PATHS) {
  const hash = createHash('sha256');
  const files = artifactPaths
    .map((path) => resolve(root, path))
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

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function verifyProvenance({
  root = process.cwd(),
  expectedSourceSha,
  expectedArtifactDigest,
  checkoutSha,
} = {}) {
  const buildMetadata = readJson(resolve(root, 'artifacts/ci/build-metadata.json'));
  const manifest = readJson(resolve(root, 'artifacts/cd/deploy-manifest.json'));
  const sourceSha = manifest.commitSha;

  if (typeof sourceSha !== 'string' || !/^[0-9a-f]{40}$/i.test(sourceSha)) {
    throw new Error(`Invalid MANIFEST_SHA: ${String(sourceSha)}`);
  }
  if (buildMetadata.commitSha !== sourceSha) {
    throw new Error(
      `SOURCE_SHA/BUILD_SHA/MANIFEST_SHA mismatch: build=${String(buildMetadata.commitSha)} manifest=${sourceSha}`,
    );
  }
  if (expectedSourceSha && expectedSourceSha !== sourceSha) {
    throw new Error(
      `SOURCE_SHA/BUILD_SHA/MANIFEST_SHA mismatch: source=${expectedSourceSha} manifest=${sourceSha}`,
    );
  }
  if (checkoutSha && checkoutSha !== sourceSha) {
    throw new Error(
      `Checkout SHA mismatch: checkout=${checkoutSha} manifest=${sourceSha}`,
    );
  }
  if (buildMetadata.buildRunId !== manifest.buildRunId) {
    throw new Error(
      `Build run mismatch: metadata=${String(buildMetadata.buildRunId)} manifest=${String(manifest.buildRunId)}`,
    );
  }
  if (manifest.environment !== 'ci') {
    throw new Error(`Expected CI source manifest, got environment=${String(manifest.environment)}`);
  }

  const artifactDigest = computeArtifactDigest(root);
  if (manifest.artifactDigest !== artifactDigest) {
    throw new Error(
      `Artifact digest mismatch: manifest=${String(manifest.artifactDigest)} actual=${artifactDigest}`,
    );
  }
  if (expectedArtifactDigest && expectedArtifactDigest !== artifactDigest) {
    throw new Error(
      `Promotion digest mismatch: expected=${expectedArtifactDigest} actual=${artifactDigest}`,
    );
  }

  return {
    sourceSha,
    buildSha: buildMetadata.commitSha,
    artifactDigest,
    buildRunId: manifest.buildRunId,
  };
}

function currentCheckoutSha() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

function writeGithubOutputs(result) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  appendFileSync(
    outputPath,
    [
      `source_sha=${result.sourceSha}`,
      `build_sha=${result.buildSha}`,
      `artifact_digest=${result.artifactDigest}`,
      `build_run_id=${result.buildRunId}`,
      '',
    ].join('\n'),
    'utf8',
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = verifyProvenance({
    expectedSourceSha: process.env.PROVENANCE_EXPECTED_SHA || undefined,
    expectedArtifactDigest: process.env.PROVENANCE_EXPECTED_DIGEST || undefined,
    checkoutSha:
      process.env.PROVENANCE_VERIFY_CHECKOUT === 'true' ? currentCheckoutSha() : undefined,
  });
  writeGithubOutputs(result);
  console.log(`[provenance] source=${result.sourceSha} digest=${result.artifactDigest}`);
}
