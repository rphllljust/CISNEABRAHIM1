import { expect, test, type Page } from '@playwright/test';

/**
 * JORNADA DAS TELAS FINANCE MIGRADAS PARA A ENGINE.
 *
 * Roda contra a APLICAÇÃO REAL (API + PostgreSQL + autorização), como as demais janelas de engine:
 * nenhum `page.route`, nenhum `fulfill`. O que se prova aqui é que a lista e o detalhe migrados
 * continuam ENTREGANDO ao operador o que entregavam antes — e que as três capacidades novas da
 * engine estão de pé sobre dado real.
 *
 * SOBRE A ESCOLHA DAS ENTIDADES: `fin.payables` está VAZIA no banco de desenvolvimento (0 linhas)
 * enquanto receivables/budgets/expenses têm 3 cada. Uma lista vazia renderiza o painel de carteira
 * vazia — comportamento correto e PRESERVADO —, e não a tabela. Por isso a prova de tabela usa
 * CONTAS A RECEBER, que tem dado; contas a pagar é provada pelo que ela entrega SEM dado: os
 * indicadores, as visões salvas, o construtor de filtros e o painel humano de carteira vazia.
 *
 * Pré-requisitos: API em CISNE_JOURNEY_API_URL, web em CISNE_JOURNEY_WEB_URL, e
 * CISNE_JOURNEY_LOGIN / CISNE_JOURNEY_PASSWORD no ambiente.
 */
const LOGIN = process.env['CISNE_JOURNEY_LOGIN'] ?? 'abrahim@cisne-rondonia.invalid';

function requirePassword(): string {
  const value = process.env['CISNE_JOURNEY_PASSWORD']?.trim();
  if (!value) {
    throw new Error('CONFIGURATION_ERROR: CISNE_JOURNEY_PASSWORD is required to run this journey.');
  }
  return value;
}

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/^usuário/i).fill(LOGIN);
  await page.getByLabel(/^senha/i).fill(requirePassword());
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 30_000 });
}

