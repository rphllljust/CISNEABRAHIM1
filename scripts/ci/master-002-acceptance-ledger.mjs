#!/usr/bin/env node
/**
 * MASTER 002: verifies the original acceptance annex against an auditable ledger.
 * This is a STRUCTURAL gate and must never be interpreted as business sign-off.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const annex = readFileSync(new URL('docs/00-governance/master-002-annex-a.md', root), 'utf8');
const ledger = JSON.parse(readFileSync(new URL('docs/00-governance/master-002-acceptance-ledger.json', root), 'utf8'));
const expected = {"CE":10,"CL":10,"SO":10,"PC":10,"OS":16,"PE":10,"AF":10,"LT":12,"CA":10,"GD":12,"CO":14,"FI":14,"FS":12,"CT":16,"FL":12,"BI":14};
const matches = [...annex.matchAll(/^\*\*([A-Z]{2}-\d{2})\s*[—–-]\s*(.*?)\*\*(.*)$/gm)];
assert.equal(matches.length, 192, 'Annex A must have 192 individually identified mandatory criteria');
const found = matches.map((m) => m[1]);
assert.equal(new Set(found).size, 192, 'Annex contains duplicate criterion IDs');
assert.equal(ledger.criterion_count, 192, 'Ledger declares wrong criterion count');
assert.equal(ledger.criteria.length, 192, 'Ledger must preserve every criterion');
assert.deepEqual(ledger.criteria.map((row) => row.id), found, 'Ledger IDs differ from Annex A');
for (const [prefix, count] of Object.entries(expected)) {
  assert.equal(ledger.criteria.filter((row) => row.module === prefix).length, count, 'Module criterion count mismatch: ' + prefix);
}
const statuses = new Set(['NOT_RUN', 'PASS', 'FAIL', 'BLOCKED']);
for (const row of ledger.criteria) {
  assert.ok(statuses.has(row.status), 'Unknown status for ' + row.id);
  const label = matches.find((m) => m[1] === row.id);
  const original = label[2].trim().replace(/:\s*$/, '') + ': ' + label[3].trim();
  assert.equal(row.requirement, original, 'Criterion wording changed: ' + row.id);
  assert.ok(Array.isArray(row.evidence), 'Evidence must be an array for ' + row.id);
  if (row.status === 'PASS') {
    assert.ok(row.evidence.length > 0, 'PASS requires traceable evidence: ' + row.id);
    assert.ok(row.evidence.every((e) => /^[0-9a-f]{40}$/i.test(e.sha || '') && typeof e.url === 'string' && /^https:\/\//.test(e.url)), 'PASS evidence requires SHA and URL: ' + row.id);
  }
}
assert.equal(ledger.journeys.length, 5, 'MASTER 002 requires five full business journeys');
for (const journey of ledger.journeys) {
  assert.ok(statuses.has(journey.status), 'Unknown journey status: ' + journey.id);
  assert.ok(Array.isArray(journey.evidence), 'Journey evidence must be an array');
  if (journey.status === 'PASS') assert.ok(journey.evidence.length > 0, 'Journey PASS requires evidence: ' + journey.id);
}
const passed = ledger.criteria.filter((row) => row.status === 'PASS').length;
const journeysPassed = ledger.journeys.filter((row) => row.status === 'PASS').length;
const report = {
  totalCriteria: ledger.criteria.length,
  criterionPassRecorded: passed,
  criterionNotYetAccepted: ledger.criteria.length - passed,
  journeyPassRecorded: journeysPassed,
  journeyNotYetAccepted: ledger.journeys.length - journeysPassed,
  businessAcceptance: passed === 192 && journeysPassed === 5 ? 'LEDGER_READY_FOR_MANUAL_SIGNOFF' : 'NOT_EVALUATED',
  source: 'MASTER 002 Annex A (192 IDs)',
};
process.stdout.write(JSON.stringify(report) + '\n');
