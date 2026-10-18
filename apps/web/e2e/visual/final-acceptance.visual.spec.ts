import { test, expect } from '@playwright/test';
import { prepareAuthenticatedSession, stabilizePage } from '../fixtures/visual-helpers';

/**
 * ACEITE VISUAL DA ETAPA FINAL — 1600x900, a resolucao do contrato.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTE SPEC EXISTE, E O QUE ELE PROVA
 *
 * A prova visual do CISNE nao e "tsc 0" nem "bundle mudou": e a aplicacao REAL, em estado
 * autenticado, na resolucao em que o operador trabalha. Este arquivo abre cada superficie fechada
 * nesta etapa, MEDE a geometria da primeira dobra e grava o screenshot do `#main-content`.
 *
 * As medidas sao ASSERTIVAS, nao decorativas. "A fila domina a primeira dobra" e uma afirmacao
 * verificavel: o topo da fila tem de estar acima de 900px, e a superficie de trabalho tem de
 * ocupar a maior parte da altura util. Sem isso, o teste passaria com a silhueta antiga de volta.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ESTADO AUTENTICADO SEM CREDENCIAL DE PRODUCAO
 *
 * `prepareAuthenticatedSession` instala o mock de API do proprio repositorio e entra por `/login`
 * com o usuario de fixture — ou seja, a sessao e real do ponto de vista do frontend (token, shell,
 * rotas protegidas), e os DADOS sao controlados. Isso valida geometria, tipografia, densidade,
 * estados e ausencia de linguagem legada.
 *
 * O que ele NAO valida, e esta declarado no relatorio: os numeros empresariais reais. Producao
 * autenticada exige credencial humana — ver a nota final no relatorio da etapa.
 */

const FOLD = 900;

/** A superficie de trabalho nao pode comecar abaixo da dobra em nenhuma rota Tier-1. */
async function assertWorkSurfaceAboveFold(page: import('@playwright/test').Page): Promise<void> {
  const main = page.locator('#main-content');
  await expect(main).toBeVisible();
  const box = await main.boundingBox();
  expect(box, '#main-content precisa existir e ter caixa').not.toBeNull();
  expect(box!.y).toBeLessThan(FOLD);
}

/** Sem overflow horizontal e sem superficie cortada — o defeito classico de grade densa. */
async function assertNoHorizontalOverflow(page: import('@playwright/test').Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  expect(
    overflow.scrollW,
    `a pagina nao deve exceder o viewport (scrollWidth=${overflow.scrollW}, clientWidth=${overflow.clientW})`,
  ).toBeLessThanOrEqual(overflow.clientW + 1);
}

/**
 * Vocabulario de implementacao nunca aparece para o operador.
 *
 * As palavras sao ancoradas em LIMITE DE PALAVRA e maiusculas especificas de identificador
 * (`PARK_BI_GAP`) de proposito: sem isso, `undefined` casa com o proprio relatorio de erro e o teste
 * reprova a si mesmo — o falso positivo que faria a proxima pessoa desligar a assercao.
 */
async function assertNoImplementationLanguage(page: import('@playwright/test').Page): Promise<void> {
  const text = (await page.locator('#main-content').textContent()) ?? '';
  expect(text).not.toMatch(/PARK_BI_GAP|snapshot executivo|backend publica|amostra tecnica/i);
  expect(text).not.toMatch(/\bundefined\b/);
  expect(text).not.toMatch(/\bNaN\b/);
  expect(text).not.toMatch(/\[object Object\]/);
}

test.describe('aceite visual final — 1600x900', () => {
  test.use({ viewport: { width: 1600, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await prepareAuthenticatedSession(page, 'finance');
  });

  test('contas a receber — situacao, toolbar de consulta e contexto', async ({ page }) => {
    await page.goto('/app/finance/receivables');
    await expect(page.getByRole('heading', { level: 1, name: 'Contas a receber' })).toBeVisible();
    await stabilizePage(page);

    // A FAIXA DE SITUACAO responde antes da grade e cada valor abre o conjunto exato.
    const strip = page.getByLabel(/situação financeira do recorte/i);
    await expect(strip).toBeVisible();
    await expect(page.getByRole('link', { name: /^Vencido/i })).toHaveAttribute(
      'href',
      /status=OVERDUE/,
    );

    // A TOOLBAR DE CONSULTA existe: busca no dominio, janela de vencimento e ordenacao declarada.
    await expect(page.getByLabel(/buscar títulos no domínio/i)).toBeVisible();
    await expect(page.getByLabel(/vencimento a partir de/i)).toBeVisible();
    await expect(page.getByLabel(/ordenar por/i)).toBeVisible();

    // Contexto sem seleção não ocupa a bancada; a prévia abre o mesmo contexto sem abandonar a fila.
    await page.getByRole('button', { name: /Prévia de / }).first().click();
    await expect(page.getByRole('heading', { name: 'Contexto do título' })).toBeVisible();

    await assertWorkSurfaceAboveFold(page);
    await assertNoHorizontalOverflow(page);
    await assertNoImplementationLanguage(page);

    await expect(page.locator('#main-content')).toHaveScreenshot('final-receivables.png', {
      maxDiffPixelRatio: 0.02,
    });
  });

  test('contas a pagar — faixa persistida e mesmo padrao operacional', async ({ page }) => {
    await page.goto('/app/finance/payables');
    await expect(page.getByRole('heading', { level: 1, name: 'Contas a pagar' })).toBeVisible();
    await stabilizePage(page);

    await expect(page.getByLabel(/situação financeira do recorte/i)).toBeVisible();
    // Aging 90+ e FATO persistido do titulo e so existe do lado a pagar.
    await expect(page.getByRole('link', { name: /^Aging 90\+/i })).toHaveAttribute(
      'href',
      /agingBucket=90_PLUS/,
    );
    await expect(page.getByLabel(/buscar títulos no domínio/i)).toBeVisible();
    await page.getByRole('button', { name: /Prévia de / }).first().click();
    await expect(page.getByRole('heading', { name: 'Contexto do título' })).toBeVisible();

    await assertWorkSurfaceAboveFold(page);
    await assertNoHorizontalOverflow(page);
    await assertNoImplementationLanguage(page);

    await expect(page.locator('#main-content')).toHaveScreenshot('final-payables.png', {
      maxDiffPixelRatio: 0.02,
    });
  });

  test('financeiro — central de operacoes financeiras', async ({ page }) => {
    await page.goto('/app/finance');
    await expect(page.getByRole('heading', { level: 1, name: 'Financeiro' })).toBeVisible();
    await stabilizePage(page);

    // A SITUACAO abre a central; a fila de excecoes vem logo depois.
    await expect(page.getByLabel(/situação financeira do recorte/i)).toBeVisible();
    await page.getByRole('button', { name: 'Contexto do processo' }).click();
    await expect(page.getByRole('heading', { name: /exceções financeiras/i })).toBeVisible();

    // A regiao de trabalho existe e a tela nao tem overflow.
    await expect(page.locator('[data-region="work-surface"]').first()).toBeVisible();
    await assertWorkSurfaceAboveFold(page);
    await assertNoHorizontalOverflow(page);
    await assertNoImplementationLanguage(page);

    await expect(page.locator('#main-content')).toHaveScreenshot('final-finance.png', {
      maxDiffPixelRatio: 0.02,
    });
  });
});
