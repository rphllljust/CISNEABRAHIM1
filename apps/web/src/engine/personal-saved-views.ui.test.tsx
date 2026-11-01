import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { useSavedViews } from './DynamicSavedViews';
import { DynamicSavedViewsBar } from './DynamicSavedViewsBar';

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
    expect(result.current.notice).toMatch(/sem permissão/i);
    expect(result.current.canRetry).toBe(false);
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
    await act(async () => { await result.current.save(ROW.name, ROW.filters, 'list'); });
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
    const initialProps: { owner: string | null } = { owner: OWNER };
    const { result, rerender } = renderHook(
      ({ owner }: { owner: string | null }) => useSavedViews(owner, KEY),
      { initialProps },
    );
    await waitFor(() => expect(result.current.views).toEqual([ROW]));
    rerender({ owner: null });
    await waitFor(() => expect(result.current.views).toEqual([]));
    expect(result.current.persistable).toBe(false);
    rerender({ owner: other });
    await waitFor(() => expect(result.current.views).toEqual([ROW]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('restores remote views after a transient GET fails, without fake empty state', async () => {
    let reads = 0;
    const fetchMock = vi.fn(async () => {
      reads += 1;
      return reads === 1 ? response({}, 503) : response([ROW]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useSavedViews(OWNER, KEY));

    await waitFor(() => expect(result.current.canRetry).toBe(true));
    expect(result.current.persistable).toBe(false);
    expect(result.current.notice).toMatch(/indisponíveis/i);

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.views).toEqual([ROW]));
    expect(result.current.persistable).toBe(true);
    expect(result.current.canRetry).toBe(false);
    expect(result.current.notice).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns failure acknowledgement for rejected writes and allows retry without local persistence', async () => {
    let posts = 0;
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts += 1;
        return posts === 1 ? response({}, 503) : response(ROW, 201);
      }
      return response([]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useSavedViews(OWNER, KEY));
    await waitFor(() => expect(result.current.persistable).toBe(true));

    let first = true;
    await act(async () => {
      first = await result.current.save(ROW.name, ROW.filters, 'list');
    });
    expect(first).toBe(false);
    expect(result.current.views).toEqual([]);
    expect(result.current.notice).toMatch(/não foi salva/i);
    expect(window.localStorage.length).toBe(0);

    let second = false;
    await act(async () => {
      second = await result.current.save(ROW.name, ROW.filters, 'list');
    });
    expect(second).toBe(true);
    expect(result.current.views).toEqual([ROW]);
    expect(result.current.notice).toBeNull();
  });

  it('keeps the operator draft and form open until Save acknowledgement', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    render(
      <DynamicSavedViewsBar
        views={[]}
        onApply={vi.fn()}
        onDelete={vi.fn()}
        onSave={onSave}
        persistable
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Salvar visão' }));
    const field = screen.getByTestId('dynamic-saved-view-name');
    await user.type(field, 'Vencidos da unidade');
    await user.click(screen.getByTestId('dynamic-saved-view-save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('dynamic-saved-view-save')).toBeEnabled());
    expect(field).toHaveValue('Vencidos da unidade');
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveAttribute('aria-expanded', 'true');

    await user.click(screen.getByTestId('dynamic-saved-view-save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(field).toHaveValue(''));
    expect(screen.getByRole('button', { name: 'Salvar visão' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('offers a retry control on recoverable loading failures', async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    render(
      <DynamicSavedViewsBar
        views={[]}
        onApply={vi.fn()}
        onDelete={vi.fn()}
        onSave={vi.fn()}
        persistable={false}
        statusMessage="Visões salvas indisponíveis no servidor."
        onRetry={retry}
      />,
    );
    expect(screen.getByTestId('dynamic-saved-views-unavailable')).toHaveTextContent('indisponíveis');
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

});
