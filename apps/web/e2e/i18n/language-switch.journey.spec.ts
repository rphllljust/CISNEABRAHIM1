import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * JORNADA DE IDIOMA — A PROVA DE DOM DA TROCA DE IDIOMA.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * As três exigências, e como cada uma é provada AQUI:
 *
 *   1. TROCAR IDIOMA muda `[data-testid="entity-title"]`.
 *      Não basta `localStorage.setItem` ter rodado: o título RENDERIZADO tem de mudar.
 *   2. SEM RELOAD.
 *      Um marcador JS escrito em `window` antes da troca precisa SOBREVIVER. Se a página
 *      recarregasse, o marcador sumiria — é isso que distingue "o React re-renderizou" de
 *      "a página recarregou e por acaso ficou em inglês".
 *   3. `localStorage` PERSISTE ENTRE SESSÕES.
 *      Sessão nova = contexto de browser novo (`browser.newContext()`), com o MESMO
 *      storageState. Um `page.reload()` não provaria persistência entre sessões; provaria
 *      só que a aba atual não perdeu o estado.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Sem mock, sem `page.route`, sem `sleep`. Contra a aplicação real.
 */

const STORAGE_KEY = 'cisne.language';

/**
 * Credencial vinda do ambiente, com erro EXPLÍCITO quando falta.
 *
 * Não há login de fallback embutido: um default silencioso foi o que permitiu uma suíte
 * inteira apontar para um usuário inexistente por meses (ver `e2e/engine/journey-credentials.ts`).
 */
function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`CONFIGURATION_ERROR: ${name} is required to run this journey.`);
  }
  return value;
}

const LOGIN = requireEnv('CISNE_JOURNEY_LOGIN');
const PASSWORD = requireEnv('CISNE_JOURNEY_PASSWORD');
const SHOTS = process.env['CISNE_JOURNEY_SHOTS'] ?? join(process.cwd(), 'test-results', 'i18n');
mkdirSync(SHOTS, { recursive: true });

/** Autentica e espera a casca do app. */
async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/^usuário/i).fill(LOGIN);
  await page.getByLabel(/^senha/i).fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 30_000 });
}

/**
 * Abre a lista de OS renderizada pela engine e espera o TÍTULO DA ENTIDADE.
 *
 * A espera é pelo próprio nó medido: sem ela, a asserção poderia correr antes de o
 * metadado chegar e comparar um título vazio.
 */
async function openEntityList(page: Page): Promise<void> {
  await page.goto('/app/service-orders');
  await expect(page.locator('[data-testid="dynamic-list"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid="entity-title"]')).toBeVisible({ timeout: 30_000 });
}

/** Troca o idioma pelo SELETOR REAL e espera o valor do `<select>` refletir a escolha. */
async function switchLanguage(page: Page, language: 'pt-BR' | 'en-US'): Promise<void> {
  const switcher = page.locator('[data-testid="language-switcher"]');
  await expect(switcher).toBeVisible({ timeout: 30_000 });
  await switcher.selectOption(language);
  await expect(switcher).toHaveValue(language, { timeout: 10_000 });
}

/** Texto do título da entidade, já normalizado. */
async function entityTitle(page: Page): Promise<string> {
  return (await page.locator('[data-testid="entity-title"]').textContent())?.trim() ?? '';
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * PROVA 1 — o seletor troca o idioma e o DOM muda, SEM RELOAD.
 * ─────────────────────────────────────────────────────────────────────────────
 */
test('PROVA 1 — trocar idioma muda [data-testid="entity-title"] sem reload', async ({ page }) => {
  await login(page);
  await openEntityList(page);

  // Estado inicial: o app abre em português (locale do navegador = pt-BR).
  const before = await entityTitle(page);
  expect(before, 'o título inicial deve estar em português').toBe('Ordens de serviço');

  /*
   * MARCADOR DE VIDA DA PÁGINA.
   *
   * Escrito em `window` antes da troca. `window` NÃO sobrevive a um reload de verdade —
   * então, se ele ainda estiver lá depois, a página não recarregou. É a diferença entre
   * provar "sem reload" e apenas afirmá-lo.
   *
   * `performance.timeOrigin` é fixado no carregamento do documento: comparar o valor antes
   * e depois é uma segunda testemunha, independente da primeira, de que o documento é o
   * MESMO.
   */
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>)['__cisneNoReloadMarker'] = 'vivo';
  });
  const timeOriginBefore = await page.evaluate(() => performance.timeOrigin);

  await switchLanguage(page, 'en-US');

  // O DOM mudou de verdade.
  await expect(page.locator('[data-testid="entity-title"]')).toHaveText('Service orders', {
    timeout: 15_000,
  });
  const after = await entityTitle(page);
  expect(after, 'o título em inglês difere do português').not.toBe(before);

  // SEM RELOAD — duas testemunhas independentes.
  const marker = await page.evaluate(
    () => (window as unknown as Record<string, unknown>)['__cisneNoReloadMarker'] ?? null,
  );
  expect(marker, 'o documento foi recarregado durante a troca de idioma').toBe('vivo');

  const timeOriginAfter = await page.evaluate(() => performance.timeOrigin);
  expect(timeOriginAfter, 'performance.timeOrigin mudou: houve reload').toBe(timeOriginBefore);

  // A preferência foi gravada.
  const stored = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  expect(stored).toBe('en-US');

  await page.screenshot({ path: join(SHOTS, 'i18n-01-en-US-sem-reload.png'), fullPage: true });
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * PROVA 2 — a volta para pt-BR também é sem reload, e é REVERSÍVEL.
 * ─────────────────────────────────────────────────────────────────────────────
 */
