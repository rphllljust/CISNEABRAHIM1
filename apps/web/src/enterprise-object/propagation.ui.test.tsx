import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { parseRequestPath } from '../test/request-url';
import { renderWithProviders } from '../test/render-with-providers';
import { PhysicalAssetDetailPage } from '../assets/pages/PhysicalAssetDetailPage';
import { ReceivableDetailPage } from '../finance/pages/ReceivableDetailPage';
import { PersonDetailPage } from '../people/pages/PersonDetailPage';
import { PurchaseOrderDetailPage } from '../purchase-orders/pages/PurchaseOrderDetailPage';

/**
 * PROPAGACAO DO CONTRATO DE INTERACAO ENTERPRISE
 *
 * Quatro superficies de objeto adotam as mesmas primitivas do contrato (header, fluxo,
 * proxima acao, relacoes, contexto e historico). Este spec prova, para CADA uma delas,
 * o que o contrato exige e o que nenhuma tela pode fazer:
 *
 * 1. nenhum identificador tecnico (uuid) aparece como texto;
 * 2. nenhum nome de capability aparece como texto;
 * 3. relacao nao autorizada desaparece por inteiro — sem rotulo, sem contagem e sem a
 *    palavra "oculto";
 * 4. a acao primaria so aparece quando o backend autoriza (capability real).
 */

const PO_ID = '11111111-1111-4111-8111-111111111111';
const PO_PROBE_ID = '00000000-0000-4000-8000-000000000004';
const CLIENT_ID = '22222222-2222-4222-8222-222222222222';
const PERSON_ID = '33333333-3333-4333-8333-333333333333';
const PERSON_PROBE_ID = '00000000-0000-4000-8000-000000000002';
const ASSET_ID = '44444444-4444-4444-8444-444444444444';
const ASSET_PROBE_ID = '00000000-0000-4000-8000-000000000003';
const SERVICE_ORDER_ID = '55555555-5555-4555-8555-555555555555';
const ACTOR_ID = '66666666-6666-4666-8666-666666666666';
const UNIT_ID = '77777777-7777-4777-8777-777777777777';
const RECEIVABLE_ID = '88888888-8888-4888-8888-888888888888';

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const CAPABILITY_PATTERN = /^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*){1,3}$/;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function denied(code: string): Response {
  return jsonResponse({ error: { code, message: 'Forbidden.' } }, 403);
}

function notFound(code: string): Response {
  return jsonResponse({ error: { code, message: 'Not found.' } }, 404);
}

/** Todo texto VISIVEL da arvore (nos de texto), nunca atributos como `href`. */
function visibleTexts(root: HTMLElement): string[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const out: string[] = [];
  let node = walker.nextNode();
  while (node) {
    const value = (node.textContent ?? '').trim();
    if (value.length > 0) {
      out.push(value);
    }
    node = walker.nextNode();
  }
  return out;
}

/** Regra 1 e 2 do contrato: nada de uuid e nada de capability como texto humano. */
function expectNoTechnicalText(root: HTMLElement): void {
  for (const text of visibleTexts(root)) {
    expect(text).not.toMatch(UUID_PATTERN);
    expect(text).not.toMatch(CAPABILITY_PATTERN);
  }
  expect(root.textContent ?? '').not.toMatch(/oculto/i);
}

/** Regra 3: relacao nao autorizada nao deixa vestigio nenhum na tela. */
function expectRelationAbsent(label: RegExp): void {
  expect(screen.queryByRole('region', { name: 'Relações' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: label })).not.toBeInTheDocument();
  expect(screen.queryByText(label)).not.toBeInTheDocument();
  expect(document.body.textContent ?? '').not.toMatch(/oculto/i);
}

type FetchMock = ReturnType<typeof createFetchMock>;

function requestedPaths(mock: FetchMock): string[] {
  return mock.mock.calls.map(([input]) => parseRequestPath(input).pathname);
}

/**
 * A ausencia de uma relacao so e valida depois que a sonda de autorizacao daquele
 * dominio foi REALMENTE emitida — senao o teste passaria por a pagina ainda nao ter
 * decidido nada.
 */
async function waitForProbe(mock: FetchMock, pathname: string): Promise<void> {
  await waitFor(() => {
    expect(requestedPaths(mock)).toContain(pathname);
  });
}

