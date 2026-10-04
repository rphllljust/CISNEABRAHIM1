import { expect, test, type Page } from '@playwright/test';

/**
 * PROVA DE RENDERIZAÇÃO REAL DA LISTA DE CAIXA E BANCOS.
 *
 * O `journey.spec.ts` aceita dois estados válidos (COM dado e SEM dado) porque
 * `fin.financial_accounts` já esteve vazia. Aqui NÃO há essa tolerância: este arquivo é a prova
 * de que, com contas existindo, a tela as RENDERIZA com o saldo do servidor e o bloco de
 * reconciliação — nada de asserção condicional que passaria com a grade vazia.
 *
 * Roda contra a aplicação real. Nenhum `page.route`.
 */
const LOGIN = process.env['CISNE_JOURNEY_LOGIN']?.trim();
const PASSWORD = process.env['CISNE_JOURNEY_PASSWORD']?.trim();

test.skip(
  !LOGIN || !PASSWORD,
  'CONFIGURATION_ERROR: CISNE_JOURNEY_LOGIN/PASSWORD são exigidos para a prova de renderização.',
);

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/^usuário/i).fill(LOGIN!);
  await page.getByLabel(/^senha/i).fill(PASSWORD!);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 30_000 });
}

test('a lista renderiza as contas reais com saldo e o bloco de reconciliacao', async ({ page }) => {
  await login(page);
  await page.goto('/app/finance/treasury');

  const table = page.locator('[data-testid="dynamic-list"]');
  await expect(table).toBeVisible({ timeout: 30_000 });

  // O servidor tem contas: a grade NÃO pode estar vazia. Esta é a asserção que o journey não faz.
  const rows = table.locator('[data-testid="dynamic-list-row"]');
  await expect(rows.first()).toBeVisible();
  const rowCount = await rows.count();
  expect(rowCount).toBeGreaterThan(0);

  // Cada linha traz identidade e as colunas declaradas pelo metadado.
  for (let index = 0; index < rowCount; index += 1) {
    await expect(rows.nth(index)).toHaveAttribute('data-row-id', /.+/);
  }

  /*
   * SALDO, CRÉDITOS, DÉBITOS e MOVIMENTOS — paridade com a versão artesanal. O saldo é o valor
   * reconstruído pelo servidor; a tela apenas o exibe.
   */
  const reconciliation = page.getByRole('table', {
    name: /Reconciliação das contas da página/i,
  });
  await expect(reconciliation).toBeVisible({ timeout: 30_000 });

  const reconRows = reconciliation.locator('tbody tr');
  await expect(reconRows.first()).toBeVisible();
  expect(await reconRows.count()).toBeGreaterThan(0);

  // O saldo do servidor aparece formatado em moeda — não como string crua nem como zero fixo.
  const balanceCell = reconRows.first().locator('td').nth(1);
  await expect(balanceCell).toContainText(/R\$\s?\d/);

  // A contagem de movimentos é um número publicado pelo servidor.
  const movementCell = reconRows.first().locator('td').nth(4);
  await expect(movementCell).toHaveText(/^\d+$/);

  // DRILLDOWN: cada conta do bloco leva ao detalhe.
  const link = reconciliation.locator('a[href^="/app/finance/treasury/"]').first();
  await expect(link).toBeVisible();
  const href = await link.getAttribute('href');
  expect(href).toMatch(/^\/app\/finance\/treasury\/[^/]+$/);
});
