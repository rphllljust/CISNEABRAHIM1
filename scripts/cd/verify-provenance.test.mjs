import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { computeArtifactDigest, verifyProvenance } from './verify-provenance.mjs';

const SHA = '0123456789abcdef0123456789abcdef01234567';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cisne-provenance-'));
  for (const path of ['apps/api/dist', 'apps/web/dist', 'packages/database/dist', 'artifacts/ci', 'artifacts/cd', 'artifacts/release']) {
    mkdirSync(join(root, path), { recursive: true });
  }
  writeFileSync(join(root, 'apps/api/dist/main.js'), 'api');
  writeFileSync(join(root, 'apps/web/dist/index.html'), 'web');
  writeFileSync(join(root, 'packages/database/dist/index.js'), 'db');
  writeFileSync(join(root, 'artifacts/release/runtime.txt'), 'immutable-release');
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
    // O digest cobre `DEFAULT_ARTIFACT_PATHS` (artifacts/release), que e o que o
    // release imutavel consome — nao os diretorios de build das apps. Mutar
    // `apps/web/dist` nao altera o digest por contrato; e preciso mutar um
    // arquivo DENTRO do caminho coberto para provar a deteccao.
    writeFileSync(join(root, 'artifacts/release/runtime.txt'), 'mutated-after-build');
    assert.throws(() => verifyProvenance({ root, expectedSourceSha: SHA }), /Artifact digest mismatch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('mutation outside the covered artifact path does not change the digest', () => {
  const { root, artifactDigest } = fixture();
  try {
    writeFileSync(join(root, 'apps/web/dist/index.html'), 'mutated');
    // Contrato explicito: `apps/web/dist` nao esta em DEFAULT_ARTIFACT_PATHS.
    assert.equal(computeArtifactDigest(root), artifactDigest);
    const result = verifyProvenance({ root, expectedSourceSha: SHA });
    assert.equal(result.artifactDigest, artifactDigest);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
