#!/usr/bin/env node
/**
 * PROVA DO ELO FINAL — sessao autenticada -> useNavAccess -> menu Financeiro.
 *
 * POR QUE ESTE SCRIPT EXISTE
 *
 * Todos os elos anteriores ja estavam provados em producao:
 *   - bundle com VITE_FEATURE_MODULE_FINANCE=true (verificado baixando o JS servido)
 *   - FEATURE_MODULE_FINANCE=true no Coolify (verificado via API)
 *   - registry reportando finance como `enabled`
 *   - /api/v1/finance/receivables respondendo 401 sem token (existe, exige auth)
 *
 * O que NUNCA foi provado com a IDENTIDADE REAL: se o usuario autenticado consegue
 * LER a rota de entrada do Financeiro. Essa e a unica pergunta que separa "RBAC" de
 * "menu/cache", e ela exige o token de um usuario real - que so existe nos secrets.
 *
 * O script reproduz EXATAMENTE o que `useNavAccess` faz:
 *   1. login com a identidade de smoke
 *   2. GET na entrada de `finance-overview` (a sonda composta do menu)
 *   3. classifica o resultado: 2xx = menu deve mostrar; 403 = RBAC; 404 = rota errada;
 *      FEATURE_DISABLED = release/runtime divergente
 *
 * Nada e "interpretado": o status HTTP e a resposta sao impressos.
 */
import { DeployRefusedError } from '../cd/coolify-deploy.mjs';

function required(name, value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new DeployRefusedError(`${name} ausente`);
  return normalized;
}

/**
 * Sondas do menu Financeiro — espelho de `finance-overview` (COMPOSITE_SURFACES) em
 * apps/web/src/shell/surface-access.ts. O menu mostra o item se QUALQUER uma autorizar.
 */
const FINANCE_OVERVIEW_PROBES = [
  '/api/v1/finance/receivables?limit=1&offset=0',
  '/api/v1/finance/payables?limit=1&offset=0',
  '/api/v1/finance/treasury/accounts',
];

/** Mapeia status -> diagnostico do elo que falhou. */
export function classifyProbe(status) {
  if (status >= 200 && status < 300) return 'ALLOWED';
  if (status === 403) return 'RBAC_DENIED';
  if (status === 404) return 'ROUTE_WRONG';
  if (status === 401) return 'AUTH_FAILED';
  return `HTTP_${status}`;
}

export function summarizeFinanceProbes(results) {
  const allowed = results.find((r) => r.outcome === 'ALLOWED');
  if (allowed) {
    return {
      visible: true,
      reason: 'menu deve mostrar Financeiro',
      evidence: allowed,
      results,
    };
  }
  // Nenhuma sonda autorizou: o menu NAO mostra. A causa e a primeira classificacao
  // nao-neutra, para que o diagnostico aponte o elo real.
  const denied = results.find((r) => r.outcome === 'RBAC_DENIED');
  const wrongRoute = results.find((r) => r.outcome === 'ROUTE_WRONG');
  const authFailed = results.find((r) => r.outcome === 'AUTH_FAILED');
  return {
    visible: false,
    reason: denied
      ? 'RBAC: identidade autenticada nao tem a capability finance:receivable:list'
      : wrongRoute
        ? 'ROTA ERRADA: a sonda do menu aponta para endpoint inexistente'
        : authFailed
          ? 'AUTH: token de smoke nao autenticou'
          : 'INDETERMINADO',
    evidence: denied ?? wrongRoute ?? authFailed ?? results[0],
    results,
  };
}

async function main() {
  const apiUrl = required('PROD_API_URL', process.env.PROD_API_URL).replace(/\/+$/, '');
  const login = required('PROD_SMOKE_LOGIN', process.env.PROD_SMOKE_LOGIN);
  const password = required('PROD_SMOKE_PASSWORD', process.env.PROD_SMOKE_PASSWORD);

  const loginResponse = await fetch(`${apiUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login, password }),
  });
  if (!loginResponse.ok) {
    throw new DeployRefusedError(`login falhou: HTTP ${loginResponse.status}`);
  }
  const { accessToken } = await loginResponse.json();
  if (!accessToken) throw new DeployRefusedError('login nao devolveu accessToken');
  console.log('[nav-proof] autenticado');

  // (0) O modulo esta habilitado no runtime? Se nao, o problema nao e RBAC nem menu.
  const registry = await fetch(`${apiUrl}/api/v1/modules/registry/finance`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const registryStatus = registry.ok ? (await registry.json())?.status : `HTTP_${registry.status}`;
  console.log(`[nav-proof] registry finance status=${registryStatus}`);

  // (1) As sondas exatas do menu.
  const results = [];
  for (const path of FINANCE_OVERVIEW_PROBES) {
    const response = await fetch(`${apiUrl}${path}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    // Le o motivo quando houver, sem imprimir dados do payload.
    let reason = null;
    if (!response.ok) {
      try {
        const body = await response.json();
        reason = body?.message ?? body?.error ?? body?.code ?? null;
      } catch {
        reason = null;
      }
    }
    results.push({
      path,
      status: response.status,
      outcome: classifyProbe(response.status),
      reason: Array.isArray(reason) ? reason.join('; ') : reason,
    });
    console.log(
      `[nav-proof] ${path} -> HTTP ${response.status} (${results.at(-1).outcome})${reason ? `: ${JSON.stringify(reason)}` : ''}`,
    );
  }

  const summary = summarizeFinanceProbes(results);
  console.log(
    `[nav-proof] VEREDITO visible=${summary.visible} reason="${summary.reason}" registry=${registryStatus}`,
  );

  if (!summary.visible) {
    throw new DeployRefusedError(
      `Financeiro NAO apareceria no menu: ${summary.reason} ` +
        `(registry=${registryStatus}, probes=${results.map((r) => `${r.path}=${r.status}`).join(', ')})`,
    );
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((error) => {
    console.error(`[nav-proof] FALHA: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
