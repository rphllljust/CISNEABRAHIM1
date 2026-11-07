import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REQUIRED_CI_JOBS,
  latestExactRun,
  requiredJobsPassed,
  verifiedPlaywrightLog,
  isProtectedAutomationPath,
} from './auto-merge-contract.mjs';

test('false-green Visual Full with 174 failed / 115 passed is rejected', () => {
  assert.equal(verifiedPlaywrightLog('  174 failed\\n  11 skipped\\n  115 passed\\nExit status 1'), false);
  assert.equal(verifiedPlaywrightLog('174 failed\n115 passed\nExit status 1'), false);
});
test('a real Playwright summary is mandatory', () => {
  assert.equal(verifiedPlaywrightLog('  289 passed (10m)\n'), true);
  assert.equal(verifiedPlaywrightLog('job successful, no suite executed'), false);
  assert.equal(verifiedPlaywrightLog('10 passed\nProcess completed with exit code 1'), false);
  assert.equal(verifiedPlaywrightLog('10 passed\nVisual Full acceptance blocked'), false);
  assert.equal(verifiedPlaywrightLog('0 failed\n10 passed'), true);
});
test('skipped/absent/duplicated required jobs cannot authorize merge', () => {
  const jobs = REQUIRED_CI_JOBS.map((name) => ({name, status: 'completed', conclusion: 'success'}));
  assert.equal(requiredJobsPassed(jobs), true);
  assert.equal(requiredJobsPassed(jobs.filter((j) => j.name !== 'Visual full')), false);
  assert.equal(requiredJobsPassed([...jobs, jobs[0]]), false);
  assert.equal(requiredJobsPassed(jobs.map((j) => j.name === 'Visual full' ? {...j, conclusion: 'skipped'} : j)), false);
});
test('reject stale/foreign workflow runs and prefer latest exact one', () => {
  const mk = (id, head_sha, name = 'Visual full', event = 'pull_request') =>
    ({id, head_sha, name, event, head_repository: {full_name: 'rphllljust/CISNEABRAHIM1'}});
  const run = latestExactRun([mk(1, 'a'), mk(7, 'a'), mk(9, 'b'), mk(10, 'a', 'CI'), mk(11, 'a', 'Visual full', 'push')], 'Visual full', 'a');
  assert.equal(run?.id, 7);
});
test('workflow and gate changes require separate review', () => {
  assert.equal(isProtectedAutomationPath('.github/workflows/ci.yml'), true);
  assert.equal(isProtectedAutomationPath('scripts/ci/visual-regression-ratchet.mjs'), true);
  assert.equal(isProtectedAutomationPath('scripts/cd/coolify-deploy.mjs'), true);
  assert.equal(isProtectedAutomationPath('apps/web/src/finance/PayablesListPage.tsx'), false);
});
