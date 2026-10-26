import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../../auth/storage/token-store';
import { MeasurementWorkbenchPage } from './MeasurementWorkbenchPage';

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function renderRoute(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/app/measurement" element={<MeasurementWorkbenchPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('MeasurementWorkbenchPage — runtime contract e lifecycle', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    tokenStore.clear();
  });

  it('incidente real: unitId válido + fila vazia não chama workbench sem OS', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes('/api/v1/query/measurements/queue?')) {
        return new Response(
          JSON.stringify({
            context: { unitId: 'UN-PROD-001', at: '2026-10-26T00:00:00.000Z' },
            counts: {},
            items: [],
            freshness: {
              readAt: '2026-10-26T00:00:00.000Z',
              authority: 'SERVER',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      throw new Error('request inesperado: ' + url);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderRoute('/app/measurement?unitId=UN-PROD-001');

    await waitFor(() => {
      expect(screen.getByText('Nenhum trabalho pendente')).toBeInTheDocument();
    });
    expect(
      screen.getByText('Selecione uma ordem da fila para abrir a conferência de medição.'),
    ).toBeInTheDocument();

    const requestedUrls = fetchMock.mock.calls.map(([input]) => requestUrl(input));
    expect(requestedUrls.some((url) => url.includes('/workbench'))).toBe(false);
    expect(requestedUrls.filter((url) => url.includes('/queue?'))).toHaveLength(1);
  });

  it('sem unitId e sem OS fica idle e não faz request algum', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderRoute('/app/measurement');

    expect(screen.getByText(/Informe a unidade/)).toBeInTheDocument();
    expect(
      screen.getByText('Selecione uma ordem da fila para abrir a conferência de medição.'),
    ).toBeInTheDocument();

    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('payload de fila incompleto degrada para erro controlado, não falso vazio', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            context: { unitId: 'UN-PROD-001', at: '2026-10-26T00:00:00.000Z' },
            counts: {},
            freshness: {
              readAt: '2026-10-26T00:00:00.000Z',
              authority: 'SERVER',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    renderRoute('/app/measurement?unitId=UN-PROD-001');

    await waitFor(() => {
      expect(screen.getByText('Não foi possível carregar a fila.')).toBeInTheDocument();
    });
    expect(screen.queryByText('Nenhum trabalho pendente')).not.toBeInTheDocument();
  });
});
