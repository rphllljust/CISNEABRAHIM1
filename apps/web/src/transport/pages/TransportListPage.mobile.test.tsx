import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TransportListPage } from './TransportListPage';

const listTransportServiceOrders = vi.fn();
const useMediaQuery = vi.fn();

vi.mock('../api/transport-api', () => ({
  listTransportServiceOrders,
}));
vi.mock('../../shell/hooks/useMediaQuery', () => ({
  useMediaQuery,
}));
vi.mock('../../auth/context/AuthProvider', () => ({
  useOptionalIdentityId: () => 'test-identity',
}));
vi.mock('../../engine', async (original) => {
  const engine = await original<typeof import('../../engine')>();
  return {
    ...engine,
    useSavedViews: () => ({
      views: [],
      persistedLocally: false,
      persistable: false,
      save: vi.fn(),
      remove: vi.fn(),
    }),
    DynamicSavedViewsBar: () => null,
  };
});
vi.mock('../../service-orders/components/OperationalArchetypeContext', () => ({
  OperationalArchetypeContext: ({ serviceOrderId }: { serviceOrderId: string }) => (
    <p data-testid="real-order-context">Authorized OS detail: {serviceOrderId}</p>
  ),
}));

const order = {
  id: '11111111-1111-4111-8111-111111111111',
  orderNumber: 'OS-TRANSPORT-001',
  status: 'RELEASED',
  clientId: '22222222-2222-4222-8222-222222222222',
  clientSnapshot: { name: 'Cliente Teste' },
  location: { origin: 'Porto Velho', destination: 'Ariquemes' },
  updatedAt: '2026-11-05T12:00:00Z',
};

describe('Transport worklist responsive context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMediaQuery.mockReturnValue(false);
    listTransportServiceOrders.mockResolvedValue({
      items: [order], limit: 20, offset: 0, total: 1, hasMore: false,
    });
  });

  it('opens the OS context and its real actions on mobile, then closes it', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><TransportListPage /></MemoryRouter>);
    await user.click(await screen.findByRole('button', {
      name: 'Ver contexto da OS OS-TRANSPORT-001',
    }));
    const drawer = await screen.findByRole('dialog', { name: 'Transporte OS-TRANSPORT-001' });
    expect(drawer).toBeInTheDocument();
    expect(screen.getByTestId('real-order-context')).toHaveTextContent(order.id);
    await user.click(screen.getByTestId('dynamic-context-drawer-close'));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Transporte OS-TRANSPORT-001' })).not.toBeInTheDocument();
    });
  });

  it('keeps the desktop inline context and avoids a second drawer', async () => {
    useMediaQuery.mockReturnValue(true);
    render(<MemoryRouter><TransportListPage /></MemoryRouter>);
    await userEvent.setup().click(await screen.findByRole('button', {
      name: 'Ver contexto da OS OS-TRANSPORT-001',
    }));
    expect(screen.getByTestId('real-order-context')).toHaveTextContent(order.id);
    expect(screen.queryByRole('dialog', { name: 'Transporte OS-TRANSPORT-001' })).not.toBeInTheDocument();
  });
});
