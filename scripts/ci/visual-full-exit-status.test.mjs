import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync('.github/workflows/visual-full.yml', 'utf8');

test('Visual Full preserves Playwright exit status through tee', () => {
  const job = workflow.match(/- name: Web visual regression \(full suite\)([\s\S]*?)- name: Upload visual regression diagnostics/);
  assert.ok(job, 'Visual Full job must exist');
  assert.match(job[1], /shell: bash/);
  assert.match(job[1], /set -euo pipefail/);
  assert.match(job[1], /pnpm --filter @cisne\/web test:visual 2>&1 \| tee artifacts\/ci\/web-visual\.log/);
  assert.match(job[1], /continue-on-error: true/, 'diagnostics must still upload; ratchet is authoritative');
});

test('bash pipefail propagates failed Playwright process, not successful tee', () => {
  const check = spawnSync('bash', ['-c', 'set -euo pipefail; bash -c "exit 17" 2>&1 | tee /dev/null'], {
    encoding: 'utf8',
  });
  assert.equal(check.status, 17);
});

test('bash pipefail preserves a successful Playwright-equivalent pipeline', () => {
  const check = spawnSync('bash', ['-c', 'set -euo pipefail; bash -c "exit 0" 2>&1 | tee /dev/null'], {
    encoding: 'utf8',
  });
  assert.equal(check.status, 0);
});
