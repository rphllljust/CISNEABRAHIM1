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

/**
 * Ator SEM acesso financeiro — `empregado@…` responde 403 em `/finance/receivables` (verificado
 * contra a API real antes de virar asserção).
 *
 * A credencial vem do ambiente pela MESMA regra do ator autorizado: sem ela a jornada para com
 * erro explícito, em vez de pular silenciosamente a única prova de autorização negativa.
 */
const DENIED_LOGIN = process.env['CISNE_JOURNEY_DENIED_LOGIN']?.trim();

function requireDeniedPassword(): string {
  const value = process.env['CISNE_JOURNEY_DENIED_PASSWORD']?.trim();
  if (!value) {
    throw new Error(
      'CONFIGURATION_ERROR: CISNE_JOURNEY_DENIED_PASSWORD is required to run the negative-authorization journey.',
    );
  }
  return value;
}

async function loginDenied(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/^usuário/i).fill(DENIED_LOGIN ?? '');
  await page.getByLabel(/^senha/i).fill(requireDeniedPassword());
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

    /*
     * A GRADE PERMANECE MONTADA COM 0 LINHAS — é a prova central da distinção:
     *   SOURCE_TOTAL=0            -> EmptyState (nada existe)
     *   SOURCE_TOTAL>0 + FILTRO=0 -> DynamicList + emptyMessage (nada NESTE recorte)
     *
     * Aqui o servidor devolveu 3 títulos e o FILTRO zerou. Se a tela tivesse trocado a grade por
     * um painel, o operador perderia os cabeçalhos das colunas que acabou de filtrar.
     */
    const headers = list.locator('thead th');
    await expect(headers.first()).toBeVisible();
    expect(await headers.count()).toBeGreaterThan(0);
    // A mensagem vive DENTRO do grid, na célula vazia.
    await expect(list.locator('tbody')).toContainText(/Nenhum título corresponde ao recorte/);
    await expect(list.locator('[data-testid="dynamic-list-row"]')).toHaveCount(0);

    // E o resumo passa a descrever a condição.
    await expect(page.locator('[data-testid="dynamic-filter-builder-summary"]')).toBeVisible();

    // Limpar devolve o conjunto original — o filtro não é destrutivo e as linhas VOLTAM.
    await page.locator('[data-testid="dynamic-filter-builder-clear"]').click();
    await expect(list).toHaveAttribute('data-list-count', String(before), { timeout: 30_000 });
    await expect(list.locator('[data-testid="dynamic-list-row"]').first()).toBeVisible();
  });

  test('o detalhe de conta financeira usa DynamicForm e preserva os comandos e a conciliacao', async ({ page }) => {
    await login(page);

    // A lista de caixa e bancos é a porta de entrada: pega um id real da própria tela.
    await page.goto('/app/finance/treasury');
    const linked = page.locator('a[href^="/app/finance/treasury/"]').first();
    await expect(linked).toBeVisible({ timeout: 30_000 });
    await linked.click();
    await expect(page).toHaveURL(/\/app\/finance\/treasury\/[^/]+$/, { timeout: 30_000 });

    // O bloco de identificação é o formulário do metadado (tipo e situação vêm do schema).
    await expect(page.locator('[data-testid="dynamic-form"]')).toBeVisible({ timeout: 30_000 });

    /*
     * PARIDADE: os totais da CONCILIAÇÃO continuam na tela. Eles NÃO são campos de `meta.fields` —
     * vêm de um recurso separado da API — e por isso seguem desenhados fora do formulário.
     */
    await expect(page.getByText('Créditos', { exact: true })).toBeVisible();
    await expect(page.getByText('Débitos', { exact: true })).toBeVisible();
    await expect(page.getByText('Movimentos', { exact: true })).toBeVisible();

    /*
     * DOMÍNIO: NÃO existe bloco de audit trail nesta tela — a versão original nunca teve, e
     * movimentação financeira não é trilha de auditoria. A ausência é o comportamento correto.
     */
    await expect(page.locator('[data-testid="dynamic-timeline"]')).toHaveCount(0);

    // PARIDADE: os quatro comandos do servidor continuam declarados para conta ativa.
    const registrar = page.getByRole('heading', { name: 'Registrar movimento' });
    if ((await registrar.count()) > 0) {
      await expect(registrar).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Transferir entre contas' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Estornar movimento' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Estornar transferência' })).toBeVisible();
    } else {
      // Conta encerrada: o aviso substitui os comandos — comportamento preservado.
      await expect(page.getByText(/Conta encerrada/)).toBeVisible();
    }
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

  /**
   * AUTORIZAÇÃO NEGATIVA — a engine NÃO é boundary de segurança.
   *
   * Uma tela migrada que renderizasse a lista para um ator sem permissão seria uma regressão de
   * SEGURANÇA, não de layout: `DynamicList` desenha o que recebe, e quem recusa é o servidor
   * (403) + o gate da tela. Esta prova usa um ator REALMENTE sem acesso financeiro e exige que a
   * negação seja EXPLÍCITA — nunca uma tabela vazia, que o operador leria como "não há dado".
   *
   * QUEM RECUSA PRIMEIRO É O GUARD DE ROTA (`FinanceRoute`), antes da página: o operador vê
   * "Acesso negado" com a permissão exigida e a informação de que a autorização é do BACKEND —
   * mais forte que a mensagem de página, porque nem chega a montar o módulo. Quando o guard
   * deixa passar e é a consulta que falha, o gate da página (`renderQueryGate`) assume com
   * "não tem permissão…". As duas formas são aceitas aqui; tabela vazia NÃO é.
   */
  test('ator sem permissao recebe negacao explicita, nunca lista vazia', async ({ page }) => {
    if (!DENIED_LOGIN) {
      throw new Error(
        'CONFIGURATION_ERROR: CISNE_JOURNEY_DENIED_LOGIN is required to run the negative-authorization journey.',
      );
    }
    await loginDenied(page);
    await page.goto('/app/finance/receivables');

    // A negação é DITA ao operador — pelo guard de rota ou pelo gate da consulta.
    await expect(
      page.getByRole('heading', { name: /Acesso negado|não tem permissão/i }),
    ).toBeVisible({ timeout: 30_000 });
    // E nomeia a permissão exigida, em vez de um "erro" genérico.
    await expect(page.getByText(/finance:receivables/)).toBeVisible();

    // A tabela NÃO é montada — lista vazia aqui seria uma mentira sobre o acesso.
    await expect(page.locator('[data-testid="dynamic-list"]')).toHaveCount(0);

    /*
     * SEGUNDA ENTIDADE PROTEGIDA. O ator de teste TEM `finance:treasury` (a tela de caixa abre
     * normalmente para ele), então tesouraria NÃO serve como prova de negação e não é usada aqui.
     * A prova repete sobre outra área que ele comprovadamente não acessa — contas a pagar —, o que
     * mantém o teste sobre autorização REAL em vez de uma suposição sobre o grant.
     */
    await page.goto('/app/finance/payables');
    await expect(
      page.getByRole('heading', { name: /Acesso negado|não tem permissão/i }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid="dynamic-list"]')).toHaveCount(0);
  });
});
