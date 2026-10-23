import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { packageImmutableRelease, RELEASE_INPUTS } from './immutable-release.mjs';

function write(root, path, content = path) {
  const target = resolve(root, path);
  mkdirSync(resolve(target, '..'), { recursive: true });
  writeFileSync(target, content);
}

test('packages only immutable runtime inputs under provider-neutral release paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'cisne-release-src-'));
  for (const path of RELEASE_INPUTS) {
    if (path.endsWith('/dist') || path.endsWith('/migrations')) {
      write(root, `${path}/fixture.txt`, path);
    } else {
      write(root, path, path);
    }
  }
  write(root, 'docker/release/Dockerfile.api', 'FROM node:24-alpine\n');
  write(root, 'docker/release/Dockerfile.web', 'FROM nginx:1.27-alpine\n');
  write(root, 'apps/api/src/forbidden.ts', 'must-not-ship');
  write(
    root,
    'artifacts/ci/build-metadata.json',
    JSON.stringify({
      commitSha: '1234567890abcdef1234567890abcdef12345678',
      buildRunId: '77',
    }),
  );

  const output = mkdtempSync(join(tmpdir(), 'cisne-release-out-'));
  packageImmutableRelease({ root, output });

  assert.equal(existsSync(resolve(output, 'apps/api/src/forbidden.ts')), false);
  assert.equal(existsSync(resolve(output, 'docker/release/Dockerfile.api')), true);
  assert.equal(existsSync(resolve(output, 'docker/release/Dockerfile.web')), true);
  assert.equal(existsSync(resolve(output, 'docker/release/nginx.conf')), true);
  assert.equal(existsSync(resolve(output, 'artifacts/release-identity.json')), true);
});
