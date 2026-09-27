import { expect, test, type Page } from '@playwright/test';
import { prepareAuthenticatedSession, stabilizePage } from '../fixtures/visual-helpers';

/**
 * Prova de browser da família FINANCE (uma prova por família nesta rodada).
 *
 * Escopo: as duas listas finalizadas (Despesas e Orçamentos), que antes só existiam como página
 * sem rota e exigiam identificador digitado. Rodar apenas:
 *   pnpm --filter @cisne/web exec playwright test finance.visual --project=desktop --project=mobile
 */
async function assertNoPageLevelHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
  });
  expect(
    overflow.scrollWidth,
    `a página não deve exceder a largura do viewport (scrollWidth=${overflow.scrollWidth}, clientWidth=${overflow.clientWidth})`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

test.describe('finance visual', () => {
  test.beforeEach(async ({ page }) => {
    await prepareAuthenticatedSession(page, 'finance');
  });

  test('expenses and budgets lists without identifier fields', async ({ page }) => {
    await page.goto('/app/finance/expenses');
    await expect(page.getByRole('heading', { level: 1, name: 'Despesas' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Lista de Despesas' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Combustível da frota' })).toBeVisible();
    await expect(page.getByText('CC-OPER')).toBeVisible();
    await expect(page.getByLabel(/identificador da despesa/i)).toHaveCount(0);
    await expect(page.getByText(/3 despesa\(s\) no total/)).toBeVisible();
    await assertNoPageLevelHorizontalOverflow(page);

    await stabilizePage(page);
    await expect(page.locator('#main-content')).toHaveScreenshot('finance-expenses-list.png');

    await page.goto('/app/finance/budgets');
    await expect(page.getByRole('heading', { level: 1, name: 'Orçamentos' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Lista de Orçamentos' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Operação 2026' })).toBeVisible();
    await expect(page.getByText('ORC-2026-MANUT')).toBeVisible();
    await expect(page.getByLabel(/identificador do orçamento/i)).toHaveCount(0);
    await assertNoPageLevelHorizontalOverflow(page);

    await stabilizePage(page);
    await expect(page.locator('#main-content')).toHaveScreenshot('finance-budgets-list.png');
  });
});
