/**
 * Prova de BROWSER (Playwright, chromium) — CISNE service catalog humanization.
 *
 * Roda contra a APLICACAO REAL (API + banco + autorizacao reais) na URL de dev. Nenhum mock.
 * Prova que o NOME humano da versao vigente chega ate a UI como identidade principal da lista e
 * como label do lookup humano, e que nenhum UUID aparece como rotulo.
 */
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const WEB_URL = process.env.CISNE_JOURNEY_WEB_URL ?? 'http://127.0.0.1:5173';
const API_URL = process.env.CISNE_JOURNEY_API_URL ?? 'http://127.0.0.1:3000';
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

const SHOTS = process.env.CISNE_JOURNEY_SHOTS ?? join(process.cwd(), 'test-results', 'catalog');
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
mkdirSync(SHOTS, { recursive: true });

/**
 * UM UNICO TESTE, UM UNICO CONTEXTO — e portanto UM UNICO login.
 *
 * O login da API e limitado por cliente (`AUTH_LOGIN_RATE_LIMIT_PER_MINUTE`, padrao 5/min). Cada
 * `test()` do Playwright ganha um contexto de browser novo (sem sessao), entao manter as tres provas
 * no MESMO teste evita esbarrar no limite e confundir rate limit com defeito do catalogo.
 */
async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/^usuário/i).fill(LOGIN);
  await page.getByLabel(/^senha/i).fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
}
test.describe('catalogo de servicos — nome humano na UI', () => {
  test.beforeAll(async ({ request }) => {
    const health = await request.get(`${API_URL}/api/v1/health`);
    expect(health.ok(), `API nao respondeu em ${API_URL}`).toBe(true);
    const web = await request.get(WEB_URL);
    expect(web.ok(), `Web nao respondeu em ${WEB_URL}`).toBe(true);
  });

  test('nome humano na lista, na busca e no lookup; nenhum UUID como rotulo', async ({ page }) => {
    await login(page);

    // ---- 1. LISTA: nome humano como identidade principal -------------------
    await page.goto('/app/catalog');
    await expect(page.getByRole('heading', { name: /cat.logo de servi/i })).toBeVisible({
      timeout: 30_000,
    });

    const table = page.getByRole('table', { name: /lista de defini..es de servi.o/i });
    await expect(table).toBeVisible({ timeout: 30_000 });
    await expect(table.getByRole('columnheader', { name: 'Serviço' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Categoria' })).toBeVisible();

    const links = table.locator('tbody tr td:first-child a');
    await expect.poll(async () => links.count(), { timeout: 30_000 }).toBeGreaterThan(0);

    const labels = await links.allInnerTexts();
    const humanNames = labels.filter(
      (label) => label.trim().length > 0 && !/^CNAE-\d+$/.test(label.trim()),
    );
    expect(
      humanNames.length,
      `nenhum nome humano na lista; rotulos vistos: ${JSON.stringify(labels)}`,
    ).toBeGreaterThan(0);

    const tableText = await table.innerText();
    expect(tableText, 'UUID visivel na lista do catalogo').not.toMatch(UUID_PATTERN);
    await page.screenshot({ path: join(SHOTS, 'catalog-list.png'), fullPage: true });

    // ---- 2. BUSCA por NOME, resolvida no servidor --------------------------
    const search = page.getByLabel(/buscar servi.os/i);
    await expect(search).toBeVisible();
    await expect(search).toHaveAttribute('placeholder', /nome/i);

    const firstName = (await links.first().innerText()).trim();
    const fragment = firstName.split(/\s+/).find((word) => word.length >= 5) ?? firstName;
    await search.fill(fragment);

    await expect
      .poll(
        async () => (await table.locator('tbody tr td:first-child a').allInnerTexts()).join(' | '),
        { timeout: 30_000 },
      )
      .toContain(fragment);
    await page.screenshot({ path: join(SHOTS, 'catalog-search-by-name.png'), fullPage: true });

    // ---- 3. LOOKUP humano de servico --------------------------------------
    await page.goto('/app/requests/new');
    const serviceSelect = page.locator('#request-service-select');
    await expect(serviceSelect).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => serviceSelect.locator('option').count(), { timeout: 30_000 })
      .toBeGreaterThan(1);

    const optionLabels = (await serviceSelect.locator('option').allInnerTexts()).filter(
      (label) => label.trim().length > 0,
    );
    expect(
      optionLabels.some((label) => !/^CNAE-\d+/.test(label.trim())),
      `lookup ainda rotula por code: ${JSON.stringify(optionLabels)}`,
    ).toBe(true);
    expect(optionLabels.join(' '), 'UUID visivel no lookup de servico').not.toMatch(UUID_PATTERN);

    const namedOption = optionLabels.find((label) => !/^CNAE-\d+/.test(label.trim()));
    expect(namedOption, 'nenhuma opcao com nome humano no lookup').toBeDefined();
    await serviceSelect.selectOption({ label: namedOption as string });
    await page.screenshot({ path: join(SHOTS, 'service-lookup.png'), fullPage: true });
  });
});
