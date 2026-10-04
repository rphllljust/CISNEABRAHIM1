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

const META_BY_ENTITY: Record<string, unknown> = {
  expenses: EXPENSES_META,
  budgets: BUDGETS_META,
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
  }

  // Sondas de capability: 404 (e não 403) é o que faz a sonda concluir que a capability existe.
  await fulfillJson(route, { error: { code: 'FINANCE_NOT_FOUND', message: 'Not found.' } }, 404);
  return true;
}
