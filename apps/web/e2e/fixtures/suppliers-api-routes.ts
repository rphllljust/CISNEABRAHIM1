import type { Route } from '@playwright/test';
import { SUPPLIERS_LIST_VISUAL_SNAPSHOT } from './suppliers-snapshots';

type JsonResponse = {
  status: number;
  contentType: string;
  body: string;
};

function jsonBody(body: unknown, status = 200): JsonResponse {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill(jsonBody(body, status));
}

function hasBearerToken(route: Route): boolean {
  return route.request().headers().authorization?.startsWith('Bearer ') ?? false;
}

/**
 * Filtro mínimo na mesma semântica do backend (`ILIKE` sobre razão social, nome fantasia e CNPJ):
 * permite que o estado "sem resultado" venha de uma busca real, e não de um fixture que finge.
 */
function filterSuppliers(searchParams: URLSearchParams) {
  const q = searchParams.get('q')?.trim() ?? '';
  const status = searchParams.get('status');

  let filtered = SUPPLIERS_LIST_VISUAL_SNAPSHOT.items;
  if (status === 'ACTIVE' || status === 'INACTIVE') {
    filtered = filtered.filter((supplier) => supplier.status === status);
  }
  if (q.length > 0) {
    const lowered = q.toLowerCase();
    filtered = filtered.filter(
      (supplier) =>
        supplier.legalName.toLowerCase().includes(lowered) ||
        (supplier.tradeName ?? '').toLowerCase().includes(lowered) ||
        supplier.taxId.includes(q),
    );
  }
  return filtered;
}

/**
 * Tráfego determinístico da superfície de Fornecedores para a validação visual focada.
 *
 * Fixture PRÓPRIA para não deslocar as baselines comercial/clients já commitadas. Devolve `false`
 * quando a rota não pertence a esta fixture.
 */
export async function handleSuppliersApiRoute(route: Route): Promise<boolean> {
  const request = route.request();
  const { pathname, searchParams } = new URL(request.url());
  const method = request.method();

  // O DynamicList consome a projeção existente de meta.supplier; o helper unitário
  // createSuppliersFetchMock publica o mesmo contrato para suas telas.
  // Sem esta rota a prova visual mede "Carregando…" em vez da grade.
  if (pathname !== '/api/v1/meta/suppliers' && !pathname.startsWith('/api/v1/suppliers')) {
    return false;
  }

  if (!hasBearerToken(route)) {
    await fulfillJson(route, { error: { code: 'SUPPLIER_DENIED', message: 'Unauthorized.' } }, 401);
    return true;
  }

  if (pathname === '/api/v1/meta/suppliers' && method === 'GET') {
    const field = (name: string, label: string, type: string, inList = true, listOrder = 0, extra: Record<string, unknown> = {}) => ({
      name, label, type, required: false, readOnly: false, inList, inForm: true,
      inFilter: false, listOrder, fieldOrder: 0, permLevel: 0, options: null, ...extra,
    });
    // Espelha a view "list" já usada em src/test/suppliers-fetch-mock.ts.
    // Este é somente o contrato da fixture Playwright, não um endpoint novo.
    await fulfillJson(route, {
      name: 'suppliers',
      label: 'Fornecedores',
      description: null,
      dataSchema: 'pty',
      dataTable: 'suppliers',
      labelField: 'legal_name',
      fields: [
        field('legal_name', 'Razão social', 'text', true, 10),
        field('trade_name', 'Nome fantasia', 'text', true, 20),
        field('normalized_tax_id', 'CNPJ', 'text', true, 30),
        field('payment_terms', 'Condição de pagamento', 'text', true, 40),
        field('currency_code', 'Moeda', 'text', false, 50),
        field('status', 'Estado', 'select', true, 60, {
          inFilter: true,
          options: { options: [
            { value: 'ACTIVE', label: 'Ativo' },
            { value: 'INACTIVE', label: 'Inativo' },
            { value: 'ARCHIVED', label: 'Arquivado' },
          ] },
        }),
        field('created_at', 'Atualizado em', 'datetime', true, 70, { readOnly: true }),
      ],
      views: [{
        viewType: 'list',
        label: 'Lista de fornecedores',
        layout: { columns: [
          'legal_name', 'trade_name', 'normalized_tax_id',
          'payment_terms', 'status', 'created_at',
        ] },
        isDefault: true,
      }],
      workflow: null,
      permissions: [{ action: 'read', permLevel: 0, requiredPermission: null, allowed: true }],
      allowedPermLevels: [0],
    });
    return true;
  }

  if (pathname === '/api/v1/suppliers' && method === 'GET') {
    const limit = Number(searchParams.get('limit') ?? '20');
    const offset = Number(searchParams.get('offset') ?? '0');
    const items = filterSuppliers(searchParams);
    const total = items.length;

    await fulfillJson(route, {
      items: items.slice(offset, offset + limit),
      limit,
      offset,
      total,
      totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
    });
    return true;
  }

  // Sondas de capability e detalhe: 404 (não 403) é o que faz a sonda concluir que a capability
  // existe, mantendo visível a entrada "Novo fornecedor".
  await fulfillJson(route, { error: { code: 'SUPPLIER_NOT_FOUND', message: 'Not found.' } }, 404);
  return true;
}