test('PROVA 2 — voltar para pt-BR restaura o titulo, tambem sem reload', async ({ page }) => {
  await login(page);
  await openEntityList(page);

  await switchLanguage(page, 'en-US');
  await expect(page.locator('[data-testid="entity-title"]')).toHaveText('Service orders');

  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>)['__cisneNoReloadMarker'] = 'vivo';
  });
  const timeOriginBefore = await page.evaluate(() => performance.timeOrigin);

  await switchLanguage(page, 'pt-BR');
  await expect(page.locator('[data-testid="entity-title"]')).toHaveText('Ordens de serviço', {
    timeout: 15_000,
  });

  const marker = await page.evaluate(
    () => (window as unknown as Record<string, unknown>)['__cisneNoReloadMarker'] ?? null,
  );
  expect(marker, 'o documento foi recarregado durante a troca de idioma').toBe('vivo');
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOriginBefore);

  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe('pt-BR');

  await page.screenshot({ path: join(SHOTS, 'i18n-02-volta-pt-BR.png'), fullPage: true });
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * PROVA 3 — `localStorage` persiste ENTRE SESSÕES.
 *
 * "Entre sessões" é levado a sério: a segunda visita acontece num CONTEXTO DE BROWSER
 * NOVO, que é o mais próximo de "o operador fechou e abriu o navegador" que o Playwright
 * oferece. Um `page.reload()` na mesma aba não serviria — ele não prova persistência, prova
 * apenas que a aba atual manteve o estado em memória.
 * ─────────────────────────────────────────────────────────────────────────────
 */
test('PROVA 3 — localStorage persiste entre sessoes', async ({ page, context, browser }) => {
  await login(page);
  await openEntityList(page);

  await switchLanguage(page, 'en-US');
  await expect(page.locator('[data-testid="entity-title"]')).toHaveText('Service orders');

  /*
   * O QUE CADA STORAGE GUARDA — e por que a distinção importa aqui.
   *
   *   - `localStorage['cisne.language']` → a PREFERÊNCIA DE IDIOMA. É o que esta prova mede.
   *   - `sessionStorage['cisne.refreshToken']` → a SESSÃO AUTENTICADA, que o CISNE mantém
   *     em `sessionStorage` (token de acesso só em memória; ver `auth/storage/token-store.ts`).
   *
   * `context.storageState()` serializa `localStorage` e cookies, mas NÃO `sessionStorage` —
   * é uma decisão do próprio Playwright, e ela é correta: `sessionStorage` é, por definição,
   * de UMA aba. Consequência prática: um contexto novo com `storageState` abriria a tela de
   * LOGIN, e a prova de idioma mediria a tela errada.
   *
   * Por isso o refresh token é lido aqui e reinjetado na sessão 2. Isso NÃO enfraquece a
   * prova: o que precisa atravessar a fronteira de sessão é a preferência de idioma, e ela
   * vai pelo `storageState` — do mesmo jeito que iria num navegador de verdade. A sessão é
   * encanamento do teste, não o objeto medido.
   */
  const storageState = await context.storageState();
  const storedLanguages = storageState.origins.flatMap((origin) =>
    origin.localStorage.filter((entry) => entry.name === STORAGE_KEY).map((entry) => entry.value),
  );
  expect(storedLanguages, 'a preferência não foi gravada em localStorage').toContain('en-US');

  const refreshToken = await page.evaluate(() => sessionStorage.getItem('cisne.refreshToken'));
  expect(refreshToken, 'a sessão não produziu refresh token').toBeTruthy();
  if (!refreshToken) {
    // Estreita o tipo para o `addInitScript` abaixo; a asserção acima dá a mensagem.
    throw new Error('CONFIGURATION_ERROR: refresh token ausente após o login.');
  }

  /*
   * SESSÃO 2 — contexto NOVO.
   *
   * Herda o que o navegador guardaria (cookie + localStorage via `storageState`) e recebe o
   * refresh token para poder autenticar. Nada de estado em memória do React atravessa: o
   * contexto é outro, o documento é outro.
   */
  const secondContext = await browser.newContext({ storageState, locale: 'pt-BR' });
  try {
    const secondPage = await secondContext.newPage();

    /*
     * O refresh token entra ANTES da primeira navegação: `AuthProvider` tenta retomar a
     * sessão no bootstrap, e um token injetado depois já teria perdido o barco.
     */
    await secondContext.addInitScript((token) => {
      try {
        sessionStorage.setItem('cisne.refreshToken', token);
      } catch {
        /* sessionStorage indisponível: a prova falha adiante, de forma explícita. */
      }
    }, refreshToken);

    /*
     * A sessão 2 abre a LISTA direto: se o idioma só valesse porque a URL foi visitada numa
     * ordem específica, não seria uma preferência persistida — seria efeito de navegação.
     */
    await secondPage.goto('/app/service-orders');
    await expect(secondPage.locator('[data-testid="dynamic-list"]')).toBeVisible({
      timeout: 30_000,
    });

    // A SESSÃO NOVA abre já em inglês, sem ninguém tocar no seletor.
    await expect(secondPage.locator('[data-testid="entity-title"]')).toHaveText('Service orders', {
      timeout: 30_000,
    });
    await expect(secondPage.locator('[data-testid="language-switcher"]')).toHaveValue('en-US');

    await secondPage.screenshot({
      path: join(SHOTS, 'i18n-03-sessao-nova-en-US.png'),
      fullPage: true,
    });
  } finally {
    await secondContext.close();
  }
});
