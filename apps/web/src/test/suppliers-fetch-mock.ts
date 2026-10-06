import { vi } from 'vitest';
import { parseRequestPath } from './request-url';
import { createShellFetchMock } from './shell-fetch-mock';

/**
 * Dublê de rede da worklist de FORNECEDORES.
 *
 * A lista é renderizada pela engine (`DynamicList` lê a view `list` do metadata store), então o
 * mock precisa servir `GET /api/v1/meta/suppliers` — sem ele a grade fica sem coluna e o teste
 * mediria uma tela parada em "Carregando…".
 *
 * O payload da listagem espelha `SupplierListResponse` do contrato real:
 * `{ items, limit, offset, total, totalPages }`, com `total` AUTORITATIVO (é a contagem do
 * conjunto filtrado, não o tamanho da página). É esse fato que a tela usa para dizer "de N".
 */
const SUPPLIERS = [
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    legalName: 'Metalúrgica Aurora Ltda',
    tradeName: 'Aurora Metais',
    taxId: '11.222.333/0001-44',
    paymentTerms: '30 dias',
    currencyCode: 'BRL',
    status: 'ACTIVE',
    version: 3,
    updatedAt: '2026-09-20T12:00:00.000Z',
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    legalName: 'Transportes Vale Norte S.A.',
    tradeName: null,
    taxId: '55.666.777/0001-88',
    paymentTerms: 'À vista',
    currencyCode: 'BRL',
    status: 'INACTIVE',
    version: 1,
    updatedAt: '2026-09-18T12:00:00.000Z',
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

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

/**
 * Cópia do FORMATO de `/api/v1/meta/suppliers` — não uma segunda fonte de verdade de negócio.
 * As colunas vivem na view `list`, exatamente como no store real.
 */
const SUPPLIERS_META = {
  name: 'suppliers',
  label: 'Fornecedores',
  description: null,
  dataSchema: 'pty',
  dataTable: 'suppliers',
  labelField: 'legal_name',
  fields: [
    metaField('legal_name', 'Razão social', 'text', { inList: true, listOrder: 10 }),
    metaField('trade_name', 'Nome fantasia', 'text', { inList: true, listOrder: 20 }),
    metaField('normalized_tax_id', 'CNPJ', 'text', { inList: true, listOrder: 30 }),
    metaField('payment_terms', 'Condição de pagamento', 'text', { inList: true, listOrder: 40 }),
    metaField('currency_code', 'Moeda', 'text', { inList: false, listOrder: 50 }),
    metaField('status', 'Estado', 'select', {
      inList: true,
      listOrder: 60,
      inFilter: true,
      options: {
        options: [
          { value: 'ACTIVE', label: 'Ativo' },
          { value: 'INACTIVE', label: 'Inativo' },
          { value: 'ARCHIVED', label: 'Arquivado' },
        ],
      },
    }),
    metaField('created_at', 'Atualizado em', 'datetime', {
      readOnly: true,
      inList: true,
      listOrder: 70,
    }),
  ],
  views: [
    {
      viewType: 'list',
      label: 'Lista de fornecedores',
      layout: {
        columns: [
          'legal_name',
          'trade_name',
          'normalized_tax_id',
          'payment_terms',
          'status',
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

export type SuppliersFetchMockOptions = {
  denied?: boolean;
  /** Comandos válidos publicados por fornecedor. Ausente = nenhum comando direto. */
  commands?: Array<{
    comando: string;
    label: string;
    requer_permissao: string;
    usuario_tem_permissao: boolean;
  }>;
};

export function createSuppliersFetchMock(options: SuppliersFetchMockOptions = {}) {
  const shellMock = createShellFetchMock();
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const { pathname, searchParams } = parseRequestPath(input);

    if (pathname === '/api/v1/meta/suppliers' && method === 'GET') {
      return jsonResponse(SUPPLIERS_META);
    }

    if (pathname.endsWith('/available-actions') && method === 'GET') {
      const supplierId = pathname.split('/')[4] ?? 'unknown';
      const current = SUPPLIERS.find((supplier) => supplier.id === supplierId);
      return jsonResponse({
        supplier_id: supplierId,
        status_atual: current?.status ?? 'ACTIVE',
        comandos_validos: options.commands ?? [],
        comandos_invalidos_para_status: [],
      });
    }

    if (pathname === '/api/v1/suppliers' && method === 'GET') {
      if (options.denied) {
        return jsonResponse({ error: { code: 'SUPPLIER_ACCESS_DENIED' } }, 403);
      }
      const limit = Number(searchParams.get('limit') ?? '20');
      const offset = Number(searchParams.get('offset') ?? '0');
      const status = searchParams.get('status');
      const q = searchParams.get('q')?.trim().toLowerCase() ?? '';

      let items = SUPPLIERS;
      if (status) {
        items = items.filter((supplier) => supplier.status === status);
      }
      if (q) {
        // A busca do backend cobre razao social, nome fantasia e CNPJ — o mesmo campo que a
        // tela anuncia no placeholder.
        items = items.filter(
          (supplier) =>
            supplier.legalName.toLowerCase().includes(q) ||
            (supplier.tradeName ?? '').toLowerCase().includes(q) ||
            supplier.taxId.toLowerCase().includes(q),
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

    return shellMock(input, init);
  });
}

export const SUPPLIERS_TEST_DATA = { SUPPLIERS };
