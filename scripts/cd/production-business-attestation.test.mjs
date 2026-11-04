import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { attestProductionBusiness } from './production-business-attestation.mjs';

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
