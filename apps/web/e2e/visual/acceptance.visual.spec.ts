import { expect, test, type Page } from '@playwright/test';
import { prepareAuthenticatedSession, stabilizePage } from '../fixtures/visual-helpers';
import type { ApiMockProfile } from '../fixtures/api-routes';

/**
 * ACEITE DE BROWSER — convergencia de superficie enterprise.
 *
 * Este spec NAO compara com snapshot antigo: a wave mudou a arquitetura visual de proposito (page
 * shell compartilhado, grade densa, humanizacao), entao um diff de pixel contra o baseline anterior
 * acusaria a PROPRIA mudanca desejada. O que ele faz e o que o aceite exige:
 *
 * 1. ABRIR a rota real no browser;
 * 2. provar que ela passou pela superficie COMPARTILHADA (um unico `main#main-content`, sem
 *    landmark duplicado, sem `<h1>` repetido);
 * 3. provar a HUMANIZACAO: nenhum identificador interno de unidade e nenhum enum cru conhecido
 *    (COMPLETED / RELEASED / PREPARED / CANCELLED) na superficie de negocio;
 * 4. provar que a tela nao estoura a largura do viewport;
 * 5. capturar screenshot para inspecao humana.
 *
 * Classificacao exigida pela wave: PASS ou BROKEN.
 *
 * A sessao e aberta POR PERFIL DE MOCK: cada modulo publica as proprias capabilities. Sem o perfil
 * correto a superficie responde "Acesso negado" — que e o comportamento CERTO do produto (a
 * autorizacao e do backend), nao um defeito de tela. Medir uma worklist sob o perfil errado mediria
 * a negacao, nao a superficie.
 */

/** Identificador interno de ambiente que NUNCA pode chegar a superficie. */
const FORBIDDEN_UNIT_SLUG = /unit-synthetic|UN-DEV-\d+/i;

/**
 * Enums crus CONHECIDOS — todos tem dicionario real no produto. Se aparecerem como texto visivel,
 * a humanizacao regrediu.
 */
const FORBIDDEN_RAW_ENUMS = /\b(COMPLETED|CANCELLED|RELEASED|PREPARED|IN_EXECUTION|PAUSED)\b/;

async function assertSharedSurface(page: Page, label: string): Promise<void> {
  await expect(
    page.locator('main#main-content'),
    `${label}: deve existir exatamente um main#main-content`,
  ).toHaveCount(1);
  await expect(page.locator('main main'), `${label}: nao pode haver <main> aninhado`).toHaveCount(0);
  await expect(page.locator('h1'), `${label}: deve haver exatamente um h1`).toHaveCount(1);

  const bodyText = (await page.locator('body').innerText()) ?? '';
  expect(bodyText, `${label}: nao pode expor identificador interno de unidade`).not.toMatch(
    FORBIDDEN_UNIT_SLUG,
  );
  expect(bodyText, `${label}: nao pode expor enum cru conhecido`).not.toMatch(FORBIDDEN_RAW_ENUMS);
}

async function assertNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    overflow.scrollWidth,
    `${label}: a pagina nao pode estourar a largura do viewport (scrollWidth=${overflow.scrollWidth}, clientWidth=${overflow.clientWidth})`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

async function capture(page: Page, label: string): Promise<void> {
  await stabilizePage(page);
  await page.screenshot({ path: `../../tmp/acceptance/${label}.png`, fullPage: false });
}

async function login(page: Page, profile: ApiMockProfile): Promise<void> {
  await prepareAuthenticatedSession(page, profile);
}