type MockOptions = {
  purchaseOrder?: {
    canRegister: boolean;
    canUpdate: boolean;
    canCancel: boolean;
  };
  person?: {
    canUpdate: boolean;
    canActivate: boolean;
    canDeactivate: boolean;
    status?: 'ACTIVE' | 'INACTIVE';
  };
  asset?: {
    canUpdate: boolean;
    canActivate: boolean;
    canDeactivate: boolean;
    serviceOrderRead: boolean;
  };
  receivable?: {
    serviceOrderRead: boolean;
    clientRead?: boolean;
    detailDenied?: boolean;
    /** Sobrescreve campos do titulo devolvido pelo backend (fixture de estado). */
    overrides?: Record<string, unknown>;
  };
};

function purchaseOrderDetail() {
  return {
    purchaseOrder: {
      id: PO_ID,
      internalCode: 'PC-001',
      clientId: CLIENT_ID,
      unitId: 'UN-NORDESTE',
      poNumber: 'PO-2026-0042',
      rcNumber: 'RC-7',
      issueDate: '2026-09-01',
      buyerContact: { name: 'Marina Alves' },
      serviceManager: 'Rafael Prado',
      deliveryLocation: {},
      billingLocation: {},
      currencyCode: 'BRL',
      pricingStructure: 'LINE_ITEMS',
      totalAmount: '185000.0000',
      itemsLineTotal: '185000.0000',
      paymentTerms: '30 DDL',
      paymentMethod: 'Transferência bancária',
      clientSnapshot: { tradeName: 'AMAGGI' },
      commercialSnapshot: null,
      originalDocumentId: null,
      status: 'DRAFT',
      registeredAt: null,
      cancelledAt: null,
      cancellationReason: null,
      rowVersion: 3,
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-02T10:00:00.000Z',
      consumedAmount: '0.0000',
      authorizedOverrunAmount: '0.0000',
      balance: null,
    },
    items: [
      {
        id: 'item-1',
        lineNumber: 1,
        description: 'Frete rodoviário dedicado',
        serviceDefinitionId: null,
        serviceDefinitionVersionId: null,
        serviceSnapshot: null,
        commercialSnapshot: null,
        quantity: '10.0000',
        unitCode: 'UN',
        unitPrice: '18500.0000',
        lineTotal: '185000.0000',
        rcLineReference: null,
      },
    ],
    billingRules: [
      {
        id: 'rule-1',
        ruleType: 'PO_NUMBER_REQUIRED_ON_INVOICE',
        ruleConfig: {},
        precedenceTier: '1',
        createdAt: '2026-09-01T10:00:00.000Z',
      },
    ],
    documentLinks: [],
    linked: [],
  };
}

function personDetail(status: 'ACTIVE' | 'INACTIVE') {
  return {
    id: PERSON_ID,
    memberCode: 'COL-0012',
    legalName: 'Joana Ribeiro de Souza',
    preferredName: 'Joana Ribeiro',
    defaultLaborTypeCode: 'TEC-CAMPO',
    defaultLaborTypeName: 'Técnico de campo',
    externalErpId: 'ERP-9912',
    status,
    version: 4,
    createdAt: '2026-01-05T12:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z',
    deactivatedAt: status === 'INACTIVE' ? '2026-06-01T12:00:00.000Z' : null,
    deactivationReason: status === 'INACTIVE' ? 'Afastamento temporário' : null,
    serviceOrderAllocationSupported: true,
  };
}

function physicalAsset() {
  return {
    id: ASSET_ID,
    assetCode: 'AT-0007',
    resourceTypeId: 'type-1',
    resourceTypeCode: 'TRUCK',
    resourceTypeClassification: 'VEHICLE',
    name: 'Caminhão Munck 3',
    lifecycleStatus: 'ACTIVE',
    allocationStatus: 'ALLOCATED',
    unitId: 'UN-NORDESTE',
    version: 2,
    createdAt: '2026-02-10T12:00:00.000Z',
    updatedAt: '2026-08-20T12:00:00.000Z',
    deactivatedAt: null,
    vehicle: { plate: 'ABC1D23', chassis: '9BWZZZ377VT004251', model: 'VW 8.160' },
    currentAllocation: { serviceOrderId: SERVICE_ORDER_ID, orderNumber: 'OS-2026-0101' },
    operationalLifecycle: { currentUse: null, nextUse: null, history: [], occurrences: [] },
  };
}

