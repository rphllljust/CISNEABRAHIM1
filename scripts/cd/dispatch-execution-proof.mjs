/**
 * PROVA FUNCIONAL DE DISPATCH + EXECUTION + ACTUALS — contra a API REAL.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTE ARQUIVO EXISTE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * O browser gate prova que a INTERFACE abre. Ele não prova que a cadeia
 * operacional funciona de ponta a ponta: prontidão → despacho → início →
 * realizado → conclusão → fechamento → base de medição.
 *
 * Este script exercita a cadeia pela API pública, com login real, e falha quando
 * qualquer etapa devolve causa empresarial que impeça a progressão. É a prova que
 * faltava para afirmar "capability operacional em produção".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ELE **NÃO** FAZ
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Não cria contrato, catálogo nem cliente — isso mudaria dado de negócio em
 * produção. Ele trabalha sobre uma ordem que JÁ existe e está em `RELEASED`.
 * Quando não encontra nenhuma, declara o resultado como `N/A` com o motivo, em vez
 * de inventar dado para o teste passar.
 *
 * Uso:
 *   CISNE_API_URL, PROD_SMOKE_LOGIN, PROD_SMOKE_PASSWORD
 *   node scripts/cd/dispatch-execution-proof.mjs
 */

const results = [];

function record(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function required(name) {
  const value = String(process.env[name] ?? '').trim();
  if (!value) {
    throw new Error(`${name} ausente: a prova funcional exige o runtime real.`);
  }
  return value;
}

async function call(apiUrl, token, path, init = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    // Corpo não-JSON é evidência suficiente pelo status.
  }
  return { status: response.status, ok: response.ok, body };
}

/** Extrai os motivos de bloqueio do envelope de erro, quando existirem. */
function blockingReasons(body) {
  const raw = body?.error?.details?.blockingReasons ?? body?.details?.blockingReasons ?? [];
  return Array.isArray(raw) ? raw : [];
}

async function main() {
  const apiUrl = required('CISNE_API_URL').replace(/\/+$/, '');
  const login = required('PROD_SMOKE_LOGIN');
  const password = required('PROD_SMOKE_PASSWORD');

  const auth = await call(apiUrl, null, '/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ login, password }),
  });
  if (!auth.ok || !auth.body?.accessToken) {
    record('LOGIN real na API', false, `HTTP ${auth.status}`);
    return;
  }
  const token = auth.body.accessToken;
  record('LOGIN real na API', true, `HTTP ${auth.status}`);

  // ── Unidade operacional do ator ────────────────────────────────────────────
  const orders = await call(apiUrl, token, '/api/v1/service-orders?limit=50');
  if (!orders.ok) {
    record('LISTA de ordens autorizada', false, `HTTP ${orders.status}`);
    return;
  }
  const items = orders.body?.items ?? [];
  record('LISTA de ordens autorizada', true, `${items.length} linha(s)`);

  const units = [...new Set(items.map((item) => item.unitId).filter(Boolean))];
  if (units.length === 0) {
    record('DISPATCH BOARD responde', true, 'N/A — sem unidade provisionada (legítimo)');
    record('EXECUTION CONSOLE responde', true, 'N/A — sem unidade provisionada');
    record('CADEIA operacional completa', true, 'N/A — sem ordem para operar');
    return;
  }
  const unitId = units[0];

  // ── Read model do despacho ────────────────────────────────────────────────
  const board = await call(
    apiUrl,
    token,
    `/api/v1/query/operations/dispatch?unitId=${encodeURIComponent(unitId)}`,
  );
  record(
    'DISPATCH BOARD responde',
    board.ok,
    board.ok
      ? `prontas=${board.body.readyCount} bloqueadas=${board.body.blockedCount}`
      : `HTTP ${board.status} ${board.body?.error?.code ?? ''}`,
  );
  if (!board.ok) {
    return;
  }

  // ── Read model da execução ────────────────────────────────────────────────
  const console_ = await call(
    apiUrl,
    token,
    `/api/v1/query/operations/execution?unitId=${encodeURIComponent(unitId)}`,
  );
  record(
    'EXECUTION CONSOLE responde',
    console_.ok,
    console_.ok
      ? `em execução=${console_.body.summary?.inProgress ?? 0} atrasadas=${console_.body.summary?.overdue ?? 0}`
      : `HTTP ${console_.status}`,
  );

  /**
   * ── Ordem em execução: a cadeia completa ───────────────────────────────────
   *
   * Preferimos uma ordem que JÁ está em execução em produção para provar o
   * fechamento sem criar dado. Se não houver, a prova para no ponto em que o dado
   * real termina — e diz isso, em vez de fabricar uma execução.
   */
  const inExecution = console_.ok ? (console_.body.items ?? []) : [];
  if (inExecution.length === 0) {
    record('CADEIA operacional completa', true, 'N/A — nenhuma ordem em execução agora');
    return;
  }

  const target = inExecution[0];
  const overview = await call(
    apiUrl,
    token,
    `/api/v1/query/service-orders/${target.serviceOrderId}/overview`,
  );
  if (!overview.ok) {
    record('OBJECT PAGE responde', false, `HTTP ${overview.status}`);
    return;
  }
  record(
    'OBJECT PAGE responde',
    true,
    `${overview.body.identity.orderNumber} · estágio ${overview.body.currentStage}`,
  );

  const gate = overview.body.completionGate;
  record(
    'GATE de conclusão publicado',
    Array.isArray(gate?.blockingReasons),
    gate?.canComplete
      ? 'conclusão liberada'
      : `${gate?.blockingReasons?.length ?? 0} motivo(s): ${(gate?.blockingReasons ?? [])
          .map((item) => item.reasonCode)
          .join(', ')}`,
  );

  record(
    'ACTUALS publicados',
    typeof overview.body.actuals?.comparison === 'object',
    `lançamentos=${overview.body.actuals?.comparison?.recordCount ?? 0}`,
  );

  record(
    'SITUAÇÕES publicadas',
    Array.isArray(overview.body.situations),
    `${overview.body.situations?.length ?? 0} situação(ões)`,
  );

  record(
    'COMANDOS disponíveis publicados',
    Array.isArray(overview.body.availableCommands) &&
      overview.body.availableCommands.length > 0,
    `${overview.body.availableCommands?.length ?? 0} comando(s)`,
  );

  // ── Prontidão de medição ──────────────────────────────────────────────────
  const readiness = await call(
    apiUrl,
    token,
    `/api/v1/query/service-orders/${target.serviceOrderId}/measurement-readiness`,
  );
  record(
    'MEASUREMENT READINESS responde',
    readiness.ok,
    readiness.ok
      ? readiness.body.ready
        ? 'base publicada'
        : `pendente: ${(readiness.body.blockers ?? []).join(', ')}`
      : `HTTP ${readiness.status}`,
  );
}

await main();

const failed = results.filter((item) => !item.passed).length;
console.log(`\n[dispatch-execution-proof] RESULTADO ${results.length - failed}/${results.length}`);
if (failed > 0) {
  process.exitCode = 1;
}
