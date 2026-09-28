import { expect, test, type Page } from '@playwright/test';
import { prepareAuthenticatedSession, stabilizePage } from '../fixtures/visual-helpers';

/**
 * Validação visual FOCADA de Compras.
 *
 * Escopo restrito às três listas operacionais finalizadas nesta frente (solicitações, pedidos ao
 * fornecedor e notas) e à substituição do campo de identificador por escolha humana. Não cobre
 * criar/receber/validar nem substitui a regressão visual completa — rodar apenas:
 *   pnpm --filter @cisne/web exec playwright test procurement.visual --project=desktop --project=mobile
 *
 * O módulo é gated: a prova exige `VITE_FEATURE_MODULE_PROCUREMENT=true` no build.
 */
async function openProcurement(page: Page): Promise<void> {
  await page.goto('/app/procurement');
  await expect(page.getByRole('heading', { level: 1, name: 'Compras' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Solicitações de compra' })).toBeVisible();
}

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

test.describe('procurement visual', () => {
  test.beforeEach(async ({ page }) => {
    await prepareAuthenticatedSession(page, 'procurement');
  });

  test('populated purchasing lists', async ({ page }) => {
    await openProcurement(page);

    // As três entidades do fluxo têm lista: nada exige identificador digitado.
    await expect(page.getByRole('table', { name: 'Pedidos ao fornecedor' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Notas de fornecedor' })).toBeVisible();
    await expect(page.getByLabel(/identificador da solicitação/i)).toHaveCount(0);
    await expect(page.getByLabel(/identificador do pedido/i)).toHaveCount(0);
    await expect(page.getByLabel(/identificador da nota/i)).toHaveCount(0);

    // Pedido ao fornecedor identificado por nome + CNPJ (referência humana vinda do servidor).
    await expect(page.getByRole('link', { name: 'Alfa Insumos' }).first()).toBeVisible();
    await expect(page.getByText('11.222.333/0001-81').first()).toBeVisible();

    // Nota pelo número e solicitação pela justificativa.
    await expect(page.getByRole('link', { name: 'NF-1001' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Reposicao de insumos criticos' })).toBeVisible();

    // Entradas contextuais.
    await expect(page.getByRole('link', { name: 'Nova solicitação' })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Buscar' })).toBeInViewport();

    await assertNoPageLevelHorizontalOverflow(page);

    await stabilizePage(page);
    await expect(page.locator('#main-content')).toHaveScreenshot('procurement-lists-populated.png');
  });

  test('purchasing lists without results', async ({ page }) => {
    await openProcurement(page);

    await page.getByRole('searchbox', { name: 'Buscar' }).fill('Zinco Inexistente');
    await page.getByRole('button', { name: 'Buscar' }).click();

    await expect(page.getByText('Nenhuma solicitação de compra encontrada.')).toBeVisible();
    await expect(page.getByText('Nenhum pedido ao fornecedor encontrado.')).toBeVisible();
    await expect(page.getByText('Nenhuma nota de fornecedor encontrada.')).toBeVisible();
    await assertNoPageLevelHorizontalOverflow(page);

    await stabilizePage(page);
    await expect(page.locator('#main-content')).toHaveScreenshot('procurement-lists-no-results.png');
  });
});
