import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeArtifactDigest, DEFAULT_ARTIFACT_PATHS } from './verify-provenance.mjs';
import { prepareImmutableRailwayRelease } from './railway-immutable-release.mjs';

function write(root, path, content = path) {
  const target = resolve(root, path);
  mkdirSync(resolve(target, '..'), { recursive: true });
  writeFileSync(target, content);
}

test('immutable Railway release copies only sealed runtime inputs and preserves digest', () => {
  const root = mkdtempSync(join(tmpdir(), 'cisne-release-src-'));
  for (const path of DEFAULT_ARTIFACT_PATHS) {
    if (path.endsWith('/dist') || path.endsWith('/migrations')) {
      write(root, `${path}/fixture.txt`, path);
    } else {
      write(root, path, path);
    }
  }
  write(root, 'apps/api/src/forbidden.ts', 'must-not-ship');

  const sha = '1234567890abcdef1234567890abcdef12345678';
  const digest = computeArtifactDigest(root);
  write(root, 'artifacts/ci/build-metadata.json', JSON.stringify({
    commitSha: sha,
    buildRunId: '77',
    timestamp: '2026-10-21T00:00:00.000Z'
  }));
  write(root, 'artifacts/cd/deploy-manifest.json', JSON.stringify({
    version: '0.0.0',
    commitSha: sha,
    artifactDigest: digest,
    buildRunId: '77',
    timestamp: '2026-10-21T00:00:00.000Z',
    environment: 'ci'
  }));

  const output = mkdtempSync(join(tmpdir(), 'cisne-release-out-'));
  const result = prepareImmutableRailwayRelease({ root, output });

  assert.equal(result.sourceSha, sha);
  assert.equal(result.artifactDigest, digest);
  assert.equal(existsSync(resolve(output, 'apps/api/src/forbidden.ts')), false);
});
