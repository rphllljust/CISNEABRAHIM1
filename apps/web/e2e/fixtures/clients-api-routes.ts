import type { Route } from '@playwright/test';
import { CLIENTS_LIST_VISUAL_SNAPSHOT } from './clients-snapshots';
import type { ClientSummary } from '../../src/clients/types/client.types';

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
 * Filtro mínimo sobre o snapshot, na mesma semântica do backend: termo só de dígitos casa prefixo
 * de documento; qualquer outro termo casa razão social ou nome fantasia. É o necessário para que o
 * estado "sem resultado" seja produzido por uma busca REAL, e não por um fixture que finge.
 */
function filterClients(items: ClientSummary[], searchParams: URLSearchParams): ClientSummary[] {
  const q = searchParams.get('q')?.trim() ?? '';
  const status = searchParams.get('status');

  let filtered = items;
  if (status === 'ACTIVE' || status === 'INACTIVE') {
    filtered = filtered.filter((client) => client.status === status);
  }
  if (q.length > 0) {
    const digits = q.replace(/\D/g, '');
    const isDocumentOnly = /^[\d.\-/\s]+$/.test(q);
    const lowered = q.toLowerCase();
    filtered = filtered.filter((client) => {
      if (isDocumentOnly && digits.length >= 2) {
        return client.taxId.startsWith(digits);
      }
      return (
        client.legalName.toLowerCase().includes(lowered) ||
        (client.tradeName ?? '').toLowerCase().includes(lowered)
      );
    });
  }
  return filtered;
}

/**
 * Tráfego determinístico da listagem de Clientes para a validação visual focada.
 *
 * Fixture PRÓPRIA, e não o perfil `commercial`: o snapshot comercial alimenta baselines já
 * commitados de propostas e pedidos de compra, e alterá-lo colocaria essas baselines em risco sem
 * que a regressão visual completa fosse executada. Aqui só a listagem de Clientes é servida, com
 * várias linhas para exercitar de fato a tabela, a barra de filtros e a faixa de paginação.
 *
 * Devolve `false` quando a rota não pertence a esta fixture.
 */
export async function handleClientsApiRoute(route: Route): Promise<boolean> {
  const request = route.request();
  const { pathname, searchParams } = new URL(request.url());
  const method = request.method();

  if (!pathname.startsWith('/api/v1/clients')) {
    return false;
  }

  if (!hasBearerToken(route)) {
    await fulfillJson(route, { error: { code: 'CLIENT_DENIED', message: 'Unauthorized.' } }, 401);
    return true;
  }

  if (pathname === '/api/v1/clients' && method === 'GET') {
    const limit = Number(searchParams.get('limit') ?? '20');
    const offset = Number(searchParams.get('offset') ?? '0');
    const items = filterClients(CLIENTS_LIST_VISUAL_SNAPSHOT.items, searchParams);
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

  // Sondas de capability do módulo: 404 (e não 403) é o que faz o probe concluir que a capability
  // existe, mantendo visíveis as ações autorizadas — "Novo Cliente" e as linhas navegáveis.
  await fulfillJson(route, { error: { code: 'CLIENT_NOT_FOUND', message: 'Not found.' } }, 404);
  return true;
}
