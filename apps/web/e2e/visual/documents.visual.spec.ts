import { expect, test, type Page } from '@playwright/test';
import { prepareAuthenticatedSession, stabilizePage } from '../fixtures/visual-helpers';

/**
 * Validacao visual FOCADA da tela de Documentos.
 *
 * Escopo deliberadamente restrito a listagem (barra de busca/tipo, hierarquia da tabela, acao de
 * download). Nao substitui a regressao visual completa, e nao captura baselines: as assercoes aqui
 * sao de DOM e geometria, que nao dependem de plataforma. Rodar apenas:
 *   pnpm --filter @cisne/web exec playwright test documents.visual --project=desktop --project=mobile
 */
const UAT_TITLE = 'Evidência UAT — Locação de equipamento';

async function openDocumentsList(page: Page): Promise<void> {
  await page.goto('/app/documents');
  await expect(page.getByRole('heading', { level: 1, name: 'Documentos' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Lista de documentos' })).toBeVisible();
}

/**
 * Invariantes de geometria verificaveis por maquina em qualquer viewport.
 *
 * A tabela tem 6 colunas: em viewport estreito ela precisa ROLAR dentro do proprio contêiner,
 * nunca estourar a largura da pagina (o defeito classico de tabela larga em tela pequena).
 */
async function layoutMetrics(page: Page) {
  return page.evaluate(() => {
    const table = document.querySelector('table[aria-label="Lista de documentos"]');
    const container = table?.parentElement ?? null;
    const root = document.documentElement;
    return {
      hasTable: table !== null,
      pageScrollWidth: root.scrollWidth,
      pageClientWidth: root.clientWidth,
      containerOverflowX: container ? getComputedStyle(container).overflowX : '',
      containerClientWidth: container?.clientWidth ?? 0,
      containerScrollWidth: container?.scrollWidth ?? 0,
    };
  });
}

test.describe('documents visual', () => {
  test.beforeEach(async ({ page }) => {
    await prepareAuthenticatedSession(page, 'documents');
  });

  test('documents list has hierarchy, a real download action and no page overflow', async ({
    page,
  }) => {
    await openDocumentsList(page);

    // Documento e a coluna PRINCIPAL: titulo em destaque e metadado secundario discreto.
    const primary = page.getByText(UAT_TITLE).first();
    await expect(primary).toBeVisible();
    await expect(primary).toHaveClass(/font-semibold/);
    await expect(page.getByText('Evidência · Interno').first()).toBeVisible();

    // A acao de download e BOTAO, nunca link cru, e o nome acessivel diz qual documento sera baixado.
    const downloadButton = page.getByRole('button', { name: `Baixar ${UAT_TITLE}` }).first();
    await expect(downloadButton).toBeVisible();
    await expect(page.getByRole('link', { name: /^baixar/i })).toHaveCount(0);

    // O identificador de unidade e exibido como codigo (nao existe nome humano no contrato).
    await expect(page.getByText('unit-synthetic-homolog').first()).toBeVisible();

    // Documentos distintos com o MESMO titulo continuam sendo dois, e sao distinguiveis pelos
    // segundos — por isso o compromisso de tempo desta tela tem precisao de segundo.
    await expect(page.getByText(UAT_TITLE)).toHaveCount(2);
    await expect(page.getByText(/\d{2}:\d{2}:47/)).toBeVisible();
    await expect(page.getByText(/\d{2}:\d{2}:52/)).toBeVisible();

    await assertNoPageOverflowNorGreedyTable(page);

    await stabilizePage(page);
  });

  test('a filter that matches nothing explains itself and offers a way back', async ({ page }) => {
    await openDocumentsList(page);

    await page.getByRole('searchbox', { name: 'Buscar' }).fill('Zinco inexistente');

    await expect(
      page.getByText('Nenhum documento corresponde aos filtros aplicados.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /limpar filtros/i })).toBeVisible();
    await assertNoPageOverflowNorGreedyTable(page);

    await page.getByRole('button', { name: /limpar filtros/i }).click();
    await expect(page.getByText(UAT_TITLE).first()).toBeVisible();
  });

  test('the type filter is resolved on the server', async ({ page }) => {
    await openDocumentsList(page);

    await page.getByRole('combobox', { name: 'Tipo' }).selectOption('BILLING_DOCUMENT');

    await expect(page.getByText('Contrato assinado')).toBeVisible();
    await expect(page.getByText(UAT_TITLE)).toHaveCount(0);
    await assertNoPageOverflowNorGreedyTable(page);
  });
});

async function assertNoPageOverflowNorGreedyTable(page: Page): Promise<void> {
  const metrics = await layoutMetrics(page);

  // Invariante que vale SEMPRE, inclusive nos estados sem tabela (vazio, sem resultado, erro).
  expect(
    metrics.pageScrollWidth,
    `a pagina nao deve exceder a largura do viewport (scrollWidth=${metrics.pageScrollWidth}, clientWidth=${metrics.pageClientWidth})`,
  ).toBeLessThanOrEqual(metrics.pageClientWidth + 1);

  // Com a tabela em tela, ela rola DENTRO do contêiner, e o contêiner nunca e mais largo que a
  // pagina. Sem tabela nao ha o que medir: o proprio estado de "sem resultado" ja foi coberto
  // pela invariante de pagina acima.
  if (!metrics.hasTable) {
    return;
  }
  expect(metrics.containerOverflowX).toBe('auto');
  expect(metrics.containerClientWidth).toBeLessThanOrEqual(metrics.pageClientWidth + 1);
}
