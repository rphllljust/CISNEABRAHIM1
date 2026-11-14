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
    await expect(page.getByRole('combobox', { name: 'Situação' })).toBeVisible();

    // Tabela com as colunas de decisão atuais. O escopo evita casar o checkbox
    // "Selecionar todos os clientes" com o cabeçalho "Cliente".
    const table = page.getByRole('table', { name: /lista de clientes/i });
    await expect(table.getByRole('columnheader', { name: 'Cliente', exact: true })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Estrutura', exact: true })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Situação', exact: true })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Atenção', exact: true })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Atualização', exact: true })).toBeVisible();

    /*
     * O CNPJ e o nome fantasia fazem parte da MESMA celula de identidade
     * (`ClientsListPage.tsx`, coluna Cliente):
     *
     *   tradeName : `cisne-type-meta`                     -> sempre renderizado
     *   CNPJ      : `cisne-type-helper hidden ... lg:inline` -> oculto abaixo de `lg` (1024px)
     *
     * A assercao anterior exigia o CNPJ visivel em TODOS os projetos. Em `mobile`
     * (390px) o proprio CSS o esconde: `Received: hidden`. Ou seja, o teste pedia que a
     * tela mostrasse um dado que ela decide, por desenho, NAO mostrar em tela estreita —
     * e a falha nao indicava defeito algum no produto.
     *
     * O contrato correto depende do viewport, entao ele e verificado por viewport:
     *   - `desktop` (1280px >= lg): CNPJ visivel, porque esta na faixa que o exibe;
     *   - `mobile`  (390px  <  lg): CNPJ presente no DOM (o dado chega e esta pronto para
     *     a tela larga), porem oculto.
     *
     * Isto NAO afrouxa a assercao: ela continua provando que o CNPJ vem do backend e que a
     * regra de exibicao por breakpoint e a esperada. So deixa de exigir de 390px o que o
     * design reserva para 1024px+.
     */
    const taxIdText = page.getByText('11.222.333/0005-18');
    const isNarrowViewport = (page.viewportSize()?.width ?? 0) < 1024;
    if (isNarrowViewport) {
      await expect(taxIdText).toBeAttached();
      await expect(taxIdText).toBeHidden();
    } else {
      await expect(taxIdText).toBeVisible();
    }

    // Nome fantasia aparece como apoio da razão social — em qualquer viewport.
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
