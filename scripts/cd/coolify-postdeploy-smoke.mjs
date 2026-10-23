#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createCoolifyClient, DeployRefusedError } from './coolify-deploy.mjs';

const SHA_RE = /^[0-9a-f]{40}$/i;

/**
 * Modulos STUB comprovados: sem backend real por tras, permanecem desligados em TODOS os
 * ambientes (`apps/web/src/release-scope/feature-flags.ts` -> STUB_MODULES). Se um deles
 * aparecer `enabled` no registry de producao, alguem ligou superficie sem produto — o
 * operador clicaria num menu que nao leva a lugar nenhum.
 */
const STUB_MODULE_CODES = new Set(['rentals', 'transport']);

function required(name, value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new DeployRefusedError(`${name} ausente`);
  return normalized;
}

function normalizeRepository(value) {
  return String(value ?? '').trim().replace(/\/+$/, '');
}

function selectPublicBaseUrl(fqdn, name) {
  const candidates = String(fqdn ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => (value.startsWith('http://') || value.startsWith('https://') ? value : `https://${value}`));

  if (candidates.length === 0) {
    throw new DeployRefusedError(`${name}: fqdn publico ausente no Coolify`);
  }
  return (candidates.find((url) => url.startsWith('https://')) ?? candidates[0]).replace(/\/$/, '');
}

