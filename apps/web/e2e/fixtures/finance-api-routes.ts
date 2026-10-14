import type { Route } from '@playwright/test';

type JsonResponse = { status: number; contentType: string; body: string };

function jsonBody(body: unknown, status = 200): JsonResponse {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill(jsonBody(body, status));
}

function hasBearerToken(route: Route): boolean {
  return route.request().headers().authorization?.startsWith('Bearer ') ?? false;
}

const EXPENSES = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    unitId: 'unit-1',
    description: 'Combustível da frota',
    costCenterCode: 'CC-OPER',
    totalAmount: '1840',
    currencyCode: 'BRL',
    dueDate: '2026-10-05',
    status: 'SUBMITTED',
    version: 2,
    createdAt: '2026-09-20T12:00:00.000Z',
  },
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    unitId: 'unit-1',
    description: 'Peças de reposição',
    costCenterCode: 'CC-MANUT',
    totalAmount: '620',
    currencyCode: 'BRL',
    dueDate: '2026-10-12',
    status: 'DRAFT',
    version: 1,
    createdAt: '2026-09-19T12:00:00.000Z',
  },
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
    unitId: 'unit-1',
    description: 'Serviço de terceiros',
    costCenterCode: 'CC-ADM',
    totalAmount: '4300',
    currencyCode: 'BRL',
    dueDate: '2026-10-20',
    status: 'APPROVED',
    version: 3,
    createdAt: '2026-09-18T12:00:00.000Z',
  },
];

const BUDGETS = [
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    unitId: 'unit-1',
    code: 'ORC-2026-OPER',
    name: 'Operação 2026',
    currencyCode: 'BRL',
    status: 'ACTIVE',
    rowVersion: 2,
    updatedAt: '2026-09-20T12:00:00.000Z',
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    unitId: 'unit-1',
    code: 'ORC-2026-MANUT',
    name: 'Manutenção 2026',
    currencyCode: 'BRL',
    status: 'INACTIVE',
    rowVersion: 1,
    updatedAt: '2026-09-15T12:00:00.000Z',
  },
];

function pageOf<T>(items: T[], route: Route, matches: (item: T, q: string) => boolean): Record<string, unknown> {
  const searchParams = new URL(route.request().url()).searchParams;
  const limit = Number(searchParams.get('limit') ?? '20');
  const offset = Number(searchParams.get('offset') ?? '0');
  const q = searchParams.get('q')?.trim().toLowerCase() ?? '';
  const matched = q.length === 0 ? items : items.filter((item) => matches(item, q));
  return {
    items: matched.slice(offset, offset + limit),
    limit,
    offset,
    total: matched.length,
    totalPages: matched.length > 0 ? 1 : 0,
  };
}

/**
 * METADATA STORE — a superfície Financeira é RENDERIZADA PELA ENGINE.
 *
 * `DynamicList` não desenha nada sem schema: a tela mostra "Carregando…" para sempre. O harness
 * não mockava `/api/v1/meta`, então a grade nunca aparecia no aceite visual e o `<table>` não
 * existia no DOM — o teste de geometria media uma tela sem grade, e o aceite de finanças falhava
 * por um MOTIVO DE FIXTURE, não por defeito de tela.
 *
 * O payload espelha o contrato de `GET /api/v1/meta/:entity` (apps/api/src/meta): campos com
 * `in_list`/`in_filter`, views com `layout`, workflow e `allowedPermLevels`. É uma CÓPIA do
 * FORMATO, não uma segunda fonte de verdade de negócio.
 */
function metaField(
  name: string,
  label: string,
  type: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name,
    label,
    type,
    required: false,
    readOnly: false,
    inList: false,
    inForm: true,
    inFilter: false,
    listOrder: 0,
    fieldOrder: 0,
    permLevel: 0,
    options: null,
    ...extra,
  };
}

