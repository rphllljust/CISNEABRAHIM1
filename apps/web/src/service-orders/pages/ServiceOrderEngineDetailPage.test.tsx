import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../../auth/storage/token-store';
import { renderServiceOrderRoutes } from '../../test/render-service-order-routes';
import {
  createServiceOrdersFetchMock,
  MOCK_SERVICE_ORDER_ID,
} from '../../test/service-orders-fetch-mock';
import type { ServiceOrderControlCenter } from '../types/service-order.types';

const blockedControlCenter: ServiceOrderControlCenter = {
  progression: [
    {
      code: 'DEMAND',
      state: 'DONE',
      at: '2026-10-17T06:17:17.377Z',
      detail: 'Ordem criada diretamente',
      ownerStatus: 'DRAFT',
    },
    {
      code: 'PLANNING',
      state: 'CURRENT',
      at: null,
      detail: 'Nenhum recurso planejado',
      ownerStatus: 'DRAFT',
    },
    { code: 'RELEASE', state: 'PENDING', at: null, detail: null, ownerStatus: 'DRAFT' },
    { code: 'EXECUTION', state: 'PENDING', at: null, detail: 'Nenhum apontamento registrado', ownerStatus: 'DRAFT' },
    { code: 'COMPLETION', state: 'PENDING', at: null, detail: null, ownerStatus: 'DRAFT' },
    { code: 'MEASUREMENT', state: 'PENDING', at: null, detail: null, ownerStatus: null },
    { code: 'BILLING', state: 'PENDING', at: null, detail: null, ownerStatus: null },
  ],
  plannedVsActual: {
    plannedResources: 0,
    activeAllocations: 0,
    executionEntries: 0,
    executedQuantityTotal: null,
    divergences: [],
  },
  downstream: {
    measurement: { count: 0, status: null, createdAt: null },
    billing: {
      count: 0,
      status: null,
      createdAt: null,
      totalAmount: null,
      currencyCode: null,
    },
  },
  nextAction: {
    step: 'WAITING',
    transition: null,
    availableTransitions: ['cancel'],
    blockers: ['SERVICE_DEFINITION_REQUIRED'],
  },
};

describe('ServiceOrderEngineDetailPage record-specific commands', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('hides prepare but keeps cancel when backend readiness blocks prepare', async () => {
    vi.stubGlobal(
      'fetch',
      createServiceOrdersFetchMock({
        orderStatus: 'DRAFT',
        controlCenter: blockedControlCenter,
      }),
    );

    renderServiceOrderRoutes(`/app/service-orders/${MOCK_SERVICE_ORDER_ID}`);

    expect(await screen.findByRole('heading', { name: 'OS-2026-DEMO01' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Preparar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeEnabled();
    expect(screen.getAllByText('Próxima ação indisponível').length).toBeGreaterThan(0);
    expect(
      screen.getAllByText('Defina um serviço antes de preparar a ordem.').length,
    ).toBeGreaterThan(0);
  });
});