async function fetchChecked(fetchImpl, url, init, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (response.status >= 500) {
      throw new DeployRefusedError(`${label}: HTTP ${response.status}`);
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function jsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function assertRuntimeIdentity(app, { key, repository, sourceSha }) {
  const actualRepository = normalizeRepository(app?.docker_registry_image_name);
  const actualTag = String(app?.docker_registry_image_tag ?? '').trim();
  const status = String(app?.status ?? '').toLowerCase();

  if (actualRepository !== normalizeRepository(repository)) {
    throw new DeployRefusedError(
      `${key}: repository em runtime divergiu: expected=${repository} actual=${actualRepository || 'MISSING'}`,
    );
  }
  if (actualTag !== sourceSha) {
    throw new DeployRefusedError(
      `${key}: tag em runtime divergiu: expected=${sourceSha} actual=${actualTag || 'MISSING'}`,
    );
  }
  if (!status.startsWith('running')) {
    throw new DeployRefusedError(`${key}: status Coolify nao esta running: ${status || 'MISSING'}`);
  }
}

function logsText(payload) {
  if (typeof payload === 'string') return payload;
  if (typeof payload?.logs === 'string') return payload.logs;
  return JSON.stringify(payload ?? '');
}

function findFiveHundreds(text) {
  const lines = String(text).split('\n');
  return lines.filter((line) =>
    /"statusCode"\s*:\s*5\d\d|\bHTTP\s+5\d\d\b|\bstatus(?:Code)?\s*[=:]\s*5\d\d\b/i.test(line),
  );
}

export async function verifyProduction({
  client,
  fetchImpl = fetch,
  sourceSha,
  repositories,
  uuids,
  login,
  password,
}) {
  if (!SHA_RE.test(sourceSha ?? '')) throw new DeployRefusedError('COOLIFY_SOURCE_SHA invalido');
  required('PROD_SMOKE_LOGIN', login);
  required('PROD_SMOKE_PASSWORD', password);

  const [api, worker, web] = await Promise.all([
    client.getApplication(uuids.api),
    client.getApplication(uuids.worker),
    client.getApplication(uuids.web),
  ]);

  assertRuntimeIdentity(api, { key: 'api', repository: repositories.api, sourceSha });
  assertRuntimeIdentity(worker, { key: 'worker', repository: repositories.worker, sourceSha });
  assertRuntimeIdentity(web, { key: 'web', repository: repositories.web, sourceSha });

  const apiUrl = selectPublicBaseUrl(api.fqdn, 'api');
  const webUrl = selectPublicBaseUrl(web.fqdn, 'web');

  const [ready, webHealth] = await Promise.all([
    fetchChecked(fetchImpl, `${apiUrl}/api/v1/health/ready`, { method: 'GET' }, 'api readiness'),
    fetchChecked(fetchImpl, `${webUrl}/health`, { method: 'GET' }, 'web health'),
  ]);

  if (!ready.ok) throw new DeployRefusedError(`api readiness: HTTP ${ready.status}`);
  const readyBody = await jsonSafe(ready);
  if (readyBody?.status !== 'ready' || readyBody?.checks?.database?.status !== 'up') {
    throw new DeployRefusedError('api readiness nao confirmou status=ready e database=up');
  }
  if (!webHealth.ok) throw new DeployRefusedError(`web health: HTTP ${webHealth.status}`);

  const loginResponse = await fetchChecked(
    fetchImpl,
    `${apiUrl}/api/v1/auth/login`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login, password }),
    },
    'login',
  );
  const loginBody = await jsonSafe(loginResponse);
  const token = loginBody?.accessToken;
  if (!loginResponse.ok || !token) {
    throw new DeployRefusedError(`login smoke falhou: HTTP ${loginResponse.status}`);
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // PROVA DE QUE O NAVEGADOR CONSEGUE LOGAR
  // ───────────────────────────────────────────────────────────────────────────────────────────
  //
  // DEFEITO MEDIDO EM PRODUCAO (nao pego por este smoke antes desta correcao):
  // a tela de login respondia "Nao foi possivel conectar ao servidor" com a API saudavel,
  // o login funcionando por curl e `restarts=0` em todos os containers. Duas causas somadas,
  // ambas invisiveis para as assercoes anteriores:
  //
  //   1. `/runtime-config.js` do Web apontava `https://` para uma API que so serve HTTP
  //      (Traefik sem certificado valido) -> o browser falha no handshake TLS.
  //   2. A API nao devolvia `Access-Control-Allow-Origin` porque `CORS_ORIGIN` estava vazio
  //      em producao -> mesmo com a URL certa, o browser descarta a resposta.
  //
  // O login acima usa `fetch` de servidor: nao envia `Origin` e nao aplica CORS. Por isso
  // passava com o browser completamente bloqueado. Uma checagem que nao reproduz o browser
  // nao prova que o browser funciona.
  //
  // As duas assercoes abaixo fecham essa lacuna e sao FAIL-CLOSED: reprovam o deploy.

  // (1) O Web precisa anunciar para onde o browser deve chamar, no mesmo esquema e host
  //     que o smoke esta usando. Divergencia de esquema (http vs https) quebra o login.
  const runtimeConfig = await fetchChecked(
    fetchImpl,
    `${webUrl}/runtime-config.js`,
    { method: 'GET' },
    'web runtime-config',
  );
  if (!runtimeConfig.ok) {
    throw new DeployRefusedError(`web runtime-config: HTTP ${runtimeConfig.status}`);
  }
  const runtimeConfigText = await runtimeConfig.text();
  const advertised = /apiBaseUrl\s*:\s*["']([^"']+)["']/.exec(runtimeConfigText)?.[1];
  if (!advertised) {
    throw new DeployRefusedError('web runtime-config nao declara apiBaseUrl');
  }
  const normalizeBase = (value) => String(value ?? '').trim().replace(/\/+$/, '');
  if (normalizeBase(advertised) !== normalizeBase(apiUrl)) {
    throw new DeployRefusedError(
      `web runtime-config aponta para API diferente do runtime: advertised=${advertised} actual=${apiUrl}`,
    );
  }

  // O arquivo precisa ser NAO-CACHEAVEL. Caso contrario um browser que ja carregou a config
  // antiga continua com o login quebrado depois do deploy — o sintoma sobrevive a correcao e
  // parece "producao ainda quebrada". `no-store` e exigido porque este arquivo e a cola entre
  // o Web e a API: valor obsoleto nao e degradacao, e indisponibilidade de login.
  // `headers.get` une cabecalhos repetidos com ", ". A assinatura da duplicata medida em
  // e705c6bb era `no-cache, no-store, no-cache, must-revalidate`: a diretiva `no-cache`
  // aparecendo DUAS vezes revela dois cabecalhos empilhados (`expires -1` + `add_header`).
  // Uma politica correta declara cada diretiva no maximo uma vez.
  const cacheControl = runtimeConfig.headers?.get?.('cache-control') ?? '';
  const diretivas = cacheControl
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  const repetidas = diretivas.filter((d, i) => diretivas.indexOf(d) !== i);
  if (repetidas.length > 0) {
    throw new DeployRefusedError(
      `web runtime-config tem Cache-Control duplicado e ambiguo (diretivas repetidas: ${[...new Set(repetidas)].join(', ')}): '${cacheControl}'`,
    );
  }
  if (!diretivas.includes('no-store')) {
    throw new DeployRefusedError(
      `web runtime-config precisa de Cache-Control no-store (recebido: '${cacheControl || 'AUSENTE'}')`,
    );
  }

  // (2) A API precisa autorizar a origem do Web. Reproduz o preflight do browser enviando
  //     `Origin` e exigindo `Access-Control-Allow-Origin` de volta. Sem isso o login falha
  //     no browser mesmo retornando 200 aqui.
  const corsProbe = await fetchImpl(`${apiUrl}/api/v1/auth/session`, {
    method: 'GET',
    headers: { origin: webUrl },
  });
  const allowedOrigin = corsProbe.headers.get('access-control-allow-origin');
  if (!allowedOrigin) {
    throw new DeployRefusedError(
      `CORS: API nao autoriza a origem do Web (${webUrl}); defina CORS_ORIGIN na API`,
    );
  }
  if (allowedOrigin !== '*' && normalizeBase(allowedOrigin) !== normalizeBase(webUrl)) {
    throw new DeployRefusedError(
      `CORS: API autoriza origem diferente do Web: allowed=${allowedOrigin} expected=${webUrl}`,
    );
  }

  const authHeaders = { authorization: `Bearer ${token}` };
  for (const [label, path] of [
    ['auth session', '/api/v1/auth/session'],
    ['me', '/api/v1/me'],
    ['catalog', '/api/v1/catalog/service-definitions?limit=1&offset=0'],
  ]) {
    const response = await fetchChecked(fetchImpl, `${apiUrl}${path}`, { method: 'GET', headers: authHeaders }, label);
    if (!response.ok) throw new DeployRefusedError(`${label}: HTTP ${response.status}`);
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // COERENCIA DE SUPERFICIE: o Web nao pode anunciar modulo que a API recusa
  // ───────────────────────────────────────────────────────────────────────────────────────────
  //
  // DEFEITO QUE ESTA CHECAGEM FECHA (medido em 2026-10-23):
  //
  // As duas familias de flags sao INDEPENDENTES: o web le `VITE_FEATURE_MODULE_*` em BUILD
  // e a API le `FEATURE_MODULE_*` em RUNTIME. Nada as acopla. O artefato de producao estava
  // saindo com os 13 modulos construidos DESLIGADOS (job Build / artifacts sem env), e o
  // smoke passava porque so provava health, login e `catalog` — nenhum modulo gated.
  //
  // A assercao abaixo le o registro de modulos da API e exige que todo modulo reportado como
  // `enabled` seja realmente alcancavel. Divergencia (API `not_released` enquanto o menu
  // mostra o item, ou o inverso) vira falha de deploy, nao bug descoberto pelo operador.
  const modulesResponse = await fetchChecked(
    fetchImpl,
    `${apiUrl}/api/v1/modules/registry`,
    { method: 'GET', headers: authHeaders },
    'module registry',
  );
  if (!modulesResponse.ok) {
    throw new DeployRefusedError(`module registry: HTTP ${modulesResponse.status}`);
  }
  const modulesBody = await jsonSafe(modulesResponse);
  const modules = Array.isArray(modulesBody) ? modulesBody : (modulesBody?.modules ?? []);
  if (modules.length === 0) {
    throw new DeployRefusedError('module registry vazio: nao prova superficie de modulos');
  }

  const notReleased = modules.filter((entry) => entry?.status === 'not_released');
  const enabled = modules.filter((entry) => entry?.status === 'enabled');

  // Modulo sem backend real (STUB) nao deve estar habilitado em producao.
  const stubEnabled = enabled.filter((entry) => STUB_MODULE_CODES.has(String(entry?.moduleCode)));
  if (stubEnabled.length > 0) {
    throw new DeployRefusedError(
      `modulos STUB habilitados em producao: ${stubEnabled.map((e) => e.moduleCode).join(', ')}`,
    );
  }

  // Todo modulo que a API reporta como `enabled` precisa ser realmente alcancavel pela
  // identidade autenticada do smoke. `enabled` no catalogo com rota que responde 403/404
  // FEATURE_DISABLED e exatamente a incoerencia que faz o menu mostrar item inutil.
  //
  // TESTA TODAS AS ROTAS, NAO SO A PRIMEIRA.
  //
  // DEFEITO QUE ISTO FECHA (medido em 2026-10-23): a versao anterior usava `routes[0]` e
  // concatenava `?limit=1&offset=0` cegamente. Para modulo com varias rotas, a primeira pode
  // nao ser a leitura de entrada que o menu usa; e para rota que JA tem query string a
  // concatenacao produzia `...?unitId=x&limit=1?limit=1&offset=0`, URL invalida que nao prova
  // nada. Efeito pratico: o smoke dizia PASS enquanto o operador nao via o menu.
  const unreachable = [];
  const visible = [];
  for (const entry of enabled) {
    // O SUMMARY (`GET /modules/registry`) NAO traz `routes` — so o DETAIL
    // (`GET /modules/registry/:code`) traz. Ler `entry.routes` do summary devolve
    // `undefined`, o loop pulava todo mundo e `visible` saia VAZIO mesmo com os 13
    // modulos habilitados. Foi exatamente o que aconteceu no release abf17d39.
    let routes = Array.isArray(entry?.routes) ? entry.routes.filter(Boolean) : [];
    if (routes.length === 0) {
      const detail = await fetchChecked(
        fetchImpl,
        `${apiUrl}/api/v1/modules/registry/${encodeURIComponent(String(entry.moduleCode))}`,
        { method: 'GET', headers: authHeaders },
        `module detail ${entry.moduleCode}`,
      );
      if (detail.ok) {
        const body = await jsonSafe(detail);
        if (Array.isArray(body?.routes)) routes = body.routes.filter(Boolean);
      }
    }
    if (routes.length === 0) {
      // Sem rota declarada nao ha o que sondar: reporta como nao provado, nunca como visivel.
      unreachable.push(`${entry.moduleCode} [sem rota declarada no registry]`);
      continue;
    }

    // Basta UMA rota alcancavel para o modulo ser utilizavel pelo operador.
    let reachable = false;
    const failures = [];
    for (const route of routes) {
      // Respeita query pre-existente: usa '?' ou '&' conforme a rota.
      const separator = route.includes('?') ? '&' : '?';
      const probe = await fetchImpl(`${apiUrl}${route}${separator}limit=1&offset=0`, {
        method: 'GET',
        headers: authHeaders,
      });
      // 400/422 sao aceitaveis: a rota existe e autorizou, o contrato de query reclamou.
      // 403/404/500 nao sao: significam superficie anunciada que o operador nao alcanca.
      if ([403, 404, 500].includes(probe.status)) {
        failures.push(`${route} -> HTTP ${probe.status}`);
      } else {
        reachable = true;
        break;
      }
    }

    if (!reachable) {
      unreachable.push(`${entry.moduleCode} [${failures.join(', ')}]`);
    } else {
      visible.push(entry.moduleCode);
    }
  }
  if (unreachable.length > 0) {
    throw new DeployRefusedError(
      `modulos anunciados como enabled mas inacessiveis pela identidade do smoke: ${unreachable.join('; ')}`,
    );
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // LOGS: a janela precisa cobrir a INICIALIZACAO, nao so o presente.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  //
  // DEFEITO MEDIDO (release 513e2d5c): `MIGRATIONS OK: applied=0 total=104` era emitida na
  // LINHA 1 do log do container, e o smoke lia `lines=200` de um log de 568 linhas. A prova
  // existia e ficava fora da janela — o deploy era recusado por "migrations: log da API nao
  // confirmou MIGRATIONS OK" mesmo tendo migrado com sucesso.
  //
  // Uma janela fixa e uma aposta no volume de log, e o volume cresce com o trafego. Por isso
  // a leitura e ampliada e o resultado reporta quantas linhas vieram, para que a proxima
  // falha desse tipo seja diagnosticavel pela propria mensagem.
  const LOG_LINES = 2000;
  const logPayloads = await Promise.all(
    Object.entries(uuids).map(async ([key, uuid]) => {
      const payload = await client.call(`/applications/${uuid}/logs?lines=${LOG_LINES}&show_timestamps=true`);
      return [key, logsText(payload)];
    }),
  );

  const logsByKey = Object.fromEntries(logPayloads);
  const apiLogLines = String(logsByKey.api ?? '').split('\n').filter((l) => l.trim()).length;
  if (!/MIGRATIONS OK:\s*applied=\d+\s+total=\d+/i.test(logsByKey.api ?? '')) {
    // Mensagem inclui o VOLUME lido: se o problema for a janela de log, o proximo a ler
    // sabe disso sem investigar do zero.
    throw new DeployRefusedError(
      `migrations: log da API nao confirmou MIGRATIONS OK para esta inicializacao ` +
        `(lidas ${apiLogLines} linhas, limite ${LOG_LINES})`,
    );
  }

  const fiveHundreds = logPayloads.flatMap(([key, text]) =>
    findFiveHundreds(text).map((line) => `${key}: ${line.slice(0, 240)}`),
  );
  if (fiveHundreds.length > 0) {
    throw new DeployRefusedError(
      `5xx encontrado nos logs recentes: ${fiveHundreds.slice(0, 5).join(' | ')}`,
    );
  }

  return {
    sourceSha,
    apiUrl,
    webUrl,
    runtime: {
      api: { repository: repositories.api, tag: sourceSha, status: api.status },
      worker: { repository: repositories.worker, tag: sourceSha, status: worker.status },
      web: { repository: repositories.web, tag: sourceSha, status: web.status },
    },
    readiness: { status: readyBody.status, database: readyBody.checks.database.status },
    webHealth: 'ok',
    authenticatedSmoke: 'ok',
    migrations: 'ok',
    recent5xx: 0,
    // Superficie de modulos efetivamente servida pela API nesta producao.
    // Vai no log do deploy para que a decisao de release seja AUDITAVEL: sem isso,
    // "o smoke passou" nao dizia QUAIS modulos o operador recebeu.
    modules: {
      total: modules.length,
      enabled: enabled.map((entry) => entry.moduleCode),
      // Modulos cujo endpoint a identidade do smoke REALMENTE alcancou. Diferenca entre
      // `enabled` e `visible` = menu mostraria item que a API recusa.
      visible,
      notReleased: notReleased.map((entry) => entry.moduleCode),
    },
  };
}

async function main() {
  const sourceSha = required('COOLIFY_SOURCE_SHA', process.env.COOLIFY_SOURCE_SHA);
  const client = createCoolifyClient({
    baseUrl: process.env.COOLIFY_BASE_URL,
    token: process.env.COOLIFY_TOKEN,
  });

  const result = await verifyProduction({
    client,
    sourceSha,
    repositories: {
      api: required('API_REPOSITORY', process.env.API_REPOSITORY),
      worker: required('WORKER_REPOSITORY', process.env.WORKER_REPOSITORY),
      web: required('WEB_REPOSITORY', process.env.WEB_REPOSITORY),
    },
    uuids: {
      api: required('COOLIFY_API_UUID', process.env.COOLIFY_API_UUID),
      worker: required('COOLIFY_WORKER_UUID', process.env.COOLIFY_WORKER_UUID),
      web: required('COOLIFY_WEB_UUID', process.env.COOLIFY_WEB_UUID),
    },
    login: process.env.PROD_SMOKE_LOGIN,
    password: process.env.PROD_SMOKE_PASSWORD,
  });

  console.log(
    `[coolify-postdeploy] PASS source=${result.sourceSha} readiness=${result.readiness.status} database=${result.readiness.database} web=${result.webHealth} auth=${result.authenticatedSmoke} migrations=${result.migrations} recent5xx=${result.recent5xx}`,
  );
  // Prova auditavel da superficie entregue ao operador. Se um modulo construido nao
  // aparecer aqui, o deploy "verde" nao significa produto completo.
  console.log(
    `[coolify-postdeploy] modules total=${result.modules.total} enabled=[${result.modules.enabled.join(',')}] visible=[${result.modules.visible.join(',')}] notReleased=[${result.modules.notReleased.join(',')}]`,
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(`[coolify-postdeploy] FALHA: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
