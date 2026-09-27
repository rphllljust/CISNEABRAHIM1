import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { renderWithProviders } from '../test/render-with-providers';
import { PurchaseOrderCreatePage } from './pages/PurchaseOrderCreatePage';

/**
 * Tela de registro do pedido de compra na gramatica do STRUCTURED BUILDER.
 *
 * As provas aqui sao de NEGOCIO e de CONTRATO DE INTERACAO: repetidor de itens com remocao
 * confirmada, dinheiro normalizado pelo `CurrencyField`, entrada monetaria invalida recusada
 * inline, acao principal coerente com a validade real e nenhum controle sem nome acessivel.
 */

const CLIENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(code: string, status: number): Response {
  return jsonResponse({ error: { code, message: 'error' } }, status);
}

type CapturedCreate = { payloads: Array<Record<string, unknown>> };

function createPurchaseOrderCreateFetchMock(captured: CapturedCreate = { payloads: [] }) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw, 'http://127.0.0.1');
    const pathname = url.pathname;
    const method = (init?.method ?? 'GET').toUpperCase();

    if (pathname === '/api/v1/auth/session' && method === 'GET') {
      return jsonResponse({
        identityId: '00000000-0000-4000-8000-000000000001',
        session: { id: 'sid', expiresAt: '2026-12-31T00:00:00.000Z', status: 'ACTIVE' },
      });
    }

    if (pathname === '/api/v1/clients' && method === 'GET') {
      return jsonResponse({
        items: [
          {
            id: CLIENT_ID,
            legalName: 'Cliente Demonstração LTDA',
            tradeName: 'Demo',
            taxId: '11222333000181',
            status: 'ACTIVE',
            createdAt: '2026-01-01T12:00:00.000Z',
            updatedAt: '2026-01-01T12:00:00.000Z',
          },
        ],
        limit: 20,
        offset: 0,
        total: 1,
        totalPages: 1,
      });
    }

    if (pathname === '/api/v1/commercial/purchase-orders' && method === 'POST') {
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<
        string,
        unknown
      >;
      // A sonda de capacidade envia corpo vazio; o registro real manda o cliente.
      if (typeof body['clientId'] !== 'string' || body['clientId'].length === 0) {
        return errorResponse('COMMERCIAL_VALIDATION_FAILED', 400);
      }
      captured.payloads.push(body);
      return jsonResponse(
        {
          purchaseOrder: {
            id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            internalCode: 'PO-2026-UI01',
            clientId: body['clientId'],
            unitId: body['unitId'],
            poNumber: body['poNumber'],
            rcNumber: null,
            issueDate: null,
            buyerContact: {},
            serviceManager: null,
            deliveryLocation: {},
            billingLocation: {},
            currencyCode: 'BRL',
            pricingStructure: body['pricingStructure'],
            totalAmount: null,
            itemsLineTotal: null,
            paymentTerms: null,
            paymentMethod: null,
            clientSnapshot: null,
            commercialSnapshot: null,
            originalDocumentId: null,
            status: 'DRAFT',
            registeredAt: null,
            cancelledAt: null,
            cancellationReason: null,
            rowVersion: 1,
            createdAt: '2026-01-01T12:00:00.000Z',
            updatedAt: '2026-01-01T12:00:00.000Z',
            consumedAmount: '0.00',
            authorizedOverrunAmount: '0.00',
            balance: null,
          },
          items: [],
          billingRules: [],
          documentLinks: [],
        },
        201,
      );
    }

    // Demais caminhos da sonda de capacidade: negado/ausente, nunca "autorizado" implicito.
    return errorResponse('COMMERCIAL_PURCHASE_ORDER_NOT_FOUND', 404);
  });
}

/**
 * Nome acessivel do controle: `aria-label`, `aria-labelledby`, `<label>` associado, texto visivel
 * ou `title` — a mesma ordem que um leitor de tela usa para anunciar o controle.
 */
function accessibleName(element: Element): string {
  const ariaLabel = element.getAttribute('aria-label')?.trim();
  if (ariaLabel) {
    return ariaLabel;
  }
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim();
    if (text) {
      return text;
    }
  }
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    const labels = element.labels ? Array.from(element.labels) : [];
    const text = labels
      .map((label) => label.textContent ?? '')
      .join(' ')
      .trim();
    if (text) {
      return text;
    }
  }
  const content = element.textContent?.trim();
  if (content) {
    return content;
  }
  return element.getAttribute('title')?.trim() ?? '';
}

async function fillHeaderTotalPurchaseOrder(
  user: ReturnType<typeof userEvent.setup>,
  amount: string,
) {
  const clientSelect = await screen.findByLabelText(/^cliente/i, { selector: 'select' });
  await waitFor(() => {
    expect(within(clientSelect).getAllByRole('option').length).toBeGreaterThan(1);
  });
  await user.selectOptions(clientSelect, CLIENT_ID);
  await user.type(
    screen.getByLabelText(/^unidade operacional/i, { selector: 'input' }),
    'UN-POA-01',
  );
  await user.type(
    screen.getByLabelText(/^número do pedido/i, { selector: 'input' }),
    'PO-UI-001',
  );
  await user.selectOptions(
    screen.getByLabelText(/^estrutura de preço/i, { selector: 'select' }),
    'HEADER_TOTAL',
  );
  await user.type(screen.getByLabelText(/^valor total autorizado/i, { selector: 'input' }), amount);
  await user.tab();
}

