import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCoolifyDeployPayload } from './coolify-deploy-payload.mjs';

const sha = '1'.repeat(40);
const artifactDigest = `sha256:${'2'.repeat(64)}`;
const apiImage = `ghcr.io/rphllljust/cisne-api@sha256:${'3'.repeat(64)}`;
const webImage = `ghcr.io/rphllljust/cisne-web@sha256:${'4'.repeat(64)}`;

test('builds immutable Coolify payload with worker pinned to API image', () => {
  const payload = buildCoolifyDeployPayload({
    sourceSha: sha,
    artifactDigest,
    apiImage,
    webImage,
  });
  assert.equal(payload.sourceSha, sha);
  assert.equal(payload.images.api, apiImage);
  assert.equal(payload.images.worker, apiImage);
  assert.equal(payload.images.web, webImage);
  assert.equal(payload.runtime.api.healthPath, '/api/v1/health/ready');
  assert.deepEqual(payload.runtime.worker.command, [
    'node',
    'apps/api/dist/worker/main.js',
  ]);
  assert.deepEqual(payload.runtime.worker.requiredEnvironment, [
    'ALERT_SCAN_ENABLED',
  ]);
  assert.deepEqual(payload.runtime.web.requiredEnvironment, [
    'CISNE_PUBLIC_API_URL',
  ]);
});

for (const [name, patch] of [
  ['short source SHA', { sourceSha: 'abc123' }],
  ['malformed artifact digest', { artifactDigest: 'sha256:1234' }],
  ['latest API image', { apiImage: 'ghcr.io/rphllljust/cisne-api:latest' }],
  ['mutable API tag', { apiImage: 'ghcr.io/rphllljust/cisne-api:abc123' }],
  ['API image without digest', { apiImage: 'ghcr.io/rphllljust/cisne-api' }],
  ['malformed API digest', { apiImage: 'ghcr.io/rphllljust/cisne-api@sha256:1234' }],
  ['latest Web image', { webImage: 'ghcr.io/rphllljust/cisne-web:latest' }],
  ['mutable Web tag', { webImage: 'ghcr.io/rphllljust/cisne-web:abc123' }],
  ['Web image without digest', { webImage: 'ghcr.io/rphllljust/cisne-web' }],
]) {
  test(`rejects ${name}`, () => {
    assert.throws(() =>
      buildCoolifyDeployPayload({
        sourceSha: sha,
        artifactDigest,
        apiImage,
        webImage,
        ...patch,
      }),
    );
  });
}
