import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseVisualFailures, stableVisualFailureId } from './visual-regression-parser.mjs';

test('reads failed Playwright IDs but excludes a flaky list after failures', () => {
  const log = [
    '2026-11-06T12:57:30.6585545Z   2 failed',
    '2026-11-06T12:57:30.6587000Z     [mobile] › e2e/visual/clients.visual.spec.ts › clients visual › populated clients list',
    '2026-11-06T12:57:30.6587500Z     [desktop] › e2e/visual/fleet.visual.spec.ts › fleet visual › populated fleet',
    '2026-11-06T12:57:30.6653935Z   1 flaky',
    '2026-11-06T12:57:30.6654390Z     [desktop] › e2e/visual/geometry.visual.spec.ts:146:5 › suppliers flaky',
    '2026-11-06T12:57:30.6654468Z   11 skipped',
    '2026-11-06T12:57:30.6654575Z   115 passed (15.5m)',
  ].join('\n');
  assert.deepEqual(parseVisualFailures(log), [
    '[mobile] › e2e/visual/clients.visual.spec.ts › clients visual › populated clients list',
    '[desktop] › e2e/visual/fleet.visual.spec.ts › fleet visual › populated fleet',
  ]);
});

test('fails closed when Playwright failed but no summary was reported', () => {
  assert.throws(() => parseVisualFailures('playwright crashed unexpectedly'), /failing closed/);
  assert.throws(() => parseVisualFailures('0 failed'), /failing closed/);
});

test('fails closed if parsed failures do not match reported count', () => {
  assert.throws(() => parseVisualFailures('2 failed\n    [mobile] › a.spec.ts › one'), /Parsed 1 unique failures/);
});

test('handles ANSI output and deduplicates failures without relaxing counts', () => {
  const log = '\x1b[31m1 failed\x1b[0m\n    [mobile] › a.spec.ts › one';
  assert.deepEqual(parseVisualFailures(log), ['[mobile] › a.spec.ts › one']);
});

test('test identity is stable across source-line shifts but preserves project and full title', () => {
  const before = '[mobile] › e2e/visual/geometry.visual.spec.ts:147:5 › geometria › Estoque';
  const after = '[mobile] › e2e/visual/geometry.visual.spec.ts:160:5 › geometria › Estoque';
  assert.equal(stableVisualFailureId(before), stableVisualFailureId(after));
  assert.equal(stableVisualFailureId(before), '[mobile] › e2e/visual/geometry.visual.spec.ts › geometria › Estoque');
  assert.notEqual(stableVisualFailureId(before), stableVisualFailureId('[desktop] › e2e/visual/geometry.visual.spec.ts:160:5 › geometria › Estoque'));
  assert.notEqual(stableVisualFailureId(before), stableVisualFailureId('[mobile] › e2e/visual/geometry.visual.spec.ts:160:5 › geometria › Faturamento'));
  assert.equal(stableVisualFailureId('[mobile] › e2e/visual/geometry.visual.spec.ts:160:5 › title 12:34'), '[mobile] › e2e/visual/geometry.visual.spec.ts › title 12:34');
});

test('parse normalizes Playwright locations while keeping the reported failure count strict', () => {
  const log = [
    '2 failed',
    '  [mobile] › e2e/visual/geometry.visual.spec.ts:147:5 › accounting › close',
    '  [tablet] › e2e/visual/geometry.visual.spec.ts:160:5 › accounting › close',
    '1 flaky',
    '  [mobile] › flaky.spec.ts:10:2 › flaky case',
  ].join('\n');
  assert.deepEqual(parseVisualFailures(log), [
    '[mobile] › e2e/visual/geometry.visual.spec.ts › accounting › close',
    '[tablet] › e2e/visual/geometry.visual.spec.ts › accounting › close',
  ]);
});

test('fails closed when two reported failures collide after location normalization', () => {
  const log = [
    '2 failed',
    '  [mobile] › e2e/visual/geometry.visual.spec.ts:147:5 › identical title',
    '  [mobile] › e2e/visual/geometry.visual.spec.ts:160:5 › identical title',
  ].join('\n');
  assert.throws(() => parseVisualFailures(log), /Parsed 1 unique failures/);
});
