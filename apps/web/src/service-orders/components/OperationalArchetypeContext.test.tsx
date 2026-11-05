import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceOrderDetail } from '../types/service-order.types';
import { OperationalArchetypeContext } from './OperationalArchetypeContext';

const { getServiceOrder, prepareServiceOrder, releaseServiceOrder } = vi.hoisted(() => ({
  getServiceOrder: vi.fn(),
  prepareServiceOrder: vi.fn(),
  releaseServiceOrder: vi.fn(),
}));

vi.mock('../api/service-orders-api', () => ({
  getServiceOrder,
  prepareServiceOrder,
  releaseServiceOrder,
  ServiceOrdersApiError: class ServiceOrdersApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string | undefined,
      readonly kind: string,
    ) { super(kind); }
  },
}));
vi.mock('../api/service-orders-error-messages', () => ({
  mapServiceOrdersErrorToMessage: () => 'Comando não autorizado pelo domínio.',
}));

const order = {
  id: 'order-1',
  orderNumber: 'OS-001',
  status: 'DRAFT',
  rowVersion: 3,
  controlCenter: {
    nextAction: {
      step: 'Preparar a ordem',
      transition: 'prepare',
      availableTransitions: ['prepare'],
      blockers: [],
    },
    plannedVsActual: {
      plannedResources: 2,
      activeAllocations: 1,
      executionEntries: 0,
      executedQuantityTotal: null,
      divergences: [],
    },
    downstream: {
      measurement: { count: 1, status: 'APPROVED', createdAt: null },
      billing: { count: 1, status: 'PREPARED', createdAt: null, totalAmount: '200.00', currencyCode: 'BRL' },
    },
    progression: [],
  },
} as unknown as ServiceOrderDetail;

describe('OperationalArchetypeContext', () => {
  beforeEach(() => {
    getServiceOrder.mockReset();
    prepareServiceOrder.mockReset();
    releaseServiceOrder.mockReset();
    getServiceOrder.mockResolvedValue(order);
    prepareServiceOrder.mockResolvedValue(order);
    releaseServiceOrder.mockResolvedValue(order);
  });

  it('reads current backend business status and real downstream evidence', async () => {
    render(<MemoryRouter><OperationalArchetypeContext serviceOrderId="order-1" /></MemoryRouter>);
    expect(await screen.findByText('Preparar a ordem')).toBeInTheDocument();
    expect(screen.getByText('Faturamento registrado: BRL 200.00')).toBeInTheDocument();
    expect(screen.getByText('Medições')).toBeInTheDocument();
    expect(getServiceOrder).toHaveBeenCalledWith('order-1', expect.any(AbortSignal));
  });

  it('executes a versioned command only when allowed by the OS owner', async () => {
    const changed = vi.fn();
    render(<MemoryRouter><OperationalArchetypeContext serviceOrderId="order-1" onChanged={changed} /></MemoryRouter>);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Preparar OS' }));
    await waitFor(() => {
      expect(prepareServiceOrder).toHaveBeenCalledWith('order-1', 3);
      expect(changed).toHaveBeenCalledTimes(1);
    });
    expect(releaseServiceOrder).not.toHaveBeenCalled();
  });

  it('keeps the backend error visible after re-reading the record on a version conflict', async () => {
    getServiceOrder.mockResolvedValueOnce(order).mockResolvedValueOnce({
      ...order,
      rowVersion: 4,
    });
    const { ServiceOrdersApiError } = await import('../api/service-orders-api');
    prepareServiceOrder.mockRejectedValueOnce(
      new ServiceOrdersApiError(409, 'SERVICE_ORDERS_VERSION_CONFLICT', 'version_conflict'),
    );

    render(<MemoryRouter><OperationalArchetypeContext serviceOrderId="order-1" /></MemoryRouter>);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Preparar OS' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Comando não autorizado pelo domínio.');
    await waitFor(() => expect(getServiceOrder).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('alert')).toHaveTextContent('Comando não autorizado pelo domínio.');
    expect(screen.getByRole('button', { name: 'Preparar OS' })).toBeEnabled();
  });

  it('does not fabricate a command when the owner returns no transition', async () => {
    getServiceOrder.mockResolvedValueOnce({
      ...order,
      controlCenter: { ...order.controlCenter!, nextAction: {
        step: 'Sem ação disponível', transition: null, availableTransitions: [], blockers: ['Evidência pendente'],
      } },
    });
    render(<MemoryRouter><OperationalArchetypeContext serviceOrderId="order-1" /></MemoryRouter>);
    expect(await screen.findByText('Evidência pendente')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Preparar OS' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Liberar OS' })).not.toBeInTheDocument();
  });

  it('fails closed when detail access is revoked despite having list access', async () => {
    const { ServiceOrdersApiError } = await import('../api/service-orders-api');
    getServiceOrder.mockRejectedValueOnce(new ServiceOrdersApiError(403, undefined, 'denied'));
    render(<MemoryRouter><OperationalArchetypeContext serviceOrderId="order-1" /></MemoryRouter>);
    expect(await screen.findByText(/Sem autorização para consultar o detalhe/)).toBeInTheDocument();
    expect(screen.queryByText('BRL 200.00')).not.toBeInTheDocument();
  });
});
