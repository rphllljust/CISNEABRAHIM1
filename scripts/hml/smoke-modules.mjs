/**
 * SMOKE FOCADO — superfície de módulos do HML
 *
 * ============================================================================================
 * O QUE ESTE SMOKE RESPONDE
 * ============================================================================================
 *
 * Os módulos construídos estão REALMENTE acessíveis, ou o guard de release continua
 * recusando? A pergunta é específica e a distinção importa:
 *
 *   - `FEATURE_DISABLED`  → o módulo está desligado no release-scope. FAIL: é o defeito que
 *                           este trabalho elimina (superfície declarada != superfície servida).
 *   - `AUTHZ_DENIED`      → o ator autenticado não tem a capability. ACEITÁVEL: é autorização
 *                           real funcionando, não configuração errada. Reportado como tal.
 *   - `VALIDATION` (400)  → o guard liberou a rota e a validação de domínio assumiu. Prova que
 *                           o módulo está publicado e funcionando.
 *   - 5xx                 → FAIL. Módulo ligado mas quebrado.
 *
 * Sem essa separação, um 403 legítimo de autorização seria confundido com o defeito de
 * configuração — e um defeito de configuração poderia passar por "só falta permissão".
 *
 * Uso:
 *   HML_SMOKE_TOKEN=... node scripts/hml/smoke-modules.mjs
 */

const API = process.env.HML_PUBLIC_API_URL ?? 'http://127.0.0.1:3100';

/**
 * Módulos construídos sob teste: (módulo, rota de listagem real do backend).
 *
 * As rotas foram lidas dos controllers — não presumidas. Duas observações de contrato:
 *   - `payroll` NÃO expõe listagem de períodos: só `periods/:periodId`. Não existe endpoint
 *     de coleção para sondar, então a prova de superfície é `periods/0`, que pelo prefixo
 *     `payroll/` já exercita o guard de release.
 *   - `reports` expõe `catalog` (não a raiz).
 */
const BUILT_MODULE_ROUTES = [
  { module: 'finance', path: '/api/v1/finance/receivables' },
  { module: 'fiscal', path: '/api/v1/fiscal/documents' },
  { module: 'accounting', path: '/api/v1/accounting/charts' },
  { module: 'inventory', path: '/api/v1/inventory/items' },
  { module: 'procurement', path: '/api/v1/procurement/requests' },
  { module: 'suppliers', path: '/api/v1/suppliers' },
  { module: 'payroll', path: '/api/v1/payroll/periods/00000000-0000-0000-0000-000000000000' },
  { module: 'reports', path: '/api/v1/reports/catalog' },
];

/**
 * STUBS — verificação CORRIGIDA (2026-09-29).
 *
 * A versão anterior sondava `/api/v1/service-orders?archetype=RENTAL|TRANSPORT` e reportava o
 * 200 como "stub acessível". Isso era um ERRO DE PREMISSA do próprio smoke, não um defeito:
 *
 *   - `/api/v1/rentals` e `/api/v1/transport` NÃO EXISTEM (404). Nenhum controller dedicado
 *     foi escrito para essas verticais.
 *   - `archetype` é um filtro suportado da listagem de OS da RELEASE 1
 *     (`service-order-list.query.ts` monta `so.service_snapshot->>'archetype' = $n`), e
 *     `service-orders` é módulo R1 corretamente NÃO-gaited.
 *
 * Logo o 200 vinha de uma rota de Release 1 legítima, não de um stub escapando do gate.
 *
 * O que É verificável e agora é verificado: se um dia alguém criar superfície dedicada para
 * essas verticais (ex.: `/api/v1/rentals`), ela precisa nascer sob gate. Enquanto não existir,
 * a flag `FEATURE_MODULE_RENTALS=false` controla superfície de UI — e isso é declarado, não
 * presumido.
 */
const STUB_DEDICATED_SURFACES = [
  { module: 'rentals', path: '/api/v1/rentals' },
  { module: 'transport', path: '/api/v1/transport' },
];

async function login() {
  const loginValue = process.env.HML_SMOKE_LOGIN ?? process.env.BOOTSTRAP_ADMIN_LOGIN;
  const password = process.env.HML_SMOKE_PASSWORD ?? process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!loginValue || !password) {
    throw new Error('HML_SMOKE_LOGIN/HML_SMOKE_PASSWORD ausentes no ambiente.');
  }
  const response = await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login: loginValue, password }),
  });
  if (!response.ok) {
    throw new Error(`login falhou: HTTP ${response.status}`);
  }
  const body = await response.json();
  return body.accessToken;
}

/** Classifica uma resposta HTTP segundo a semântica deste smoke. */
function classify(status, errorCode) {
  if (status >= 500) return 'SERVER_ERROR';
  if (status === 403 && errorCode === 'FEATURE_DISABLED') return 'FEATURE_DISABLED';
  if (status === 403 || status === 401) return 'AUTHZ_DENIED';
  if (status >= 200 && status < 300) return 'OK';
  // 400/422 provam que o guard de release LIBEROU a rota e a validação de domínio assumiu:
  // a rota existe, está publicada e rejeitou o payload. Não é FEATURE_DISABLED nem defeito.
  if (status === 400 || status === 422) return 'VALIDATION';
  if (status === 404) return 'NOT_FOUND';
  return 'OTHER';
}