function receivableDetail() {
  return {
    id: RECEIVABLE_ID,
    unitId: UNIT_ID,
    clientId: CLIENT_ID,
    origin: {
      kind: 'BILLING_DOCUMENT',
      billingDocumentId: 'doc-1',
      billingRecordId: 'rec-1',
      serviceOrderId: SERVICE_ORDER_ID,
      measurementId: 'm-1',
    },
    principal: '1500.0000',
    currencyCode: 'BRL',
    dueDate: '2026-09-10',
    paymentTerms: '30 DDL',
    externalReference: 'AR-001',
    status: 'OPEN',
    remainingBalance: '1500.0000',
    settledAmount: '0.0000',
    lifecycle: 'ACTIVE',
    cancelledAt: null,
    cancelReason: null,
    rowVersion: 3,
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-02T12:00:00.000Z',
    installments: [
      { id: 'inst-1', installmentNumber: 1, principal: '1500.0000', dueDate: '2026-09-10' },
    ],
    settlements: [],
  };
}

/**
 * Stub de fetch unico para as quatro superficies.
 *
 * Cada rota responde exatamente o que o modulo pede — inclusive as sondas de capability
 * (`probe*Capabilities`), que sao a autorizacao REAL usada para decidir se uma acao ou
 * uma relacao pode aparecer.
 */
