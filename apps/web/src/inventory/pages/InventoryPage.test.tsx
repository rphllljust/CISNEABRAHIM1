import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../../auth/storage/token-store';
import { createInventoryFetchMock, INVENTORY_TEST_DATA } from '../../test/inventory-fetch-mock';
import { renderWithProviders } from '../../test/render-with-providers';
import { InventoryPage } from './InventoryPage';

describe('InventoryPage', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('lists warehouses, items, movements and reservations with human references', async () => {
    vi.stubGlobal('fetch', createInventoryFetchMock());
    renderWithProviders(<InventoryPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Depósito Central' })).toHaveAttribute(
        'href',
        `/app/inventory/warehouses/${INVENTORY_TEST_DATA.WAREHOUSES[0]!.id}`,
      );
    });

    // Item pelo nome e SKU; movimento e reserva identificam depósito e item por referência humana.
    expect(screen.getByRole('link', { name: 'Cabo de aço 10mm' })).toHaveAttribute(
      'href',
      `/app/inventory/items/${INVENTORY_TEST_DATA.ITEMS[0]!.id}`,
    );
    expect(screen.getAllByText('SKU-CABO-10').length).toBeGreaterThan(0);
    expect(screen.getAllByText('WH-ORIGIN').length).toBeGreaterThan(0);
    expect(screen.getByText('Recebimento inicial')).toBeInTheDocument();

    // Nenhum identificador técnico é o caminho de entrada da operação.
    expect(screen.queryByLabelText(/depósito de destino \(id\)/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/chave original/i)).not.toBeInTheDocument();
    expect(screen.queryByText(INVENTORY_TEST_DATA.WAREHOUSES[0]!.id)).not.toBeInTheDocument();
  });

  it('sends the search term to the server for all four lists', async () => {
    const fetchMock = createInventoryFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderWithProviders(<InventoryPage />);
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Depósito Central' })).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('Buscar'), 'Cabo');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => (typeof call[0] === 'string' ? call[0] : ''));
      for (const suffix of [
        '/inventory/warehouses',
        '/inventory/items',
        '/inventory/movements',
        '/inventory/reservations',
      ]) {
        expect(urls.some((url) => url.includes(suffix) && url.includes('q=Cabo'))).toBe(true);
      }
    });
  });

  it('opens the stock center straight into the movement type carried in the URL', async () => {
    const fetchMock = createInventoryFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    // Os comandos do Ctrl+K abrem /app/inventory?movementType=IN e ?movementType=OUT: o
    // recorte precisa chegar ao servidor na consulta de movimentos, sem o operador refazer
    // o filtro na mao.
    renderWithProviders(<InventoryPage />, {
      router: { initialEntries: ['/app/inventory?movementType=IN'] },
    });

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => (typeof call[0] === 'string' ? call[0] : ''));
      expect(
        urls.some((url) => url.includes('/inventory/movements') && url.includes('movementType=IN')),
      ).toBe(true);
    });
    expect(screen.getByLabelText('Tipo de movimento')).toHaveValue('IN');
  });

  it('states the refusal per list when the server denies the list grant', async () => {
    vi.stubGlobal('fetch', createInventoryFetchMock({ denied: true }));
    renderWithProviders(<InventoryPage />);

    await waitFor(() => {
      expect(screen.getByText('Você não tem permissão para listar depósitos.')).toBeInTheDocument();
    });
    expect(screen.getByText('Você não tem permissão para listar itens.')).toBeInTheDocument();
    expect(screen.getByText('Você não tem permissão para listar movimentos.')).toBeInTheDocument();
    expect(screen.getByText('Você não tem permissão para listar reservas.')).toBeInTheDocument();
  });
});