const EXPENSES_META = {
  name: 'expenses',
  label: 'Despesas',
  description: null,
  dataSchema: 'fin',
  dataTable: 'expenses',
  labelField: 'description',
  fields: [
    metaField('description', 'Descrição', 'text', { inList: true, listOrder: 10 }),
    metaField('cost_center_code', 'Centro de custo', 'data', { inList: false, listOrder: 25 }),
    metaField('total_amount', 'Valor total', 'currency', {
      inList: true,
      listOrder: 30,
      aggregation: 'sum',
    }),
    metaField('due_date', 'Vencimento', 'date', { inList: true, listOrder: 40 }),
    metaField('status', 'Status', 'select', {
      inList: true,
      listOrder: 50,
      inFilter: true,
      options: {
        options: [
          { value: 'DRAFT', label: 'Rascunho' },
          { value: 'SUBMITTED', label: 'Enviada' },
          { value: 'APPROVED', label: 'Aprovada' },
          { value: 'REJECTED', label: 'Rejeitada' },
          { value: 'CANCELLED', label: 'Cancelada' },
        ],
      },
    }),
    metaField('reimbursable', 'Reembolsável', 'boolean', { inList: true, listOrder: 60 }),
    metaField('created_at', 'Criada em', 'datetime', { readOnly: true, inList: true, listOrder: 70 }),
  ],
  views: [
    {
      viewType: 'list',
      label: 'Lista de despesas',
      layout: {
        columns: [
          'description',
          'cost_center_code',
          'due_date',
          'total_amount',
          'status',
          'reimbursable',
          'created_at',
        ],
      },
      isDefault: true,
    },
  ],
  workflow: null,
  permissions: [{ action: 'read', permLevel: 0, requiredPermission: null, allowed: true }],
  allowedPermLevels: [0],
};

const BUDGETS_META = {
  name: 'budgets',
  label: 'Orçamentos',
  description: null,
  dataSchema: 'fin',
  dataTable: 'budgets',
  labelField: 'name',
  fields: [
    metaField('code', 'Código', 'data', { inList: true, listOrder: 10 }),
    metaField('name', 'Nome', 'text', { inList: true, listOrder: 20 }),
    metaField('currency_code', 'Moeda', 'data', { inList: true, listOrder: 30 }),
    metaField('status', 'Status', 'select', {
      inList: true,
      listOrder: 40,
      inFilter: true,
      options: {
        options: [
          { value: 'DRAFT', label: 'Rascunho' },
          { value: 'ACTIVE', label: 'Ativo' },
          { value: 'INACTIVE', label: 'Inativo' },
        ],
      },
    }),
    metaField('updated_at', 'Atualizado em', 'datetime', {
      readOnly: true,
      inList: true,
      listOrder: 50,
    }),
  ],
  views: [
    {
      viewType: 'list',
      label: 'Lista de orçamentos',
      layout: { columns: ['code', 'name', 'currency_code', 'status', 'updated_at'] },
      isDefault: true,
    },
  ],
  workflow: null,
  permissions: [{ action: 'read', permLevel: 0, requiredPermission: null, allowed: true }],
  allowedPermLevels: [0],
};

/* ============================================================================
   TITULOS A RECEBER / A PAGAR — as duas worklists Tier-1
   ============================================================================ */

/**
 * DADOS DE ACEITE DAS WORKLISTS FINANCEIRAS.
 *
 * Estes titulos existem para que o aceite visual exercite a superficie REAL — nao uma tela vazia.
 * Os valores cobrem os estados que a tela precisa distinguir:
 *
 *   AR-001  VENCIDO     vencimento no passado, saldo integral  -> atraso, faixa critica
 *   AR-002  VENCIDO     vencimento no passado, saldo parcial   -> atraso + liquidacao parcial
 *   AR-003  EM ABERTO   vencimento futuro                      -> prazo "em N dias"
 *   AR-004  RECEBIDO    saldo zerado                           -> estado liquidado
 *
 * O aging PERSISTIDO (`agingBucket`) so existe do lado a pagar: e fato de dominio de `payables`, e
 * `ReceivableDetail` nao o publica. A fixture respeita essa diferenca em vez de uniformizar os dois
 * lados — uniformizar aqui esconderia exatamente a divergencia que a tela precisa declarar.
 */
