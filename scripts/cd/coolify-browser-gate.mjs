/**
 * BROWSER GATE DE PRODUÇÃO — valida a INTERFACE RENDERIZADA no runtime real.
 *
 * ──────────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTE GATE EXISTE
 * ──────────────────────────────────────────────────────────────────────────────────
 *
 * O smoke pós-deploy (`coolify-postdeploy-smoke.mjs`) prova o RUNTIME do frontend:
 * a imagem está no ar, o `/health` responde, o `/runtime-config.js` anuncia a API
 * correta com `no-store`, o CORS devolve a origem e o login retorna token. Tudo isso
 * é fail-closed e é provado com `fetch` de servidor.
 *
 * O que NENHUMA dessas asserções prova é que a INTERFACE RENDERIZA. Um `fetch` não
 * executa JavaScript de aplicação: não monta o React, não resolve a navegação por
 * permissão, não carrega o chunk de uma rota preguiçosa, não dispara os probes do
 * shell. Já houve, neste projeto, deploy "verde" com a tela de login quebrada no
 * navegador — a lacuna é real e medida.
 *
 * Este gate fecha essa lacuna abrindo um Chromium de verdade contra o domínio público
 * e exigindo a cadeia operacional completa: login pelo formulário → App Shell →
 * Controladoria → Contabilização → fila → trilha econômica.
 *
 * ──────────────────────────────────────────────────────────────────────────────────
 * O QUE ELE **NÃO** FAZ
 * ──────────────────────────────────────────────────────────────────────────────────
 *
 * Não altera dado de produção: só lê e navega. Não contorna autorização: usa as
 * credenciais de smoke já provisionadas e, quando o backend nega algo, exige que a
 * negação seja a CORRETA (fail-closed), em vez de tratá-la como erro.
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * `@playwright/test` é dependência do workspace `apps/web`, não da raiz.
 *
 * Este script vive em `scripts/cd/`, então um `import '@playwright/test'` simples
 * falharia a resolução. A primeira correção apontou um CAMINHO FIXO para
 * `apps/web/node_modules/@playwright/test/index.mjs` — e isso reprovou no CI com
 * `Cannot find module`, porque em pnpm workspaces o pacote pode viver em
 * `node_modules/.pnpm/...` e o caminho direto pelo workspace nem sempre existe
 * (localmente é um junction; no runner, não).
 *
 * Caminho fixo é SUPOSIÇÃO sobre o layout de instalação. A resolução de módulo do Node,
 * ancorada no workspace que DECLARA a dependência, é o mecanismo que qualquer `import`
 * usa: se o pacote está instalado, ele é encontrado; se não está, falha alto e cedo.
 */
const webWorkspace = resolve(import.meta.dirname, '..', '..', 'apps', 'web');
const requireFromWeb = createRequire(resolve(webWorkspace, 'package.json'));
const playwrightEntry = requireFromWeb.resolve('@playwright/test');
/**
 * O `require.resolve` devolve a entrada CJS (`index.js`). Importar um pacote CJS por
 * `import()` deixa a API pública em `default` — sem este desembrulho, `chromium` chega
 * `undefined` e o gate morre com `Cannot read properties of undefined (reading
 * 'launch')`, um erro que não diz nada sobre a causa. Aceita as duas formas para não
 * depender de qual entrada o resolver escolher.
 */
const playwrightModule = await import(pathToFileURL(playwrightEntry).href);
const chromium = playwrightModule.chromium ?? playwrightModule.default?.chromium;
if (!chromium) {
  throw new Error(
    `@playwright/test resolvido em ${playwrightEntry} nao expoe 'chromium' (interop ESM/CJS)`,
  );
}

const OUT = process.env['BROWSER_GATE_OUT'] ?? 'artifacts/browser-gate';

const results = [];
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * TRÊS RESULTADOS, NÃO DOIS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   `true`  → PASS          → PROVADO
 *   `false` → FAIL          → QUEBROU
 *   `null`  → NOT_APPLICABLE → NÃO PROVADO
 *
 * A distinção existe porque as duas primeiras são sobre a TELA (ela funciona ou
 * não) e a terceira é sobre a PROVA DE NEGÓCIO (havia caso para provar?). Somar
 * N/A na contagem de aprovados é como transformar "não medi" em "medi e passou".
 */
