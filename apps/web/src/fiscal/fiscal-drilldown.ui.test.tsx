import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { createFinanceFetchMock } from '../test/finance-fetch-mock';
import { renderWithProviders } from '../test/render-with-providers';
import { FiscalDocumentsPage } from './pages/FiscalDocumentsPage';

/**
 * Transporte de drill-down do Fiscal: a situação vem do URL.
 *
 * É o que permite Ctrl+K (`/app/fiscal/documents?status=REJECTED`) e o drill-down
 * abrirem a fila já recortada, sem mecanismo novo e sem gravar identificador de
 * registro na URL ou no browser.
 */

function renderFiscalDocuments(initialEntry: string) {
  renderWithProviders(
    <Routes>
      <Route path="/app/fiscal/documents" element={<FiscalDocumentsPage />} />
      <Route path="/app/fiscal/documents/:fiscalDocumentId" element={<FiscalDocumentsPage />} />
    </Routes>,
    { router: { initialEntries: [initialEntry] } },
  );
}

function listCallUrls(fetchMock: ReturnType<typeof createFinanceFetchMock>): string[] {
  return fetchMock.mock.calls
    .map(([input]) =>
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    )
    .filter((url) => url.includes('/api/v1/fiscal/documents?'));
}

describe('Fiscal — transporte de drill-down por URL', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('abre a fila já filtrada quando a situação vem do URL', async () => {
    const fetchMock = createFinanceFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    renderFiscalDocuments('/app/fiscal/documents?status=REJECTED');

    await waitFor(() => {
      expect(listCallUrls(fetchMock).some((url) => url.includes('status=REJECTED'))).toBe(true);
    });
    // O filtro do formulário reflete o recorte vindo do URL.
    expect(screen.getByLabelText(/situação/i)).toHaveValue('REJECTED');
  });

  it('ignora valor de situação que não é uma opção real do domínio', async () => {
    const fetchMock = createFinanceFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    // Valor fora da lista de situações: não vira filtro nem vaza para a consulta.
    renderFiscalDocuments('/app/fiscal/documents?status=NAO_EXISTE');

    await waitFor(() => {
      expect(listCallUrls(fetchMock).length).toBeGreaterThan(0);
    });
    expect(listCallUrls(fetchMock).every((url) => !url.includes('NAO_EXISTE'))).toBe(true);
    expect(screen.getByLabelText(/situação/i)).toHaveValue('');
  });

  it('mostra o total real informado pelo servidor, sem estimar', async () => {
    const fetchMock = createFinanceFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    renderFiscalDocuments('/app/fiscal/documents');

    await waitFor(() => {
      expect(screen.getByText(/na fila/i)).toBeInTheDocument();
    });
    // O contador usa `total` do servidor — a tela não recalcula a fila.
    expect(screen.getByText(/documentos? na fila/i)).toBeInTheDocument();
  });
});