const RECEIVABLES = [
  {
    id: 'rrrrrrrr-rrrr-4rrr-8rrr-rrrrrrrrrr01',
    unitId: 'unit-1',
    clientId: 'client-1',
    origin: {
      kind: 'BILLING_DOCUMENT',
      billingDocumentId: 'nf-2026-0001',
      billingRecordId: 'br-1',
      serviceOrderId: 'so-1',
      measurementId: 'm-1',
    },
    principal: '12000.0000',
    currencyCode: 'BRL',
    dueDate: '2026-08-10',
    paymentTerms: '30 dias',
    externalReference: 'AR-001',
    status: 'OVERDUE',
    remainingBalance: '12000.0000',
    settledAmount: '0.0000',
    lifecycle: 'OVERDUE',
    cancelledAt: null,
    cancelReason: null,
    rowVersion: 1,
    createdAt: '2026-07-11T12:00:00.000Z',
    updatedAt: '2026-08-11T12:00:00.000Z',
    installments: [
      { id: 'i-1', installmentNumber: 1, principal: '12000.0000', dueDate: '2026-08-10' },
    ],
    settlements: [],
  },
  {
    id: 'rrrrrrrr-rrrr-4rrr-8rrr-rrrrrrrrrr02',
    unitId: 'unit-1',
    clientId: 'client-1',
    origin: {
      kind: 'MEASUREMENT',
      billingDocumentId: 'nf-2026-0002',
      billingRecordId: 'br-2',
      serviceOrderId: 'so-2',
      measurementId: 'm-2',
    },
    principal: '8400.0000',
    currencyCode: 'BRL',
    dueDate: '2026-09-05',
    paymentTerms: '45 dias',
    externalReference: 'AR-002',
    status: 'OVERDUE',
    remainingBalance: '3400.0000',
    settledAmount: '5000.0000',
    lifecycle: 'OVERDUE',
    cancelledAt: null,
    cancelReason: null,
    rowVersion: 2,
    createdAt: '2026-07-22T12:00:00.000Z',
    updatedAt: '2026-09-06T12:00:00.000Z',
    installments: [
      { id: 'i-2', installmentNumber: 1, principal: '8400.0000', dueDate: '2026-09-05' },
    ],
    settlements: [
      {
        id: 's-1',
        installmentId: 'i-2',
        amount: '5000.0000',
        currencyCode: 'BRL',
        status: 'SETTLED',
        settledAt: '2026-09-01T12:00:00.000Z',
        idempotencyKey: 'idem-s-1',
        externalReference: 'REC-0001',
      },
    ],
  },
  {
    id: 'rrrrrrrr-rrrr-4rrr-8rrr-rrrrrrrrrr03',
    unitId: 'unit-1',
    clientId: 'client-1',
    origin: {
      kind: 'SERVICE_ORDER',
      billingDocumentId: 'nf-2026-0003',
      billingRecordId: 'br-3',
      serviceOrderId: 'so-3',
      measurementId: 'm-3',
    },
    principal: '5600.0000',
    currencyCode: 'BRL',
    dueDate: '2026-11-20',
    paymentTerms: '30 dias',
    externalReference: 'AR-003',
    status: 'OPEN',
    remainingBalance: '5600.0000',
    settledAmount: '0.0000',
    lifecycle: 'OPEN',
    cancelledAt: null,
    cancelReason: null,
    rowVersion: 1,
    createdAt: '2026-10-21T12:00:00.000Z',
    updatedAt: '2026-10-21T12:00:00.000Z',
    installments: [
      { id: 'i-3', installmentNumber: 1, principal: '5600.0000', dueDate: '2026-11-20' },
    ],
    settlements: [],
  },
  {
    id: 'rrrrrrrr-rrrr-4rrr-8rrr-rrrrrrrrrr04',
    unitId: 'unit-1',
    clientId: 'client-1',
    origin: {
      kind: 'BILLING_RECORD',
      billingDocumentId: 'nf-2026-0004',
      billingRecordId: 'br-4',
      serviceOrderId: 'so-4',
      measurementId: 'm-4',
    },
    principal: '2300.0000',
    currencyCode: 'BRL',
    dueDate: '2026-09-28',
    paymentTerms: 'à vista',
    externalReference: 'AR-004',
    status: 'PAID',
    remainingBalance: '0.0000',
    settledAmount: '2300.0000',
    lifecycle: 'PAID',
    cancelledAt: null,
    cancelReason: null,
    rowVersion: 3,
    createdAt: '2026-08-29T12:00:00.000Z',
    updatedAt: '2026-09-28T12:00:00.000Z',
    installments: [
      { id: 'i-4', installmentNumber: 1, principal: '2300.0000', dueDate: '2026-09-28' },
    ],
    settlements: [
      {
        id: 's-2',
        installmentId: 'i-4',
        amount: '2300.0000',
        currencyCode: 'BRL',
        status: 'SETTLED',
        settledAt: '2026-09-28T12:00:00.000Z',
        idempotencyKey: 'idem-s-2',
        externalReference: 'REC-0002',
      },
    ],
  },
];

