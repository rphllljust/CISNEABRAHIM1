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

test('CD workflow checks independent business authority before Release ready and GHCR', () => {
  const release = readFileSync(new URL('../../.github/workflows/coolify-release.yml', import.meta.url), 'utf8');
  const approval = release.indexOf('name: Require explicit business release approval (exact SHA)');
  const ready = release.indexOf('- id: authority');
  const ghcr = release.indexOf('  publish:');
  assert.ok(approval > 0 && ready > approval && ghcr > ready, 'business gate must run first');
  assert.match(release, /CISNE_BUSINESS_APPROVED_SHA:\s*\$\{\{ vars\.CISNE_BUSINESS_APPROVED_SHA \}\}/);
  assert.match(release, /run: node scripts\/cd\/verify-business-release-approval\.mjs/);
  const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.ok(ci.includes('scripts/cd/verify-business-release-approval.test.mjs'), 'CI must enforce this contract');
});
