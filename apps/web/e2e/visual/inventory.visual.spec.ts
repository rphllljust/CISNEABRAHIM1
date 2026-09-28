import { expect, test, type Page } from '@playwright/test';
import { prepareAuthenticatedSession, stabilizePage } from '../fixtures/visual-helpers';

/**
 * Validação visual FOCADA de Estoque.
 *
 * Escopo restrito às quatro listas operacionais finalizadas nesta frente (depósitos, itens,
 * movimentos, reservas) e à ausência de campo de identificador. Não cobre movimentar/reservar nem
 * substitui a regressão visual completa — rodar apenas:
 *   pnpm --filter @cisne/web exec playwright test inventory.visual --project=desktop --project=mobile
 *
 * O módulo é gated: a prova exige `VITE_FEATURE_MODULE_INVENTORY=true` no build.
 */
async function openInventory(page: Page): Promise<void> {
  await page.goto('/app/inventory');
  await expect(page.getByRole('heading', { level: 1, name: 'Estoque' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Depósitos' })).toBeVisible();
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

test.describe('inventory visual', () => {
  test.beforeEach(async ({ page }) => {
    await prepareAuthenticatedSession(page, 'inventory');
  });

  test('populated stock lists', async ({ page }) => {
    await openInventory(page);

    // As quatro listas existem: nada de operação por identificador digitado.
    await expect(page.getByRole('table', { name: 'Itens de estoque' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Movimentos de estoque' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Reservas de estoque' })).toBeVisible();
    await expect(page.getByLabel(/depósito de destino \(id\)/i)).toHaveCount(0);

    // Depósito e item por referência humana; movimento legível por código/SKU e descrição.
    await expect(page.getByRole('link', { name: 'Depósito Central' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Cabo de aço 10mm' }).first()).toBeVisible();
    await expect(page.getByText('SKU-CABO-10').first()).toBeVisible();
    await expect(page.getByText('Recebimento inicial')).toBeVisible();
    await expect(page.getByText('Saída para a OS 1042')).toBeVisible();

    await expect(page.getByRole('searchbox', { name: 'Buscar' })).toBeInViewport();
    await assertNoPageLevelHorizontalOverflow(page);

    await stabilizePage(page);
    await expect(page.locator('#main-content')).toHaveScreenshot('inventory-lists-populated.png');
  });

  test('stock lists without results', async ({ page }) => {
    await openInventory(page);

    await page.getByRole('searchbox', { name: 'Buscar' }).fill('Zinco Inexistente');
    await page.getByRole('button', { name: 'Buscar' }).click();

    await expect(page.getByText('Nenhum depósito encontrado.')).toBeVisible();
    await expect(page.getByText('Nenhum item de estoque encontrado.')).toBeVisible();
    await expect(page.getByText('Nenhum movimento encontrado.')).toBeVisible();
    await expect(page.getByText('Nenhuma reserva encontrada.')).toBeVisible();
    await assertNoPageLevelHorizontalOverflow(page);

    await stabilizePage(page);
    await expect(page.locator('#main-content')).toHaveScreenshot('inventory-lists-no-results.png');
  });
});
