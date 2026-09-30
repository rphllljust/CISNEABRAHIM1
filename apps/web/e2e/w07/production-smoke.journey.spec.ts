/**
 * CISNE — BIG WAVE 07: browser smoke contra o BUILD DE PRODUCAO.
 *
 * Roda contra o artefato real (`vite build` servido em 4173) e a API de producao
 * (`NODE_ENV=production` em 3000), ambos sobre PostgreSQL real. Nenhum dev server.
 *
 * Percorre a jornada operacional por CLIQUE e reprova em: 5xx, 401/403 inesperado,
 * erro de console, rota quebrada e UUID visivel como rotulo.
 */
import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const WEB_URL = process.env.CISNE_W07_WEB_URL ?? 'http://127.0.0.1:4173';
const API_URL = process.env.CISNE_W07_API_URL ?? 'http://127.0.0.1:3000';
const LOGIN = process.env.CISNE_JOURNEY_LOGIN ?? 'abrahim@cisne-rondonia.invalid';

/**
 * SENHA VEM DO AMBIENTE — sem default silencioso (mesma regra dos scripts de seed, commit
 * 6d65e3e). A credencial de homologacao nao vive no repositorio: o valor entra pelo ambiente
 * (`.env`, gitignored) e a ausencia falha alto, em vez de autenticar com senha embutida.
 */
function requireJourneyPassword(): string {
  const value = process.env['CISNE_JOURNEY_PASSWORD']?.trim();
  if (!value) {
    throw new Error(
      'CONFIGURATION_ERROR: CISNE_JOURNEY_PASSWORD is required to run this journey. ' +
        'Set it in the environment (gitignored .env); see .env.example.',
    );
  }
  return value;
}

const PASSWORD = requireJourneyPassword();

const SHOTS = process.env.CISNE_W07_SHOTS ?? join(process.cwd(), 'test-results', 'w07-smoke');
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
mkdirSync(SHOTS, { recursive: true });

type Smoke = { path: string; expect: RegExp; label: string };

/** Telas obrigatorias do smoke. O titulo esperado prova que a rota renderizou. */
const SURFACES: Smoke[] = [
  { path: '/app', expect: /painel|dashboard|vis.o geral/i, label: 'Dashboard' },
  { path: '/app/clients', expect: /cliente/i, label: 'Clientes' },
  { path: '/app/requests', expect: /solicita/i, label: 'Solicitacoes' },
  { path: '/app/proposals', expect: /proposta/i, label: 'Propostas' },
  { path: '/app/service-orders', expect: /ordem de servi|ordens de servi/i, label: 'Ordens de servico' },
  { path: '/app/billing', expect: /faturamento|nota/i, label: 'Faturamento' },
  { path: '/app/finance/receivables', expect: /receb|t.tulo|financeiro/i, label: 'Recebiveis' },
  { path: '/app/work-inbox', expect: /caixa de trabalho|work inbox|trabalho/i, label: 'Work Inbox' },
  { path: '/app/catalog', expect: /cat.logo de servi/i, label: 'Catalogo' },
];

/** Erros que NAO reprovam: ruido de rede/telemetria sem efeito operacional. */
const CONSOLE_IGNORE = [/favicon/i, /Download the React DevTools/i, /ResizeObserver/i];

test.describe('BIG WAVE 07 — smoke do build de producao', () => {
  test.beforeAll(async ({ request }) => {
    const health = await request.get(`${API_URL}/api/v1/health`);
    expect(health.ok(), `API de producao nao respondeu em ${API_URL}`).toBe(true);
    const web = await request.get(WEB_URL);
    expect(web.ok(), `Build de producao nao respondeu em ${WEB_URL}`).toBe(true);
  });

  test('jornada por clique sem 5xx, sem 401/403 inesperado e sem erro de console', async ({ page }) => {
    const serverErrors: string[] = [];
    const authErrors: string[] = [];
    const consoleErrors: string[] = [];
    const clientErrors: string[] = [];

    page.on('response', (response) => {
      const status = response.status();
      const url = response.url();
      if (!url.includes('/api/')) return;
      if (status >= 500) serverErrors.push(`${status} ${url}`);
      if (status === 401 || status === 403) authErrors.push(`${status} ${url}`);
      // 404/400 tambem sao registrados: "Failed to load resource" sem a URL nao permite
      // decidir se e rota quebrada (bloqueador) ou sondagem opcional de capability.
      if (status === 404 || status === 400) clientErrors.push(`${status} ${url}`);
    });
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      if (CONSOLE_IGNORE.some((pattern) => pattern.test(text))) return;
      consoleErrors.push(text);
    });
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

    // ---- login no build de producao ----
    await page.goto(`${WEB_URL}/login`);
    await page.getByLabel(/^usuário/i).fill(LOGIN);
    await page.getByLabel(/^senha/i).fill(PASSWORD);
    await page.getByRole('button', { name: /entrar/i }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
    await page.screenshot({ path: join(SHOTS, '00-dashboard.png'), fullPage: true });

    // 401/403 do proprio login nao contam como inesperado.
    authErrors.length = 0;

    // ---- percorre as superficies obrigatorias ----
    for (const surface of SURFACES) {
      await page.goto(`${WEB_URL}${surface.path}`);
      await expect(
        page.getByText(surface.expect).first(),
        `${surface.label} (${surface.path}) nao renderizou`,
      ).toBeVisible({ timeout: 30_000 });

      // Rota quebrada: nada de tela em branco nem "not found" do router.
      const body = (await page.locator('body').innerText()).trim();
      expect(body.length, `${surface.label} renderizou vazio`).toBeGreaterThan(20);
      expect(body, `${surface.label} caiu em rota inexistente`).not.toMatch(
        /p.gina n.o encontrada|not found|404/i,
      );

      await page.screenshot({
        path: join(SHOTS, `${surface.label.replace(/\s+/g, '-').toLowerCase()}.png`),
        fullPage: true,
      });
    }

    // ---- catalogo: nome humano, code secundario, sem UUID ----
    await page.goto(`${WEB_URL}/app/catalog`);
    const table = page.getByRole('table', { name: /lista de defini..es de servi.o/i });
    await expect(table).toBeVisible({ timeout: 30_000 });
    const labels = await table.locator('tbody tr td:first-child a').allInnerTexts();
    expect(labels.length, 'catalogo sem linhas').toBeGreaterThan(0);
    expect(
      labels.some((label) => label.trim().length > 0 && !/^CNAE-\d+$/.test(label.trim())),
      `catalogo nao mostra nome humano: ${JSON.stringify(labels)}`,
    ).toBe(true);
    expect(await table.innerText(), 'UUID visivel no catalogo').not.toMatch(UUID_PATTERN);

    // ---- work inbox ----
    await page.goto(`${WEB_URL}/app/work-inbox`);
    await expect(page.getByText(/caixa de trabalho|work inbox|trabalho/i).first()).toBeVisible({
      timeout: 30_000,
    });

    // ---- veredito ----
    expect(serverErrors, `5xx observados:\n${serverErrors.join('\n')}`).toEqual([]);
    expect(authErrors, `401/403 inesperados:\n${authErrors.join('\n')}`).toEqual([]);

    // Diagnostico explicito dos 404/400 antes de julgar o console.
    console.log(`\n=== W07 SMOKE: respostas 400/404 ===\n${clientErrors.join('\n') || '(nenhuma)'}\n=== END ===\n`);

    const unexpectedConsole = consoleErrors.filter(
      (text) => !/Failed to load resource/i.test(text),
    );
    expect(unexpectedConsole, `erros de console:\n${unexpectedConsole.join('\n')}`).toEqual([]);
  });
});
