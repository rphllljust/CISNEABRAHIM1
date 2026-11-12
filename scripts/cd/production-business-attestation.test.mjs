import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { attestProductionBusiness, summarizeRejectedProductionBusiness } from './production-business-attestation.mjs';

const runtime = {
  assertionsPass: 'true',
  runtimeVerified: 'true',
  releaseVerified: 'true',
  productionRuntimeValidated: 'true',
};
const render = (fields) =>
  Object.entries({ ...runtime, ...fields })
    .map(([key, value]) => `[coolify-browser-gate] ${key}=${value}`)
    .join('\n');

const real = {
  businessEvidenceAvailable: 'true',
  businessVerified: 'true',
  productionBusinessValidated: 'true',
  productionValidated: 'true',
  businessOutcome: 'BUSINESS_VALIDATED',
};
const empty = {
  businessEvidenceAvailable: 'false',
  businessVerified: 'false',
  productionBusinessValidated: 'NOT_APPLICABLE',
  productionValidated: 'CONDITIONAL',
  businessOutcome: 'BUSINESS_EVIDENCE_NOT_AVAILABLE',
};

describe('production business attestation — fail closed, no synthetic production', () => {
  it('accepts a real, complete authoritative chain', () => {
    const verdict = attestProductionBusiness(render(real));
    assert.equal(verdict.status, 'PASS');
    assert.equal(verdict.business_verified, true);
    assert.equal(verdict.production_validated, true);
  });
  it('never treats an empty unit as business accepted', () => {
    const verdict = attestProductionBusiness(render(empty));
    assert.equal(verdict.status, 'CONDITIONAL');
    assert.equal(verdict.business_verified, false);
    assert.equal(verdict.production_validated, false);
  });
  it('does not infer business acceptance from a green technical release', () => {
    assert.throws(
      () => attestProductionBusiness(render({ ...real, businessVerified: 'false' })),
      /NOT ACCEPTED/,
    );
  });
  it('rejects available business evidence when it has not been proven', () => {
    assert.throws(
      () => attestProductionBusiness(render({ ...real, productionValidated: 'false' })),
      /NOT ACCEPTED/,
    );
  });
  it('rejects missing or unreadable business evidence', () => {
    assert.throws(
      () => attestProductionBusiness(render({ ...empty, businessEvidenceAvailable: 'null' })),
      /NOT ACCEPTED/,
    );
  });
  it('rejects inconsistent conditional evidence', () => {
    assert.throws(
      () => attestProductionBusiness(render({ ...empty, businessVerified: 'true' })),
      /NOT ACCEPTED/,
    );
  });
  it('rejects an unsuccessful runtime', () => {
    assert.throws(
      () => attestProductionBusiness(render({ ...real, runtimeVerified: 'false' })),
      /runtime\/release gate/,
    );
  });
  it('requires every relevant field, without trusting missing values', () => {
    assert.throws(
      () => attestProductionBusiness('[coolify-browser-gate] runtimeVerified=true'),
      /Missing browser verdict field/,
    );
  });
  it('refuses duplicate verdict fields', () => {
    const log = render(real) + '\n[coolify-browser-gate] businessVerified=false';
    assert.throws(() => attestProductionBusiness(log), /Duplicate browser verdict field/);
  });
  it('does not confuse a log text mention with a verdict', () => {
    const log = 'debug: [coolify-browser-gate] businessVerified=true\n' + render(empty);
    assert.equal(attestProductionBusiness(log).status, 'CONDITIONAL');
  });
});

/**
 * The release smoke checks immutable source SHA and repository on API, Worker,
 * and Web. This test prevents the business-only workflow from omitting the
 * repository env and failing before Chromium ever inspects production.
 */
describe('production business evidence workflow configuration', () => {
  it('inherits the exact three GHCR repository identities from the release', () => {
    const businessWorkflow = readFileSync(
      new URL('../../.github/workflows/production-business-evidence.yml', import.meta.url),
      'utf8',
    );
    const releaseWorkflow = readFileSync(
      new URL('../../.github/workflows/coolify-release.yml', import.meta.url),
      'utf8',
    );
    const smokeJobHeader = businessWorkflow.split('\n    steps:\n')[0];
    assert.match(smokeJobHeader, /^    env:$/m, 'repositories belong in the job environment');
    for (const variable of ['API_REPOSITORY', 'WORKER_REPOSITORY', 'WEB_REPOSITORY']) {
      const releaseLine = releaseWorkflow
        .split('\n')
        .find((line) => line.trimStart().startsWith(`${variable}: ghcr.io/`));
      assert.ok(releaseLine, `official release must declare ${variable}`);
      assert.ok(
        smokeJobHeader.split('\n').includes(`      ${releaseLine.trim()}`),
        `business smoke must define ${variable} identical to the official release`,
      );
    }
  });
});

