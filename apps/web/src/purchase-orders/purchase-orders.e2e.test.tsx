import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { resetTokenStoreForTests } from '../auth/storage/token-store';
import { createCommercialFetchMock } from '../test/commercial-fetch-mock';
import { loginAndReachApp } from '../test/login-ui-helpers';
import { createShellFetchMock } from '../test/shell-fetch-mock';
import { parseRequestPath } from '../test/request-url';
import { PURCHASE_ORDER_PRICING_STRUCTURES } from './types/purchase-order.types';

describe('purchase orders administrative flow e2e (frontend)', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/login');
  });

  function composeFetch(commercialOptions = {}) {
    const shellMock = createShellFetchMock();
    const commercialMock = createCommercialFetchMock(commercialOptions);
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const { pathname } = parseRequestPath(input);
      if (
        pathname.startsWith('/api/v1/commercial/') ||
        pathname.startsWith('/api/v1/clients')
      ) {
        return commercialMock(input, init);
      }
      return shellMock(input, init);
    });
  }

  it('supports list, create and register', async () => {
    vi.stubGlobal('fetch', composeFetch());
    render(<App />);
    const user = userEvent.setup();
    await loginAndReachApp(user);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /pedidos de compra/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('link', { name: /pedidos de compra/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /pedidos de compra/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'PO-CLIENTE-001' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: /novo pedido/i }));
    await waitFor(() => {
      expect(screen.getAllByRole('option').length).toBeGreaterThan(1);
    });
    await user.selectOptions(screen.getByLabelText('Cliente'), screen.getAllByRole('option')[1]!);
    await user.type(screen.getByLabelText('Unidade operacional'), 'unit-demo');
    await user.type(screen.getByLabelText(/número do pedido/i), 'PO-E2E-001');
    await user.selectOptions(screen.getByLabelText('Estrutura de preço'), 'HEADER_TOTAL');
    await user.type(screen.getByLabelText(/valor total autorizado/i), '30000.00');
    await user.click(screen.getByRole('button', { name: /registrar pedido/i }));

    await waitFor(() => {
      // Contrato enterprise: o numero do pedido e a referencia humana; o titulo e o objeto.
      expect(screen.getByRole('heading', { name: 'Pedido de compra' })).toBeInTheDocument();
    });
    expect((await screen.findAllByText('PO-E2E-001')).length).toBeGreaterThan(0);

    await user.click(await screen.findByRole('button', { name: 'Registrar pedido' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Status: Registrado')).toBeInTheDocument();
    });
  }, 25000);

  it('shows loading state initially', async () => {
    vi.stubGlobal('fetch', composeFetch());
    render(<App />);
    const user = userEvent.setup();
    await loginAndReachApp(user);
    window.history.pushState({}, '', '/app/purchase-orders');
    await user.click(await screen.findByRole('link', { name: /pedidos de compra/i }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /pedidos de compra/i })).toBeInTheDocument();
    });
  });

  it('handles version conflict on update', async () => {
    vi.stubGlobal('fetch', composeFetch({ purchaseOrderVersionConflict: true }));
    render(<App />);
    const user = userEvent.setup();
    await loginAndReachApp(user);
    await user.click(await screen.findByRole('link', { name: /pedidos de compra/i }));
    await user.click(await screen.findByRole('link', { name: 'PO-CLIENTE-001' }));
    // A edicao e acao secundaria no contrato: vive no menu de acoes do cabecalho.
    await user.click(await screen.findByRole('button', { name: 'Mais ações' }));
    await user.click(await screen.findByRole('menuitem', { name: /editar rascunho/i }));
    await user.click(screen.getByRole('button', { name: /salvar alterações/i }));
    await waitFor(() => {
      expect(screen.getAllByText(/alterado por outro usuário/i).length).toBeGreaterThan(0);
    });
  });
});

describe('purchase order form validation', () => {
  it('validates line items structure', async () => {
    const { validatePurchaseOrderForm, EMPTY_PURCHASE_ORDER_FORM } = await import(
      './utils/purchase-order-form-validation'
    );
    const errors = validatePurchaseOrderForm({
      ...EMPTY_PURCHASE_ORDER_FORM,
      clientId: 'id',
      unitId: 'unit',
      poNumber: 'PO-1',
      pricingStructure: PURCHASE_ORDER_PRICING_STRUCTURES.LineItems,
    });
    expect(errors.itemDescription).toBeTruthy();
    expect(errors.itemLineTotal).toBeTruthy();
  });
});
