import type { Route } from '@playwright/test';
import { DOCUMENTS_LIST_VISUAL_SNAPSHOT } from './documents-snapshots';
import type { DocumentDetail } from '../../src/documents/types/document.types';

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
 * Filtro com a MESMA semantica da listagem real: busca por titulo e tipo resolvidos no servidor.
 * E o que permite ao teste produzir "sem resultado" por uma busca de verdade, em vez de um fixture
 * que finge.
 */
function filterDocuments(
  items: DocumentDetail[],
  searchParams: URLSearchParams,
): DocumentDetail[] {
  const q = searchParams.get('q')?.trim().toLowerCase() ?? '';
  const categoryCode = searchParams.get('categoryCode')?.trim() ?? '';
  return items.filter((item) => {
    if (categoryCode && item.categoryCode !== categoryCode) {
      return false;
    }
    if (q && !item.title.toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });
}

/**
 * Trafego deterministico da listagem de Documentos para a validacao visual focada.
 *
 * Devolve `false` quando a rota nao pertence a esta fixture, para o restante do perfil `shell`
 * continuar atendendo o que a pagina precisa (sessao, modulos, unidades).
 */
export async function handleDocumentsApiRoute(route: Route): Promise<boolean> {
  const request = route.request();
  const { pathname, searchParams } = new URL(request.url());
  const method = request.method();

  if (!pathname.startsWith('/api/v1/documents')) {
    return false;
  }

  if (!hasBearerToken(route)) {
    await fulfillJson(route, { error: { code: 'DOCUMENT_ACCESS_DENIED', message: 'Unauthorized.' } }, 401);
    return true;
  }

  if (pathname === '/api/v1/documents' && method === 'GET') {
    const limit = Number(searchParams.get('limit') ?? '100');
    const offset = Number(searchParams.get('offset') ?? '0');
    const items = filterDocuments(DOCUMENTS_LIST_VISUAL_SNAPSHOT, searchParams);
    // Sem `total`, exatamente como o contrato publicado: a tela nao pode inventar um numero.
    await fulfillJson(route, { items: items.slice(offset, offset + limit), limit, offset });
    return true;
  }

  // Sondas de capability do modulo: 404 (e nao 403) e o que faz o probe concluir que a capability
  // existe, mantendo visivel a acao de download.
  await fulfillJson(route, { error: { code: 'DOCUMENT_NOT_FOUND', message: 'Not found.' } }, 404);
  return true;
}
