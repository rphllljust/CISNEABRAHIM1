import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..', '..');

test('production delivery has no active Railway provider path', () => {
  for (const path of [
    '.github/workflows/cd.yml',
    'docker/railway',
    'scripts/cd/railway-ensure-hml.mjs',
    'scripts/cd/railway-production-deploy.mjs',
    'scripts/cd/railway-immutable-release.mjs',
  ]) {
    assert.equal(existsSync(resolve(root, path)), false, `legacy provider path still exists: ${path}`);
  }

  const ci = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8');
  const release = readFileSync(resolve(root, '.github/workflows/coolify-release.yml'), 'utf8');

  assert.equal(ci.includes('artifacts/railway'), false);
  assert.equal(release.includes('artifacts/railway'), false);
  assert.equal(release.includes('docker/railway'), false);
  assert.equal(release.includes('RAILWAY_'), false);
  assert.match(release, /Deploy authorized digests to Coolify/);
});