function createFetchMock(options: MockOptions = {}) {
  const po = options.purchaseOrder ?? { canRegister: true, canUpdate: true, canCancel: true };
  const person = options.person ?? { canUpdate: true, canActivate: true, canDeactivate: true };
  const asset = options.asset ?? {
    canUpdate: true,
    canActivate: true,
    canDeactivate: true,
    serviceOrderRead: true,
  };
  const receivable = options.receivable ?? { serviceOrderRead: true, clientRead: true };

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { pathname } = parseRequestPath(input);
    const method = (init?.method ?? 'GET').toUpperCase();

    if (pathname === '/api/v1/auth/session' && method === 'GET') {
      return jsonResponse({
        identityId: ACTOR_ID,
        session: { id: 'session-1', expiresAt: '2026-12-31T00:00:00.000Z', status: 'ACTIVE' },
      });
    }
    if (pathname === '/api/v1/authz/probe' && method === 'GET') {
      return jsonResponse({ status: 'ok' });
    }

    // ---- Pedido de compra -------------------------------------------------
    if (pathname === '/api/v1/commercial/purchase-orders' && method === 'GET') {
      return jsonResponse({ items: [], limit: 1, offset: 0 });
    }
    if (pathname === '/api/v1/commercial/purchase-orders' && method === 'POST') {
      return jsonResponse({ error: { code: 'COMMERCIAL_VALIDATION_FAILED' } }, 400);
    }
    if (pathname === `/api/v1/commercial/purchase-orders/${PO_ID}` && method === 'GET') {
      return jsonResponse(purchaseOrderDetail());
    }
    if (pathname === `/api/v1/commercial/purchase-orders/${PO_PROBE_ID}` && method === 'GET') {
      return notFound('COMMERCIAL_PURCHASE_ORDER_NOT_FOUND');
    }
    if (pathname === `/api/v1/commercial/purchase-orders/${PO_PROBE_ID}` && method === 'PATCH') {
      return po.canUpdate
        ? jsonResponse({ error: { code: 'COMMERCIAL_VALIDATION_FAILED' } }, 400)
        : denied('COMMERCIAL_DENIED');
    }
    if (
      pathname === `/api/v1/commercial/purchase-orders/${PO_PROBE_ID}/register` &&
      method === 'POST'
    ) {
      return po.canRegister
        ? jsonResponse({ error: { code: 'COMMERCIAL_PURCHASE_ORDER_INVALID_STATE' } }, 409)
        : denied('COMMERCIAL_DENIED');
    }
    if (
      pathname === `/api/v1/commercial/purchase-orders/${PO_PROBE_ID}/cancel` &&
      method === 'POST'
    ) {
      return po.canCancel
        ? jsonResponse({ error: { code: 'COMMERCIAL_PURCHASE_ORDER_INVALID_STATE' } }, 409)
        : denied('COMMERCIAL_DENIED');
    }

    // ---- Pessoa -----------------------------------------------------------
    if (pathname === '/api/v1/people' && method === 'GET') {
      return jsonResponse({ items: [], limit: 1, offset: 0 });
    }
    if (pathname === '/api/v1/people' && method === 'POST') {
      return jsonResponse({ error: { code: 'PERSON_VALIDATION_FAILED' } }, 400);
    }
    if (pathname === `/api/v1/people/${PERSON_PROBE_ID}` && method === 'GET') {
      return notFound('PERSON_NOT_FOUND');
    }
    if (pathname === `/api/v1/people/${PERSON_PROBE_ID}` && method === 'PATCH') {
      return person.canUpdate
        ? jsonResponse({ error: { code: 'PERSON_VALIDATION_FAILED' } }, 400)
        : denied('PERSON_DENIED');
    }
    if (pathname === `/api/v1/people/${PERSON_PROBE_ID}/deactivate` && method === 'POST') {
      return person.canDeactivate
        ? jsonResponse({ error: { code: 'PERSON_VALIDATION_FAILED' } }, 400)
        : denied('PERSON_DENIED');
    }
    if (pathname === `/api/v1/people/${PERSON_PROBE_ID}/activate` && method === 'POST') {
      return person.canActivate
        ? jsonResponse({ error: { code: 'PERSON_VALIDATION_FAILED' } }, 400)
        : denied('PERSON_DENIED');
    }
    if (pathname === `/api/v1/people/${PERSON_ID}` && method === 'GET') {
      return jsonResponse(personDetail(person.status ?? 'INACTIVE'));
    }
    if (pathname === `/api/v1/people/${PERSON_ID}/history` && method === 'GET') {
      return jsonResponse({
        items: [
          {
            id: 'ev-2',
            eventType: 'DEACTIVATED',
            payload: { reason: 'Afastamento temporário' },
            actorIdentityId: ACTOR_ID,
            occurredAt: '2026-06-01T12:00:00.000Z',
          },
          {
            id: 'ev-1',
            eventType: 'CREATED',
            payload: {},
            actorIdentityId: ACTOR_ID,
            occurredAt: '2026-01-05T12:00:00.000Z',
          },
        ],
      });
    }

    // ---- Ativo fisico -----------------------------------------------------
    if (pathname === '/api/v1/resources/physical-assets' && method === 'GET') {
      return jsonResponse({ items: [], limit: 1, offset: 0, total: 0 });
    }
    if (pathname === '/api/v1/resources/physical-assets' && method === 'POST') {
      return jsonResponse({ error: { code: 'ASSET_VALIDATION_FAILED' } }, 400);
    }
    if (pathname === '/api/v1/resources/physical-resource-types' && method === 'GET') {
      return jsonResponse({
        items: [
          {
            id: 'type-1',
            code: 'TRUCK',
            name: 'Caminhão munck',
            classification: 'VEHICLE',
            status: 'ACTIVE',
          },
        ],
      });
    }
    if (pathname === `/api/v1/resources/physical-assets/${ASSET_ID}` && method === 'GET') {
      return jsonResponse(physicalAsset());
    }
    if (pathname === `/api/v1/resources/physical-assets/${ASSET_PROBE_ID}` && method === 'GET') {
      return notFound('ASSET_NOT_FOUND');
    }
    if (pathname === `/api/v1/resources/physical-assets/${ASSET_PROBE_ID}` && method === 'PATCH') {
      return asset.canUpdate
        ? jsonResponse({ error: { code: 'ASSET_VALIDATION_FAILED' } }, 400)
        : denied('ASSET_DENIED');
    }
    if (
      pathname === `/api/v1/resources/physical-assets/${ASSET_PROBE_ID}/deactivate` &&
      method === 'POST'
    ) {
      return asset.canDeactivate
        ? jsonResponse({ error: { code: 'ASSET_VALIDATION_FAILED' } }, 400)
        : denied('ASSET_DENIED');
    }
    if (
      pathname === `/api/v1/resources/physical-assets/${ASSET_PROBE_ID}/activate` &&
      method === 'POST'
    ) {
      return asset.canActivate
        ? jsonResponse({ error: { code: 'ASSET_VALIDATION_FAILED' } }, 400)
        : denied('ASSET_DENIED');
    }

    // ---- Ordem de servico (autorizacao da relacao) ------------------------
    if (pathname === '/api/v1/service-orders' && method === 'GET') {
      const allowed =
        options.asset?.serviceOrderRead !== false && options.receivable?.serviceOrderRead !== false;
      return allowed
        ? jsonResponse({ items: [], limit: 1, offset: 0 })
        : denied('SERVICE_ORDER_DENIED');
    }

    // ---- Titulo a receber -------------------------------------------------
    if (pathname === `/api/v1/finance/receivables/${RECEIVABLE_ID}` && method === 'GET') {
      return receivable.detailDenied
        ? denied('FINANCE_DENIED')
        : jsonResponse({ ...receivableDetail(), ...(receivable.overrides ?? {}) });
    }
    if (
      pathname === `/api/v1/finance/receivables/${RECEIVABLE_ID}/collections/current` &&
      method === 'GET'
    ) {
      return notFound('FINANCE_NOT_FOUND');
    }
    if (pathname === `/api/v1/clients/${CLIENT_ID}` && method === 'GET') {
      return receivable.clientRead === false
        ? denied('CLIENT_DENIED')
        : jsonResponse({
            id: CLIENT_ID,
            legalName: 'AMAGGI Agro Industrial LTDA',
            tradeName: 'AMAGGI Agro',
            taxId: '12345678000199',
            externalErpId: null,
            status: 'ACTIVE',
            version: 1,
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            deactivatedAt: null,
            deactivationReason: null,
            purchaseOrderRequirement: 'OPTIONAL',
            contacts: [],
            addresses: [],
          });
    }

    return notFound('UNKNOWN');
  });
}

