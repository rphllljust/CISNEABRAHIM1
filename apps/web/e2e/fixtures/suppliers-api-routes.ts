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

  if (!pathname.startsWith('/api/v1/suppliers')) {
    return false;
  }

  if (!hasBearerToken(route)) {
    await fulfillJson(route, { error: { code: 'SUPPLIER_DENIED', message: 'Unauthorized.' } }, 401);
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
