import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeServiceOrderListAccess } from './service-orders-api';

vi.mock('../../auth/api/auth-api', () => ({
  getApiBaseUrl: () => '',
  isNetworkError: (error: unknown) => error instanceof TypeError,
}));
vi.mock('../../auth/storage/token-store', () => ({
  tokenStore: { getAccessToken: () => 'session-token' },
}));

function reply(status: number) {
  return new Response(JSON.stringify(status === 200 ? { items: [], total: 0 } : { error: {} }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

describe('OS list access: no implicit authorization on failure', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('allows an authenticated 200 list response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(200)));
    await expect(probeServiceOrderListAccess()).resolves.toBe(true);
  });

  it('denies the explicit 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(403)));
    await expect(probeServiceOrderListAccess()).resolves.toBe(false);
  });

  it('propagates a 503 outage instead of returning true', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(503)));
    await expect(probeServiceOrderListAccess()).rejects.toMatchObject({ status: 503 });
  });

  it('propagates network errors instead of returning true', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(probeServiceOrderListAccess()).rejects.toMatchObject({ kind: 'network' });
  });
});