function renderPurchaseOrder() {
  return renderWithProviders(
    <Routes>
      <Route path="/app/purchase-orders/:purchaseOrderId" element={<PurchaseOrderDetailPage />} />
    </Routes>,
    { router: { initialEntries: [`/app/purchase-orders/${PO_ID}`] } },
  );
}

function renderPerson() {
  return renderWithProviders(
    <Routes>
      <Route path="/app/people/:personId" element={<PersonDetailPage />} />
    </Routes>,
    { router: { initialEntries: [`/app/people/${PERSON_ID}`] } },
  );
}

function renderAsset() {
  return renderWithProviders(
    <Routes>
      <Route path="/app/assets/:assetId" element={<PhysicalAssetDetailPage />} />
    </Routes>,
    { router: { initialEntries: [`/app/assets/${ASSET_ID}`] } },
  );
}

function renderReceivable() {
  return renderWithProviders(
    <Routes>
      <Route path="/app/finance/receivables/:receivableId" element={<ReceivableDetailPage />} />
    </Routes>,
    { router: { initialEntries: [`/app/finance/receivables/${RECEIVABLE_ID}`] } },
  );
}

describe('Contrato enterprise — propagação: pedido de compra', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('apresenta referência, cliente, estado, fluxo, contexto e histórico persistidos', async () => {
    vi.stubGlobal('fetch', createFetchMock());
    const { container } = renderPurchaseOrder();

    await waitFor(() => {
      expect(screen.getAllByText('PO-2026-0042').length).toBeGreaterThan(0);
    });

    // Referencia humana (cabecalho e breadcrumb) e cliente por NOME, nunca por uuid.
    expect(screen.getAllByText('PO-2026-0042').length).toBeGreaterThan(0);
    expect(screen.getAllByText('AMAGGI').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Rascunho').length).toBeGreaterThan(0);
    // Fluxo real: rascunho -> registrado -> cancelado, com o estado corrente marcado.
    const flow = screen.getByRole('region', { name: 'Fluxo do pedido de compra' });
    expect(within(flow).getByText('Rascunho')).toHaveAttribute('aria-current', 'step');
    expect(within(flow).getByText('Registrado')).toBeInTheDocument();
    expect(within(flow).getByText('Cancelado')).toBeInTheDocument();
    // Contexto e historico apenas com fatos persistidos.
    expect(screen.getByText('Rafael Prado')).toBeInTheDocument();
    expect(screen.getByText('Marina Alves')).toBeInTheDocument();
    expect(screen.getByText('Pedido criado')).toBeInTheDocument();

    expectNoTechnicalText(container);
  });

  it('oferece a ação primária e a destrutiva separada somente com capability', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', createFetchMock());
    renderPurchaseOrder();

    const register = await screen.findByRole('button', { name: 'Registrar pedido' });
    expect(register).toBeEnabled();
    // Ação destrutiva não fica exposta ao lado da primária.
    expect(screen.queryByRole('button', { name: 'Cancelar pedido' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Mais ações' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Cancelar pedido' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Editar rascunho' })).toBeInTheDocument();
  });

  it('não oferece ação nenhuma quando o backend não autoriza registro, edição ou cancelamento', async () => {
    vi.stubGlobal(
      'fetch',
      createFetchMock({ purchaseOrder: { canRegister: false, canUpdate: false, canCancel: false } }),
    );
    renderPurchaseOrder();

    await screen.findByRole('heading', { name: 'Pedido de compra' });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Registrar pedido' })).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Mais ações' })).not.toBeInTheDocument();
    // Sem permissão de escrita o objeto continua legível.
    expect(screen.getAllByText('PO-2026-0042').length).toBeGreaterThan(0);
  });
});

