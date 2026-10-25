import type { Route } from '@playwright/test';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * MOCK DE MEDIÇÃO PARA A SUÍTE VISUAL
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A suíte visual não abria NENHUMA rota de medição. O `TypeError` de render que
 * chegou ao cliente passou por toda a automação de CI sem ser visto, porque
 * cobertura que não abre a rota não é cobertura.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE O MOCK DEVOLVE ESTADO VAZIO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * É o estado REAL de um tenant recém-provisionado: fila sem itens, nenhum estágio
 * com lacuna de receita, nenhuma medição em decisão. O spec visual prova que a
 * tela renderiza esse estado SEM quebrar — que é exatamente o defeito encontrado.
 *
 * Inventar itens de fila faria o teste medir dado que o backend não produz, e um
 * erro de contrato passaria despercebido. O mock replica a FORMA do contrato, com
 * as coleções presentes e vazias; ele nunca inventa valor de negócio.
 */

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

const MOCK_UNIT_ID = 'unit-1';

/** Frescura declarada pelo SERVIDOR — o cliente nunca a inventa. */
function freshness(): { readAt: string; authority: 'SERVER' } {
  return { readAt: new Date().toISOString(), authority: 'SERVER' };
}

/**
 * FILA VAZIA com todas as contagens presentes.
 *
 * As chaves de contagem são as que a tela lê para montar a faixa de resumo; omitir
 * uma faria a faixa renderizar `undefined` e o teste mediria um defeito do MOCK.
 */
function emptyQueue(): unknown {
  return {
    context: { unitId: MOCK_UNIT_ID, at: new Date().toISOString() },
    counts: {
      READY_NOT_PREPARED: 0,
      ACCEPTED_NOT_BILLABLE: 0,
      APPROVED_NOT_ACCEPTED: 0,
      MEASURED_NOT_APPROVED: 0,
      EXECUTED_NOT_MEASURED: 0,
    },
    items: [],
    freshness: freshness(),
  };
}

/** LACUNA DE RECEITA — estágios sem ocorrência, todos com contagem zero. */
function emptyRevenueLeakage(): unknown {
  return {
    context: { unitId: MOCK_UNIT_ID, at: new Date().toISOString() },
    stages: [
      { stage: 'EXECUTED_NOT_MEASURED', label: 'Executado sem medir', count: 0, amount: null },
      { stage: 'MEASURED_NOT_APPROVED', label: 'Medido sem aprovar', count: 0, amount: null },
      { stage: 'APPROVED_NOT_ACCEPTED', label: 'Aprovado sem aceite', count: 0, amount: null },
      { stage: 'ACCEPTED_NOT_BILLABLE', label: 'Aceito sem elegibilidade', count: 0, amount: null },
      { stage: 'READY_NOT_PREPARED', label: 'Elegível sem preparar', count: 0, amount: null },
    ],
    totalCount: 0,
    totalAmount: null,
    freshness: freshness(),
  };
}

export async function handleMeasurementApiRoute(route: Route): Promise<boolean> {
  const url = new URL(route.request().url());
  const pathname = url.pathname;
  const method = route.request().method();

  if (!pathname.startsWith('/api/v1/query/measurements')) {
    return false;
  }

  if (!hasBearerToken(route)) {
    await fulfillJson(route, { error: { code: 'MEASUREMENTS_DENIED', message: 'Unauthorized.' } }, 401);
    return true;
  }

  if (method === 'GET') {
    if (pathname === '/api/v1/query/measurements/queue') {
      await fulfillJson(route, emptyQueue());
      return true;
    }
    if (pathname === '/api/v1/query/measurements/revenue-leakage') {
      await fulfillJson(route, emptyRevenueLeakage());
      return true;
    }
  }

  await fulfillJson(
    route,
    { error: { code: 'MEASUREMENTS_NOT_FOUND', message: 'Not found.' } },
    404,
  );
  return true;
}