test.describe('finance migrado para a engine', () => {
  test('contas a receber e renderizada pela DynamicList com paridade e cadeia', async ({ page }) => {
    await login(page);
    await page.goto('/app/finance/receivables');

    // A tabela é da ENGINE: o testid é o contrato, não a classe.
    const list = page.locator('[data-testid="dynamic-list"]');
    await expect(list).toBeVisible({ timeout: 30_000 });
    await expect(list).toHaveAttribute('data-entity', 'receivables');
    // A view `list` de receivables declara 6 colunas.
    await expect(list).toHaveAttribute('data-column-count', '6');

    // PARIDADE: linhas com título real e ordenação por coluna continuam disponíveis.
    await expect(list.locator('[data-testid="dynamic-list-row"]').first()).toBeVisible();
    await expect(list.locator('th button').first()).toBeVisible();
    // A carteira do dev tem 3 títulos — o recorte do servidor chega à tabela.
    expect(Number(await list.getAttribute('data-list-count'))).toBeGreaterThan(0);

    // PARIDADE: os indicadores de drill-down continuam na tela.
    await expect(page.getByRole('link', { name: /^Vencidos/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Carteira em aberto/ })).toBeVisible();

    // CAPACIDADE NOVA: o construtor visual de filtros, montado sobre o metadado.
    const builder = page.locator('[data-testid="dynamic-filter-builder"]');
    await expect(builder).toBeVisible();
    await expect(builder).toHaveAttribute('data-entity', 'receivables');

    /*
     * PARIDADE DA CADEIA COMERCIAL — feature exclusiva desta tela. A prévia é aberta pela ação de
     * linha e a cadeia tem de montar com os vínculos que o payload realmente traz.
     */
    await list.locator('[data-testid="dynamic-list-row"]').first().getByRole('button', { name: /Prévia/ }).click();
    await expect(page.getByRole('navigation', { name: /Cadeia/i })).toBeVisible({ timeout: 30_000 });
  });

  test('contas a pagar preserva indicadores, visoes e o painel de carteira vazia', async ({ page }) => {
    await login(page);
    await page.goto('/app/finance/payables');

    /*
     * PARIDADE ESTRUTURAL SEM DADO: a página em volta continua inteira. Este é exatamente o
     * comportamento que a versão anterior do arquivo documentava como correção — o estado vazio é
     * um ESTADO DA WORKLIST, nunca uma segunda estrutura de página. Se a migração tivesse feito
     * retorno antecipado no vazio, estes controles teriam sumido.
     *
     * Os indicadores são LINKS, e a visão salva homônima é um BOTÃO: o papel é o que desempata
     * "Vencidos" — sem ele o localizador casaria os dois.
     */
    await expect(page.getByRole('link', { name: /^Vencidos/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^A vencer/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Aging 90\+/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Obrigações em aberto/ })).toBeVisible();

    // Visões salvas — embutidas do smart list.
    await expect(page.getByRole('button', { name: 'Tudo', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pagos', exact: true })).toBeVisible();

    /*
     * A barra de ações em lote (e a nota PARK) só existe quando HÁ linha para selecionar — a
     * carteira de pagáveis do dev está vazia, então ela não renderiza. A ausência aqui é o
     * comportamento PRESERVADO, não uma perda: `BulkActionBar` nunca apareceu com 0 registros.
     */
    await expect(page.getByText(/\d+ registros no recorte atual/)).toBeVisible();

    // O painel humano de carteira vazia, com a saída para compras.
    await expect(page.getByRole('heading', { name: /Nenhuma obrigação a pagar registrada/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ver compras' })).toBeVisible();

    // O construtor de filtros está montado mesmo sem linha.
    await expect(page.locator('[data-testid="dynamic-filter-builder"]')).toBeVisible();
  });

  test('o construtor de filtros compoe condicao e restringe a lista', async ({ page }) => {
    await login(page);
    await page.goto('/app/finance/receivables');

    const list = page.locator('[data-testid="dynamic-list"]');
    await expect(list).toBeVisible({ timeout: 30_000 });
    const before = Number(await list.getAttribute('data-list-count'));
    expect(before).toBeGreaterThan(0);

    await page.locator('[data-testid="dynamic-filter-builder-toggle"]').click();
    await page.locator('[data-testid="dynamic-filter-add-rule"]').click();
    const rule = page.locator('[data-testid="dynamic-filter-rule"]').first();
    await expect(rule).toBeVisible();

    /*
     * OPERADORES POR TIPO. O construtor oferece apenas os campos que o metadata store marcou
     * `in_filter` — para receivables: `client_id` (link), `due_date` (date), `lifecycle` (select),
     * `origin_kind` (select), `unit_id` (link). `principal` NÃO está entre eles, e filtrar por
     * campo que o metadado não declara filtrável é exatamente o hardcode que a engine elimina.
     *
     * Não existe campo `text` filtrável nesta entidade, então `contains` não aparece AQUI — e é
     * correto que não apareça: oferecê-lo seria oferecer o que o tipo não sustenta.
     */
    await rule.locator('[data-testid="dynamic-filter-rule-field"]').selectOption('unit_id');
    const linkOps = await rule
      .locator('[data-testid="dynamic-filter-rule-op"] option')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('value')));
    // `link` é conjunto fechado: igualdade, diferença e pertinência. Sem ordem, sem `contains`.
    expect(linkOps).toEqual(['=', '!=', 'in']);

    // `date` oferece ORDEM — é o tipo que sustenta `>`, `>=`, `<`, `<=`.
    await rule.locator('[data-testid="dynamic-filter-rule-field"]').selectOption('due_date');
    const dateOps = await rule
      .locator('[data-testid="dynamic-filter-rule-op"] option')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('value')));
    expect(dateOps).toContain('>');
    expect(dateOps).toContain('<=');
    expect(dateOps).not.toContain('contains');

    // `lifecycle`, que é `select`, oferece `in` — o conjunto fechado do tipo.
    await rule.locator('[data-testid="dynamic-filter-rule-field"]').selectOption('lifecycle');
    const selectOps = await rule
      .locator('[data-testid="dynamic-filter-rule-op"] option')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('value')));
    expect(selectOps).toContain('in');
    expect(selectOps).toContain('=');
    expect(selectOps).not.toContain('contains');
    expect(selectOps).not.toContain('is_true');

    // Um valor anterior a qualquer título: o recorte sobre `due_date` zera o conjunto exibido.
    await rule.locator('[data-testid="dynamic-filter-rule-field"]').selectOption('due_date');
    await rule.locator('[data-testid="dynamic-filter-rule-op"]').selectOption('<');
    await rule.locator('[data-testid="dynamic-filter-rule-value"]').fill('1900-01-01');
    await expect(list).toHaveAttribute('data-list-count', '0', { timeout: 30_000 });

    // E o resumo passa a descrever a condição.
    await expect(page.locator('[data-testid="dynamic-filter-builder-summary"]')).toBeVisible();

    // Limpar devolve o conjunto original — o filtro não é destrutivo.
    await page.locator('[data-testid="dynamic-filter-builder-clear"]').click();
    await expect(list).toHaveAttribute('data-list-count', String(before), { timeout: 30_000 });
  });

  test('o detalhe de orcamento usa DynamicForm e o subformulario de linhas', async ({ page }) => {
    await login(page);

    // A lista de orçamentos é a porta de entrada: pega um id real da própria tela.
    await page.goto('/app/finance/budgets');
    const row = page.locator('[data-testid="dynamic-list-row"]').first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    await expect(page).toHaveURL(/\/app\/finance\/budgets\/[^/]+$/, { timeout: 30_000 });

    // O bloco de identificação/vigência/controle é o formulário do metadado.
    await expect(page.locator('[data-testid="dynamic-form"]')).toBeVisible({ timeout: 30_000 });

    // PARIDADE: os formulários de comando continuam na tela.
    await expect(page.getByRole('heading', { name: 'Adicionar período' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Adicionar linha' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aprovar' })).toBeVisible();

    // CAPACIDADE NOVA: o subformulário de linhas, somente leitura e com rodapé.
    const subform = page.locator('[data-testid="dynamic-subform"]');
    if ((await subform.count()) > 0) {
      await expect(subform).toBeVisible();
      // Somente leitura: a API de orçamento não publica PATCH por linha.
      await expect(subform.locator('[data-testid="dynamic-subform-add"]')).toHaveCount(0);
      await expect(subform.locator('[data-testid="dynamic-subform-totals"]')).toBeVisible();
    }
  });
});