describe('Contrato enterprise — propagação: pessoa', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('mostra referência humana, fluxo real, histórico persistido e a próxima ação de reativação', async () => {
    vi.stubGlobal('fetch', createFetchMock({ person: { canUpdate: true, canActivate: true, canDeactivate: true } }));
    const { container } = renderPerson();

    await waitFor(() => {
      expect(screen.getAllByText('COL-0012').length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText('COL-0012').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Joana Ribeiro de Souza').length).toBeGreaterThan(0);
    // Situacao cadastral: o estado persistido aparece no cabecalho e no fluxo.
    expect(screen.getAllByText('Inativa').length).toBeGreaterThan(0);
    const flow = screen.getByRole('region', { name: 'Situação cadastral da Pessoa' });
    expect(within(flow).getByText('Inativa')).toHaveAttribute('aria-current', 'step');
    expect(within(flow).getByText('Ativa')).toBeInTheDocument();
    expect(screen.getAllByText('Técnico de campo').length).toBeGreaterThan(0);

    const nextAction = await screen.findByRole('region', { name: 'Próxima ação' });
    expect(within(nextAction).getAllByText('Reativar a Pessoa').length).toBeGreaterThan(0);

    // Historico: rotulo humano do evento persistido e o motivo gravado — nunca o ator tecnico.
    expect(screen.getByText('Pessoa inativada')).toBeInTheDocument();
    expect(screen.getByText('Cadastro criado')).toBeInTheDocument();
    expect(screen.getAllByText('Afastamento temporário').length).toBeGreaterThan(0);
    expect(container.textContent ?? '').not.toContain(ACTOR_ID);

    expectNoTechnicalText(container);
  });

  it('declara a espera quando o próximo passo pertence ao planejamento da OS', async () => {
    vi.stubGlobal(
      'fetch',
      createFetchMock({
        person: { canUpdate: true, canActivate: false, canDeactivate: true, status: 'ACTIVE' },
      }),
    );
    renderPerson();

    const nextAction = await screen.findByRole('region', { name: 'Próxima ação' });
    expect(within(nextAction).getByText('Aguardar alocação em ordem de serviço')).toBeInTheDocument();
    expect(
      within(nextAction).getByText('Responsável: Planejamento da ordem de serviço'),
    ).toBeInTheDocument();
    // Espera de terceiro não oferece botão.
    expect(within(nextAction).queryByRole('button')).not.toBeInTheDocument();
  });

  it('não oferece edição quando a capability de atualização é negada', async () => {
    vi.stubGlobal(
      'fetch',
      createFetchMock({
        person: { canUpdate: false, canActivate: true, canDeactivate: false, status: 'ACTIVE' },
      }),
    );
    renderPerson();

    await screen.findByRole('heading', { name: 'Joana Ribeiro' });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Editar cadastro' })).not.toBeInTheDocument();
    });
  });
});

