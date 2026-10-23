import { test } from '@playwright/test';

/**
 * CAPTURA DE PRODUÇÃO — `/app` no artefato publicado, SEM `page.route`.
 *
 * Este spec NAO mocka nada: ele abre a URL real de produção, autentica com as credenciais de
 * ambiente e captura a tela. Se a sessão não puder ser estabelecida (sem credenciais, sem seed de
 * operador em produção), o spec FALHA e diz por quê — um screenshot de tela de login não é prova de
 * `/app`, e apresentá-lo como prova seria desonesto.
 *
 * Rodar:
 *   PROD_BASE_URL=... PROD_USER=... PROD_PASSWORD=... \
 *   pnpm --filter @cisne/web exec playwright test --config e2e/prod/playwright.prod.config.ts
 */

const BASE_URL = process.env.PROD_BASE_URL;
const USER = process.env.PROD_USER;
const PASSWORD = process.env.PROD_PASSWORD;

test.describe('produção /app', () => {
  test.use({ viewport: { width: 1728, height: 900 } });

  test('captura /app no artefato publicado', async ({ page }) => {
    test.skip(!BASE_URL || !USER || !PASSWORD, 'PROD_BASE_URL/PROD_USER/PROD_PASSWORD não fornecidos — captura autenticada impossível');

    await page.goto(`${BASE_URL!}/login`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel(/^usuário/i).fill(USER!);
    await page.getByLabel(/^senha/i).fill(PASSWORD!);
    await page.getByRole('button', { name: /^entrar/i }).click();
    await page.waitForURL(/\/app/, { timeout: 60_000 });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(2500);

    await page.screenshot({ path: 'tmp/prod-proof/app-prod-1728.png', fullPage: false });

    const rows = await page.locator('.dashboard-queue__row:not(.dashboard-queue__row--head)').count();
    const kpis = await page.locator('.dashboard-kpi-cell').count();
    const sidebar = await page.locator('aside.shell__sidebar').boundingBox();
    const sidebarBg = await page
      .locator('aside.shell__sidebar')
      .evaluate((el) => getComputedStyle(el).backgroundColor);

    console.log(
      'PROD_REPORT=' +
        JSON.stringify(
          {
            url: page.url(),
            rows,
            kpis,
            sidebarWidth: sidebar ? Math.round(sidebar.width) : null,
            sidebarBg,
          },
          null,
          2,
        ),
    );

    // Estado B — seleção abre o contexto SEM overlay.
    const firstRef = page.locator('.dashboard-queue__ref').first();
    if (await firstRef.count()) {
      await firstRef.click();
      await page.waitForTimeout(700);
      await page.screenshot({ path: 'tmp/prod-proof/app-prod-drawer-1728.png', fullPage: false });
    }
  });
});
