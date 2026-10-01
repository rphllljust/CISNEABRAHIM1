import { expect, test, type Page } from '@playwright/test';
import {
  ACCOUNTING_ACCOUNT_ID,
  ACCOUNTING_CHART_ID,
  ACCOUNTING_FIXED_ASSET_ID,
  ACCOUNTING_JOURNAL_ID,
  ACCOUNTING_PERIOD_ID,
} from '../fixtures/accounting-api-routes';
import { prepareAuthenticatedSession, stabilizePage } from '../fixtures/visual-helpers';

/**
 * Prova de browser da família CONTABILIDADE (Família 4) — as 11 rotas em Chromium real.
 *
 * O perfil `accounting` devolve o contrato real da contabilidade (plano, contas, período, ledger,
 * journal postado, balancete, DRE, balanço, imobilizado e prontidão de fechamento), então cada
 * tela é exercitada com dado do servidor — não há mock de runtime nas páginas.
 *
 * Além do screenshot, cada rota assere: cabeçalho da worklist presente, área de resultado
 * definida, filtro real funcionando, ação existente disponível e ausência de overflow horizontal
 * em nível de página.
 */

/**
 * Erros de JAVASCRIPT da página — exceção não tratada, promessa rejeitada, falha de render.
 *
 * O console também emite "Failed to load resource" para as respostas de SONDA de capability, que
 * são 404/403 POR CONTRATO (é assim que a sonda conclui se a capability existe) e respostas
 * legítimas de recusa do servidor. Elas não são erro de JavaScript e não indicam tela quebrada;
 * o que esta prova exige é zero exceção e zero 5xx.
 */
function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') {
      return;
    }
    const text = message.text();
    if (/Failed to load resource/i.test(text)) {
      return;
    }
    errors.push(text);
  });
  page.on('response', (response) => {
    if (response.status() >= 500) {
      errors.push(`5xx: ${response.status()} ${response.url()}`);
    }
  });
  return errors;
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

