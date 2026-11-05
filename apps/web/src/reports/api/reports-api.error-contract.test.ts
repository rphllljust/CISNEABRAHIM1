import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../../auth/storage/token-store';
import { getReportCatalog, previewReport } from './reports-api';
import { REPORT_ERROR_CODES } from '../types/reports.types';

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('reports authorization and error envelope contract', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetTokenStoreForTests();
    tokenStore.setTokens('reports-test-access', 'reports-test-refresh');
  });

  it('classifies an expired session (401) as denied, never a generic server fault', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(401, { error: { code: 'UNAUTHORIZED' } })));
    await expect(getReportCatalog()).rejects.toMatchObject({ status: 401, kind: 'denied' });
  });

  it('reads authoritative access denial from the nested error envelope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      response(403, { error: { code: REPORT_ERROR_CODES.ACCESS_DENIED } }),
    ));
    await expect(previewReport('SERVICE_ORDERS_BY_PERIOD', {})).rejects.toMatchObject({
      status: 403, code: REPORT_ERROR_CODES.ACCESS_DENIED, kind: 'denied',
    });
  });

  it('preserves 503 outages instead of converting them into denied or empty reports', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(503, { error: { code: 'UNAVAILABLE' } })));
    await expect(getReportCatalog()).rejects.toMatchObject({ status: 503, kind: 'unknown' });
  });

  it('preserves report-not-ready status for safe export retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      response(409, { error: { code: REPORT_ERROR_CODES.NOT_READY } }),
    ));
    await expect(previewReport('SERVICE_ORDERS_BY_PERIOD', {})).rejects.toMatchObject({
      status: 409, code: REPORT_ERROR_CODES.NOT_READY, kind: 'not_ready',
    });
  });
});