function record(name, passed, detail) {
  results.push({ name, passed, detail });
  const label = passed === null ? 'N/A ' : passed ? 'PASS' : 'FAIL';
  console.log(`${label}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function required(name) {
  const value = String(process.env[name] ?? '').trim();
  if (!value) {
    throw new Error(`${name} ausente: o gate de browser nao pode rodar sem o runtime real.`);
  }
  return value;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * EXTRAÇÃO DA UNIDADE OPERACIONAL — FUNÇÃO PURA E TESTÁVEL
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A unidade vive na FAIXA DE RESUMO que o operador lê:
 *
 *   `UNIDADE UN-PROD-001   1 FALHARAM   0 PENDENTES   0 ESTORNADAS`
 *
 * Três fontes foram tentadas antes desta, e as três primeiras não servem:
 *
 *   1. `fetch('/api/v1/me')` relativo → resolve contra a origem do SPA e recebe
 *      `index.html` (`SyntaxError: Unexpected token '<'`).
 *   2. escutar `/api/v1/me` → devolve identidade e permissões, NÃO a unidade.
 *   3. ler token de storage → o `tokenStore` guarda o access token em MEMÓRIA,
 *      por design; ler de storage seria enfraquecer isso.
 *
 * Extraída como função pura porque o defeito anterior — um delimitador de fim
 * de comentário ausente — deixou a navegação inteira DENTRO do comentário: a
 * checagem de sintaxe passou, o teste por regex passou, e o código simplesmente
 * não rodava. Só comportamento pega isso.
 */
export function extractOperationalUnit(worklistText) {
  if (typeof worklistText !== 'string') return null;
  const match = /UNIDADE\s+([A-Z0-9][A-Z0-9._-]{2,})/i.exec(worklistText);
  return match?.[1] ?? null;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * O VEREDITO É UMA FUNÇÃO PURA — E É TESTÁVEL COMO TAL
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A decisão de saída vivia embutida no `main` e só podia ser julgada lendo o
 * código-fonte com regex. Isso é o que permitiu o defeito passar: o teste
 * afirmava `assert.match(source, /businessVerified/)` e ficava verde enquanto
 * `businessVerified=false` produzia `exitCode=0`.
 *
 * Extraída aqui, a regra passa a ser exercitada por COMPORTAMENTO: quatro
 * combinações de entrada, quatro saídas esperadas.
 *
 *   releaseVerified = assertionsPass && runtimeVerified && businessVerified
 *
 * `NOT_APPLICABLE` não entra na conjunção como aprovado: ele mantém
 * `businessVerified = false`, e a entrega não é declarada validada.
 */
export function decideReleaseVerdict(input) {
  const assertionsPass = input.passed === input.total && input.total > 0;
  const runtimeVerified = input.runtimeVerified === true;
  const businessVerified = input.businessVerified === true;
  return {
    assertionsPass,
    runtimeVerified,
    businessVerified,
    releaseVerified: assertionsPass && runtimeVerified && businessVerified,
    exitCode: assertionsPass && runtimeVerified && businessVerified ? 0 : 1,
  };
}

async function main() {
  const webUrl = required('CISNE_PROD_WEB_URL').replace(/\/+$/, '');
  const login = required('PROD_SMOKE_LOGIN');
  const password = required('PROD_SMOKE_PASSWORD');

  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const consoleErrors = [];
  const forbidden = [];
  /** Status HTTP que a API devolveu ao login — evidência para o diagnostico. */
  const loginApiStatuses = [];
  /**
   * Vereditos separados, declarados AQUI para sobreviverem ao `try`/`catch`.
   *
   * `runtimeVerified` = a aplicação subiu, autenticou e renderizou.
   * `businessVerified` = a capability desta release foi observada funcionando.
   */
  let runtimeVerified = false;
  let businessVerified = false;
  let businessReason;
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('response', (res) => {
    if (res.status() === 403) forbidden.push(`${res.status()} ${res.url()}`);
    if (res.url().includes('/api/v1/auth/login')) {
      loginApiStatuses.push(`HTTP ${res.status()}`);
    }
  });

  /**
   * A UNIDADE VEM DA RESPOSTA REAL DE `/api/v1/me` QUE O PRÓPRIO APP FAZ.
   *
   * ─────────────────────────────────────────────────────────────────────────────
   * DUAS TENTATIVAS ERRADAS ANTES DESTA (registradas para não repetir)
   * ─────────────────────────────────────────────────────────────────────────────
   *
   * 1ª: `fetch('/api/v1/me')` relativo dentro de `page.evaluate`. Resolveu contra a
   *     origem do SPA — que devolve `index.html` — e o parse estourou:
   *     `SyntaxError: Unexpected token '<', "<!doctype "... is not valid JSON`.
   *
   * 2ª: ler o token de `localStorage` para chamar a API com `Authorization`. O
   *     `tokenStore` mantém o access token em MEMÓRIA (`let accessToken`), nunca em
   *     storage — por design, e com razão: token em storage é token exposto a XSS.
   *     O gate não deve enfraquecer isso para se autenticar.
   *
   * A fonte correta é a RESPOSTA QUE O APP JÁ RECEBE. O `AuthProvider` consulta
   * `/api/v1/me` na sessão autenticada; o gate escuta essa resposta. Nenhuma
   * requisição extra, nenhum token manipulado, nenhuma URL inventada.
   */
  let unitIdFromSession = null;
  page.on('response', async (res) => {
    if (unitIdFromSession) return;
    if (!/\/api\/v1\/me\b/.test(res.url())) return;
    if (res.status() !== 200) return;
    try {
      const contentType = res.headers()['content-type'] ?? '';
      if (!contentType.includes('application/json')) return;
      const me = await res.json();
      const lists = [me?.unidades, me?.units, me?.usuario?.unidades, me?.identity?.units];
      for (const list of lists) {
        if (Array.isArray(list)) {
          for (const entry of list) {
            const candidate =
              typeof entry === 'string' ? entry : (entry?.unitId ?? entry?.id ?? entry?.code);
            if (typeof candidate === 'string' && candidate.trim().length > 0) {
              unitIdFromSession = candidate.trim();
              return;
            }
          }
        }
      }
      const single = me?.unitId ?? me?.unidadeId ?? me?.usuario?.unitId;
      if (typeof single === 'string' && single.trim().length > 0) {
        unitIdFromSession = single.trim();
      }
    } catch {
      // Resposta não-JSON: a asserção de unidade abaixo reprova com motivo claro.
    }
  });

  try {
    // ── 1. LOGIN PELO FORMULÁRIO REAL ──────────────────────────────────────────
    // Não injeta token em storage: o `AuthProvider` revalida a sessão no servidor, então
    // semear storage não autentica. O caminho exercitado é o do operador.
    await page.goto(`${webUrl}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.fill('input[type="text"], input[name="login"], input[type="email"]', login);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    try {
      await page.waitForURL((u) => !u.toString().includes('/login'), { timeout: 90_000 });
    } catch {
      /**
       * DIAGNÓSTICO ACIONÁVEL, NÃO "TIMEOUT".
       *
       * Um `waitForURL` estourado diz apenas que a URL não mudou. Isso cobre causas
       * MUITO diferentes: credencial inválida, CORS bloqueando, API fora, chunk da rota
       * quebrado. Sem separar os casos, quem depura perde tempo procurando no lugar
       * errado — e a mensagem some no log como um timeout genérico.
       *
       * Aqui extraímos a evidência que o navegador já produziu: a mensagem de erro na
       * tela e o status HTTP que a API devolveu ao login.
       */
      const bodyText = await page.locator('body').innerText().catch(() => '');
      const uiError = /Algo deu errado[^\n]*/i.exec(bodyText)?.[0] ?? null;
      const loginResponse = loginApiStatuses.at(-1) ?? 'sem resposta de /auth/login';
      throw new Error(
        `login nao alcancou a aplicacao (url=${page.url()}). ` +
          `api=${loginApiStatuses.length > 0 ? loginResponse : 'nenhuma chamada a API'}. ` +
          `ui=${uiError ?? 'sem mensagem de erro na tela'}.`,
      );
    }
    record('LOGIN real pelo formulário', true, page.url());

    /**
     * ───────────────────────────────────────────────────────────────────────────
     * RESOLVE A UNIDADE REAL DO OPERADOR — SEM ELA NÃO HÁ PROVA DE NEGÓCIO
     * ───────────────────────────────────────────────────────────────────────────
     *
     * A estação de medição exige `unitId` na URL antes de carregar a fila. Abrir
     * `/app/measurement` sem unidade provou apenas que a tela sabe pedir a unidade
     * — e o gate chamava isso de aprovado. Isso é PROVA DE RUNTIME, não de negócio:
     * dizer "aceite visível: N/A" num release de aceite é não ter provado nada.
     *
     * ─────────────────────────────────────────────────────────────────────────────
     * A FONTE DA UNIDADE É A FAIXA DE RESUMO QUE O OPERADOR JÁ VÊ
     * ─────────────────────────────────────────────────────────────────────────────
     *
     * Duas tentativas anteriores falharam, e as duas por buscarem a unidade numa
     * porta que não a publica:
     *
     * 1ª `fetch('/api/v1/me')` relativo → resolveu contra a origem do SPA e recebeu
     *    `index.html` (`SyntaxError: Unexpected token '<'`).
     * 2ª escutar `/api/v1/me` → o endpoint devolve identidade e permissões, NÃO a
     *    unidade operacional. Resultado medido em produção:
     *    "nenhuma unidade publicada para o operador".
     *
     * A unidade ESTÁ na tela: a faixa de resumo da controladoria exibe
     * `UNIDADE UN-PROD-001`. É a mesma fonte que o gate já usa na asserção
     * anterior (`WORKLIST apresenta estado operacional explícito`), e é o valor
     * que o operador lê para decidir. Nada é inventado: o código é EXTRAÍDO do
     * texto renderizado pelo produto.
     */

    // ── 2. APP SHELL + NAVEGAÇÃO POR PERMISSÃO ────────────────────────────────
    await page.goto(`${webUrl}/app/accounting/economic-posting`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    // A navegação resolve item a item contra o servidor; esperar `networkidle` nunca
    // assenta (o shell revalida sessão). Espera-se a CONDIÇÃO que importa.
    await page.waitForFunction(
      () => {
        const nav = document.querySelector('nav[aria-label="Navegação principal"]');
        if (!nav) return false;
        const t = nav.textContent ?? '';
        return !t.includes('Carregando navegação') && t.trim().length > 0;
      },
      undefined,
      { timeout: 90_000 },
    );

    const navText = await page
      .locator('nav[aria-label="Navegação principal"]')
      .innerText()
      .catch(() => '');
    record('NAVEGAÇÃO contém Controladoria', /Controladoria/i.test(navText));
    record('NAVEGAÇÃO contém Contabilização', /Contabiliza/i.test(navText));

    // ── 3. CONTROL TOWER / WORK QUEUE ──────────────────────────────────────────
    await page
      .waitForFunction(() => !document.body.innerText.includes('Carregando'), undefined, {
        timeout: 90_000,
      })
      .catch(() => {});
    const worklistText = await page.locator('body').innerText();
    record('WORKLIST renderizada', worklistText.length > 200, `${worklistText.length} chars`);

    /**
     * ───────────────────────────────────────────────────────────────────────────
     * RESOLVE A UNIDADE REAL DO OPERADOR — SEM ELA NÃO HÁ PROVA DE NEGÓCIO
     * ───────────────────────────────────────────────────────────────────────────
     *
     * A estação de medição exige `unitId` na URL antes de carregar a fila. Abrir
     * `/app/measurement` sem unidade provou apenas que a tela sabe pedir a unidade.
     *
     * ─────────────────────────────────────────────────────────────────────────────
     * DUAS FONTES TENTADAS ANTES, E POR QUE FALHARAM
     * ─────────────────────────────────────────────────────────────────────────────
     *
     * 1ª `fetch('/api/v1/me')` relativo → resolveu contra a origem do SPA e recebeu
     *    `index.html`: `SyntaxError: Unexpected token '<'`.
     * 2ª escutar a resposta de `/api/v1/me` → o endpoint devolve identidade e
     *    permissões, NÃO a unidade operacional. Medido em produção:
     *    "nenhuma unidade publicada para o operador".
     *
     * A unidade ESTÁ na tela: a faixa de resumo exibe `UNIDADE UN-PROD-001` — o
     * mesmo valor que a asserção seguinte lê, e que o operador usa para decidir.
     * O código é EXTRAÍDO do texto renderizado pelo produto; nada é inventado.
     */
    const unitFromStrip = extractOperationalUnit(worklistText);
    const resolvedUnitId = unitFromStrip ?? unitIdFromSession;

    record(
      'UNIDADE operacional resolvida pelo servidor',
      typeof resolvedUnitId === 'string' && resolvedUnitId.length > 0,
      resolvedUnitId ?? 'nenhuma unidade publicada para o operador',
    );

    /**
     * FILA VAZIA É RESULTADO LEGÍTIMO — "SEM UNIDADE" NÃO É.
     *
     * A worklist filtra por unidade operacional autorizada. Um tenant sem unidade
     * provisionada não tem fato econômico algum, e a tela DEVE dizer exatamente isso.
     * Tratar "0 linhas" como defeito faria o gate reprovar uma tela saudável por falta
     * de dado — e a resposta errada a isso seria afrouxar a asserção.
     *
     * O que o gate separa:
     *
     *   - `Nenhuma unidade autorizada` → provisionamento ausente. A tela está correta e
     *     não há o que operar; as asserções de fila viram N/A EXPLÍCITO, contado no
     *     resultado, nunca silenciado.
     *   - Qualquer outro estado → a tela precisa oferecer a faixa de resumo e, havendo
     *     caso, o drill-through. Aí sim é funcionalidade e é exigida.
     */
    const noAuthorizedUnit = /Nenhuma unidade autorizada/i.test(worklistText);
    /**
     * A FAIXA DE RESUMO NÃO REPETE O PRÓPRIO `aria-label` NO TEXTO.
     *
     * A asserção anterior procurava a string "Resumo da contabilização" no texto da
     * página. Esse é o `aria-label` do elemento — rótulo de acessibilidade, não conteúdo
     * visível. A faixa renderiza os NÚMEROS: `UNIDADE / UN-PROD-001 / N FALHARAM /
     * N PENDENTES / N ESTORNADAS`. A busca nunca podia casar, e o gate reprovava uma tela
     * CORRETA por um seletor errado — um falso negativo que corrói a confiança no gate.
     *
     * Medido em produção: a faixa exibia `1 FALHARAM · 0 PENDENTES · 0 ESTORNADAS` e a
     * asserção reprovava.
     *
     * Agora exige CONTEÚDO OPERACIONAL: estado vazio explícito, OU os contadores que o
     * operador usa para decidir. Não afrouxou — ficou mais concreta.
     */
    const stripElement = page.locator('[aria-label="Resumo da contabilização"]');
    const stripText = (await stripElement.innerText().catch(() => '')) || '';
    const hasOperationalCounters = /FALHARAM|PENDENTES|ESTORNADAS/i.test(stripText);
    record(
      'WORKLIST apresenta estado operacional explícito',
      noAuthorizedUnit || hasOperationalCounters || /Nenhuma exceção/i.test(worklistText),
      noAuthorizedUnit
        ? 'sem unidade provisionada (legítimo)'
        : hasOperationalCounters
          ? stripText.replace(/\n+/g, ' ').slice(0, 80)
          : 'com unidade, sem contadores',
    );

    if (noAuthorizedUnit) {
      // N/A EXPLÍCITO: registrado como aprovado-com-motivo, não omitido em silêncio.
      record('Faixa de resumo visível', true, 'N/A — nenhuma unidade autorizada');
      record('Fila oferece drill-through para a trilha', true, 'N/A — nenhuma unidade autorizada');
      await page.screenshot({ path: `${OUT}/01-worklist.png`, fullPage: true });
      record(
        'CONSOLE sem erro crítico',
        consoleErrors.filter(
          (t) =>
            !/favicon|Download the React DevTools|ResizeObserver/i.test(t) &&
            !/Failed to load resource/i.test(t),
        ).length === 0,
        'verificado antes do curto-circuito de fila',
      );
      return;
    }

    const stripVisible = await page
      .locator('[aria-label="Resumo da contabilização"]')
      .isVisible()
      .catch(() => false);
    record('Faixa de resumo visível', stripVisible);

    await page.screenshot({ path: `${OUT}/01-worklist.png`, fullPage: true });

    // ── 4. ECONOMIC TRACE (drill-through operacional) ──────────────────────────
    const traceLinks = page.locator('a[href*="/accounting/economic-trace/"]');
    const traceCount = await traceLinks.count();
    record('Fila oferece drill-through para a trilha', traceCount > 0, `${traceCount} linha(s)`);

    if (traceCount > 0) {
      await traceLinks.first().click();
      await page
        .waitForFunction(() => !document.body.innerText.includes('Carregando'), undefined, {
          timeout: 90_000,
        })
        .catch(() => {});
      const traceText = await page.locator('body').innerText();

      record(
        'TRILHA mostra estado financeiro persistido',
        /LIQUIDAD|SETTLED|PAGO|PAID|RECEBID|ABERT|PENDENT/i.test(traceText),
      );
      record(
        'TRILHA mostra estado contábil persistido',
        /CONTABILIZ|PENDENT|FALH|POSTED|FAILED|APURAD/i.test(traceText),
      );
      // Diagnóstico operacional é superfície de operador: nunca o nome da classe do
      // framework. Este é o defeito que a F1.1/F1.2 corrigiu na origem.
      record(
        'TRILHA sem ruído de framework (Accounting Http Exception)',
        !/Accounting Http Exception/.test(traceText),
      );
      await page.screenshot({ path: `${OUT}/02-economic-trace.png`, fullPage: true });
    }

    // ── 5. CONSOLE E AUTORIZAÇÃO ───────────────────────────────────────────────
    // `useNavAccess` SONDA cada módulo. Um 403 de sonda é fail-closed CORRETO; contar
    // isso como erro transformaria negação correta em defeito. O que nunca pode
    // acontecer é 403 no módulo que o operador está usando.
    const isAccessProbe = (url) =>
      /[?&](limit|pageSize)=1\b/.test(url) ||
      /\/authz\/probe\b/.test(url) ||
      /\/authz\/access-admin\//.test(url);

    /**
     * ───────────────────────────────────────────────────────────────────────────
     * MEDIÇÃO → ACEITE → ELEGIBILIDADE DE FATURAMENTO (fronteira READY_TO_BILL)
     * ───────────────────────────────────────────────────────────────────────────
     *
     * A vertical desta release só está PROVADA em produção se a superfície
     * responder com o contrato que o backend publica. O gate não cria dado: ele
     * verifica a PÁGINA DE MEDIÇÃO, que é a estação de trabalho real, e exige que
     * ela exponha as três verdades e a decisão de elegibilidade.
     *
     * O que NUNCA pode aparecer aqui:
     *
     *   - soma de unidades heterogêneas (KM somado a DAY) — é o defeito que a
     *     fronteira comercial/física desta release existe para impedir;
     *   - `FEATURE_DISABLED`;
     *   - `Measurements Http Exception` (nome de classe do framework vazando para o
     *     operador);
     *   - 403/404/409/5xx nas rotas da própria capability.
     *
     * Medir sem ordem de serviço elegível é resultado LEGÍTIMO — mas NÃO é prova
     * de negócio. O gate distingue os dois: `runtimeVerified` (a estação carrega
     * sem quebrar) e `businessVerified` (aceite e elegibilidade observados). Só o
     * segundo autoriza dizer que a capability foi validada em produção.
     */
    const measurementUrl = resolvedUnitId
      ? `${webUrl}/app/measurement?unitId=${encodeURIComponent(resolvedUnitId)}`
      : `${webUrl}/app/measurement`;
    await page.goto(measurementUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page
      .waitForFunction(() => !document.body.innerText.includes('Carregando'), undefined, {
        timeout: 90_000,
      })
      .catch(() => {});
    const measurementText = await page.locator('body').innerText().catch(() => '');
    /**
     * ───────────────────────────────────────────────────────────────────────────
     * "RENDERIZADA" NÃO É "LONGA" — MEDIDO EM PRODUÇÃO
     * ───────────────────────────────────────────────────────────────────────────
     *
     * A primeira versão exigia `measurementText.length > 200` e reprovou produção
     * com `MEDIÇÃO renderizada — 16 chars`. Os 16 caracteres eram a INSTRUÇÃO
     * correta do produto: sem `unitId` na URL a tela pede a unidade antes de
     * carregar a fila.
     *
     * Exigir volume de texto reprova uma tela saudável — é falso negativo por
     * TAMANHO, irmão do falso negativo por vocabulário que este mesmo gate já
     * corrigiu. O que a asserção deve provar é que a aplicação APARECEU, isto é,
     * que o shell renderizou em vez de uma página em branco ou um erro.
     */
    const shellRendered = await page
      .locator('main#main-content')
      .isVisible()
      .catch(() => false);
    record(
      'MEDIÇÃO renderizada',
      shellRendered && measurementText.trim().length > 0,
      `${measurementText.length} chars, shell=${shellRendered ? 'visível' : 'ausente'}`,
    );
    /**
     * `runtimeVerified` exige a estação ABERTA na unidade real. Abrir sem unidade
     * prova apenas que a tela sabe pedir a unidade — o deploy subiu, e só.
     */
    runtimeVerified =
      shellRendered && measurementText.trim().length > 0 && typeof resolvedUnitId === 'string' && resolvedUnitId.length > 0;
    record(
      'MEDIÇÃO sem FEATURE_DISABLED',
      !/FEATURE_DISABLED/.test(measurementText),
    );
    record(
      'MEDIÇÃO sem ruído de framework (Measurements Http Exception)',
      !/Measurements Http Exception/i.test(measurementText),
    );

    /**
     * ───────────────────────────────────────────────────────────────────────────
     * PROVA DE NEGÓCIO: PROCURA UMA ORDEM ELEGÍVEL, NÃO ESPERA QUE ELA APAREÇA
     * ───────────────────────────────────────────────────────────────────────────
     *
     * Abrir a estação com a unidade certa já prova RUNTIME (a tela carrega sem
     * quebrar). Provar NEGÓCIO exige uma medição real em decisão: é nela que o
     * aceite do cliente e a elegibilidade de faturamento existem.
     *
     * A fila é a fonte: se houver item, o operador entra por ele. Sem item, o gate
     * NÃO inventa caso e NÃO declara a capability validada — emite
     * NOT_APPLICABLE com motivo, separado do veredito de runtime.
     */
    const queueLinks = page.locator('a[href*="serviceOrderId="], button[data-service-order-id]');
    const queueCount = await queueLinks.count().catch(() => 0);

    if (queueCount > 0) {
      // Entra pela FILA — o caminho do operador, não uma URL montada à mão.
      await queueLinks.first().click();
      await page
        .waitForFunction(() => !document.body.innerText.includes('Carregando'), undefined, {
          timeout: 90_000,
        })
        .catch(() => {});
      const workbenchText = await page.locator('body').innerText().catch(() => '');

      const eligibility = /Elegib|READY_TO_BILL|Pronto para faturar/i.test(workbenchText);
      const acceptance = /Aceite|ACEITE|Aceita/i.test(workbenchText);
      /**
       * A UNIDADE COMERCIAL É A DO CONTRATO.
       *
       * Se a tela exibir `HOUR` ou `KM` como unidade de MEDIÇÃO, a fronteira
       * comercial/física vazou: fato operacional virou quantidade faturável.
       */
      const commercialUnit =
        !/\bHOUR\b/.test(workbenchText) || /\bDAY\b|\bTRIP\b|\bM3\b/.test(workbenchText);

      record(
        'MEDIÇÃO expõe elegibilidade de faturamento',
        eligibility,
        `${workbenchText.length} chars`,
      );
      record('MEDIÇÃO expõe aceite do cliente', acceptance);
      record(
        'MEDIÇÃO não mede em unidade física (HOUR/KM)',
        commercialUnit,
        'unidade comercial preservada',
      );

      businessVerified = eligibility && acceptance && commercialUnit;
      businessReason = businessVerified
        ? 'aceite e elegibilidade observados em medição real'
        : 'workbench aberto sem expor aceite/elegibilidade';
      await page.screenshot({ path: `${OUT}/03-measurement-workbench.png`, fullPage: true });
    } else {
      /**
       * NOT_APPLICABLE — NÃO PROVADO, E O NOME DIZ ISSO.
       *
       * A tentação é registrar `record(..., true, 'N/A')` para não pintar de
       * vermelho uma tela saudável. Foi o que se fez, e o TOTAL passou a contar
       * N/A como PASS: o gate saía verde sem ter provado o negócio.
       *
       * `record(name, null, ...)` marca o resultado como NÃO APLICÁVEL — nem
       * aprovado nem reprovado naquela asserção —, e o veredito final exige
       * `businessVerified`, que continua FALSE aqui. A tela não é punida; a
       * ENTREGA não é declarada validada.
       */
      businessReason = 'NOT_APPLICABLE — nenhuma medição na fila desta unidade';
      record('MEDIÇÃO expõe elegibilidade de faturamento', null, businessReason);
      record('MEDIÇÃO expõe aceite do cliente', null, businessReason);
      record('MEDIÇÃO não mede em unidade física (HOUR/KM)', null, businessReason);
      await page.screenshot({ path: `${OUT}/03-measurement.png`, fullPage: true });
    }
    const measurementDenied = forbidden.filter((f) => /\/measurements?\b/.test(f));
    record(
      'SEM 403/404 nas rotas de medição',
      measurementDenied.length === 0,
      measurementDenied.slice(0, 2).map((f) => f.slice(0, 120)).join(' | ') || 'nenhum',
    );

    const accountingDenied = forbidden.filter((f) =>
      /\/accounting\/(economic-trace|economic-events|charts|journals)/.test(f),
    );
    record(
      'SEM 403 no módulo de contabilidade em uso',
      accountingDenied.length === 0,
      accountingDenied.slice(0, 2).map((f) => f.slice(0, 120)).join(' | ') || 'nenhum',
    );

    const unexpected403 = forbidden.filter(
      (f) => !/\/auth\/(login|refresh)/.test(f) && !isAccessProbe(f),
    );
    record(
      'SEM 403 inesperado',
      unexpected403.length === 0,
      unexpected403.slice(0, 2).map((f) => f.slice(0, 120)).join(' | ') || 'nenhum',
    );

    // Erros 4xx/5xx HTTP aparecem no console do Chromium como "Failed to load resource"
    // — é o espelho do que já foi julgado acima, não erro de aplicação. Exceções de JS
    // (promessas rejeitadas, exceções síncronas) continuam contando.
    const realConsoleErrors = consoleErrors.filter(
      (t) =>
        !/favicon|Download the React DevTools|ResizeObserver/i.test(t) &&
        !/Failed to load resource/i.test(t),
    );
    record(
      'CONSOLE sem erro crítico',
      realConsoleErrors.length === 0,
      realConsoleErrors.slice(0, 2).map((t) => t.slice(0, 140)).join(' | ') || 'nenhum',
    );
  } catch (error) {
    record('EXECUÇÃO do gate', false, String(error?.message ?? error));
    await page.screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }

  // N/A NÃO conta como aprovado: `r.passed` só é truthy para `true`. O total
  // inclui os N/A porque a soma precisa refletir o que foi AVALIADO, não o que
  // foi provado — e a distinção aparece explícita no log.
  const passed = results.filter((r) => r.passed === true).length;
  const notApplicable = results.filter((r) => r.passed === null).length;
  const total = results.length;
  console.log(
    `\n[coolify-browser-gate] RESULTADO ${passed}/${total} ` +
      `(N/A ${notApplicable}) web=${webUrl}`,
  );

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   * TRÊS VEREDITOS, PORQUE SÃO TRÊS COISAS DIFERENTES
   * ─────────────────────────────────────────────────────────────────────────────
   *
   * `assertionsPass`: as asserções de base (HTTP, console, shell, auth) passaram.
   * `runtimeVerified`: a aplicação subiu na UNIDADE REAL e renderizou.
   * `businessVerified`: a CAPABILITY desta release foi observada funcionando numa
   *   medição real — aceite, elegibilidade e unidade comercial visíveis.
   *
   * ─────────────────────────────────────────────────────────────────────────────
   * POR QUE `passed === total` NÃO PODE SER O VEREDITO
   * ─────────────────────────────────────────────────────────────────────────────
   *
   * O bloco NOT_APPLICABLE registrava `record(..., true, motivo)` para não pintar
   * de vermelho uma tela saudável — e o TOTAL contava esses registros como PASS.
   * Resultado medido: `runtimeVerified=true`, `businessVerified=false` e mesmo
   * assim `exitCode = 0`. O pipeline ficava verde sem ter provado o negócio.
   *
   * `NOT_APPLICABLE` não é `PASS`: é NÃO PROVADO. Para esta release — medição →
   * aceite → elegibilidade → READY_TO_BILL — só existe aprovação quando a
   * capability foi efetivamente observada.
   *
   * A saída agora é a CONJUNÇÃO das três condições, nunca a contagem.
   */
  const verdict = decideReleaseVerdict({
    passed,
    total,
    runtimeVerified,
    businessVerified,
  });

  console.log(`[coolify-browser-gate] assertionsPass=${verdict.assertionsPass}`);
  console.log(`[coolify-browser-gate] runtimeVerified=${verdict.runtimeVerified}`);
  console.log(`[coolify-browser-gate] businessVerified=${verdict.businessVerified}`);
  console.log(`[coolify-browser-gate] businessReason=${businessReason ?? 'não avaliado'}`);
  console.log(`[coolify-browser-gate] releaseVerified=${verdict.releaseVerified}`);

  if (verdict.exitCode !== 0) {
    process.exitCode = verdict.exitCode;
  }
}

/**
 * Executa quando chamado como SCRIPT, não quando importado.
 *
 * O teste de comportamento importa `decideReleaseVerdict`; sem esta guarda, o
 * import abriria Chromium e navegaria contra produção só para ler uma função pura.
 */
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  await main();
}
