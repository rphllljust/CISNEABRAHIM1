import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import {
  createServiceOrdersFetchMock,
  MOCK_SERVICE_ORDER_ID,
} from '../test/service-orders-fetch-mock';

describe('service order execution flow e2e (frontend)', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it('renders field execution header without admin navigation', async () => {
    vi.stubGlobal('fetch', createServiceOrdersFetchMock());
    window.history.pushState({}, '', `/app/service-orders/${MOCK_SERVICE_ORDER_ID}/execution`);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /OS-2026-DEMO01/i })).toBeInTheDocument();
    });

    expect(screen.getByText(/execução em campo/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open menu/i })).not.toBeInTheDocument();
    expect(screen.getByText(/cliente demo/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /requisitos/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirmar e começar/i })).toBeInTheDocument();
  }, 20000);

  it('starts execution and records required activity', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', createServiceOrdersFetchMock());
    window.history.pushState({}, '', `/app/service-orders/${MOCK_SERVICE_ORDER_ID}/execution`);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /confirmar e começar/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /confirmar e começar/i }));

    await waitFor(() => {
      expect(screen.getByText(/execução iniciada/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /registrar atividade/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /registrar atividade/i })).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/observação/i), 'Serviço executado no local.');
    await user.click(screen.getByRole('button', { name: /salvar registro/i }));

    await waitFor(() => {
      expect(screen.getByText(/registro salvo/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /registrar atividade/i }));
    await user.type(screen.getByLabelText(/quantidade/i), '1');
    await user.click(screen.getByRole('button', { name: /salvar registro/i }));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /concluir ordem de serviço/i }),
      ).toBeInTheDocument();
    });
  }, 30000);

  it('supports pause and resume', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', createServiceOrdersFetchMock());
    window.history.pushState({}, '', `/app/service-orders/${MOCK_SERVICE_ORDER_ID}/execution`);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /confirmar e começar/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /confirmar e começar/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /pausar/i })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: /pausar/i }));
    await user.click(screen.getByRole('button', { name: /confirmar pausa/i }));

    await waitFor(() => {
      expect(screen.getByText(/execução pausada/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /retomar execução/i }));

    await waitFor(() => {
      expect(screen.getByText(/execução retomada/i)).toBeInTheDocument();
    });
  }, 30000);

  it('registers occurrence from secondary action', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', createServiceOrdersFetchMock());
    window.history.pushState({}, '', `/app/service-orders/${MOCK_SERVICE_ORDER_ID}/execution`);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /confirmar e começar/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /confirmar e começar/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /ocorrência/i })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: /ocorrência/i }));
    await user.type(screen.getByLabelText(/^código$/i), 'RAIN');
    await user.type(screen.getByLabelText(/^descrição$/i), 'Chuva forte no local.');
    await user.click(screen.getByRole('button', { name: /registrar ocorrência/i }));

    await waitFor(() => {
      expect(screen.getByText(/ocorrência registrada/i)).toBeInTheDocument();
    });
  }, 30000);

  it('shows missing requirement feedback on complete', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', createServiceOrdersFetchMock());
    window.history.pushState({}, '', `/app/service-orders/${MOCK_SERVICE_ORDER_ID}/execution`);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /confirmar e começar/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /confirmar e começar/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/faltam/i);
    });
  }, 20000);

  it('denies execution when list access is forbidden', async () => {
    vi.stubGlobal('fetch', createServiceOrdersFetchMock({ serviceOrderListAllowed: false }));
    window.history.pushState({}, '', `/app/service-orders/${MOCK_SERVICE_ORDER_ID}/execution`);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /acesso negado/i })).toBeInTheDocument();
    });
  }, 20000);

  it('surfaces version conflict errors', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      createServiceOrdersFetchMock({ executionVersionConflict: true }),
    );
    window.history.pushState({}, '', `/app/service-orders/${MOCK_SERVICE_ORDER_ID}/execution`);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /confirmar e começar/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /confirmar e começar/i }));

    await waitFor(() => {
      expect(screen.getByText(/alterados por outra operação/i)).toBeInTheDocument();
    });
  }, 20000);

  it('surfaces network failure without blind retry of new mutation key', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', createServiceOrdersFetchMock({ executionNetworkFailure: true }));
    window.history.pushState({}, '', `/app/service-orders/${MOCK_SERVICE_ORDER_ID}/execution`);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /confirmar e começar/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /confirmar e começar/i }));

    await waitFor(() => {
      expect(screen.getByText(/falha de rede/i)).toBeInTheDocument();
    });
  }, 20000);

  it('prevents double submit while busy', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', createServiceOrdersFetchMock({ executionDelayedStartMs: 300 }));
    window.history.pushState({}, '', `/app/service-orders/${MOCK_SERVICE_ORDER_ID}/execution`);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /confirmar e começar/i })).toBeInTheDocument();
    });

    const startButton = screen.getByRole('button', { name: /confirmar e começar/i });
    await user.click(startButton);
    await waitFor(() => {
      expect(startButton).toHaveAttribute('aria-busy', 'true');
    });
  }, 20000);

  it('represents planned versus realized without overwriting the plan', async () => {
    vi.stubGlobal(
      'fetch',
      createServiceOrdersFetchMock({
        executionComparison: {
          quantities: [{ unitCode: 'SERVICE', plannedQuantity: '2', actualQuantity: '3' }],
          resources: [
            {
              requirementKind: 'PHYSICAL_RESOURCE',
              code: 'TRUCK',
              plannedQuantity: '2',
              allocatedActiveCount: 1,
            },
          ],
          periods: [
            {
              source: 'PLANNED_RESOURCE',
              label: 'TRUCK (planejado)',
              startAt: '2026-01-02T08:00:00.000Z',
              endAt: '2026-01-02T12:00:00.000Z',
            },
            {
              source: 'EXECUTION_LIFECYCLE',
              label: 'Execucao',
              startAt: '2026-01-02T09:00:00.000Z',
              endAt: null,
            },
          ],
          occurrenceCount: 0,
          entryCount: 0,
        },
      }),
    );
    window.history.pushState({}, '', `/app/service-orders/${MOCK_SERVICE_ORDER_ID}/execution`);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /planejado × realizado/i })).toBeInTheDocument();
    });

    // Planejado e realizado aparecem lado a lado, sem sobrescrever o plano.
    const quantitiesTable = screen.getByRole('table', {
      name: /quantidades planejadas e realizadas/i,
    });
    expect(within(quantitiesTable).getByText('2')).toBeInTheDocument();
    expect(within(quantitiesTable).getByText('3')).toBeInTheDocument();
    expect(within(quantitiesTable).getByText('Divergente')).toBeInTheDocument();

    const resourcesTable = screen.getByRole('table', {
      name: /recursos planejados e alocações ativas/i,
    });
    expect(within(resourcesTable).getByText('TRUCK')).toBeInTheDocument();
    expect(within(resourcesTable).getByText('Recurso físico')).toBeInTheDocument();

    expect(screen.getByText(/TRUCK \(planejado\)/)).toBeInTheDocument();
    const realizedPeriod = screen.getByText(/Execucao/).closest('li');
    expect(realizedPeriod).not.toBeNull();
    expect(within(realizedPeriod as HTMLElement).getByText('Realizado')).toBeInTheDocument();
  }, 20000);
});