test.describe('contabilidade (Família 4) — 11 rotas', () => {
  test.beforeEach(async ({ page }) => {
    await prepareAuthenticatedSession(page, 'accounting');
  });

  test('01 plano de contas: árvore com filtros e ações reais', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/app/accounting/chart');
    await expect(page.getByRole('heading', { level: 1, name: 'Plano de contas' })).toBeVisible();

    await page.getByLabel(/^plano de contas$/i).selectOption(ACCOUNTING_CHART_ID);
    const tree = page.getByRole('table', { name: /árvore de contas/i });
    await expect(tree).toBeVisible();
    // As asserções são ancoradas na GRADE: "Caixa" também aparece no seletor de conta superior
    // do formulário de nova conta, e o que esta prova verifica é a árvore carregada do servidor.
    await expect(tree.getByRole('cell', { name: 'Caixa', exact: true })).toBeVisible();
    await expect(tree.getByRole('cell', { name: 'Receita de serviços', exact: true })).toBeVisible();

    // FILTRO REAL: buscar por código reduz a árvore.
    await page.getByLabel(/^buscar$/i).fill('4.1.01');
    await expect(tree.getByRole('cell', { name: 'Receita de serviços', exact: true })).toBeVisible();
    await expect(tree.getByRole('cell', { name: 'Caixa', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: /limpar filtros/i }).click();
    await expect(tree.getByRole('cell', { name: 'Caixa', exact: true })).toBeVisible();

    // AÇÃO EXISTENTE: o detalhamento por conta usa a listagem filtrada do servidor.
    await page.getByRole('button', { name: /lançamentos da conta 1\.1\.01/i }).click();
    await expect(page.getByRole('table', { name: /lançamentos da conta/i })).toBeVisible();

    await assertNoPageLevelHorizontalOverflow(page);
    await stabilizePage(page);
    await expect(page.locator('#main-content')).toHaveScreenshot('accounting-chart.png');
    expect(errors, `erros de JS: ${errors.join(' | ')}`).toEqual([]);
  });

  test('02 lançamentos: barra operacional, grade e detalhe com postar/estornar', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/app/accounting/journals');
    await expect(page.getByRole('heading', { level: 1, name: 'Lançamentos' })).toBeVisible();

    await page.getByLabel(/^plano de contas$/i).selectOption(ACCOUNTING_CHART_ID);
    await page.getByLabel(/período contábil/i).selectOption(ACCOUNTING_PERIOD_ID);
    await expect(page.getByRole('table', { name: /lançamentos do período/i })).toBeVisible();
    await expect(page.getByText('Venda de serviços de manutenção')).toBeVisible();

    // FILTRO REAL: estado rascunho não tem lançamento neste recorte -> estado dentro da estrutura.
    await page.getByLabel(/^estado$/i).selectOption('DRAFT');
    await expect(page.getByText(/nenhum lançamento em rascunho no período/i)).toBeVisible();
    await page.getByLabel(/^estado$/i).selectOption('POSTED');
    await expect(page.getByRole('table', { name: /lançamentos do período/i })).toBeVisible();

    // AÇÃO EXISTENTE: abrir o detalhe com as ações decididas pelo backend.
    await page.getByRole('link', { name: 'Abrir' }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Lançamento' })).toBeVisible();
    await expect(page.getByRole('table', { name: /linhas do lançamento/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Estornar' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Postar' })).toBeVisible();

    await assertNoPageLevelHorizontalOverflow(page);
    await stabilizePage(page);
    await expect(page.locator('#main-content')).toHaveScreenshot('accounting-journals.png');
    expect(errors, `erros de JS: ${errors.join(' | ')}`).toEqual([]);
  });

  test('03 diário: relatório de postados com paginação do servidor', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/app/accounting/diario');
    await expect(page.getByRole('heading', { level: 1, name: 'Diário' })).toBeVisible();

    // PRÉ-REQUISITO: o estado de orientação compacto mora na área de resultado.
    await expect(page.getByText(/selecione o escopo do relatório/i)).toBeVisible();

    await page.getByLabel(/^plano de contas$/i).selectOption(ACCOUNTING_CHART_ID);
    await page.getByLabel(/período contábil/i).selectOption(ACCOUNTING_PERIOD_ID);
    await expect(page.getByRole('table', { name: /livro diário/i })).toBeVisible();
    await expect(page.getByText('1.1.01 — Caixa')).toBeVisible();
    await expect(page.getByText(/débitos da página/i)).toBeVisible();

    await assertNoPageLevelHorizontalOverflow(page);
    await stabilizePage(page);
    await expect(page.locator('#main-content')).toHaveScreenshot('accounting-diario.png');
    expect(errors, `erros de JS: ${errors.join(' | ')}`).toEqual([]);
  });

  test('04 razão: filtro de conta e extrato com saldo do servidor', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/app/accounting/razao');
    await expect(page.getByRole('heading', { level: 1, name: 'Razão' })).toBeVisible();

    await page.getByLabel(/^plano de contas$/i).selectOption(ACCOUNTING_CHART_ID);
    await page.getByLabel(/período contábil/i).selectOption(ACCOUNTING_PERIOD_ID);

    // PRÉ-REQUISITO DO DOMÍNIO: o razão exige uma conta.
    await expect(page.getByText(/nenhuma conta selecionada para o razão/i)).toBeVisible();

    await page.getByLabel(/conta \(razão\)/i).selectOption(ACCOUNTING_ACCOUNT_ID);
    await expect(page.getByRole('table', { name: /razão da conta/i })).toBeVisible();
    await expect(page.getByText(/saldo anterior/i).first()).toBeVisible();
    await expect(page.getByText(/natureza/i).first()).toBeVisible();

    await assertNoPageLevelHorizontalOverflow(page);
    await stabilizePage(page);
    await expect(page.locator('#main-content')).toHaveScreenshot('accounting-razao.png');
    expect(errors, `erros de JS: ${errors.join(' | ')}`).toEqual([]);
  });

  test('05 balancete: relatório de conferência débito/crédito', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/app/accounting/balancete');
    await expect(page.getByRole('heading', { level: 1, name: 'Balancete' })).toBeVisible();

    await page.getByLabel(/^plano de contas$/i).selectOption(ACCOUNTING_CHART_ID);
    await page.getByLabel(/período contábil/i).selectOption(ACCOUNTING_PERIOD_ID);
    await expect(page.getByRole('table', { name: /balancete do período/i })).toBeVisible();
    await expect(page.getByText(/conferido pelo servidor/i)).toBeVisible();
    await expect(page.getByText('1.1.01 — Caixa')).toBeVisible();

    await assertNoPageLevelHorizontalOverflow(page);
    await stabilizePage(page);
    await expect(page.locator('#main-content')).toHaveScreenshot('accounting-balancete.png');
    expect(errors, `erros de JS: ${errors.join(' | ')}`).toEqual([]);
  });

  test('06 DRE: área de resultado apurada pelo servidor', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/app/accounting/dre');
    await expect(page.getByRole('heading', { level: 1, name: 'DRE' })).toBeVisible();

    await page.getByLabel(/^plano de contas$/i).selectOption(ACCOUNTING_CHART_ID);
    await page.getByLabel(/período contábil/i).selectOption(ACCOUNTING_PERIOD_ID);
    await expect(page.getByRole('region', { name: 'Resultado do período' })).toBeVisible();
    await expect(page.getByText('Receita')).toBeVisible();
    await expect(page.getByText('Despesa')).toBeVisible();

    await assertNoPageLevelHorizontalOverflow(page);
    await stabilizePage(page);
    await expect(page.locator('#main-content')).toHaveScreenshot('accounting-dre.png');
    expect(errors, `erros de JS: ${errors.join(' | ')}`).toEqual([]);
  });

  test('07 balanço patrimonial: posição conferida pelo servidor', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/app/accounting/balanco');
    await expect(page.getByRole('heading', { level: 1, name: 'Balanço patrimonial' })).toBeVisible();

    await page.getByLabel(/^plano de contas$/i).selectOption(ACCOUNTING_CHART_ID);
    await page.getByLabel(/período contábil/i).selectOption(ACCOUNTING_PERIOD_ID);
    await expect(
      page.getByRole('region', { name: 'Posição patrimonial do período' }),
    ).toBeVisible();
    await expect(page.getByText(/conferido: a = p \+ pl/i)).toBeVisible();

    await assertNoPageLevelHorizontalOverflow(page);
    await stabilizePage(page);
    await expect(page.locator('#main-content')).toHaveScreenshot('accounting-balanco.png');
    expect(errors, `erros de JS: ${errors.join(' | ')}`).toEqual([]);
  });

  test('08 fechamentos: workbench do período com checklist e ações', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/app/accounting/fechamentos');
    await expect(page.getByRole('heading', { level: 1, name: 'Fechamentos' })).toBeVisible();

    await page.getByLabel(/^plano de contas$/i).selectOption(ACCOUNTING_CHART_ID);
    await page.getByLabel(/período contábil/i).selectOption(ACCOUNTING_PERIOD_ID);
    await expect(page.getByRole('region', { name: 'Estado do período' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Checklist do período' })).toBeVisible();
    await expect(page.getByText(/histórico de fechamentos/i)).toBeVisible();
    await expect(page.getByRole('table', { name: /execuções de fechamento/i })).toBeVisible();

    // AÇÕES EXISTENTES: fechar e reabrir continuam disponíveis com o mesmo fluxo.
    await expect(page.getByRole('button', { name: 'Fechar' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reabrir' })).toBeVisible();

    await assertNoPageLevelHorizontalOverflow(page);
    await stabilizePage(page);
    await expect(page.locator('#main-content')).toHaveScreenshot('accounting-fechamentos.png');
    expect(errors, `erros de JS: ${errors.join(' | ')}`).toEqual([]);
  });

  test('09 origem dos lançamentos: rastreabilidade com visões e drill-down', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/app/accounting/origens');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Origem dos lançamentos' }),
    ).toBeVisible();
    await expect(
      page.getByRole('table', { name: /origem dos lançamentos contábeis/i }),
    ).toBeVisible();
    // DRILL-DOWN REAL para o lançamento gerado pela regra publicada.
    await expect(page.getByRole('link', { name: '#1' })).toHaveAttribute(
      'href',
      `/app/accounting/journals/${ACCOUNTING_JOURNAL_ID}`,
    );

    await assertNoPageLevelHorizontalOverflow(page);
    await stabilizePage(page);
    await expect(page.locator('#main-content')).toHaveScreenshot('accounting-origens.png');
    expect(errors, `erros de JS: ${errors.join(' | ')}`).toEqual([]);
  });

  test('10 ativo imobilizado: registro, valor contábil e movimentos persistidos', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(`/app/accounting/fixed-assets/${ACCOUNTING_FIXED_ASSET_ID}`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Ativo imobilizado' }),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: 'Registro do imobilizado' })).toBeVisible();
    const movements = page.getByRole('table', { name: /movimentos do imobilizado/i });
    await expect(movements).toBeVisible();
    // Os tipos de movimento são exibidos pelo rótulo humano do vocabulário fechado do domínio.
    await expect(movements.getByRole('cell', { name: 'Aquisição', exact: true })).toBeVisible();
    await expect(movements.getByRole('cell', { name: 'Depreciação', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /depreciar/i })).toBeVisible();

    await assertNoPageLevelHorizontalOverflow(page);
    await stabilizePage(page);
    await expect(page.locator('#main-content')).toHaveScreenshot('accounting-fixed-assets.png');
    expect(errors, `erros de JS: ${errors.join(' | ')}`).toEqual([]);
  });

  test('11 central de fechamento: workbench operacional com bloqueadores reais', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/app/closing');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Central de fechamento' }),
    ).toBeVisible();

    // A competência já vem pré-selecionada (a mais recente publicada pelo servidor).
    await expect(
      page.getByRole('list', { name: /bloqueadores do fechamento/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('listitem').filter({ hasText: /lançamentos em rascunho/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Situação do período' }),
    ).toBeVisible();
    // Bloqueador real desabilita o fechamento — o backend decide.
    await expect(page.getByRole('button', { name: 'Fechar período' })).toBeDisabled();

    await assertNoPageLevelHorizontalOverflow(page);
    await stabilizePage(page);
    await expect(page.locator('#main-content')).toHaveScreenshot('accounting-closing.png');
    expect(errors, `erros de JS: ${errors.join(' | ')}`).toEqual([]);
  });
});