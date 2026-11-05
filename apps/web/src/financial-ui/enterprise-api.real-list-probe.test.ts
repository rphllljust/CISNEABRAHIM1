import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { probeInventoryReadAccess } from '../inventory/api/inventory-api';
import { probeProcurementReadAccess } from '../procurement/api/procurement-api';
import { probeSupplierListAccess } from '../suppliers/api/suppliers-api';

vi.mock('../auth/api/auth-api', () => ({
  getApiBaseUrl: () => '',
  isNetworkError: (error: unknown) => error instanceof TypeError,
}));
function reply(status: number) {
  return new Response(JSON.stringify(status === 200 ? { items: [], total: 0 } : { error: {} }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

describe('Procure-to-Pay: real entry-list authorization', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('signed-in-test-actor', 'refresh-token');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('checks the actual procurement worklist, not a fabricated record ID', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(200));
    vi.stubGlobal('fetch', fetchMock);
    await expect(probeProcurementReadAccess()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/procurement/requests?limit=1&offset=0'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('denies inventory only on an actual 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(403)));
    await expect(probeInventoryReadAccess()).resolves.toBe(false);
  });

  it('does not treat missing supplier list as authorized', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(404)));
    await expect(probeSupplierListAccess()).rejects.toMatchObject({ status: 404 });
  });

  it('surfaces an unavailable inventory service instead of a false 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(503)));
    await expect(probeInventoryReadAccess()).rejects.toMatchObject({ status: 503 });
  });

  it('exposes a supplier list when the authorized API responds 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(200)));
    await expect(probeSupplierListAccess()).resolves.toBe(true);
  });
});