describe('rejected production business evidence — safe diagnostics, fail closed', () => {
  it('records only allowlisted fields and never upgrades rejection to acceptance', () => {
    const log = render({
      ...real,
      businessVerified: 'false',
      productionBusinessValidated: 'false',
      productionValidated: 'false',
      businessOutcome: 'BUSINESS_EVIDENCE_INCOMPLETE',
    }) + '\nPRIVATE_CUSTOMER=Never copy this or https://private.example.com';
    const proof = summarizeRejectedProductionBusiness(log, 'a'.repeat(40), '123');
    assert.equal(proof.status, 'FAIL');
    assert.equal(proof.reason, 'BUSINESS_EVIDENCE_INCOMPLETE');
    assert.equal(proof.runtime_verified, true);
    assert.equal(proof.business_verified, false);
    assert.equal(proof.production_validated, false);
    assert.equal(proof.sanitized_verdict.businessOutcome, 'BUSINESS_EVIDENCE_INCOMPLETE');
    assert.doesNotMatch(JSON.stringify(proof), /PRIVATE_CUSTOMER|private\\.example/);
  });

  it('publishes only allowlisted missing business checks for incomplete chains', () => {
    const log = render({
      ...real,
      businessVerified: 'false',
      productionBusinessValidated: 'false',
      productionValidated: 'false',
      businessOutcome: 'BUSINESS_EVIDENCE_INCOMPLETE',
    }) + '\\nFAIL  MEDIÇÃO expõe elegibilidade de faturamento — BUSINESS_EVIDENCE_INCOMPLETE; ordensLidas=2; pendencias=acceptanceVerified,billingRecordVerified,PRIVATE_CUSTOMER';
    const proof = summarizeRejectedProductionBusiness(log, 'd'.repeat(40));
    assert.deepEqual(proof.business_diagnostics, {
      category: 'CHAIN_CHECKS_MISSING',
      missing_checks: ['acceptanceVerified', 'billingRecordVerified'],
    });
    assert.doesNotMatch(JSON.stringify(proof), /PRIVATE_CUSTOMER|ordensLidas/);
  });

  it('identifies absence of a terminal order without exposing operational data', () => {
    const log = render({ ...real, businessOutcome: 'BUSINESS_EVIDENCE_INCOMPLETE' }) +
      '\\nFAIL  MEDIÇÃO expõe elegibilidade de faturamento — BUSINESS_EVIDENCE_INCOMPLETE; sem OS COMPLETED/CLOSED com workbench elegivel';
    const proof = summarizeRejectedProductionBusiness(log, 'e'.repeat(40));
    assert.deepEqual(proof.business_diagnostics, {
      category: 'NO_ELIGIBLE_TERMINAL_ORDER',
      missing_checks: [],
    });
  });

  it('rejects missing or duplicated verdict fields without trusting their contents', () => {
    const log = render({ ...real, businessVerified: 'false' }) +
      '\n[coolify-browser-gate] businessVerified=true';
    const proof = summarizeRejectedProductionBusiness(log, 'b'.repeat(40));
    assert.equal(proof.status, 'FAIL');
    assert.equal(proof.sanitized_verdict.businessVerified, 'UNKNOWN');
    assert.equal(summarizeRejectedProductionBusiness('a raw error only', 'b'.repeat(40)).status, 'FAIL');
  });

  it('writes a restricted FAIL artifact and exits nonzero on a real rejection', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cisne-fail-closed-business-'));
    try {
      const input = join(dir, 'verdict.log');
      const output = join(dir, 'attestation.json');
      writeFileSync(input, render({
        ...real,
        businessVerified: 'false',
        productionBusinessValidated: 'false',
        productionValidated: 'false',
        businessOutcome: 'BUSINESS_VALIDATION_FAILED',
      }) + '\nSECRET_PASSWORD=hidden', 'utf8');
      const child = spawnSync(process.execPath, [
        fileURLToPath(new URL('./production-business-attestation.mjs', import.meta.url)), input, output,
      ], {
        env: {
          ...process.env,
          EXPECTED_SOURCE_SHA: 'c'.repeat(40),
          GITHUB_RUN_ID: '12345',
          GITHUB_OUTPUT: '',
          GITHUB_STEP_SUMMARY: '',
        },
        encoding: 'utf8',
      });
      assert.equal(child.status, 1, child.stderr);
      const artifact = JSON.parse(readFileSync(output, 'utf8'));
      assert.equal(artifact.status, 'FAIL');
      assert.equal(artifact.reason, 'BUSINESS_VALIDATION_FAILED');
      assert.equal(artifact.github_run_id, '12345');
      assert.equal(artifact.source_sha, 'c'.repeat(40));
      assert.doesNotMatch(JSON.stringify(artifact), /SECRET_PASSWORD|hidden/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
