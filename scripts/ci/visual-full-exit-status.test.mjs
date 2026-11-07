import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync('.github/workflows/visual-full.yml', 'utf8');
const ciWorkflow = readFileSync('.github/workflows/ci.yml', 'utf8');

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

test('Visual ratchet uses exact-SHA standalone Visual Full baseline (not CI Build)', () => {
  const ratchet = readFileSync('scripts/ci/visual-regression-ratchet.mjs', 'utf8');
  assert.match(ratchet, /run\.name === 'Visual full'/);
  assert.match(ratchet, /job\.name === 'Visual full'/);
  assert.match(ratchet, /run\.head_sha === baselineSha/);
  assert.doesNotMatch(ratchet, /job\.name === 'Build \/ artifacts'/);
  assert.doesNotMatch(ratchet, /No completed CI push run found/);
});


test('strict Visual Full acceptance gate is independent of the regression ratchet', () => {
  assert.match(workflow, /- name: Enforce strict Visual Full acceptance/);
  const gate = workflow.split('- name: Enforce strict Visual Full acceptance')[1];
  assert.match(gate, /if: always\(\)/);
  assert.match(gate, /VISUAL_OUTCOME: \$\{\{ steps\.web-visual\.outcome \}\}/);
  assert.match(gate, /VISUAL_OUTCOME.*!=.*success/);
  assert.match(gate, /exit 1/);
});

test('strict Visual Full acceptance fails for failed, skipped or missing outcomes', () => {
  const script = 'if [[ "${VISUAL_OUTCOME}" != "success" ]]; then exit 1; fi';
  for (const outcome of ['failure', 'skipped', '']) {
    const check = spawnSync('bash', ['-c', script], {
      encoding: 'utf8',
      env: { ...process.env, VISUAL_OUTCOME: outcome },
    });
    assert.equal(check.status, 1, `outcome=${outcome || '(missing)'}`);
  }
  const passing = spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: { ...process.env, VISUAL_OUTCOME: 'success' },
  });
  assert.equal(passing.status, 0);
});

test('CI pull-request Visual Full preserves Playwright exit status and strictly rejects failure', () => {
  const job = ciWorkflow.match(/  visual-full:\n([\s\S]*?)\n  release-ready:/);
  assert.ok(job, 'CI pull-request Visual Full job must exist');

  const visualStep = job[1].match(/- name: Web visual regression \(full suite\)([\s\S]*?)- name: Upload visual regression diagnostics/);
  assert.ok(visualStep, 'CI must execute and report the Playwright pipeline');
  assert.match(visualStep[1], /shell: bash/);
  assert.match(visualStep[1], /set -euo pipefail/);
  assert.match(visualStep[1], /pnpm --filter @cisne\/web test:visual 2>&1 \| tee artifacts\/ci\/web-visual\.log/);
  assert.match(visualStep[1], /continue-on-error: true/);

  const acceptance = job[1].split('- name: Enforce strict Visual Full acceptance')[1];
  assert.ok(acceptance, 'CI must not substitute accepted regression debt for a passing suite');
  assert.match(acceptance, /if: always\(\)/);
  assert.match(acceptance, /VISUAL_OUTCOME: \$\{\{ steps\.web-visual\.outcome \}\}/);
  assert.match(acceptance, /VISUAL_OUTCOME.*!=.*success/);
  assert.match(acceptance, /exit 1/);
});

test('CI always runs the Visual Full exit-status contract even when the visual job is skipped', () => {
  const staticQuality = ciWorkflow.match(/  static-quality:\n([\s\S]*?)\n  unit-test-shards:/);
  assert.ok(staticQuality);
  assert.match(staticQuality[1], /node --test scripts\/ci\/visual-full-exit-status\.test\.mjs/);
});

test('CI detects visual harness edits and fails closed when git diff errors', () => {
  const detector = ciWorkflow.match(/  detect-change-scope:\n([\s\S]*?)\n  visual-critical:/);
  assert.ok(detector, 'CI change scope classifier must exist');

  const visualPattern = detector[1].match(/visual='([^']+)'/);
  assert.ok(visualPattern, 'CI classifier visual regex must exist');
  const isVisualRisk = new RegExp(visualPattern[1]);
  for (const path of [
    '.github/workflows/ci.yml',
    '.github/workflows/visual-full.yml',
    'scripts/ci/visual-full-exit-status.test.mjs',
    'apps/web/e2e/fixtures/accounting-api-routes.ts',
    'apps/web/src/AppRoutes.tsx',
  ]) {
    assert.equal(isVisualRisk.test(path), true, path);
  }
  assert.equal(isVisualRisk.test('docs/README.md'), false);
  assert.ok(
    detector[1].includes('if ! files="$(git diff --name-only "$range")"; then'),
    'failed git diff must not be interpreted as an empty diff',
  );
  assert.match(detector[1], /Unable to calculate changed paths/);
  assert.match(detector[1], /exit 1/);
});
