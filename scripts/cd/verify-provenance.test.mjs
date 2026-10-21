import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { computeArtifactDigest, verifyProvenance } from './verify-provenance.mjs';

const SHA = '0123456789abcdef0123456789abcdef01234567';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cisne-provenance-'));
  for (const path of ['apps/api/dist', 'apps/web/dist', 'packages/database/dist', 'artifacts/ci', 'artifacts/cd']) {
    mkdirSync(join(root, path), { recursive: true });
  }
  writeFileSync(join(root, 'apps/api/dist/main.js'), 'api');
  writeFileSync(join(root, 'apps/web/dist/index.html'), 'web');
  writeFileSync(join(root, 'packages/database/dist/index.js'), 'db');
  const metadata = { commitSha: SHA, buildRunId: '42' };
  writeFileSync(join(root, 'artifacts/ci/build-metadata.json'), JSON.stringify(metadata));
  const artifactDigest = computeArtifactDigest(root);
  const manifest = {
    version: '0.0.0',
    commitSha: SHA,
    artifactDigest,
    buildRunId: '42',
    timestamp: '2026-10-21T00:00:00.000Z',
    environment: 'ci',
  };
  writeFileSync(join(root, 'artifacts/cd/deploy-manifest.json'), JSON.stringify(manifest));
  return { root, artifactDigest };
}

test('accepts identical source, build, manifest SHA and artifact digest', () => {
  const { root, artifactDigest } = fixture();
  try {
    const result = verifyProvenance({
      root,
      expectedSourceSha: SHA,
      expectedArtifactDigest: artifactDigest,
      checkoutSha: SHA,
    });
    assert.equal(result.sourceSha, SHA);
    assert.equal(result.buildSha, SHA);
    assert.equal(result.artifactDigest, artifactDigest);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects SHA divergence', () => {
  const { root } = fixture();
  try {
    const metadataPath = join(root, 'artifacts/ci/build-metadata.json');
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
    metadata.commitSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    writeFileSync(metadataPath, JSON.stringify(metadata));
    assert.throws(() => verifyProvenance({ root, expectedSourceSha: SHA }), /mismatch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects artifact mutation after build', () => {
  const { root } = fixture();
  try {
    writeFileSync(join(root, 'apps/web/dist/index.html'), 'mutated');
    assert.throws(() => verifyProvenance({ root, expectedSourceSha: SHA }), /Artifact digest mismatch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