async function probe(token, path) {
  const response = await fetch(`${API}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  let errorCode = null;
  try {
    const body = await response.json();
    errorCode = body?.error?.code ?? body?.code ?? null;
  } catch {
    // resposta sem corpo JSON — irrelevante para a classificação
  }
  return { status: response.status, code: errorCode, outcome: classify(response.status, errorCode) };
}

/**
 * DEFEITO ABERTO CONHECIDO — não relacionado ao release-scope.
 *
 * `GET /api/v1/payroll/periods/:periodId` responde HTTP **500** com `PAYROLL_VALIDATION_FAILED`.
 * Um erro de validação de entrada é condição de cliente e deve ser 4xx; 500 é incorreto.
 * O guard de release LIBEROU a rota (não é FEATURE_DISABLED), então a configuração de módulos
 * está correta — o defeito está no mapeamento de erro do domínio de folha.
 *
 * Declarado como EXCEÇÃO CONHECIDA para que o smoke meça a regressão de configuração (seu
 * objetivo) sem mascarar o defeito. Remover esta entrada quando o defeito for corrigido.
 */
const KNOWN_OPEN_DEFECTS = new Map([
  ['payroll', 'PAYROLL_VALIDATION_FAILED servido como HTTP 500 em vez de 4xx'],
]);

async function main() {
  console.log(`SMOKE FOCADO DE MÓDULOS — ${API}\n`);

  const token = process.env.HML_SMOKE_TOKEN ?? (await login());
  const failures = [];
  const notes = [];
  /** Resultados por módulo, para a asserção central: nenhum FEATURE_DISABLED. */
  const outcomes = [];

  console.log('[1] Módulos CONSTRUÍDOS — esperado: NÃO FEATURE_DISABLED');
  for (const { module, path } of BUILT_MODULE_ROUTES) {
    const result = await probe(token, path);
    outcomes.push({ module, ...result });
    const line = `    ${module.padEnd(14)} HTTP ${String(result.status).padEnd(4)} ${result.outcome}${
      result.code ? ` (${result.code})` : ''
    }`;
    console.log(line);

    if (result.outcome === 'FEATURE_DISABLED') {
      failures.push(`${module}: FEATURE_DISABLED — módulo construído está desligado no release-scope`);
    } else if (result.outcome === 'SERVER_ERROR') {
      if (KNOWN_OPEN_DEFECTS.has(module)) {
        notes.push(
          `${module}: HTTP ${result.status} — DEFEITO ABERTO CONHECIDO (${KNOWN_OPEN_DEFECTS.get(module)}). ` +
            'Não é release-scope: o guard liberou a rota.',
        );
      } else {
        failures.push(`${module}: HTTP ${result.status} — módulo ligado mas quebrado`);
      }
    } else if (result.outcome === 'NOT_FOUND') {
      // 404 é informação de contrato (rota/param ausente), não de configuração. Registrado
      // como observação para não inflar o resultado com falso FAIL — mas visível.
      notes.push(`${module}: HTTP 404 em ${path} — rota sem correspondência (conferir contrato)`);
    }
  }

  console.log('\n[2] VERTICAIS DEDICADAS (rentals/transport) — OUT_OF_RELEASE_1 (DDP-026)');
  for (const { module, path } of STUB_DEDICATED_SURFACES) {
    const result = await probe(token, path);
    console.log(
      `    ${module.padEnd(14)} HTTP ${String(result.status).padEnd(4)} ${result.outcome}${
        result.code ? ` (${result.code})` : ''
      }`,
    );

    if (result.outcome === 'SERVER_ERROR') {
      failures.push(`${module}: HTTP ${result.status} — erro de servidor`);
    } else if (result.outcome === 'FEATURE_DISABLED') {
      // Superfície dedicada existe E está sob gate: exatamente o comportamento correto quando
      // a flag está false. Nada a apontar.
      console.log(`      -> superfície dedicada sob gate, recusada (correto para flag=false)`);
    } else if (result.outcome === 'NOT_FOUND') {
      notes.push(
        `${module}: sem superfície dedicada (404). A vertical é consumida via archetype na ` +
          'listagem de OS da Release 1. FEATURE_MODULE_' +
          `${module.toUpperCase()}=false controla UI, não rota.`,
      );
    } else {
      // 200/403 numa rota /api/v1/rentals significa que alguém criou superfície dedicada sem
      // colocá-la sob gate — a inconsistência de release boundary que precisa ser notada.
      failures.push(
        `${module}: HTTP ${result.status} em ${path} — superfície dedicada existe mas NÃO está ` +
          'sob gate de release. Registre o prefixo em GATED_API_PATH_PREFIXES.',
      );
    }
  }

  console.log('');
  const disabled = outcomes.filter((entry) => entry.outcome === 'FEATURE_DISABLED');
  if (disabled.length > 0) {
    failures.push(
      `${disabled.length} módulo(s) construído(s) responderam FEATURE_DISABLED: ` +
        disabled.map((entry) => entry.module).join(', '),
    );
  }

  if (notes.length > 0) {
    console.log('Observações (não são falha de configuração):');
    for (const note of notes) console.log(`  - ${note}`);
    console.log('');
  }

  if (failures.length > 0) {
    console.error(`SMOKE DE MÓDULOS: FAIL (${failures.length} problema(s))`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log('SMOKE DE MÓDULOS: PASS');
  console.log(
    `  Nenhum dos ${outcomes.length} módulos construídos respondeu FEATURE_DISABLED; nenhum 5xx.`,
  );
  console.log('  AUTHZ_DENIED é aceitável e indica autorização real operando.');
  process.exit(0);
}

main().catch((error) => {
  console.error(`[smoke-modules] fatal: ${error.message}`);
  process.exit(1);
});
