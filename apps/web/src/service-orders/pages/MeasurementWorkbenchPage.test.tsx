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

describe('MeasurementWorkbenchPage — incidente de produção sem OS selecionada', () => {
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

  it('unitId válido + fila vazia não chama workbench com serviceOrderId vazio', async () => {
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
      throw new Error('request inesperado no cenário sem seleção: ' + url);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/app/measurement?unitId=UN-PROD-001']}>
        <Routes>
          <Route path="/app/measurement" element={<MeasurementWorkbenchPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Nenhum trabalho pendente')).toBeInTheDocument();
    });

    expect(
      screen.getByText('Selecione uma ordem da fila para abrir a conferência de medição.'),
    ).toBeInTheDocument();

    const requestedUrls = fetchMock.mock.calls.map(([input]) => requestUrl(input));
    expect(requestedUrls.some((url) => url.includes('/workbench'))).toBe(false);
    expect(
      requestedUrls.some((url) => url.includes('/api/v1/query/measurements/queue?')),
    ).toBe(true);
  });
});
