import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { resetTokenStoreForTests } from '../auth/storage/token-store';
import { createCommercialFetchMock } from '../test/commercial-fetch-mock';
import { loginAndReachApp } from '../test/login-ui-helpers';
import { createShellFetchMock } from '../test/shell-fetch-mock';
import { parseRequestPath } from '../test/request-url';
import {
  createPurchaseOrderItemRow,
} from './utils/purchase-order-form-validation';
import { PURCHASE_ORDER_PRICING_STRUCTURES } from './types/purchase-order.types';

function purchaseOrderIdFromPath(pathname: string): string {
  const parts = pathname.split('/');
  return parts[parts.length - 1] ?? 'po-1';
}

/** No da cadeia no formato REAL do read model (`BusinessChainNode`). */
function chainNode(
  kind: string,
  id: string,
  reference: string,
  relation: 'ROOT' | 'ORIGIN' | 'RESULT',
  isRoot: boolean,
) {
  return {
    id,
    kind,
    businessReference: reference,
    status: 'ACTIVE',
    occurredAt: '2026-02-02T12:00:00.000Z',
    route: `/app/${kind.toLowerCase()}/${id}`,
    relation: isRoot ? 'ROOT' : relation,
    summary: reference,
    unitId: null,
    clientId: 'client-1',
  };
}

describe('purchase orders administrative flow e2e (frontend)', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/login');
  });

  function composeFetch(commercialOptions = {}) {    const shellMock = createShellFetchMock();
    const commercialMock = createCommercialFetchMock(commercialOptions);
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const { pathname } = parseRequestPath(input);
      if (
        pathname.startsWith('/api/v1/commercial/') ||
        pathname.startsWith('/api/v1/clients')
      ) {
        return commercialMock(input, init);
      }
      /*
       * CADEIA DE NEGOCIO: a object page do pedido le a linhagem autorizada do servidor.
       * Sem rota aqui a chamada cairia no shell mock, que nao conhece o endpoint — e a
       * pagina ficaria presa no carregamento. O mock devolve a cadeia no formato REAL do
       * read model, com o pedido como no raiz.
       */
      if (pathname.startsWith('/api/v1/business-chain/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            anchor: { kind: 'PURCHASE_ORDER', id: purchaseOrderIdFromPath(pathname) },
            nodes: [
              chainNode('CLIENT', 'client-1', 'Cliente E2E', 'ORIGIN', false),
              chainNode('SERVICE_REQUEST', 'req-1', 'SOL-E2E-001', 'ORIGIN', false),
              chainNode('PURCHASE_ORDER', purchaseOrderIdFromPath(pathname), 'PO-E2E-001', 'ROOT', true),
            ],
            milestones: [],
          }),
        } as Response;
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
    // O Cliente passou a ser escolhido pela busca humana do cadastro: o mesmo fato de negocio
    // (pedido vinculado a um Cliente autorizado) agora acontece por busca, nao por lista nativa.
    const clientSelect = await screen.findByLabelText(/^cliente/i);
    await waitFor(() => {
      expect(within(clientSelect).getAllByRole('option').length).toBeGreaterThan(1);
    });
    await user.selectOptions(clientSelect, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    await user.type(screen.getByLabelText(/^unidade operacional/i), 'unit-demo');
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
    // Mesmo fato de negocio de antes, na estrutura de itens por linha: o pedido por itens exige
    // ao menos uma linha, e cada linha exige descricao e total.
    const header = {
      ...EMPTY_PURCHASE_ORDER_FORM,
      clientId: 'id',
      unitId: 'unit',
      poNumber: 'PO-1',
      pricingStructure: PURCHASE_ORDER_PRICING_STRUCTURES.LineItems,
    };
    const withoutLines = validatePurchaseOrderForm(header);
    expect(withoutLines.itemsRequired).toBeTruthy();

    const withEmptyLine = validatePurchaseOrderForm({
      ...header,
      items: [createPurchaseOrderItemRow()],
    });
    expect(withEmptyLine.items?.[0]?.description).toBeTruthy();
    expect(withEmptyLine.items?.[0]?.lineTotal).toBeTruthy();
  });
});
