import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { useSavedViews } from './DynamicSavedViews';

const KEY = 'workspace.FINANCEIRO';
const OWNER = '11111111-1111-4111-8111-111111111111';
const ROW = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Vencidos',
  filters: { overdue: 'true', domain: 'FINANCEIRO' },
  viewType: 'list',
  createdAt: '2026-11-01T14:00:00.000Z',
};
function response(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}
const matchesViews = (url: RequestInfo | URL) => {
  const location = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
  return location.includes('/api/v1/personalization/saved-views/');
};

describe('Diagnostic P2-01 / #179 — Workspace Saved Views server persistence', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
    resetTokenStoreForTests();
    tokenStore.setTokens('saved-views-access-token', 'refresh-token');
  });

  it('loads real server views and never treats local storage as authority', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => response([ROW]));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useSavedViews(OWNER, KEY));
    await waitFor(() => expect(result.current.views).toEqual([ROW]));
    expect(result.current.persistedLocally).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(result.current.persistable).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toContain(encodeURIComponent(KEY));
  });

  it('does not invent an empty saved-view collection on 403 or network failure', async () => {
    const localStorageKey = `cisne.saved-views.${OWNER}.${KEY}`;
    window.localStorage.setItem(localStorageKey, JSON.stringify([ROW]));
    vi.stubGlobal('fetch', vi.fn(async () => response({}, 403)));
    const { result } = renderHook(() => useSavedViews(OWNER, KEY));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.persistable).toBe(false);
    expect(result.current.views).toEqual([]);
    expect(result.current.notice).toMatch(/indisponíveis no servidor/i);
    expect(window.localStorage.getItem(localStorageKey)).not.toBeNull();
  });

  it('saves and removes only after server acknowledgement; no local fallback', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (!matchesViews(url)) return response({}, 404);
      if (init?.method === 'POST') return response(ROW, 201);
      if (init?.method === 'DELETE') return response({ deleted: true });
      return response([]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useSavedViews(OWNER, KEY));
    await waitFor(() => expect(result.current.persistable).toBe(true));
    act(() => result.current.save(ROW.name, ROW.filters, 'list'));
    await waitFor(() => expect(result.current.views).toEqual([ROW]));
    expect(window.localStorage.length).toBe(0);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true);
    act(() => result.current.remove(ROW.id));
    await waitFor(() => expect(result.current.views).toEqual([]));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true);
  });

  it('migrates existing preferences only after remote POST succeeded', async () => {
    const key = `cisne.saved-views.${OWNER}.${KEY}`;
    window.localStorage.setItem(key, JSON.stringify([ROW]));
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (!matchesViews(url)) return response({}, 404);
      return init?.method === 'POST' ? response(ROW, 201) : response([]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useSavedViews(OWNER, KEY));
    await waitFor(() => expect(result.current.views).toEqual([ROW]));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true);
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it('does not expose the previous owner view when identity changes', async () => {
    const other = '33333333-3333-4333-8333-333333333333';
    const fetchMock = vi.fn(async () => response([ROW]));
    vi.stubGlobal('fetch', fetchMock);
    const { result, rerender } = renderHook(
      ({ owner }: { owner: string | null }) => useSavedViews(owner, KEY),
      { initialProps: { owner: OWNER } as { owner: string | null } },
    );
    await waitFor(() => expect(result.current.views).toEqual([ROW]));
    rerender({ owner: null });
    await waitFor(() => expect(result.current.views).toEqual([]));
    expect(result.current.persistable).toBe(false);
    rerender({ owner: other });
    await waitFor(() => expect(result.current.views).toEqual([ROW]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
