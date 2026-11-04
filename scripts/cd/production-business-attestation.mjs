#!/usr/bin/env node
// PROD-ACCEPT-001: verdict is computed only from the real, read-only browser gate.
// No production fixtures, mutations, customer names, IDs, or raw screenshots are published.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PREFIX = '[coolify-browser-gate] ';
const FIELDS = [
  'assertionsPass',
  'runtimeVerified',
  'releaseVerified',
  'productionRuntimeValidated',
  'businessEvidenceAvailable',
  'businessVerified',
  'productionBusinessValidated',
  'productionValidated',
  'businessOutcome',
];

export function attestProductionBusiness(verdictLog) {
  if (typeof verdictLog !== 'string') throw new TypeError('verdict log must be text');
  const seen = new Map();
  for (const line of verdictLog.split(/\r?\n/)) {
    if (!line.startsWith(PREFIX)) continue;
    const match = /^\[coolify-browser-gate\] ([A-Za-z]+)=(.+)$/.exec(line);
    if (!match || !FIELDS.includes(match[1])) continue;
    if (seen.has(match[1])) throw new Error(`Duplicate browser verdict field: ${match[1]}`);
    seen.set(match[1], match[2].trim());
  }
  for (const key of FIELDS) {
    if (!seen.has(key)) throw new Error(`Missing browser verdict field: ${key}`);
  }
  const isTrue = (key) => seen.get(key) === 'true';
  const basePassed =
    isTrue('assertionsPass') &&
    isTrue('runtimeVerified') &&
    isTrue('releaseVerified') &&
    isTrue('productionRuntimeValidated');
  if (!basePassed) throw new Error('Production runtime/release gate is not verified');

  const evidenceAvailable = seen.get('businessEvidenceAvailable');
  const businessVerified = seen.get('businessVerified');
  const businessValidated = seen.get('productionBusinessValidated');
  const productionValidated = seen.get('productionValidated');
  const businessOutcome = seen.get('businessOutcome');

  if (
    evidenceAvailable === 'true' &&
    businessVerified === 'true' &&
    businessValidated === 'true' &&
    productionValidated === 'true' &&
    businessOutcome === 'BUSINESS_VALIDATED'
  ) {
    return {
      status: 'PASS',
      reason: 'REAL_BUSINESS_CHAIN_VERIFIED',
      runtime_verified: true,
      business_verified: true,
      production_validated: true,
    };
  }
  if (
    evidenceAvailable === 'false' &&
    businessVerified === 'false' &&
    businessValidated === 'NOT_APPLICABLE' &&
    productionValidated === 'CONDITIONAL' &&
    businessOutcome === 'BUSINESS_EVIDENCE_NOT_AVAILABLE'
  ) {
    return {
      status: 'CONDITIONAL',
      reason: 'NO_REAL_ELIGIBLE_OPERATION',
      runtime_verified: true,
      business_verified: false,
      production_validated: false,
    };
  }
  throw new Error('Incomplete, inconsistent, or failed business evidence: NOT ACCEPTED');
}

function main() {
  const expectedSha = process.env.EXPECTED_SOURCE_SHA;
  if (!/^[0-9a-f]{40}$/i.test(expectedSha ?? '')) {
    throw new Error('EXPECTED_SOURCE_SHA is required and must be a full commit SHA');
  }
  const input = process.argv[2];
  const output = process.argv[3];
  if (!input || !output) throw new Error('Usage: node production-business-attestation.mjs <verdict.log> <attestation.json>');
  const proof = attestProductionBusiness(readFileSync(input, 'utf8'));
  const attestation = {
    schema_version: 1,
    source_sha: expectedSha,
    evidence_source: 'PRODUCTION_READ_ONLY_BROWSER',
    status: proof.status,
    reason: proof.reason,
    runtime_verified: proof.runtime_verified,
    business_verified: proof.business_verified,
    production_validated: proof.production_validated,
    checked_at: new Date().toISOString(),
    github_run_id: process.env.GITHUB_RUN_ID ?? null,
  };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(attestation, null, 2) + '\n', { mode: 0o600 });
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `business_status=${proof.status}\nbusiness_verified=${proof.business_verified}\n`);
  }
  const message = proof.status === 'PASS'
    ? 'Aceite empresarial real confirmado no navegador, sem criar dados.'
    : 'CONDITIONAL: runtime aprovado; sem transacao real elegivel. Nenhum aceite empresarial foi declarado.';
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      [
        '## CISNE — Production Business Evidence',
        '',
        `**Source SHA:** \`${expectedSha}\``,
        `**Business acceptance:** \`${proof.status}\``,
        `**Runtime verified:** \`true\``,
        `**Business verified:** \`${proof.business_verified}\``,
        '',
        message,
        '',
        'Somente leituras autenticadas do runtime existente. Sem fixture, seed, faturamento ou transacao ficticia na producao.',
        '',
      ].join('\n'),
    );
  }
  console.log(`[production-business-attestation] source=${expectedSha} business=${proof.status} runtime=true businessVerified=${proof.business_verified}`);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(`[production-business-attestation] REFUSED: ${error.message}`);
    process.exitCode = 1;
  }
}