const PAYABLES = [
  {
    id: 'pppppppp-pppp-4ppp-8ppp-pppppppppp01',
    unitId: 'unit-1',
    counterpartyId: 'supplier-1',
    origin: { kind: 'SUPPLIER_INVOICE', id: 'inv-1', reference: 'NF-FORN-7781' },
    expenseCategoryId: 'cat-1',
    costCenter: { id: 'cc-1', code: 'CC-OPER' },
    principal: '9800.0000',
    currencyCode: 'BRL',
    dueDate: '2026-07-15',
    paymentTerms: '30 dias',
    externalReference: 'AP-001',
    status: 'OVERDUE',
    agingBucket: '90_PLUS',
    remainingBalance: '9800.0000',
    paidAmount: '0.0000',
    lifecycle: 'OVERDUE',
    cancelledAt: null,
    cancelReason: null,
    rowVersion: 1,
    createdAt: '2026-06-15T12:00:00.000Z',
    updatedAt: '2026-07-16T12:00:00.000Z',
    installments: [
      { id: 'pi-1', installmentNumber: 1, principal: '9800.0000', dueDate: '2026-07-15' },
    ],
    payments: [],
  },
  {
    id: 'pppppppp-pppp-4ppp-8ppp-pppppppppp02',
    unitId: 'unit-1',
    counterpartyId: 'supplier-1',
    origin: { kind: 'SUPPLIER_INVOICE', id: 'inv-2', reference: 'NF-FORN-7802' },
    expenseCategoryId: 'cat-1',
    costCenter: { id: 'cc-1', code: 'CC-MANUT' },
    principal: '4200.0000',
    currencyCode: 'BRL',
    dueDate: '2026-10-02',
    paymentTerms: '45 dias',
    externalReference: 'AP-002',
    status: 'PARTIALLY_PAID',
    agingBucket: '31_60',
    remainingBalance: '2200.0000',
    paidAmount: '2000.0000',
    lifecycle: 'PARTIALLY_PAID',
    cancelledAt: null,
    cancelReason: null,
    rowVersion: 2,
    createdAt: '2026-08-18T12:00:00.000Z',
    updatedAt: '2026-10-03T12:00:00.000Z',
    installments: [
      { id: 'pi-2', installmentNumber: 1, principal: '4200.0000', dueDate: '2026-10-02' },
    ],
    payments: [
      {
        id: 'pay-1',
        installmentId: 'pi-2',
        kind: 'PARTIAL',
        amount: '2000.0000',
        currencyCode: 'BRL',
        paidAt: '2026-10-03T12:00:00.000Z',
        idempotencyKey: 'idem-pay-1',
        paymentReference: 'PIX-99120',
        originKind: 'SUPPLIER_INVOICE',
        originId: 'inv-2',
        originReference: 'NF-FORN-7802',
        reversesPaymentId: null,
        actorIdentityId: 'identity-1',
        createdAt: '2026-10-03T12:00:00.000Z',
      },
    ],
  },
  {
    id: 'pppppppp-pppp-4ppp-8ppp-pppppppppp03',
    unitId: 'unit-1',
    counterpartyId: 'supplier-1',
    origin: { kind: 'SUPPLIER_INVOICE', id: 'inv-3', reference: 'NF-FORN-7840' },
    expenseCategoryId: 'cat-1',
    costCenter: { id: 'cc-1', code: 'CC-ADM' },
    principal: '3100.0000',
    currencyCode: 'BRL',
    dueDate: '2026-11-25',
    paymentTerms: '30 dias',
    externalReference: 'AP-003',
    status: 'OPEN',
    agingBucket: 'CURRENT',
    remainingBalance: '3100.0000',
    paidAmount: '0.0000',
    lifecycle: 'OPEN',
    cancelledAt: null,
    cancelReason: null,
    rowVersion: 1,
    createdAt: '2026-10-26T12:00:00.000Z',
    updatedAt: '2026-10-26T12:00:00.000Z',
    installments: [
      { id: 'pi-3', installmentNumber: 1, principal: '3100.0000', dueDate: '2026-11-25' },
    ],
    payments: [],
  },
];

