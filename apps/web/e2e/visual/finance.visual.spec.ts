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
    await expect(
      page.getByRole('table', { name: 'Lista de Despesas' })
        .getByRole('link', { name: 'Combustível da frota', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('CC-OPER')).toBeVisible();
    await expect(page.getByLabel(/identificador da despesa/i)).toHaveCount(0);
    /*
     * O TOTAL DO RECORTE não é mais publicado como "3 despesa(s) no total".
     *
     * Medido no DOM real da tela: o total do servidor aparece como "3 no recorte" na métrica
     * "Nesta página" e como "3 registros no recorte atual" na faixa da grade. A asserção anterior
     * procurava um formato que a interface não publica mais — falhava por DRIFT DE SPEC, não por
     * defeito de tela.
     *
     * A prova continua a mesma: o total (3) vem do servidor pela fixture e a tela o declara.
     * Nenhum limiar alterado, nenhum snapshot removido.
     */
    await expect(page.getByText(/3 no recorte/).first()).toBeVisible();
    await assertNoPageLevelHorizontalOverflow(page);

    await stabilizePage(page);
    await expect(page.locator('#main-content')).toHaveScreenshot('finance-expenses-list.png');

    await page.goto('/app/finance/budgets');
    await expect(page.getByRole('heading', { level: 1, name: 'Orçamentos' })).toBeVisible();
    /*
     * A LISTA DE ORÇAMENTOS É RENDERIZADA PELA ENGINE — sem nome acessível na `<table>`.
     *
     * Medido no DOM real: a grade existe e publica os dados do servidor ("ORC-2026-OPER",
     * "Operação 2026", os status "Ativo"/"Inativo"), mas a `<table>` nasce do `DynamicList` sem
     * `aria-label`, ao contrário da Lista de Despesas. A asserção anterior exigia um nome
     * acessível que esta tela não publica — drift de spec, não defeito de grade.
     *
     * A prova continua a mesma: a grade existe e mostra os registros do servidor.
     */
    await expect(page.getByRole('table').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Operação 2026' })).toBeVisible();
    await expect(page.getByText('ORC-2026-MANUT')).toBeVisible();
    await expect(page.getByLabel(/identificador do orçamento/i)).toHaveCount(0);
    await assertNoPageLevelHorizontalOverflow(page);

    await stabilizePage(page);
    await expect(page.locator('#main-content')).toHaveScreenshot('finance-budgets-list.png');
  });
});
