import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertReleaseReadyPassed,
  AuthorizationRefusedError,
  authorizePublication,
  selectAuthorizingRun,
} from './select-authorizing-run.mjs';

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);

let nextId = 1000;
function run(overrides = {}) {
  nextId += 1;
  return {
    id: nextId,
    name: 'CI',
    head_branch: 'main',
    head_sha: SHA,
    status: 'completed',
    conclusion: 'success',
    ...overrides,
  };
}

function releaseReady(conclusion = 'success') {
  return [{ name: 'Release ready', status: 'completed', conclusion }];
}

const jobsOk = async () => releaseReady('success');

for (const [label, runs, expected] of [
  ['1. cancelado + verde no mesmo sha escolhe o verde', [
    run({ status: 'completed', conclusion: 'cancelled' }),
    run({ status: 'completed', conclusion: 'success' }),
  ], 'success'],
  ['2. failure + verde no mesmo sha escolhe o verde', [
    run({ status: 'completed', conclusion: 'failure' }),
    run({ status: 'completed', conclusion: 'success' }),
  ], 'success'],
  ['8. Visual full success + CI success escolhe o CI', [
    run({ name: 'Visual full', conclusion: 'success' }),
    run({ name: 'CI', conclusion: 'success' }),
  ], 'success'],
]) {
  test(label, async () => {
    const chosen = selectAuthorizingRun(runs, SHA);
    assert.equal(chosen.name, 'CI');
    assert.equal(chosen.head_sha, SHA);
    assert.equal(chosen.conclusion, expected);
  });
}

for (const [label, runs] of [
  ['3. somente cancelado recusa', [run({ conclusion: 'cancelled' })]],
  ['4. somente failure recusa', [run({ conclusion: 'failure' })]],
  ['5. somente in_progress recusa', [run({ status: 'in_progress', conclusion: null })]],
  ['6. nenhum run recusa', []],
  ['7. Visual full success + CI failure recusa', [
    run({ name: 'Visual full', conclusion: 'success' }),
    run({ name: 'CI', conclusion: 'failure' }),
  ]],
  ['11. CI success com sha diferente recusa', [run({ head_sha: OTHER_SHA })]],
  ['recusa run de CI fora da main', [run({ head_branch: 'feature/x' })]],
]) {
  test(label, () => {
    assert.throws(() => selectAuthorizingRun(runs, SHA), AuthorizationRefusedError);
  });
}

test('9. CI success sem Release ready recusa', () => {
  assert.throws(() => assertReleaseReadyPassed([]), AuthorizationRefusedError);
  assert.throws(
    () => assertReleaseReadyPassed([{ name: 'Unit tests', conclusion: 'success' }]),
    AuthorizationRefusedError,
  );
});

test('10. CI success com Release ready=failure recusa', () => {
  assert.throws(
    () => assertReleaseReadyPassed(releaseReady('failure')),
    AuthorizationRefusedError,
  );
});

test('12. CI success + Release ready success + sha correto autoriza', async () => {
  const result = await authorizePublication([run()], SHA, jobsOk);
  assert.equal(result.sourceSha, SHA);
  assert.ok(result.runId > 0);
});

test('authorizePublication propaga recusa quando o run nao autoriza', async () => {
  await assert.rejects(
    () => authorizePublication([run({ conclusion: 'failure' })], SHA, jobsOk),
    AuthorizationRefusedError,
  );
});

test('prefere o success de maior id quando ha varios', () => {
  const older = run({ id: 10 });
  const newer = run({ id: 50 });
  assert.equal(selectAuthorizingRun([older, newer], SHA).id, 50);
});

test('expectedSha malformado recusa', () => {
  assert.throws(() => selectAuthorizingRun([run()], 'abc'), AuthorizationRefusedError);
});
