import { expect, test, type Page } from '@playwright/test';
import { prepareAuthenticatedSession, stabilizePage } from '../fixtures/visual-helpers';

/**
 * CAPTURA DE EVIDÊNCIA DA RECOMPOSIÇÃO DO CUSTOMER WORKSPACE.
 *
 * Este spec NÃO compara contra baseline: ele captura as telas para inspeção da mudança de
 * composição (workspace, drawer de contexto e object page). O spec com baseline
 * (`clients.visual.spec.ts`) continua sendo a regressão; aqui o objetivo é EVIDÊNCIA VISUAL.
 */
async function openClientsList(page: Page): Promise<void> {
  await page.goto('/app/clients');
  await expect(page.getByRole('heading', { level: 1, name: 'Clientes' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Lista de clientes' })).toBeVisible();
}

test.describe('customer workspace evidence', () => {
  test.beforeEach(async ({ page }) => {
    await prepareAuthenticatedSession(page, 'clients');
  });

  test('workspace composition', async ({ page }) => {
    await openClientsList(page);
    await stabilizePage(page);

    /*
     * A grade tem as COLUNAS DE DECISÃO do workspace, não só identidade e status.
     * Os nomes são buscados dentro da TABELA: `Cliente` também casa o rótulo do campo de busca,
     * e uma busca global seria ambígua por construção, não por defeito da tela.
     */
    const table = page.getByRole('table', { name: 'Lista de clientes' });
    // `Cliente` é o nome do BOTÃO de ordenação dentro do cabeçalho, não do `<th>` — o `<th>` que
    // o contém expõe o mesmo nome acessível, e `getByRole` casaria os dois. O botão é o alvo
    // inequívoco.
    await expect(table.getByRole('button', { name: 'Cliente' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Estrutura' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Situação' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Atenção' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Atualização' })).toBeVisible();

    // A ESTRUTURA EMPRESARIAL tem dado REAL na célula: grupo e filiais publicados pelo servidor.
    await expect(table.getByText('Grupo Alfa').first()).toBeVisible();

    await page.screenshot({ path: 'test-results/evidence/clients-workspace.png', fullPage: true });
  });

  test('context drawer from a row', async ({ page }) => {
    await openClientsList(page);

    // Selecionar a linha abre o CONTEXTO sem sair da fila.
    await page.getByRole('cell', { name: /Alfa Madeira LTDA/ }).first().click();

    const drawer = page.getByRole('dialog').or(page.getByRole('complementary'));
    await expect(drawer.first()).toBeVisible();
    await stabilizePage(page);

    await page.screenshot({ path: 'test-results/evidence/clients-context.png', fullPage: true });
  });

  test('create page with duplicate check', async ({ page }) => {
    await page.goto('/app/clients/new');
    await expect(page.getByLabel(/razão social/i)).toBeVisible();
    await stabilizePage(page);
    await page.screenshot({ path: 'test-results/evidence/clients-new.png', fullPage: true });
  });
});
