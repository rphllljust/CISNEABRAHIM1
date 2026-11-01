import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyServiceOrderEvidencePage } from './measurement-evidence-source.mjs';

const unitId = 'UN-PROD-001';
const classify = (status, payload) =>
  classifyServiceOrderEvidencePage({ status, payload, unitId });

describe('read-only enterprise evidence source classification', () => {
  it('recognizes an actually empty authorized unit without manufacturing a business PASS', () => {
    assert.deepEqual(classify(200, { items: [], hasMore: false }), {
      valid: true,
      reason: 'BUSINESS_EVIDENCE_NOT_AVAILABLE',
    });
  });
  it('distinguishes a nonempty authorized result', () => {
    assert.equal(classify(200, {
      items: [{ id: 'os-1', unitId }], hasMore: false,
    }).reason, 'BUSINESS_EVIDENCE_AVAILABLE');
  });
  it('403 and 401 mean denied authority, not an empty operation', () => {
    for (const status of [401, 403]) {
      assert.deepEqual(classify(status, null), {
        valid: false, reason: 'BUSINESS_ACCESS_DENIED',
      });
    }
  });
  it('404 is a route defect rather than absent work', () => {
    assert.equal(classify(404, null).reason, 'BUSINESS_ROUTE_NOT_FOUND');
  });
  it('network/5xx are unavailable sources rather than absent work', () => {
    for (const status of [null, 500, 503]) {
      assert.equal(classify(status, null).reason, 'BUSINESS_SOURCE_UNAVAILABLE');
    }
  });
  it('HTTP 2xx with invalid projection refuses validation', () => {
    for (const payload of [null, {}, { items: [] }, { items: 'none', hasMore: false }]) {
      assert.equal(classify(200, payload).reason, 'BUSINESS_PROJECTION_INVALID');
    }
  });
  it('a response containing orders from another unit cannot prove the requested scope', () => {
    assert.equal(classify(200, {
      items: [{ id: 'os-2', unitId: 'UN-OUTRA' }], hasMore: false,
    }).reason, 'BUSINESS_SCOPE_MISMATCH');
  });
  it('hasMore with zero returned items is an invalid page', () => {
    assert.equal(classify(200, { items: [], hasMore: true }).reason, 'BUSINESS_PAGINATION_INVALID');
  });
});