configure({ asyncUtilTimeout: 3000 });

describe('PurchaseOrderCreatePage — structured builder', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('adiciona e remove uma linha de item do pedido', async () => {
    vi.stubGlobal('fetch', createPurchaseOrderCreateFetchMock());
    const user = userEvent.setup();
    renderWithProviders(<PurchaseOrderCreatePage />);

    // A estrutura padrao do pedido e por itens: o repetidor abre no estado vazio declarado.
    expect(await screen.findByText(/nenhum item informado/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /adicionar item/i }));
    await user.type(
      screen.getByLabelText('Descrição', { selector: 'input' }),
      'Locação de andaimes',
    );
    expect(screen.getByText('Item 1')).toBeInTheDocument();

    // Remoção discreta, com nome acessivel explicito e confirmacao (a linha carrega dado digitado).
    await user.click(screen.getByRole('button', { name: /remover item 1/i }));
    expect(screen.getByText(/remover este item\?/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /confirmar remoção/i }));

    expect(screen.queryByText('Item 1')).not.toBeInTheDocument();
    expect(screen.getByText(/nenhum item informado/i)).toBeInTheDocument();
  });

  it('normaliza o valor total autorizado antes de registrar', async () => {
    const captured: CapturedCreate = { payloads: [] };
    vi.stubGlobal('fetch', createPurchaseOrderCreateFetchMock(captured));
    const user = userEvent.setup();
    renderWithProviders(<PurchaseOrderCreatePage />);

    await fillHeaderTotalPurchaseOrder(user, '30.000,00');

    const submit = screen.getByRole('button', { name: /registrar pedido/i });
    await waitFor(() => {
      expect(submit).toBeEnabled();
    });
    await user.click(submit);

    await waitFor(() => {
      expect(captured.payloads).toHaveLength(1);
    });
    // O que sai da tela e o decimal normalizado, nao a mascara digitada.
    expect(captured.payloads[0]).toMatchObject({
      clientId: CLIENT_ID,
      unitId: 'UN-POA-01',
      poNumber: 'PO-UI-001',
      pricingStructure: 'HEADER_TOTAL',
      currencyCode: 'BRL',
      totalAmount: '30000.00',
    });
    expect(captured.payloads[0]).not.toHaveProperty('items');
  });

  it('recusa valor monetário inválido inline e mantém o registro bloqueado', async () => {
    const captured: CapturedCreate = { payloads: [] };
    vi.stubGlobal('fetch', createPurchaseOrderCreateFetchMock(captured));
    const user = userEvent.setup();
    renderWithProviders(<PurchaseOrderCreatePage />);

    await fillHeaderTotalPurchaseOrder(user, 'R$ abc');

    expect(await screen.findByText(/informe um valor monetário válido/i)).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: /registrar pedido/i });
    expect(submit).toBeDisabled();
    expect(captured.payloads).toHaveLength(0);
  });

  it('mantém a ação principal coerente com a validade real do formulário', async () => {
    const captured: CapturedCreate = { payloads: [] };
    vi.stubGlobal('fetch', createPurchaseOrderCreateFetchMock(captured));
    const user = userEvent.setup();
    renderWithProviders(<PurchaseOrderCreatePage />);

    const submit = await screen.findByRole('button', { name: /registrar pedido/i });
    expect(submit).toBeDisabled();
    expect(screen.getByText(/falta preencher/i)).toBeInTheDocument();

    await fillHeaderTotalPurchaseOrder(user, '30000.00');

    await waitFor(() => {
      expect(submit).toBeEnabled();
    });
    expect(screen.queryByText(/falta preencher/i)).not.toBeInTheDocument();

    await user.click(submit);
    await waitFor(() => {
      expect(captured.payloads).toHaveLength(1);
    });
  });

  it('não deixa nenhum controle sem nome acessível', async () => {
    vi.stubGlobal('fetch', createPurchaseOrderCreateFetchMock());
    const user = userEvent.setup();
    const { container } = renderWithProviders(<PurchaseOrderCreatePage />);

    // Com uma linha de item o pedido fica no seu estado mais denso de controles.
    await user.click(await screen.findByRole('button', { name: /adicionar item/i }));

    const controls = Array.from(
      container.querySelectorAll('button, a, input, select, textarea'),
    );
    expect(controls.length).toBeGreaterThan(10);

    const unnamed = controls.filter((control) => accessibleName(control) === '');
    expect(unnamed.map((control) => control.outerHTML)).toEqual([]);
  });
});
