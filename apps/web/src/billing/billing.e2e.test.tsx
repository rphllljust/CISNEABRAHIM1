import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import {
  createServiceOrdersFetchMock,
  MOCK_SERVICE_ORDER_ID,
} from '../test/service-orders-fetch-mock';

describe('billing administration e2e (frontend)', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it('renders billing dashboard route', async () => {
    vi.stubGlobal(
      'fetch',
      createServiceOrdersFetchMock({
        orderCompleted: true,
        seedMeasurement: 'approved',
        seedBilling: 'prepared',
      }),
    );
    window.history.pushState({}, '', '/app/billing');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /^faturamento interno$/i })).toBeInTheDocument();
    });
  });

  it('navigates from dashboard card to billing detail', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      createServiceOrdersFetchMock({
        orderCompleted: true,
        seedMeasurement: 'approved',
        seedBilling: 'prepared',
      }),
    );
    window.history.pushState({}, '', '/app/billing');
    render(<App />);

    await waitFor(
      () => {
        expect(screen.getByText('OS-2026-DEMO01')).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    const orderRow = screen.getByText('OS-2026-DEMO01').closest('tr');
    expect(orderRow).not.toBeNull();
    await user.click(within(orderRow as HTMLElement).getByRole('link', { name: /preparar faturamento/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /itens faturáveis/i })).toBeInTheDocument();
    });
    expect(window.location.pathname).toBe(`/app/service-orders/${MOCK_SERVICE_ORDER_ID}/billing`);
  });

  it('prepares billing from detail page', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      createServiceOrdersFetchMock({
        orderCompleted: true,
        seedMeasurement: 'approved',
        purchaseOrderPaymentTerms: '30 DDL',
      }),
    );
    window.history.pushState({}, '', `/app/service-orders/${MOCK_SERVICE_ORDER_ID}/billing`);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /preparar faturamento/i })).toBeEnabled();
    });

    await user.click(screen.getByRole('button', { name: /preparar faturamento/i }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: /confirmar preparação/i }));

    await waitFor(() => {
      expect(screen.getByText(/preparação de faturamento concluída/i)).toBeInTheDocument();
    });
  });
});
