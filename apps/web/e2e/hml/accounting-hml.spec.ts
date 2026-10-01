import { expect, test, type Page } from '@playwright/test';

/**
 * SMOKE REAL DE HML — Contabilidade (Família 4), SEM FIXTURE.
 *
 * Esta prova abre as SEIS rotas autorizadas contra o HML de verdade: o artefato servido pelo
 * nginx do container `cisne_hml_web` e as APIs reais do `cisne_hml_api`. Nenhuma resposta é
 * interceptada, nenhum perfil de mock é instalado e nenhum dado é criado — a tela registra o
 * que o servidor devolve, inclusive quando o pré-requisito legítimo não existe.
 *
 * ESCOPO DELIBERADAMENTE RESTRITO ÀS SEIS ROTAS DA FAMÍLIA 4. As demais superfícies do produto
 * são cobertas pelas suas próprias suítes; esta prova não as exercita.
 *
 * Rodar apenas:
 *   HML_WEB_URL=... HML_SMOKE_LOGIN=... HML_SMOKE_PASSWORD=... \
 *     pnpm --filter @cisne/web exec playwright test --config e2e/hml/playwright.hml.config.ts
 *
 * Credenciais vêm do AMBIENTE (as mesmas de `.env.hml`); nenhuma é versionada aqui.
 */

const HML_WEB = process.env.HML_WEB_URL ?? 'http://127.0.0.1:5174';
const HML_LOGIN = process.env.HML_SMOKE_LOGIN ?? '';
const HML_PASSWORD = process.env.HML_SMOKE_PASSWORD ?? '';

type RouteReport = { route: string; detail: string };

const reports: RouteReport[] = [];

/**
 * GUARDAS — exatamente o que o gate exige.
 *
 * `pageerror` captura exceção não tratada. O console emite "Failed to load resource" para as
 * respostas de SONDA de capability (401/403/404 por contrato) e para recortes recusados pelo
 * servidor: isso é resposta legítima da API, não erro de JavaScript. Erro 5xx é medido pelo
 * listener de `response`, e não pelo texto do console.
 */
function attachGuards(page: Page): { jsErrors: string[]; serverErrors: string[] } {
  const jsErrors: string[] = [];
  const serverErrors: string[] = [];
  page.on('pageerror', (error) => jsErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') {
      return;
    }
    const text = message.text();
    if (/Failed to load resource/i.test(text)) {
      return;
    }
    jsErrors.push(text);
  });
  page.on('response', (response) => {
    if (response.status() >= 500) {
      serverErrors.push(`${response.status()} ${response.url()}`);
    }
  });
  return { jsErrors, serverErrors };
}

/**
 * Entra no HML de forma IDEMPOTENTE.
 *
 * A sessão vive no armazenamento do navegador: quando o token já é válido, `/login` redireciona
 * para a visão geral e o formulário não existe — repetir o preenchimento falharia por um motivo
 * que não é a página sob prova. Aqui o login só acontece quando o formulário está de fato lá.
 */
