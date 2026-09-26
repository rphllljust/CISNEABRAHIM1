import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { createFinanceFetchMock, MOCK_FISCAL_ID } from '../test/finance-fetch-mock';
import { renderWithProviders } from '../test/render-with-providers';
import { FiscalDocumentsPage } from './pages/FiscalDocumentsPage';

function renderFiscalDocuments(initialEntry: string) {
  renderWithProviders(
    <Routes>
      <Route path="/app/fiscal/documents" element={<FiscalDocumentsPage />} />
      <Route path="/app/fiscal/documents/:fiscalDocumentId" element={<FiscalDocumentsPage />} />
    </Routes>,
    { router: { initialEntries: [initialEntry] } },
  );
}

describe('Fiscal backoffice UI', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('lists documents for the selected unit with readable protocol instead of an identifier lookup', async () => {
    const user = userEvent.setup();
    const fetchMock = createFinanceFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    renderFiscalDocuments('/app/fiscal/documents');

    await waitFor(() => {
      expect(screen.getByRole('table', { name: /lista de documentos fiscais/i })).toBeInTheDocument();
    });
    expect(screen.getByText('NF de serviço')).toBeInTheDocument();
    expect(screen.getByText('35260812345678000199550010000000011000000010')).toBeInTheDocument();

    // A lista ja carrega sozinha: nenhuma digitacao de identificador e exigida.
    const listUrls = fetchMock.mock.calls.map(([input]) =>
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const listCalls = listUrls.filter((url) => url.includes('/api/v1/fiscal/documents?'));
    expect(listCalls.length).toBeGreaterThan(0);
    expect(listCalls[0]).toContain('unitId=unit-1');

    await user.selectOptions(screen.getByLabelText(/situação/i), 'REJECTED');
    await waitFor(() => {
      const filtered = fetchMock.mock.calls
        .map(([input]) =>
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        )
        .filter((url) => url.includes('status=REJECTED'));
      expect(filtered.length).toBeGreaterThan(0);
    });
  });

  it('shows the empty state when the unit has no fiscal document', async () => {
    vi.stubGlobal('fetch', createFinanceFetchMock({ fiscalDocumentCount: 0 }));
    renderFiscalDocuments('/app/fiscal/documents');
    await waitFor(() => {
      expect(screen.getByText(/nenhum documento fiscal/i)).toBeInTheDocument();
    });
  });

  it('renders persisted tax amounts without recalculating', async () => {
    vi.stubGlobal('fetch', createFinanceFetchMock());
    renderFiscalDocuments(`/app/fiscal/documents/${MOCK_FISCAL_ID}`);
    await waitFor(() => {
      expect(screen.getByRole('table', { name: /itens do documento fiscal/i })).toBeInTheDocument();
    });
    expect(screen.getByText(/100,00/)).toBeInTheDocument();
    expect(screen.getByText(/5,00/)).toBeInTheDocument();
    expect(screen.getByRole('table', { name: /tributos persistidos/i })).toBeInTheDocument();
    expect(screen.getByText('SEM VALIDADE FISCAL')).toBeInTheDocument();
    expect(screen.getByText('Bloqueada')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: /eventos do documento fiscal/i })).toBeInTheDocument();
    expect(
      screen.getByRole('table', { name: /tentativas de autorização do documento fiscal/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /voltar para a lista/i })).toBeInTheDocument();
  });

  it('shows denied when fiscal read is forbidden', async () => {
    vi.stubGlobal('fetch', createFinanceFetchMock({ fiscalAllowed: false }));
    renderFiscalDocuments(`/app/fiscal/documents/${MOCK_FISCAL_ID}`);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/não tem permissão/i);
    });
  });

  it('surfaces the backend denial when the fiscal list is forbidden', async () => {
    vi.stubGlobal('fetch', createFinanceFetchMock({ fiscalAllowed: false }));
    renderFiscalDocuments('/app/fiscal/documents');
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/permiss/i);
    });
  });
});
