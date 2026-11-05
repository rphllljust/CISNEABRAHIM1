import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../../auth/storage/token-store';
import { listEmploymentContracts, listPayrollPeriods } from './payroll-api';

const loaders = {
  periods: () => listPayrollPeriods({ unitId: 'UNIT-A', page: 0, pageSize: 20 }),
  contracts: () => listEmploymentContracts({ unitId: 'UNIT-A', page: 0, pageSize: 20 }),
};

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('payroll directory uses authoritative list responses', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetTokenStoreForTests();
    tokenStore.setTokens('payroll-test-access', 'payroll-test-refresh');
  });

  for (const [directory, load] of Object.entries(loaders)) {
    it(`${directory}: propagates missing endpoints instead of fabricating zero records`, async () => {
      vi.stubGlobal('fetch', vi.fn(async () => response(404, { error: { code: 'PAYROLL_NOT_FOUND' } })));
      await expect(load()).rejects.toMatchObject({ status: 404, kind: 'not_found' });
    });

    it(`${directory}: does not hide authorization denial`, async () => {
      vi.stubGlobal('fetch', vi.fn(async () => response(403, { error: { code: 'PAYROLL_DENIED' } })));
      await expect(load()).rejects.toMatchObject({ status: 403, kind: 'denied' });
    });

    it(`${directory}: accepts an authoritative empty 200 page`, async () => {
      const payload = { items: [], total: 0, page: 0, pageSize: 20, totalPages: 0 };
      vi.stubGlobal('fetch', vi.fn(async () => response(200, payload)));
      await expect(load()).resolves.toEqual(payload);
    });
  }
});
