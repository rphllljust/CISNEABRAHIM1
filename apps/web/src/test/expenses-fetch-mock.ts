import { vi } from 'vitest';
import { parseRequestPath } from './request-url';
import { createShellFetchMock } from './shell-fetch-mock';

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
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * METADATA STORE — a lista de despesas é RENDERIZADA PELA ENGINE.
 *
 * `DynamicList` não desenha nada sem schema: sem `GET /api/v1/meta/expenses` a grade fica em
 * "Carregando…" e o teste mediria uma tela sem tabela. O payload espelha o contrato de
 * `/api/v1/meta/:entity` (campos com `in_list`/`in_filter`, view `list` com `layout`) — é uma
 * CÓPIA do formato, não uma segunda fonte de verdade de negócio.
 *
 * `cost_center_code` sai com `inList: false` de propósito: é o caso REAL do metadado, e é o que a
 * projeção da tela existe para reabilitar. Um mock que já viesse com a coluna ligada não provaria
 * a projeção.
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
  label: 'Despesa',
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
    metaField('created_at', 'Criada em', 'datetime', {
      readOnly: true,
      inList: true,
      listOrder: 70,
    }),
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

export function createExpensesFetchMock(options: { denied?: boolean } = {}) {
  const shellMock = createShellFetchMock();
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const { pathname, searchParams } = parseRequestPath(input);

    if (pathname === '/api/v1/meta/expenses' && method === 'GET') {
      return jsonResponse(EXPENSES_META);
    }

    if (pathname === '/api/v1/finance/expenses' && method === 'GET') {
      if (options.denied) {
        return jsonResponse({ error: { code: 'FINANCE_DENIED' } }, 403);
      }
      const limit = Number(searchParams.get('limit') ?? '20');
      const offset = Number(searchParams.get('offset') ?? '0');
      const status = searchParams.get('status');
      const q = searchParams.get('q')?.trim().toLowerCase() ?? '';
      let items = EXPENSES;
      if (status) {
        items = items.filter((expense) => expense.status === status);
      }
      if (q) {
        items = items.filter(
          (expense) =>
            expense.description.toLowerCase().includes(q) ||
            expense.costCenterCode.toLowerCase().includes(q),
        );
      }
      return jsonResponse({
        items: items.slice(offset, offset + limit),
        limit,
        offset,
        total: items.length,
        totalPages: items.length > 0 ? 1 : 0,
      });
    }

    if (pathname.startsWith('/api/v1/finance/expenses')) {
      return jsonResponse({ error: { code: 'FINANCE_EXPENSE_NOT_FOUND' } }, 404);
    }

    return shellMock(input, init);
  });
}

export const EXPENSES_TEST_DATA = { EXPENSES };
