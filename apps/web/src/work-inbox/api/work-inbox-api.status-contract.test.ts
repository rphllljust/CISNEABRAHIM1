import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../../auth/storage/token-store';
import { getWorkInbox } from './work-inbox-api';

function response(status: number): Response {
  return new Response(JSON.stringify({ error: { code: 'AUTHZ_DENIED' } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('central work queue authorization contract', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetTokenStoreForTests();
    tokenStore.setTokens('inbox-access', 'inbox-refresh');
  });

  it('treats 401 as session/access denial, never an empty queue', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(401)));
    await expect(getWorkInbox({ limit: 1 })).rejects.toMatchObject({ status: 401, kind: 'denied' });
  });

  it('treats 403 as explicit denial', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(403)));
    await expect(getWorkInbox({ limit: 1 })).rejects.toMatchObject({ status: 403, kind: 'denied' });
  });

  it('preserves server outages as errors rather than zero totals', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(503)));
    await expect(getWorkInbox({ limit: 1 })).rejects.toMatchObject({ status: 503, kind: 'unknown' });
  });

  it('preserves network faults independently from 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(getWorkInbox({ limit: 1 })).rejects.toMatchObject({ status: 0, kind: 'network' });
  });
});