describe('Contrato enterprise — propagação: ativo físico', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('mostra nome do tipo de recurso, alocação vigente e a relação autorizada com a OS', async () => {
    vi.stubGlobal('fetch', createFetchMock());
    const { container } = renderAsset();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Caminhão Munck 3' })).toBeInTheDocument();
    });

    expect(screen.getAllByText('AT-0007').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Caminhão munck').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ativo').length).toBeGreaterThan(0);

    // Relação real (alocação vigente) com destino real e autorizado.
    const relations = await screen.findByRole('region', { name: 'Relações' });
    expect(within(relations).getByRole('link', { name: /Ordem de serviço alocada/ })).toHaveAttribute(
      'href',
      `/app/service-orders/${SERVICE_ORDER_ID}/planning`,
    );
    expect(within(relations).getByText('1')).toBeInTheDocument();

    // Próxima ação declarada com o responsável real do próximo passo.
    const nextAction = await screen.findByRole('region', { name: 'Próxima ação' });
    expect(within(nextAction).getByText('Aguardar a liberação da alocação')).toBeInTheDocument();
    expect(within(nextAction).getByText('Responsável: Ordem de serviço OS-2026-0101')).toBeInTheDocument();

    // Histórico somente com marcos persistidos do cadastro.
    expect(screen.getByText('Ativo cadastrado')).toBeInTheDocument();

    expectNoTechnicalText(container);
  });

  it('remove a relação por inteiro quando a leitura de ordens de serviço é negada', async () => {
    const mock = createFetchMock({
      asset: { canUpdate: true, canActivate: true, canDeactivate: true, serviceOrderRead: false },
    });
    vi.stubGlobal('fetch', mock);
    const { container } = renderAsset();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Caminhão Munck 3' })).toBeInTheDocument();
    });
    // A sonda da relação foi emitida e negada pelo servidor.
    await waitForProbe(mock, '/api/v1/service-orders');

    expectRelationAbsent(/Ordem de serviço alocada/);
    // O fato continua visível como contexto: a alocação vigente é persistida.
    expect(screen.getAllByText('OS-2026-0101').length).toBeGreaterThan(0);
    expectNoTechnicalText(container);
  });

  it('separa a ação destrutiva no menu de ações secundárias', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', createFetchMock());
    renderAsset();

    await screen.findByRole('heading', { name: 'Caminhão Munck 3' });
    expect(await screen.findByRole('button', { name: 'Editar cadastro' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desativar ativo' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mais ações' }));
    expect(
      within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Desativar ativo' }),
    ).toBeInTheDocument();
  });

  it('não oferece ação nenhuma quando as capabilities de cadastro são negadas', async () => {
    vi.stubGlobal(
      'fetch',
      createFetchMock({
        asset: { canUpdate: false, canActivate: false, canDeactivate: false, serviceOrderRead: true },
      }),
    );
    renderAsset();

    await screen.findByRole('heading', { name: 'Caminhão Munck 3' });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Editar cadastro' })).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Mais ações' })).not.toBeInTheDocument();
  });
});

