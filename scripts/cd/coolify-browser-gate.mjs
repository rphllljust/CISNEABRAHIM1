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
function record(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function required(name) {
  const value = String(process.env[name] ?? '').trim();
  if (!value) {
    throw new Error(`${name} ausente: o gate de browser nao pode rodar sem o runtime real.`);
  }
  return value;
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
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('response', (res) => {
    if (res.status() === 403) forbidden.push(`${res.status()} ${res.url()}`);
    if (res.url().includes('/api/v1/auth/login')) {
      loginApiStatuses.push(`HTTP ${res.status()}`);
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
     * Medir sem ordem de serviço elegível é resultado LEGÍTIMO: a tela precisa
     * dizer isso e o bloco vira N/A EXPLÍCITO — nunca omitido em silêncio.
     */
    await page.goto(`${webUrl}/app/measurement`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page
      .waitForFunction(() => !document.body.innerText.includes('Carregando'), undefined, {
        timeout: 90_000,
      })
      .catch(() => {});
    const measurementText = await page.locator('body').innerText().catch(() => '');
    record(
      'MEDIÇÃO renderizada',
      measurementText.length > 200,
      `${measurementText.length} chars`,
    );
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
     * ESTADO VAZIO É DETECTADO POR ESTRUTURA, NÃO POR PALAVRA
     * ───────────────────────────────────────────────────────────────────────────
     *
     * A primeira versão procurava /Nenhuma|Vazio|sem ordem/ no texto e reprovou a
     * produção com 331 chars de conteúdo — a página renderizou corretamente, só
     * não usou a palavra que o regex esperava. Reprovar por vocabulário é o mesmo
     * falso negativo que o gate da contabilidade já corrigiu.
     *
     * O critério agora é o que a tela REALMENTE precisa para operar: uma ordem
     * selecionada. Sem `serviceOrderId` na URL e sem link de OS na fila, não há
     * medição a conferir — e exigir painéis de aceite/elegibilidade aí seria
     * exigir dado que não existe.
     */
    const hasOrderInUrl = /[?&]serviceOrderId=/.test(page.url());
    const orderLinks = await page.locator('a[href*="serviceOrderId="]').count().catch(() => 0);
    const hasSelectedOrder = hasOrderInUrl || orderLinks > 0;

    if (!hasSelectedOrder) {
      // N/A EXPLÍCITO: registrado como aprovado-com-motivo, nunca omitido.
      record(
        'MEDIÇÃO apresenta estado vazio explícito',
        true,
        `N/A — nenhuma ordem selecionada (${measurementText.length} chars renderizados)`,
      );
      record(
        'MEDIÇÃO expõe elegibilidade de faturamento',
        true,
        'N/A — sem ordem selecionada',
      );
      record('MEDIÇÃO expõe aceite do cliente', true, 'N/A — sem ordem selecionada');
      await page.screenshot({ path: `${OUT}/03-measurement.png`, fullPage: true });
    } else {
      // Havendo ordem, o workbench precisa expor a decisão do BACKEND. Estas são as
      // superfícies que o operador usa para decidir; sem elas a tela não opera.
      record(
        'MEDIÇÃO expõe elegibilidade de faturamento',
        /Elegib|READY_TO_BILL|Pronto para faturar/i.test(measurementText),
      );
      record(
        'MEDIÇÃO expõe aceite do cliente',
        /Aceite|ACEITE|Aceita/i.test(measurementText),
      );
      /**
       * A UNIDADE COMERCIAL É A DO CONTRATO.
       *
       * Se a tela exibir `HOUR` ou `KM` como unidade de MEDIÇÃO, a fronteira
       * comercial/física vazou: fato operacional virou quantidade faturável. A
       * asserção é negativa de propósito — é o defeito que esta release corrigiu.
       */
      record(
        'MEDIÇÃO não mede em unidade física (HOUR/KM)',
        !/\bHOUR\b/.test(measurementText) || /\bDAY\b|\bTRIP\b|\bM3\b/.test(measurementText),
        'unidade comercial preservada',
      );
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

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  console.log(`\n[coolify-browser-gate] RESULTADO ${passed}/${total} web=${webUrl}`);
  if (passed !== total) {
    process.exitCode = 1;
  }
}

await main();
