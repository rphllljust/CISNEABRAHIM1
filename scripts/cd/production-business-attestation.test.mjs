import assert from 'node:assert/strict';
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
