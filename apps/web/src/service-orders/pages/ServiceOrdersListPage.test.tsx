import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceOrdersListPage } from './ServiceOrdersListPage';
import {
  createServiceOrdersFetchMock,
  MOCK_SERVICE_ORDER_ID,
} from '../../test/service-orders-fetch-mock';
import { renderWithProviders } from '../../test/render-with-providers';
import { requestUrl } from '../../test/request-url';
import { resetTokenStoreForTests, tokenStore } from '../../auth/storage/token-store';
import { SERVICE_ORDER_STATUSES } from '../types/service-order.types';

describe('ServiceOrdersListPage', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('loads service orders and exposes operational links', async () => {
    vi.stubGlobal('fetch', createServiceOrdersFetchMock());
    renderWithProviders(<ServiceOrdersListPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'OS-2026-DEMO01' })).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: 'OS-2026-DEMO01' })).toHaveAttribute(
      'href',
      `/app/service-orders/${MOCK_SERVICE_ORDER_ID}/planning`,
    );
    expect(screen.getByRole('link', { name: 'Planejamento' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Execução' })).toHaveAttribute(
      'href',
      `/app/service-orders/${MOCK_SERVICE_ORDER_ID}/execution`,
    );
    expect(screen.getByRole('link', { name: 'Medição' })).toHaveAttribute(
      'href',
      `/app/service-orders/${MOCK_SERVICE_ORDER_ID}/measurement`,
    );
  });

  it('shows denied state when list access is forbidden', async () => {
    vi.stubGlobal('fetch', createServiceOrdersFetchMock({ serviceOrderListAllowed: false }));
    renderWithProviders(<ServiceOrdersListPage />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/não tem permissão para listar ordens de serviço/i);
    });
  });

  it('prepares a draft order (Preparar on DRAFT moves to PREPARED)', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      createServiceOrdersFetchMock({ orderStatus: SERVICE_ORDER_STATUSES.Draft }),
    );
    renderWithProviders(<ServiceOrdersListPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Preparar' })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: 'Preparar' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Status: Preparada')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Liberar' })).toBeEnabled();
  });

  it('releases a prepared order (Liberar on PREPARED moves to RELEASED)', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      createServiceOrdersFetchMock({ orderStatus: SERVICE_ORDER_STATUSES.Prepared }),
    );
    renderWithProviders(<ServiceOrdersListPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Liberar' })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: 'Liberar' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Status: Liberada')).toBeInTheDocument();
    });
  });

  it('cancels an order only after a cancellation reason is informed', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', createServiceOrdersFetchMock());
    renderWithProviders(<ServiceOrdersListPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancelar' })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));

    const dialog = await screen.findByRole('dialog');
    const confirmButton = within(dialog).getByRole('button', {
      name: 'Confirmar cancelamento',
    });
    expect(confirmButton).toBeDisabled();
    expect(within(dialog).getByLabelText(/motivo do cancelamento/i)).toBeInTheDocument();

    await user.type(
      within(dialog).getByLabelText(/motivo do cancelamento/i),
      'Cliente encerrou a demanda',
    );
    expect(confirmButton).toBeEnabled();
    await user.click(confirmButton);

    await waitFor(() => {
      expect(screen.getByLabelText('Status: Cancelada')).toBeInTheDocument();
    });
  });

  it('reopens a cancelled order back to its previous status', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      createServiceOrdersFetchMock({ orderStatus: SERVICE_ORDER_STATUSES.Cancelled }),
    );
    renderWithProviders(<ServiceOrdersListPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Reabrir' })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: 'Reabrir' }));

    const dialog = await screen.findByRole('dialog');
    const confirmButton = within(dialog).getByRole('button', { name: 'Confirmar reabertura' });
    expect(confirmButton).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/motivo da reabertura/i), 'Retomada da operação');
    await user.click(confirmButton);

    await waitFor(() => {
      expect(screen.getByLabelText('Status: Preparada')).toBeInTheDocument();
    });
  });

  it('reopens a completed order back into execution', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      createServiceOrdersFetchMock({ orderStatus: SERVICE_ORDER_STATUSES.Completed }),
    );
    renderWithProviders(<ServiceOrdersListPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Reabrir' })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: 'Reabrir' }));

    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/motivo da reabertura/i), 'Serviço adicional');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar reabertura' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Status: Em execução')).toBeInTheDocument();
    });
  });

  it('surfaces a mapped 409 message when a lifecycle action hits a version conflict', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      createServiceOrdersFetchMock({
        orderStatus: SERVICE_ORDER_STATUSES.Draft,
        lifecycleVersionConflict: true,
      }),
    );
    renderWithProviders(<ServiceOrdersListPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Preparar' })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: 'Preparar' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/foram alterados por outra operação/i);
    });
  });

  it('exposes the dispatch segments as the filter query parameter', async () => {
    const user = userEvent.setup();
    const fetchMock = createServiceOrdersFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<ServiceOrdersListPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'OS-2026-DEMO01' })).toBeInTheDocument();
    });

    const filterSelect = screen.getByLabelText('Filtro operacional');
    expect(within(filterSelect).getByRole('option', { name: 'Minhas OS' })).toBeInTheDocument();
    expect(within(filterSelect).getByRole('option', { name: 'Não atribuídas' })).toBeInTheDocument();
    expect(within(filterSelect).getByRole('option', { name: 'Não agendadas' })).toBeInTheDocument();
    expect(within(filterSelect).getByRole('option', { name: 'Hoje' })).toBeInTheDocument();

    await user.selectOptions(filterSelect, 'mine');

    await waitFor(() => {
      const requestedUrls = fetchMock.mock.calls.map((call) => requestUrl(call[0]));
      expect(requestedUrls.some((url) => url.includes('filter=mine'))).toBe(true);
    });
    expect(screen.getByText(/Minhas ordens: atribuídas a você/i)).toBeInTheDocument();
  });

  it('explains each non-deadline dispatch segment without inventing data', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', createServiceOrdersFetchMock());
    renderWithProviders(<ServiceOrdersListPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'OS-2026-DEMO01' })).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText('Filtro operacional'), 'unscheduled');
    await waitFor(() => {
      expect(screen.getByText(/sem janela operacional ativa/i)).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText('Filtro operacional'), 'unassigned');
    await waitFor(() => {
      expect(screen.getByText(/sem empregado atribuído por alocação ativa/i)).toBeInTheDocument();
    });
  });

  it('shows the dispatch projection columns without inventing assignment', async () => {
    const fetchMock = createServiceOrdersFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<ServiceOrdersListPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'OS-2026-DEMO01' })).toBeInTheDocument();
    });

    expect(screen.getByRole('columnheader', { name: 'Responsável' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Prazo' })).toBeInTheDocument();
    // Sem alocacao ativa a listagem declara a ausencia em vez de fabricar responsavel.
    expect(screen.getByText('Sem responsável')).toBeInTheDocument();
    expect(screen.getByText('Sem prazo')).toBeInTheDocument();
  });
});
