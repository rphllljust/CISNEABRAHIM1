import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../../auth/storage/token-store';
import { createProcurementFetchMock } from '../../test/procurement-fetch-mock';
import { requestUrl } from '../../test/request-url';
import { renderWithProviders } from '../../test/render-with-providers';
import { ProcurementHubPage } from './ProcurementPages';

describe('ProcurementHubPage', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('lists the three purchasing entities instead of asking for identifiers', async () => {
    vi.stubGlobal('fetch', createProcurementFetchMock());
    renderWithProviders(<ProcurementHubPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Reposicao de insumos' })).toHaveAttribute(
        'href',
        '/app/procurement/requests/cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
      );
    });

    // Pedido ao fornecedor identificado por nome + CNPJ, nunca pelo identificador técnico.
    expect(screen.getByRole('link', { name: 'Alfa Insumos' })).toHaveAttribute(
      'href',
      '/app/procurement/orders/dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
    );
    expect(screen.getAllByText('11.222.333/0001-81').length).toBeGreaterThan(0);
    // Nota do fornecedor pelo número.
    expect(screen.getByRole('link', { name: 'NF-1001' })).toBeInTheDocument();

    // Nenhum caminho de entrada por identificador digitado.
    expect(screen.queryByLabelText(/identificador da solicitação/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/identificador do pedido/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/identificador da nota/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/identificador da conferência/i)).not.toBeInTheDocument();
  });

  it('sends the search to the backend for all three lists', async () => {
    const fetchMock = createProcurementFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderWithProviders(<ProcurementHubPage />);
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Reposicao de insumos' })).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('Buscar'), 'Manutencao');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => requestUrl(call[0]));
      expect(urls.some((url) => url.includes('/procurement/requests') && url.includes('q=Manutencao'))).toBe(true);
      expect(urls.some((url) => url.includes('/procurement/orders') && url.includes('q=Manutencao'))).toBe(true);
      expect(urls.some((url) => url.includes('/supplier-invoices') && url.includes('q=Manutencao'))).toBe(true);
    });
  });

  it('states the refusal per list when the server denies the list grant', async () => {
    vi.stubGlobal('fetch', createProcurementFetchMock({ denied: true }));
    renderWithProviders(<ProcurementHubPage />);

    await waitFor(() => {
      expect(
        screen.getByText('Você não tem permissão para listar solicitações de compra.'),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText('Você não tem permissão para listar pedidos ao fornecedor.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Você não tem permissão para listar notas de fornecedor.'),
    ).toBeInTheDocument();
  });
});
