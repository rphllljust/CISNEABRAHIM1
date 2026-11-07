import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('workflow topology requires real full Playwright for every PR', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  const visual = readFileSync('.github/workflows/visual-full.yml', 'utf8');
  const controller = readFileSync('.github/workflows/cisne-verified-auto-merge.yml', 'utf8');
  assert.match(ci, /if: github\.event_name == 'pull_request'/);
  assert.match(ci, /all PRs require successful Visual Full/);
  assert.match(ci, /Require actual full Playwright success/);
  assert.match(visual, /pull_request:\s*\n\s*\nconcurrency:/);
  assert.match(visual, /push:\s*\n\s*branches: \[main\]/);
  assert.match(controller, /pull_request_target:/);
  assert.match(controller, /node scripts\/ci\/auto-merge-controller\.mjs/);
});

test('Coolify release must verify exact main Visual Full and refuse stale SHA', () => {
  const release = readFileSync('.github/workflows/coolify-release.yml', 'utf8');
  assert.match(release, /MAIN_VISUAL_VALIDATED=true/);
  assert.match(release, /verifiedPlaywrightLog/);
  assert.match(release, /Refuse obsolete SHA before touching Coolify/);
});

test('recovery includes CI, Visual Full and isolated HML on exact main SHA', () => {
  const controller = readFileSync('scripts/ci/auto-merge-controller.mjs', 'utf8');
  assert.match(controller, /actions\/workflows\/ci\.yml\/dispatches/);
  assert.match(controller, /actions\/workflows\/visual-full\.yml\/dispatches/);
  assert.match(controller, /actions\/workflows\/hml-isolated-e2e\.yml\/dispatches/);
  assert.match(controller, /main\.sha/);
  assert.match(controller, /Serialized promotion: next candidates wait/);
});