async function signIn(page: Page): Promise<void> {
  await page.goto(`${HML_WEB}/login`, { waitUntil: 'domcontentloaded' });
  const alreadySignedIn = await page
    .getByRole('heading', { level: 1, name: /visão geral/i })
    .isVisible()
    .catch(() => false);
  if (!alreadySignedIn) {
    const userField = page.getByLabel(/^usuário/i);
    await userField.waitFor({ state: 'visible', timeout: 30_000 });
    await userField.fill(HML_LOGIN);
    await page.getByLabel(/^senha/i).fill(HML_PASSWORD);
    await page.getByRole('button', { name: /^entrar/i }).click();
  }
  await expect(page.getByRole('heading', { level: 1, name: /visão geral/i })).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * Abre a rota e mede o que o HML REAL publicou: título correto, controles presentes, resultado
 * ou estado vazio declarado dentro da estrutura e ausência de tela branca.
 *
 * Não esperamos `networkidle`: a superfície contábil consulta o servidor por escopo e o
 * `networkidle` não assenta de forma confiável com sessão real. Esperamos a área principal
 * ficar visível e estável em vez de silêncio de rede.
 */
async function visit(page: Page, route: string, heading: string) {
  const { jsErrors, serverErrors } = attachGuards(page);
  await page.goto(`${HML_WEB}${route}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible({
    timeout: 30_000,
  });
  await page.locator('#main-content').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(1500);

  /*
   * A sessão não pode ter sido derrubada no meio da prova: cair em `/login` ou `/no-access`
   * significaria medir outra tela. Aqui o fato é afirmado em vez de presumido.
   */
  const finalUrl = page.url();
  expect(finalUrl, `a rota ${route} não pode redirecionar para login`).not.toContain('/login');
  expect(finalUrl, `a rota ${route} não pode redirecionar para no-access`).not.toContain(
    '/no-access',
  );

  const selects = await page.getByRole('combobox').count();
  const buttons = await page.getByRole('button').count();
  const tables = await page.getByRole('table').count();
  const mainText = ((await page.locator('#main-content').innerText().catch(() => '')) ?? '').slice(
    0,
    4000,
  );

  return { jsErrors, serverErrors, selects, buttons, tables, mainText };
}

/** O estado vazio legítimo é um RESULTADO válido, desde que declarado na tela. */
const DECLARED_STATE_MARKERS = [
  /nenhum/i,
  /não há/i,
  /nao ha/i,
  /sem permissão/i,
  /indisponível/i,
  /selecione/i,
];

function hasDeclaredState(text: string): boolean {
  return DECLARED_STATE_MARKERS.some((marker) => marker.test(text));
}

test.describe('HML real — Contabilidade (Família 4), 6 rotas, sem fixture', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(() => {
    expect(HML_LOGIN, 'HML_SMOKE_LOGIN precisa estar definida').not.toBe('');
    expect(HML_PASSWORD, 'HML_SMOKE_PASSWORD precisa estar definida').not.toBe('');
  });

  /**
   * UMA SESSÃO DE BROWSER PARA AS SEIS ROTAS — uma autenticação, uma página.
   *
   * O HML aplica limite de tentativas de login (`429 AUTH_RATE_LIMITED`), que é comportamento
   * CORRETO do servidor. Além disso, o refresh token do CISNE vive em `sessionStorage`
   * (`cisne.refreshToken`), e o `storageState` do Playwright só captura cookies e `localStorage`
   * — tentar semear a sessão por arquivo não funciona.
   *
   * Por isso a prova autentica UMA ÚNICA VEZ numa página real, permanece na MESMA página e
   * navega sequencialmente pelas seis rotas: nenhum contexto novo, nenhum login novo e nenhuma
   * alteração no produto. É exatamente o que um operador faz.
   */
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
    await signIn(page);
  });

  test.afterAll(async () => {
    await page.context().close();
  });

  test('01 /app/accounting/chart — Plano de contas', async () => {
    const r = await visit(page, '/app/accounting/chart', 'Plano de contas');
    expect(r.selects, 'a barra operacional precisa de controles reais').toBeGreaterThan(0);
    expect(r.mainText.length, 'a página não pode ser branca').toBeGreaterThan(0);
    expect(r.jsErrors, `JS: ${r.jsErrors.join(' | ')}`).toEqual([]);
    expect(r.serverErrors, `5xx: ${r.serverErrors.join(' | ')}`).toEqual([]);
    reports.push({
      route: '/app/accounting/chart',
      detail: `${r.selects} controles · ${r.tables} grade(s) · estado declarado=${hasDeclaredState(r.mainText)}`,
    });
  });

  test('02 /app/accounting/journals — Lançamentos', async () => {
    const r = await visit(page, '/app/accounting/journals', 'Lançamentos');
    expect(r.selects).toBeGreaterThan(0);
    expect(r.buttons).toBeGreaterThan(0);
    expect(r.mainText.length).toBeGreaterThan(0);
    expect(r.jsErrors, `JS: ${r.jsErrors.join(' | ')}`).toEqual([]);
    expect(r.serverErrors, `5xx: ${r.serverErrors.join(' | ')}`).toEqual([]);
    reports.push({
      route: '/app/accounting/journals',
      detail: `${r.selects} controles · ${r.tables} grade(s) · estado declarado=${hasDeclaredState(r.mainText)}`,
    });
  });

  test('03 /app/accounting/diario — Diário', async () => {
    const r = await visit(page, '/app/accounting/diario', 'Diário');
    expect(r.selects).toBeGreaterThan(0);
    expect(r.mainText.length).toBeGreaterThan(0);
    expect(r.jsErrors, `JS: ${r.jsErrors.join(' | ')}`).toEqual([]);
    expect(r.serverErrors, `5xx: ${r.serverErrors.join(' | ')}`).toEqual([]);
    reports.push({
      route: '/app/accounting/diario',
      detail: `${r.selects} controles · ${r.tables} grade(s) · estado declarado=${hasDeclaredState(r.mainText)}`,
    });
  });

  test('04 /app/accounting/fechamentos — Fechamentos', async () => {
    const r = await visit(page, '/app/accounting/fechamentos', 'Fechamentos');
    expect(r.selects).toBeGreaterThan(0);
    expect(r.buttons).toBeGreaterThan(0);
    expect(r.mainText.length).toBeGreaterThan(0);
    expect(r.jsErrors, `JS: ${r.jsErrors.join(' | ')}`).toEqual([]);
    expect(r.serverErrors, `5xx: ${r.serverErrors.join(' | ')}`).toEqual([]);
    reports.push({
      route: '/app/accounting/fechamentos',
      detail: `${r.selects} controles · ${r.buttons} ação(ões) · estado declarado=${hasDeclaredState(r.mainText)}`,
    });
  });

  test('05 /app/accounting/origens — Origem dos lançamentos', async () => {
    const r = await visit(page, '/app/accounting/origens', 'Origem dos lançamentos');
    expect(r.selects).toBeGreaterThan(0);
    expect(r.mainText.length).toBeGreaterThan(0);
    expect(r.jsErrors, `JS: ${r.jsErrors.join(' | ')}`).toEqual([]);
    expect(r.serverErrors, `5xx: ${r.serverErrors.join(' | ')}`).toEqual([]);
    reports.push({
      route: '/app/accounting/origens',
      detail: `${r.selects} controles · ${r.tables} grade(s) · estado declarado=${hasDeclaredState(r.mainText)}`,
    });
  });

  test('06 /app/closing — Central de fechamento', async () => {
    const r = await visit(page, '/app/closing', 'Central de fechamento');
    expect(r.selects).toBeGreaterThan(0);
    expect(r.buttons).toBeGreaterThan(0);
    expect(r.mainText.length).toBeGreaterThan(0);
    expect(r.jsErrors, `JS: ${r.jsErrors.join(' | ')}`).toEqual([]);
    expect(r.serverErrors, `5xx: ${r.serverErrors.join(' | ')}`).toEqual([]);
    reports.push({
      route: '/app/closing',
      detail: `${r.selects} controles · ${r.buttons} ação(ões) · estado declarado=${hasDeclaredState(r.mainText)}`,
    });
  });

  test.afterAll(() => {
    console.log('\n=== HML REAL — 6 rotas da Família 4 ===');
    for (const report of reports) {
      console.log(`PASS ${report.route} :: ${report.detail}`);
    }
    expect(reports, 'as 6 rotas precisam ter sido visitadas').toHaveLength(6);
  });
});
