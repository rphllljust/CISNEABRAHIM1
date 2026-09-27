import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../../auth/storage/token-store';
import { renderServiceOrderRoutes } from '../../test/render-service-order-routes';
import {
  createServiceOrdersFetchMock,
  MOCK_SERVICE_ORDER_ID,
} from '../../test/service-orders-fetch-mock';

function renderControlCenter(options: Parameters<typeof createServiceOrdersFetchMock>[0] = {}) {
  vi.stubGlobal('fetch', createServiceOrdersFetchMock(options));
  renderServiceOrderRoutes(`/app/service-orders/${MOCK_SERVICE_ORDER_ID}/planning`);
  return waitFor(() => {
    expect(
      screen.getByRole('region', { name: /centro de controle operacional/i }),
    ).toBeInTheDocument();
  });
}

describe('OperationsControlCenter (service order)', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('renders the derived progression with the real owner status of each step', async () => {
    await renderControlCenter();

    expect(screen.getByRole('heading', { name: /progressão operacional/i })).toBeInTheDocument();
    const progression = screen.getByRole('heading', { name: /progressão operacional/i })
      .parentElement!;
    for (const label of [
      /^demanda$/i,
      /^planejamento$/i,
      /^liberação$/i,
      /^execução$/i,
      /^conclusão$/i,
      /^medição$/i,
      /^faturamento$/i,
    ]) {
      expect(within(progression).getByText(label)).toBeInTheDocument();
    }
    // Estado do modulo dono, nunca status paralelo do frontend.
    expect(screen.getAllByText(/^liberada$/i).length).toBeGreaterThan(0);
  });

  it('renders planned vs actual from the backend facts, including divergences', async () => {
    await renderControlCenter({
      controlCenter: {
        progression: [
          { code: 'DEMAND', state: 'DONE', at: '2026-01-01T07:00:00.000Z', detail: null, ownerStatus: 'COMPLETED' },
          { code: 'PLANNING', state: 'DONE', at: '2026-01-01T08:00:00.000Z', detail: '2 recurso(s) planejado(s)', ownerStatus: 'COMPLETED' },
          { code: 'RELEASE', state: 'DONE', at: '2026-01-01T09:00:00.000Z', detail: null, ownerStatus: 'COMPLETED' },
          { code: 'EXECUTION', state: 'DONE', at: '2026-01-01T10:00:00.000Z', detail: '3 apontamento(s)', ownerStatus: 'COMPLETED' },
          { code: 'COMPLETION', state: 'DONE', at: '2026-01-01T18:00:00.000Z', detail: null, ownerStatus: 'COMPLETED' },
          { code: 'MEASUREMENT', state: 'DONE', at: '2026-01-02T09:00:00.000Z', detail: null, ownerStatus: 'APPROVED' },
          { code: 'BILLING', state: 'DONE', at: '2026-01-03T09:00:00.000Z', detail: null, ownerStatus: 'PREPARED' },
        ],
        plannedVsActual: {
          plannedResources: 2,
          activeAllocations: 1,
          executionEntries: 3,
          executedQuantityTotal: '12.500000',
          divergences: ['PLANNED_WITHOUT_ACTIVE_ALLOCATION'],
        },
        downstream: {
          measurement: { count: 1, status: 'APPROVED', createdAt: '2026-01-02T09:00:00.000Z' },
          billing: {
            count: 1,
            status: 'PREPARED',
            createdAt: '2026-01-03T09:00:00.000Z',
            totalAmount: '15000.0000',
            currencyCode: 'BRL',
          },
        },
        nextAction: {
          step: 'MEASURE',
          transition: null,
          availableTransitions: [],
          blockers: [],
        },
      },
    });

    expect(screen.getByRole('heading', { name: /^planejado$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^realizado$/i })).toBeInTheDocument();
    expect(screen.getByText('12.500000')).toBeInTheDocument();
    expect(
      screen.getByText(/planejado com recursos, mas sem alocação ativa/i),
    ).toBeInTheDocument();
  });

  it('does not invent measurement or billing when the backend omits the block', async () => {
    await renderControlCenter();

    // Blocos zerados/nulos: ausencia autorizada ou ausencia de dado — nunca inventar.
    expect(screen.getByText(/sem medição disponível neste contexto/i)).toBeInTheDocument();
    expect(screen.getByText(/sem faturamento disponível neste contexto/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /abrir medição da os/i })).not.toBeInTheDocument();
  });

  it('surfaces the backend next action and its real blockers', async () => {
    await renderControlCenter({
      controlCenter: {
        progression: [
          { code: 'DEMAND', state: 'DONE', at: '2026-01-01T07:00:00.000Z', detail: null, ownerStatus: 'PAUSED' },
        ],
        plannedVsActual: {
          plannedResources: 1,
          activeAllocations: 0,
          executionEntries: 1,
          executedQuantityTotal: null,
          divergences: ['EXECUTED_WITHOUT_PLAN'],
        },
        downstream: {
          measurement: { count: 0, status: null, createdAt: null },
          billing: { count: 0, status: null, createdAt: null, totalAmount: null, currencyCode: null },
        },
        nextAction: {
          step: 'RESUME',
          transition: 'resume',
          availableTransitions: ['resume'],
          blockers: ['NO_ACTIVE_ALLOCATION'],
        },
      },
    });

    expect(screen.getByRole('heading', { name: /próximo passo/i })).toBeInTheDocument();
    expect(screen.getByText(/retomar execução/i)).toBeInTheDocument();
    expect(
      screen.getByText(/nenhum recurso ativo alocado para a execução/i),
    ).toBeInTheDocument();
  });
});