/** Resumo autoritativo — contagens e valores do recorte COMPLETO, agregados pelo SERVIDOR. */
function titleSummary(
  items: ReadonlyArray<{ status: string; remainingBalance: string; agingBucket?: string }>,
): Record<string, unknown> {
  const sum = (filter: (item: { status: string; remainingBalance: string }) => boolean) =>
    items
      .filter(filter)
      .reduce((total, item) => total + Number(item.remainingBalance), 0)
      .toFixed(4);
  const overdue = items.filter((item) => item.status === 'OVERDUE');
  const due = items.filter((item) => item.status === 'OPEN');
  const open = items.filter((item) => item.status === 'OPEN' || item.status === 'OVERDUE' || item.status === 'PARTIALLY_PAID');
  const paid = items.filter((item) => item.status === 'PAID');
  const aging90 = items.filter((item) => item.agingBucket === '90_PLUS');
  return {
    total: items.length,
    openCount: open.length,
    overdueCount: overdue.length,
    dueCount: due.length,
    paidCount: paid.length,
    ...(items.some((item) => item.agingBucket !== undefined)
      ? { aging90PlusCount: aging90.length }
      : {}),
    amounts: [
      {
        currencyCode: 'BRL',
        openAmount: sum((item) => item.status === 'OPEN' || item.status === 'OVERDUE' || item.status === 'PARTIALLY_PAID'),
        overdueAmount: sum((item) => item.status === 'OVERDUE'),
        dueAmount: sum((item) => item.status === 'OPEN'),
      },
    ],
  };
}

/** Envelope canonico de pagina, honrando `limit`/`offset` como a API real. */
function titlePage<T>(items: readonly T[], route: Route): Record<string, unknown> {
  const params = new URL(route.request().url()).searchParams;
  const limit = Number(params.get('limit') ?? '50');
  const offset = Number(params.get('offset') ?? '0');
  const status = params.get('status');
  const filtered = status ? items.filter((item) => (item as { status: string }).status === status) : items;
  const total = filtered.length;
  return {
    items: filtered.slice(offset, offset + limit),
    limit,
    offset,
    total,
    totalPages: total > 0 ? Math.max(1, Math.ceil(total / limit)) : 0,
  };
}

/** Campos da view `list` de titulos — os mesmos nomes que `finance-engine-rows` preenche. */
const RECEIVABLES_META = {
  name: 'receivables',
  label: 'Contas a receber',
  description: null,
  dataSchema: 'fin',
  dataTable: 'receivables',
  labelField: 'external_reference',
  fields: [
    metaField('external_reference', 'Título', 'text', { inList: true, listOrder: 10 }),
    metaField('client_id', 'Cliente', 'data', { inList: true, listOrder: 20 }),
    metaField('due_date', 'Vencimento', 'date', { inList: true, listOrder: 30 }),
    metaField('lifecycle', 'Situação', 'select', { inList: true, listOrder: 40 }),
    metaField('principal', 'Principal', 'currency', { inList: true, listOrder: 50, aggregation: 'sum' }),
    metaField('remaining_balance', 'Saldo', 'currency', { inList: true, listOrder: 60, aggregation: 'sum' }),
  ],
  views: [
    {
      viewType: 'list',
      label: 'Lista de contas a receber',
      layout: {
        columns: [
          'external_reference',
          'client_id',
          'due_date',
          'lifecycle',
          'principal',
          'remaining_balance',
        ],
      },
      isDefault: true,
    },
  ],
  workflow: null,
  permissions: [{ action: 'read', permLevel: 0, requiredPermission: null, allowed: true }],
  allowedPermLevels: [0],
};

const PAYABLES_META = {
  name: 'payables',
  label: 'Contas a pagar',
  description: null,
  dataSchema: 'fin',
  dataTable: 'payables',
  labelField: 'external_reference',
  fields: [
    metaField('external_reference', 'Título', 'text', { inList: true, listOrder: 10 }),
    metaField('counterparty_id', 'Fornecedor', 'data', { inList: true, listOrder: 20 }),
    metaField('due_date', 'Vencimento', 'date', { inList: true, listOrder: 30 }),
    metaField('lifecycle', 'Situação', 'select', { inList: true, listOrder: 40 }),
    metaField('aging_bucket', 'Faixa', 'select', { inList: false, listOrder: 45 }),
    metaField('principal', 'Principal', 'currency', { inList: true, listOrder: 50, aggregation: 'sum' }),
    metaField('remaining_balance', 'Saldo', 'currency', { inList: true, listOrder: 60, aggregation: 'sum' }),
  ],
  views: [
    {
      viewType: 'list',
      label: 'Lista de contas a pagar',
      layout: {
        columns: [
          'external_reference',
          'counterparty_id',
          'due_date',
          'lifecycle',
          'principal',
          'remaining_balance',
        ],
      },
      isDefault: true,
    },
  ],
  workflow: null,
  permissions: [{ action: 'read', permLevel: 0, requiredPermission: null, allowed: true }],
  allowedPermLevels: [0],
};

