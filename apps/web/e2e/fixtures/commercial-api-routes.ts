import type { Route } from '@playwright/test';
import { COMMERCIAL_CONTRACTS_VISUAL_SNAPSHOT } from './commercial-contracts-snapshots';
import {
  COMMERCIAL_CLIENTS_SNAPSHOT,
  COMMERCIAL_PROPOSAL_DETAIL_SNAPSHOT,
  COMMERCIAL_PROPOSAL_VERSIONS_SNAPSHOT,
  COMMERCIAL_PROPOSALS_LIST_SNAPSHOT,
  COMMERCIAL_PURCHASE_ORDER_DETAIL_SNAPSHOT,
  COMMERCIAL_PURCHASE_ORDERS_LIST_SNAPSHOT,
  VISUAL_PROPOSAL_ID,
  VISUAL_PURCHASE_ORDER_ID,
} from './commercial-snapshots';

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
 * Handles deterministic commercial API traffic for Playwright screenshots.
 * Returns false when the route does not belong to the commercial fixture.
 */
export async function handleCommercialApiRoute(route: Route): Promise<boolean> {
  const request = route.request();
  const url = new URL(request.url());
  const { pathname } = url;
  const method = request.method();
  const isClientRoute = pathname.startsWith('/api/v1/clients');
  const isCommercialRoute = pathname.startsWith('/api/v1/commercial/');

  if (!isClientRoute && !isCommercialRoute) {
    return false;
  }

  if (!hasBearerToken(route)) {
    await fulfillJson(route, { code: 'COMMERCIAL_DENIED', message: 'Unauthorized.' }, 401);
    return true;
  }

  if (pathname === '/api/v1/clients' && method === 'GET') {
    await fulfillJson(route, COMMERCIAL_CLIENTS_SNAPSHOT);
    return true;
  }

  if (isClientRoute) {
    await fulfillJson(route, { code: 'CLIENT_NOT_FOUND', message: 'Not found.' }, 404);
    return true;
  }

  // A worklist Contratos também faz parte do perfil comercial.
  // Sem a rota de lista, a fixture respondia 404 e a prova de filtros
  // media somente o estado de erro, não a interface da carteira.
  if (pathname === '/api/v1/commercial/contracts' && method === 'GET') {
    const limit = Math.max(1, Number(url.searchParams.get('limit') ?? '20'));
    const offset = Math.max(0, Number(url.searchParams.get('offset') ?? '0'));
    const clientId = url.searchParams.get('clientId');
    const unitId = url.searchParams.get('unitId');
    const status = url.searchParams.get('status');
    const q = url.searchParams.get('q')?.trim().toLowerCase();
    const effectiveFrom = url.searchParams.get('effectiveFrom');
    const effectiveTo = url.searchParams.get('effectiveTo');
    const items = COMMERCIAL_CONTRACTS_VISUAL_SNAPSHOT.filter((item) =>
      (!clientId || item.clientId === clientId) &&
      (!unitId || item.unitId === unitId) &&
      (!status || item.status === status) &&
      (!q || [item.contractNumber, item.internalCode, item.title].some((value) => value.toLowerCase().includes(q))) &&
      (!effectiveFrom || !item.validTo || item.validTo >= effectiveFrom) &&
      (!effectiveTo || item.validFrom <= effectiveTo)
    );
    await fulfillJson(route, {
      items: items.slice(offset, offset + limit),
      limit,
      offset,
      total: items.length,
      hasMore: offset + limit < items.length,
    });
    return true;
  }

  const proposalsBase = '/api/v1/commercial/proposals';
  if (pathname === proposalsBase && method === 'GET') {
    await fulfillJson(route, COMMERCIAL_PROPOSALS_LIST_SNAPSHOT);
    return true;
  }
  if (pathname === proposalsBase && method === 'POST') {
    await fulfillJson(
      route,
      { code: 'COMMERCIAL_VALIDATION_FAILED', message: 'Capability probe.' },
      400,
    );
    return true;
  }
  if (
    pathname === `${proposalsBase}/${VISUAL_PROPOSAL_ID}/versions` &&
    method === 'GET'
  ) {
    await fulfillJson(route, COMMERCIAL_PROPOSAL_VERSIONS_SNAPSHOT);
    return true;
  }
  if (pathname === `${proposalsBase}/${VISUAL_PROPOSAL_ID}` && method === 'GET') {
    await fulfillJson(route, COMMERCIAL_PROPOSAL_DETAIL_SNAPSHOT);
    return true;
  }
  if (pathname.startsWith(`${proposalsBase}/`)) {
    await fulfillJson(
      route,
      { code: 'COMMERCIAL_PROPOSAL_NOT_FOUND', message: 'Capability probe.' },
      404,
    );
    return true;
  }

  const purchaseOrdersBase = '/api/v1/commercial/purchase-orders';
  if (pathname === purchaseOrdersBase && method === 'GET') {
    await fulfillJson(route, COMMERCIAL_PURCHASE_ORDERS_LIST_SNAPSHOT);
    return true;
  }
  if (pathname === purchaseOrdersBase && method === 'POST') {
    await fulfillJson(
      route,
      { code: 'COMMERCIAL_VALIDATION_FAILED', message: 'Capability probe.' },
      400,
    );
    return true;
  }
  if (
    pathname === `${purchaseOrdersBase}/${VISUAL_PURCHASE_ORDER_ID}` &&
    method === 'GET'
  ) {
    await fulfillJson(route, COMMERCIAL_PURCHASE_ORDER_DETAIL_SNAPSHOT);
    return true;
  }
  if (pathname.startsWith(`${purchaseOrdersBase}/`)) {
    await fulfillJson(
      route,
      { code: 'COMMERCIAL_PURCHASE_ORDER_NOT_FOUND', message: 'Capability probe.' },
      404,
    );
    return true;
  }

  await fulfillJson(route, { code: 'COMMERCIAL_NOT_FOUND', message: 'Not found.' }, 404);
  return true;
}
