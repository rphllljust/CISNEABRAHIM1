import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  authorizeBusinessRelease,
  BusinessReleaseRefusedError,
} from './verify-business-release-approval.mjs';

const sha = 'ca7c8f0f66bade930d973d6717431d3c8e38dc9b';
const otherSha = 'a'.repeat(40);

test('MASTER 002: missing business approval refuses publication', () => {
  for (const invalid of [undefined, '', ' ', 'approved', 'deadbeef']) {
    assert.throws(() => authorizeBusinessRelease(sha, invalid), BusinessReleaseRefusedError);
  }
});

test('MASTER 002: another commit, even with prior approval, refuses publication', () => {
  assert.throws(() => authorizeBusinessRelease(sha, otherSha), /does not match/);
});

test('MASTER 002: malformed or missing expected SHA refuses publication', () => {
  for (const invalid of ['', undefined, 'abc', 'g'.repeat(40)]) {
    assert.throws(() => authorizeBusinessRelease(invalid, sha), /invalid/);
  }
});

test('MASTER 002: explicit approval accepts only the exact 40-character SHA', () => {
  assert.deepEqual(authorizeBusinessRelease(sha, sha.toUpperCase()), { sourceSha: sha, authorized: true });
});

test('CD release no longer requires SHA-bound business approval or issue comments', () => {
  const release = readFileSync(new URL('../../.github/workflows/coolify-release.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(release, /name: Require explicit business release approval \(exact SHA\)/);
  assert.doesNotMatch(release, /CISNE_BUSINESS_APPROVED_SHA:/);
  assert.doesNotMatch(release, /node scripts\/cd\/verify-business-release-approval\.mjs/);
  assert.doesNotMatch(release, /node scripts\/cd\/verify-owner-business-release-approval\.mjs/);
  const ready = release.indexOf('- id: authority');
  const ghcr = release.indexOf('  publish:');
  assert.ok(ready > 0 && ghcr > ready, 'CI/HML gate must execute before publication');
  assert.match(release, /hml-isolated-e2e\.yml\/runs\?branch=main&head_sha=\$EXPECTED_SHA/);
  assert.match(release, /select-authorizing-run\.mjs/);
  assert.match(release, /ready" != "success"/);
  assert.match(release, /CURRENT_MAIN_SHA" != "\$EXPECTED_SHA"/);
  const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.ok(ci.includes('scripts/cd/verify-business-release-approval.test.mjs'), 'CI must enforce this contract');
});
