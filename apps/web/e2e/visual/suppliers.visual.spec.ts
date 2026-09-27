import { expect, test, type Page } from '@playwright/test';
import { prepareAuthenticatedSession, stabilizePage } from '../fixtures/visual-helpers';

/**
 * Validação visual FOCADA de Fornecedores.
 *
 * Escopo restrito à superfície finalizada nesta frente: a listagem (busca, filtro de status,
 * tabela com referência humana e faixa de paginação) e o estado sem resultado. Não cobre
 * criar/detalhe nem substitui a regressão visual completa — rodar apenas:
 *   pnpm --filter @cisne/web exec playwright test suppliers.visual --project=desktop --project=mobile
 *
 * O módulo é gated: a prova exige `VITE_FEATURE_MODULE_SUPPLIERS=true` no build.
 */
async function openSuppliersList(page: Page): Promise<void> {
  await page.goto('/app/suppliers');
  await expect(page.getByRole('heading', { level: 1, name: 'Fornecedores' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Lista de Fornecedores' })).toBeVisible();
}

/**
 * Invariante de geometria verificável por máquina em qualquer viewport: a tabela vive dentro de um
 * contêiner com `overflow-x-auto`, então em viewport estreito ela rola DENTRO do cartão em vez de
 * estourar a largura da página.
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

test.describe('suppliers visual', () => {
  test.beforeEach(async ({ page }) => {
    await prepareAuthenticatedSession(page, 'suppliers');
  });

  test('populated suppliers list', async ({ page }) => {
    await openSuppliersList(page);

    // Busca e filtro de status ficam junto da lista.
    await expect(page.getByRole('searchbox', { name: 'Buscar' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Status' })).toBeVisible();

    // A linha identifica o fornecedor por referência humana: nome fantasia, razão social e CNPJ.
    await expect(page.getByRole('columnheader', { name: /fornecedor/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /cnpj/i })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Alfa Insumos' })).toBeVisible();
    await expect(page.getByText('11.222.333/0001-81')).toBeVisible();
    await expect(page.getByText('Delta Lubrificantes EIRELI')).toBeVisible();

    // Nenhum identificador técnico é oferecido como caminho de entrada.
    await expect(page.getByLabel(/identificador do fornecedor/i)).toHaveCount(0);

    // Faixa de paginação alimentada pelo total do backend.
    await expect(page.getByText(/5 fornecedor\(es\) no total/)).toBeVisible();
    await expect(page.getByRole('button', { name: /anterior/i })).toBeDisabled();

    await expect(page.getByRole('searchbox', { name: 'Buscar' })).toBeInViewport();
    await assertNoPageLevelHorizontalOverflow(page);

    await stabilizePage(page);
    await expect(page.locator('#main-content')).toHaveScreenshot('suppliers-list-populated.png');
  });

  test('suppliers list without results', async ({ page }) => {
    await openSuppliersList(page);

    await page.getByRole('searchbox', { name: 'Buscar' }).fill('Zinco Inexistente');
    await page.getByRole('button', { name: 'Buscar' }).click();

    await expect(
      page.getByText('Nenhum fornecedor encontrado para os filtros selecionados.'),
    ).toBeVisible();
    await assertNoPageLevelHorizontalOverflow(page);

    await stabilizePage(page);
    await expect(page.locator('#main-content')).toHaveScreenshot('suppliers-list-no-results.png');
  });
});