describe('Contrato enterprise — propagação: conta a receber', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('resolve o cliente por nome, sem uuid, com fluxo, espera e relação autorizada', async () => {
    vi.stubGlobal('fetch', createFetchMock());
    const { container } = renderReceivable();

    await waitFor(() => {
      expect(screen.getAllByText('AR-001').length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText('AR-001').length).toBeGreaterThan(0);
    // O nome humano vem do cadastro de Clientes; o uuid do vínculo nunca é texto.
    await waitFor(() => {
      expect(screen.getAllByText('AMAGGI Agro').length).toBeGreaterThan(0);
    });
    expect(screen.queryByText(CLIENT_ID)).not.toBeInTheDocument();
    const flow = await screen.findByRole('region', { name: 'Fluxo do título a receber' });
    expect(within(flow).getByText('Em aberto')).toHaveAttribute('aria-current', 'step');
    expect(within(flow).getByText('Parcialmente recebido')).toBeInTheDocument();
    expect(within(flow).getByText('Recebido')).toBeInTheDocument();
    expect(screen.getByText('Documento de faturamento')).toBeInTheDocument();

    const nextAction = await screen.findByRole('region', { name: 'Próxima ação' });
    expect(within(nextAction).getByText('Aguardar recebimento do título')).toBeInTheDocument();
    expect(within(nextAction).getByText('Responsável: AMAGGI Agro')).toBeInTheDocument();

    const relations = await screen.findByRole('region', { name: 'Relações' });
    expect(within(relations).getByRole('link', { name: /Ordem de serviço faturada/ })).toHaveAttribute(
      'href',
      `/app/service-orders/${SERVICE_ORDER_ID}/planning`,
    );

    expectNoTechnicalText(container);
  });

  it('omite unidade que chega como identificador técnico em vez de imprimir uuid', async () => {
    vi.stubGlobal('fetch', createFetchMock());
    const { container } = renderReceivable();

    await screen.findByRole('heading', { name: 'Conta a receber' });
    // `unitId` do título é uuid: a guarda do contrato omite o campo por inteiro.
    expect(screen.queryByText('Unidade')).not.toBeInTheDocument();
    expect(container.textContent ?? '').not.toContain(UNIT_ID);
  });

  it('remove a relação por inteiro quando a leitura de ordens de serviço é negada', async () => {
    const mock = createFetchMock({ receivable: { serviceOrderRead: false } });
    vi.stubGlobal('fetch', mock);
    const { container } = renderReceivable();

    await screen.findByRole('heading', { name: 'Conta a receber' });
    await waitForProbe(mock, '/api/v1/service-orders');

    expectRelationAbsent(/Ordem de serviço faturada/);
    // O fato persistido continua declarado, sem oferecer navegacao para o dominio negado.
    expect(screen.getByText('Documento de faturamento')).toBeInTheDocument();
    expectNoTechnicalText(container);
  });

  it('mantém o título legível mas sem cliente quando a leitura do cadastro é negada', async () => {
    vi.stubGlobal('fetch', createFetchMock({ receivable: { serviceOrderRead: true, clientRead: false } }));
    renderReceivable();

    await screen.findByRole('heading', { name: 'Conta a receber' });
    await waitFor(() => {
      expect(screen.queryByText('AMAGGI Agro')).not.toBeInTheDocument();
    });
    // Sem o nome autorizado o fato é OMITIDO — nunca substituído por identificador técnico.
    expect(screen.queryByText('Cliente')).not.toBeInTheDocument();
    expect(screen.getAllByText('AR-001').length).toBeGreaterThan(0);
  });

  it('negação de leitura do título aparece como negação, não como registro vazio', async () => {
    vi.stubGlobal('fetch', createFetchMock({ receivable: { serviceOrderRead: true, detailDenied: true } }));
    renderReceivable();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/permissão/i);
    });
    expect(screen.queryByText(/não está mais disponível/i)).not.toBeInTheDocument();
  });

  it('em título cancelado não declara próxima ação e mantém as ações de estado bloqueadas', async () => {
    vi.stubGlobal(
      'fetch',
      createFetchMock({
        receivable: {
          serviceOrderRead: true,
          overrides: {
            status: 'CANCELLED',
            lifecycle: 'CANCELLED',
            cancelledAt: '2026-08-20T12:00:00.000Z',
            cancelReason: 'Faturamento emitido em duplicidade',
          },
        },
      }),
    );
    renderReceivable();

    await waitFor(() => {
      expect(screen.getAllByText('AR-001').length).toBeGreaterThan(0);
    });
    const flow = screen.getByRole('region', { name: 'Fluxo do título a receber' });
    expect(within(flow).getByText('Cancelado')).toHaveAttribute('aria-current', 'step');
    // Título encerrado não tem proximo passo declarado: a secao inteira desaparece.
    expect(screen.queryByRole('region', { name: 'Próxima ação' })).not.toBeInTheDocument();
    // As acoes reais de liquidacao/cancelamento continuam bloqueadas pela regra de estado.
    expect(screen.getByRole('button', { name: 'Receber' })).toBeDisabled();
    expect(screen.getAllByText('Faturamento emitido em duplicidade').length).toBeGreaterThan(0);
  });
});
