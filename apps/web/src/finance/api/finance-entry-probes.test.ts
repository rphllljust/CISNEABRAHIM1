import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../../auth/storage/token-store';
import { probeBudgetReadAccess, probeExpenseReadAccess } from './finance-api';

vi.mock('../../auth/api/auth-api', () => ({
  getApiBaseUrl: () => '',
  isNetworkError: (error: unknown) => error instanceof TypeError,
}));

function reply(status: number): Response {
  return new Response(JSON.stringify(status === 200
    ? { items: [], limit: 1, offset: 0, total: 0 }
    : { error: { code: status === 403 ? 'FINANCE_DENIED' : 'FINANCE_UNAVAILABLE' } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('MASTER 002 financial worklist authorization parity', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('authorized-test-actor', 'refresh-token');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetTokenStoreForTests();
  });

  it.each([
    ['expenses', probeExpenseReadAccess, '/api/v1/finance/expenses?limit=1&offset=0'],
    ['budgets', probeBudgetReadAccess, '/api/v1/finance/budgets?limit=1&offset=0'],
  ])('%s probes a real list rather than a fabricated record', async (_name, probe, url) => {
    const fetchMock = vi.fn().mockResolvedValue(reply(200));
    vi.stubGlobal('fetch', fetchMock);
    await expect(probe()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(url),
      expect.objectContaining({ method: 'GET' }),
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('00000000-0000-4000');
  });

  it.each([probeExpenseReadAccess, probeBudgetReadAccess])(
    'denies only a verified 403 without silently accepting 404 or 503',
    async (probe) => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(reply(403))
        .mockResolvedValueOnce(reply(404))
        .mockResolvedValueOnce(reply(503))
        .mockResolvedValueOnce(reply(401));
      vi.stubGlobal('fetch', fetchMock);
      await expect(probe()).resolves.toBe(false);
      await expect(probe()).rejects.toMatchObject({ status: 404 });
      await expect(probe()).rejects.toMatchObject({ status: 503 });
      await expect(probe()).rejects.toMatchObject({ status: 401 });
    },
  );
});
