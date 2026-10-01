import { expect, test, type Page } from '@playwright/test';

/**
 * SMOKE REAL DE HML — FAMÍLIA 5 (FISCAL), 5 rotas, SEM FIXTURE.
 *
 * Abre as 5 rotas fiscais contra o HML de verdade: o artefato servido pelo nginx do container
 * `cisne_hml_web` e as APIs reais do `cisne_hml_api`. Nenhuma resposta é interceptada, nenhum
 * perfil de mock é instalado e nenhum dado é criado.
 *
 * Rodar apenas:
 *   HML_WEB_URL=... HML_SMOKE_LOGIN=... HML_SMOKE_PASSWORD=... \
 *     pnpm --filter @cisne/web exec playwright test --config e2e/hml/playwright.hml.config.ts fiscal-hml.spec.ts
 */

const HML_WEB = process.env.HML_WEB_URL ?? 'http://127.0.0.1:5174';
const HML_LOGIN = process.env.HML_SMOKE_LOGIN ?? '';
const HML_PASSWORD = process.env.HML_SMOKE_PASSWORD ?? '';

type Guards = { jsErrors: string[]; serverErrors: string[] };

function attachGuards(page: Page): Guards {
  const guards: Guards = { jsErrors: [], serverErrors: [] };
  page.on('pageerror', (error) => guards.jsErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') {
      return;
    }
    // Resposta de SONDA de capability (401/403/404 por contrato) não é erro de JavaScript.
    if (/Failed to load resource/i.test(message.text())) {
      return;
    }
    guards.jsErrors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 500) {
      guards.serverErrors.push(`${response.status()} ${response.url()}`);
    }
  });
  return guards;
}

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

/** Abre a rota e exige o landmark principal montado, sem cair em login ou acesso negado. */
async function openRoute(page: Page, route: string, heading: RegExp) {
  const guards = attachGuards(page);
  await page.goto(`${HML_WEB}${route}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible({
    timeout: 30_000,
  });
  await page.locator('#main-content').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(1200);
  expect(page.url(), `a rota ${route} não pode cair em login`).not.toContain('/login');
  expect(page.url(), `a rota ${route} não pode cair em acesso negado`).not.toContain('/no-access');
  return guards;
}

const ROUTES: Array<{ route: string; heading: RegExp; label: string }> = [
  { route: '/app/fiscal/documents', heading: /documentos fiscais/i, label: 'Documentos fiscais' },
  { route: '/app/fiscal/periods', heading: /períodos fiscais/i, label: 'Períodos fiscais' },
  {
    route: '/app/fiscal/assessments',
    heading: /obrigações tributárias/i,
    label: 'Obrigações tributárias',
  },
  { route: '/app/fiscal/apuracao', heading: /apuração/i, label: 'Apuração' },
  { route: '/app/fiscal/tributos', heading: /tributos/i, label: 'Tributos' },
];

test.describe('HML real — Fiscal (Família 5), 5 rotas, sem fixture', () => {
  test.describe.configure({ mode: 'serial' });

  for (const { route, heading, label } of ROUTES) {
    test(`${label} — ${route}`, async ({ page }) => {
      await signIn(page);
      const guards = await openRoute(page, route, heading);
      const main = page.locator('#main-content');
      const text = await main.innerText();

      // A tela publicou conteúdo real: ou área de resultado, ou estado declarado pela moldura.
      expect(text.trim().length, `${label} não pode abrir em branco`).toBeGreaterThan(0);
      expect(
        /nenhum|não há|nao ha|sem permissão|não foi possível|fila|regra|período|apura|documento|obriga/i.test(
          text,
        ),
        `${label} precisa declarar resultado ou estado`,
      ).toBe(true);

      // 0 erro de JS e 0 resposta 5xx relacionada.
      expect(guards.jsErrors, `erros de JS em ${label}: ${guards.jsErrors.join(' | ')}`).toEqual([]);
      expect(
        guards.serverErrors,
        `5xx em ${label}: ${guards.serverErrors.join(' | ')}`,
      ).toEqual([]);
    });
  }
});
