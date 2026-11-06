import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../auth/storage/token-store', () => ({
  tokenStore: { getAccessToken: () => 'cisne-access-test-only' },
}));
vi.mock('../../auth/api/auth-api', () => ({
  getApiBaseUrl: () => 'https://api.cisne.test',
}));

import {
  EmbeddedBiError,
  getEmbeddedBiCatalog,
  issueEmbeddedBiTicket,
} from './embedded-bi-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MASTER 015 — frontend embedded BI HTTP contract', () => {
  it('uses an authenticated no-cache catalog query scoped to the selected unit', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ key: 'service-orders', label: 'Ordens de serviço' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const actual = await getEmbeddedBiCatalog('CISNE-RO-PVH');
    expect(actual.items[0]?.key).toBe('service-orders');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.cisne.test/api/v1/analytics/embedded/catalog?unitId=CISNE-RO-PVH',
      expect.objectContaining({
        cache: 'no-store',
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer cisne-access-test-only',
        }),
      }),
    );
  });

  it('sends the unit and a catalog key, not an arbitrary browser dashboard UUID', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        token: 'guest-token-in-memory',
        dashboardId: 'uuid-from-backend',
        supersetDomain: 'https://bi.cisne.test',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await issueEmbeddedBiTicket('CISNE-RO-PVH', 'service-orders');
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.method).toBe('POST');
    expect(JSON.parse(request.body as string)).toEqual({
      unitId: 'CISNE-RO-PVH',
      dashboardKey: 'service-orders',
    });
    expect(request.headers).not.toHaveProperty('X-Superset-Service-Password');
  });

  it('does not convert a 403 to empty datasets', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    await expect(getEmbeddedBiCatalog('OTHER-UNIT'))
      .rejects.toMatchObject({ name: 'EmbeddedBiError', status: 403 });
  });

  it('treats malformed successful response as service failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => { throw new SyntaxError('bad json'); },
    }));
    await expect(getEmbeddedBiCatalog('CISNE-RO-PVH'))
      .rejects.toMatchObject({ name: 'EmbeddedBiError', status: 502 });
  });

  it('tracks upstream network failure without leaking secret fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('upstream secret in error')));
    await expect(getEmbeddedBiCatalog('CISNE-RO-PVH')).rejects.toBeInstanceOf(EmbeddedBiError);
    await expect(getEmbeddedBiCatalog('CISNE-RO-PVH'))
      .rejects.toMatchObject({ name: 'EmbeddedBiError', status: 0, message: 'unavailable' });
  });
});
