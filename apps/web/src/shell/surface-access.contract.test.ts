import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import {
  probeExplicitCapability,
  probeSurfaceAccess,
  resetSurfaceAccessCacheForTests,
  resolveAuthorizedUnit,
} from './surface-access';

vi.mock('../auth/api/auth-api', () => ({ getApiBaseUrl: () => '' }));
function reply(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('MASTER 002: cross-module authorization probes', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('session-token', 'refresh-token');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetSurfaceAccessCacheForTests();
  });

  it('allows verified list reads and denies a real PDP 403', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(200)).mockResolvedValueOnce(reply(403));
    vi.stubGlobal('fetch', fetchMock);
    await expect(probeSurfaceAccess('client-list', '')).resolves.toEqual({ outcome: 'allowed' });
    await expect(probeSurfaceAccess('client-list', '')).resolves.toEqual({ outcome: 'denied' });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/clients?limit=1&offset=0'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it.each([429, 500, 502, 503])('never treats an HTTP %s outage as denial', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(status)));
    await expect(probeSurfaceAccess('accounting-journal-read', 'unit-1'))
      .rejects.toThrow(/probe unavailable/);
  });

  it('does not represent network loss as denial', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(probeSurfaceAccess('finance-receivable-list', '')).rejects.toThrow('Failed to fetch');
  });

  it('does not reclassify an unavailable unit directory as a missing operational scope', async () => {
    resetSurfaceAccessCacheForTests();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(503)));
    await expect(resolveAuthorizedUnit('actor-with-unit')).rejects.toThrow('unit_lookup_unavailable');
  });

  it('still returns an empty unit for explicit directory denial', async () => {
    resetSurfaceAccessCacheForTests();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(403)));
    await expect(resolveAuthorizedUnit('actor-without-directory-access')).resolves.toBe('');
  });

  it('keeps grant checks fail closed on 403 but retryable on 503', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply(403)).mockResolvedValueOnce(reply(503)));
    await expect(probeExplicitCapability('actor-1', 'accounting:journal:read'))
      .resolves.toEqual({ outcome: 'denied' });
    await expect(probeExplicitCapability('actor-1', 'accounting:journal:read'))
      .rejects.toThrow(/Capability probe unavailable/);
  });

  it('accepts an explicit live non-revoked grant and refuses a revoked grant', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(reply(200, [{ action: 'accounting:journal:read', revokedAt: null }]))
      .mockResolvedValueOnce(reply(200, [{ action: 'accounting:journal:read', revokedAt: '2026-11-01' }])));
    await expect(probeExplicitCapability('actor-1', 'accounting:journal:read'))
      .resolves.toEqual({ outcome: 'allowed' });
    await expect(probeExplicitCapability('actor-1', 'accounting:journal:read'))
      .resolves.toEqual({ outcome: 'denied' });
  });
});