/*
 * O REGISTRO DE METADADOS VEM DEPOIS DAS CONSTANTES QUE ELE INDEXA.
 *
 * `const` nao sofre hoisting de valor: um `META_BY_ENTITY` declarado acima destes objetos leria a
 * zona morta temporal e quebraria a fixture inteira em tempo de importacao. O registro fica aqui,
 * depois das quatro entidades, e e o unico ponto que o handler consulta.
 */
const META_BY_ENTITY: Record<string, unknown> = {
  expenses: EXPENSES_META,
  budgets: BUDGETS_META,
  receivables: RECEIVABLES_META,
  payables: PAYABLES_META,
};

/**
 * Tráfego determinístico da superfície Financeira finalizada nesta frente (Despesas e Orçamentos).
 * Devolve `false` quando a rota não pertence a esta fixture.
 */
export async function handleFinanceApiRoute(route: Route): Promise<boolean> {
  const request = route.request();
  const { pathname } = new URL(request.url());
  const method = request.method();

  if (!pathname.startsWith('/api/v1/finance') && !pathname.startsWith('/api/v1/meta')) {
    return false;
  }

  if (!hasBearerToken(route)) {
    await fulfillJson(route, { error: { code: 'FINANCE_DENIED', message: 'Unauthorized.' } }, 401);
    return true;
  }

  if (method === 'GET') {
    if (pathname === '/api/v1/meta') {
      await fulfillJson(
        route,
        Object.entries(META_BY_ENTITY).map(([name, schema]) => ({
          name,
          label: (schema as { label: string }).label,
          description: null,
        })),
      );
      return true;
    }
    if (pathname.startsWith('/api/v1/meta/')) {
      const entity = pathname.slice('/api/v1/meta/'.length);
      const schema = META_BY_ENTITY[entity];
      if (schema) {
        await fulfillJson(route, schema);
        return true;
      }
      await fulfillJson(route, { error: { code: 'META_NOT_FOUND', message: 'Unknown entity.' } }, 404);
      return true;
    }
    if (pathname === '/api/v1/finance/expenses') {
      await fulfillJson(
        route,
        pageOf(EXPENSES, route, (item, q) =>
          item.description.toLowerCase().includes(q) || item.costCenterCode.toLowerCase().includes(q),
        ),
      );
      return true;
    }
    if (pathname === '/api/v1/finance/budgets') {
      await fulfillJson(
        route,
        pageOf(BUDGETS, route, (item, q) =>
          item.code.toLowerCase().includes(q) || item.name.toLowerCase().includes(q),
        ),
      );
      return true;
    }

    /*
     * TITULOS A RECEBER / A PAGAR — as duas worklists Tier-1.
     *
     * ORDEM IMPORTA: `/receivables/summary` tem de ser testado ANTES de `/receivables`, porque o
     * prefixo do primeiro tambem casa com o segundo. Sem essa precedencia, a tela receberia um
     * envelope de PAGINA onde espera um RESUMO, e a faixa de situacao leria `undefined` em todos os
     * campos — exatamente o tipo de defeito de fixture que o aceite visual existe para nao mascarar.
     */
    if (pathname === '/api/v1/finance/receivables/summary') {
      await fulfillJson(route, titleSummary(RECEIVABLES));
      return true;
    }
    if (pathname === '/api/v1/finance/payables/summary') {
      await fulfillJson(route, titleSummary(PAYABLES));
      return true;
    }
    if (pathname === '/api/v1/finance/receivables') {
      await fulfillJson(route, titlePage(RECEIVABLES, route));
      return true;
    }
    if (pathname === '/api/v1/finance/payables') {
      await fulfillJson(route, titlePage(PAYABLES, route));
      return true;
    }
    if (pathname === '/api/v1/finance/payables/aging') {
      const buckets: Record<string, { count: number; remaining: string }> = {};
      for (const item of PAYABLES) {
        const bucket = item.agingBucket;
        const current = buckets[bucket] ?? { count: 0, remaining: '0.0000' };
        buckets[bucket] = {
          count: current.count + 1,
          remaining: (Number(current.remaining) + Number(item.remainingBalance)).toFixed(4),
        };
      }
      await fulfillJson(route, { asOf: '2026-10-14T12:00:00.000Z', buckets });
      return true;
    }
    if (pathname === '/api/v1/finance/treasury/accounts') {
      await fulfillJson(route, []);
      return true;
    }
  }

  // Sondas de capability: 404 (e não 403) é o que faz a sonda concluir que a capability existe.
  await fulfillJson(route, { error: { code: 'FINANCE_NOT_FOUND', message: 'Not found.' } }, 404);
  return true;
}
