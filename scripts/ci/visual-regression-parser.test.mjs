import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseVisualFailures } from './visual-regression-parser.mjs';

test('reads failed Playwright IDs but excludes a flaky list after failures', () => {
  const log = [
    '2026-11-06T12:57:30.6585545Z   2 failed',
    '2026-11-06T12:57:30.6587000Z     [mobile] › e2e/visual/clients.visual.spec.ts:51:3 › clients visual › populated clients list',
    '2026-11-06T12:57:30.6587500Z     [desktop] › e2e/visual/fleet.visual.spec.ts:51:3 › fleet visual › populated fleet',
    '2026-11-06T12:57:30.6653935Z   1 flaky',
    '2026-11-06T12:57:30.6654390Z     [desktop] › e2e/visual/geometry.visual.spec.ts:146:5 › suppliers flaky',
    '2026-11-06T12:57:30.6654468Z   11 skipped',
    '2026-11-06T12:57:30.6654575Z   115 passed (15.5m)',
  ].join('\\n');
  assert.deepEqual(parseVisualFailures(log), [
    '[mobile] › e2e/visual/clients.visual.spec.ts:51:3 › clients visual › populated clients list',
    '[desktop] › e2e/visual/fleet.visual.spec.ts:51:3 › fleet visual › populated fleet',
  ]);
});

test('fails closed when Playwright failed but no summary was reported', () => {
  assert.throws(() => parseVisualFailures('playwright crashed unexpectedly'), /failing closed/);
  assert.throws(() => parseVisualFailures('0 failed'), /failing closed/);
});

test('fails closed if parsed failures do not match reported count', () => {
  assert.throws(() => parseVisualFailures('2 failed\\n    [mobile] › a.spec.ts:3:1 › one'), /Parsed 1 unique failures/);
});

test('handles ANSI output and deduplicates failures without relaxing counts', () => {
  const log = '\\x1b[31m1 failed\\x1b[0m\\n    [mobile] › a.spec.ts:3:1 › one';
  assert.deepEqual(parseVisualFailures(log), ['[mobile] › a.spec.ts:3:1 › one']);
});
