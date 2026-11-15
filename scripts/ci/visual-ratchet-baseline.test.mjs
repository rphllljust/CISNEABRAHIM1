import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveVisualBaselineSha, selectVisualBaselineRun } from './visual-ratchet-baseline.mjs';

const base = 'a'.repeat(40);
const current = 'b'.repeat(40);

test('PR e push usam o SHA exato anterior; schedule e dispatch usam o SHA atual', () => {
  assert.equal(resolveVisualBaselineSha('pull_request', { pull_request: { base: { sha: base } } }, current), base);
  assert.equal(resolveVisualBaselineSha('push', { before: base }, current), base);
  assert.equal(resolveVisualBaselineSha('schedule', {}, current), current);
  assert.equal(resolveVisualBaselineSha('workflow_dispatch', {}, current), current);
});

test('SHA ausente ou zerado nao vira baseline verde', () => {
  assert.throws(() => resolveVisualBaselineSha('schedule', {}, undefined), /failing closed/);
  assert.throws(() => resolveVisualBaselineSha('push', { before: '0'.repeat(40) }, current), /failing closed/);
  assert.throws(() => resolveVisualBaselineSha('issues', {}, current), /Unsupported event/);
});

test('somente execucao Visual full completa no SHA exato e anterior serve de baseline', () => {
  const runs = [
    { id: 4, name: 'Visual full', head_sha: current, status: 'completed' },
    { id: 3, name: 'Visual full', head_sha: current, status: 'completed' },
    { id: 2, name: 'Visual full', head_sha: base, status: 'completed' },
    { id: 5, name: 'Visual full', head_sha: current, status: 'in_progress' },
  ];
  assert.equal(selectVisualBaselineRun(runs, current, 4)?.id, 3);
  assert.equal(selectVisualBaselineRun(runs, current, 3)?.id, 4);
  assert.equal(selectVisualBaselineRun(runs, current, 999)?.id, 4);
  assert.equal(selectVisualBaselineRun(runs, 'c'.repeat(40), 999), undefined);
});
