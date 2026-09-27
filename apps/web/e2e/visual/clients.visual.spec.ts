import { expect, test, type Page } from '@playwright/test';
import {
  prepareAuthenticatedSession,
  stabilizePage,
} from '../fixtures/visual-helpers';

/**
 * Validação visual FOCADA de Clientes.
 *
 * Escopo deliberadamente restrito à listagem reformulada (barra de busca/filtros compacta, tabela
 * com documento e status, faixa de paginação). Não cobre criar/editar/detalhe, que não mudaram
 * nesta frente, e não substitui a regressão visual completa — rodar apenas:
 *   pnpm --filter @cisne/web exec playwright test clients.visual --project=desktop --project=mobile
 */
async function openClientsList(page: Page): Promise<void> {
  await page.goto('/app/clients');
  await expect(page.getByRole('heading', { level: 1, name: 'Clientes' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Lista de Clientes' })).toBeVisible();
}

/**
 * Invariantes de layout verificáveis por máquina em qualquer viewport.
 *
 * A tabela tem 5 colunas e vive dentro de um contêiner com `overflow-x-auto`: em viewport estreito
 * ela deve ROLAR dentro do contêiner, nunca estourar a largura da página (o defeito clássico de
 * tabela larga em telas pequenas).
 */
async function assertNoPageLevelHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return {
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
    };
  });
  expect(
    overflow.scrollWidth,
    `a página não deve exceder a largura do viewport (scrollWidth=${overflow.scrollWidth}, clientWidth=${overflow.clientWidth})`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

test.describe('clients visual', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      test.info().project.name === 'tablet',
      'Este spec focado mantém baselines somente para desktop e mobile.',
    );
    await prepareAuthenticatedSession(page, 'clients');
  });

  test('populated clients list', async ({ page }) => {
    await openClientsList(page);

    // A barra de busca e o filtro de status ficam junto da lista.
    await expect(page.getByRole('searchbox', { name: 'Buscar' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Status' })).toBeVisible();

    // Tabela com as colunas da listagem e o documento formatado.
    await expect(page.getByRole('columnheader', { name: /cliente/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /documento/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /última atualização/i })).toBeVisible();
    await expect(page.getByText('11.222.333/0005-18')).toBeVisible();

    // Nome fantasia aparece como apoio da razão social.
    await expect(page.getByText('Alfa Madeira', { exact: true })).toBeVisible();

    // Faixa de paginação alimentada pelo total do backend.
    await expect(page.getByText(/1–5 de 5/)).toBeVisible();
    await expect(page.getByRole('button', { name: /próxima/i })).toBeDisabled();

    // Em viewport menor a busca e o filtro continuam alcançáveis, e a tabela rola dentro do seu
    // contêiner em vez de estourar a página.
    await expect(page.getByRole('searchbox', { name: 'Buscar' })).toBeInViewport();
    await assertNoPageLevelHorizontalOverflow(page);

    await stabilizePage(page);
    await expect(page.locator('#main-content')).toHaveScreenshot('clients-list-populated.png');
  });

  test('clients list without results', async ({ page }) => {
    await openClientsList(page);

    // Estado sem resultado: mensagem própria (não a de cadastro vazio) e saída explícita.
    await page.getByRole('searchbox', { name: 'Buscar' }).fill('Zinco Inexistente');
    await expect(
      page.getByText('Nenhum Cliente corresponde aos filtros aplicados.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /limpar filtros/i })).toBeVisible();
    await assertNoPageLevelHorizontalOverflow(page);

    await stabilizePage(page);
    await expect(page.locator('#main-content')).toHaveScreenshot(
      'clients-list-no-results.png',
    );
  });
});