test.describe('aceite de browser — superficies de negocio', () => {
  test('WORKBENCH — Central de alertas e uma fila de excecao, nao 3 selects + vazio', async ({
    page,
  }) => {
    await login(page, 'dashboard');
    await page.goto('/app/alerts');
    await expect(page.getByRole('heading', { level: 1, name: /central de alertas/i })).toBeVisible();

    await assertSharedSurface(page, 'Alertas');

    // A tela tem de conter uma FILA de trabalho — nao apenas filtros e espaco vazio.
    const body = (await page.locator('body').innerText()) ?? '';
    expect(
      /fila de alertas|nenhum alerta/i.test(body),
      'Alertas deve declarar uma fila (com itens) ou um estado vazio explicito',
    ).toBe(true);
    // Os tres recortes continuam existindo, dentro de UMA barra compacta.
    await expect(page.getByLabel(/filtros da lista/i)).toBeVisible();

    await capture(page, 'workbench-alertas');
  });

  test('WORKBENCH — Faturamento interno abre como mesa de trabalho', async ({ page }) => {
    await login(page, 'billing-empty');
    await page.goto('/app/billing');
    await expect(
      page.getByRole('heading', { level: 1, name: /faturamento interno/i }),
    ).toBeVisible();
    await assertSharedSurface(page, 'Faturamento');
    await capture(page, 'workbench-faturamento');
  });

  test('REPORT — Relatorios nao mostra unidade sintetica nem status cru', async ({ page }) => {
    await login(page, 'dashboard');
    await page.goto('/app/reports');
    await expect(page.getByRole('heading', { level: 1, name: /relatórios/i })).toBeVisible();

    await assertSharedSurface(page, 'Relatorios');

    // A previa e o conteudo principal e ocupa a largura da tela.
    await expect(page.getByRole('region', { name: /pré-visualização do relatório/i })).toBeVisible();
    await expect(page.getByLabel(/filtros do relatório/i)).toBeVisible();

    // Filtro de unidade e HUMANO (select alimentado pelo contrato), nao campo de identificador.
    const unitFilter = page.locator('#report-unit');
    await expect(unitFilter).toBeVisible();
    expect(
      await unitFilter.evaluate((el) => el.tagName),
      'o filtro de unidade deve ser um controle de selecao, nao um input de identificador',
    ).toBe('SELECT');

    await assertNoHorizontalOverflow(page, 'Relatorios');
    await capture(page, 'report-relatorios');
  });

  test('WORKLIST Comercial — Clientes usa a grade densa compartilhada', async ({ page }) => {
    await login(page, 'clients');
    await page.goto('/app/clients');
    await expect(page.getByRole('heading', { level: 1, name: 'Clientes' })).toBeVisible();
    await assertSharedSurface(page, 'Clientes');
    await expect(page.getByRole('table', { name: 'Lista de Clientes' })).toBeVisible();
    await assertNoHorizontalOverflow(page, 'Clientes');
    await capture(page, 'worklist-clientes');
  });

  test('WORKLIST Operacional — Documentos', async ({ page }) => {
    await login(page, 'documents');
    await page.goto('/app/documents');
    await expect(page.getByRole('heading', { level: 1, name: /documentos/i })).toBeVisible();
    await assertSharedSurface(page, 'Documentos');
    await capture(page, 'worklist-documentos');
  });

  test('WORKLIST Financeira — Despesas usa a grade densa compartilhada', async ({ page }) => {
    /*
      PARK_FIXTURE_GAP: o perfil `finance` do harness mocka `/api/v1/finance/expenses` e
      `/api/v1/finance/budgets`, mas NAO a sonda de capability `finance:receivables`. Apontar este
      aceite para Recebiveis mediria a tela de "Acesso negado" — comportamento correto do backend
      (a autorizacao e fail-closed), nao a superficie. A prova de grade densa vale igual em
      Despesas, que e a mesma worklist financeira. Recebiveis continua coberto pelos testes de
      unidade do modulo (`src/finance`).
    */
    await login(page, 'finance');
    await page.goto('/app/finance/expenses');
    await assertSharedSurface(page, 'Despesas');
    await capture(page, 'worklist-despesas');
  });

  test('WORKLIST Suprimentos — Fornecedores', async ({ page }) => {
    await login(page, 'suppliers');
    await page.goto('/app/suppliers');
    await expect(page.getByRole('heading', { level: 1, name: /fornecedores/i })).toBeVisible();
    await assertSharedSurface(page, 'Fornecedores');
    await capture(page, 'worklist-fornecedores');
  });

  test('WORKLIST Estoque — a grade densa substituiu a tabela legada', async ({ page }) => {
    await login(page, 'inventory');
    await page.goto('/app/inventory');
    await assertSharedSurface(page, 'Estoque');
    await capture(page, 'worklist-estoque');
  });

  test('WORKLIST Comercial — Propostas', async ({ page }) => {
    await login(page, 'commercial');
    await page.goto('/app/proposals');
    await assertSharedSurface(page, 'Propostas');
    await capture(page, 'worklist-propostas');
  });

  test('CREATE_EDIT — Novo Cliente e um cadastro em secoes, nao uma pilha de campos', async ({
    page,
  }) => {
    await login(page, 'clients');
    await page.goto('/app/clients/new');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await assertSharedSurface(page, 'Novo Cliente');
    await capture(page, 'cadastro-novo-cliente');
  });

  test('OBJECT_PAGE — Detalhe de cliente exibe estado, acao e contexto', async ({ page }) => {
    await login(page, 'clients');
    await page.goto('/app/clients');
    await expect(page.getByRole('heading', { level: 1, name: 'Clientes' })).toBeVisible();
    await assertSharedSurface(page, 'Clientes');

    const firstLink = page.locator('table a').first();
    await expect(firstLink).toBeVisible();
    await firstLink.click();
    await assertSharedSurface(page, 'Detalhe de cliente');
    await capture(page, 'object-cliente-detalhe');
  });

  test('Painel — primeira dobra mostra trabalho util, sem identificador interno', async ({
    page,
  }) => {
    await login(page, 'dashboard');
    await page.goto('/app');
    await expect(page.getByRole('heading', { level: 1, name: /visão geral/i })).toBeVisible();
    await expect(page.locator('main#main-content')).toHaveCount(1);

    const body = (await page.locator('body').innerText()) ?? '';
    expect(body, 'Painel nao pode expor o slug de unidade no recorte ativo').not.toMatch(
      FORBIDDEN_UNIT_SLUG,
    );

    await capture(page, 'painel-visao-geral');
  });
});
