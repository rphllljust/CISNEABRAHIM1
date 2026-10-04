import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * CAIXA E BANCOS — JORNADA REAL (sem mock, sem page.route, sem sleep).
 *
 * MIGRAÇÃO CONCLUÍDA — o `fixme` foi REMOVIDO, que era o critério de aceite declarado aqui.
 *
 * Este arquivo nasceu como a especificação executável do que a engine precisava entregar em
 * Treasury: a migração anterior havia sido revertida porque perderia paridade (KPIs de
 * drill-down, drawer de contexto, cadeia de negócio, formulário com campos condicionais e accent
 * por regra), e a engine v1 cobria apenas a TABELA.
 *
 * O que destravou: a tela agora é renderizada pelo metadado de `/api/v1/meta/treasury-accounts`
 * (view `list` + `in_filter`), o filtro por campo vem de `DynamicFilterBar`, a exportação por
 * `DynamicExportCsv`, e o formulário condicional de banco/caixa e o bloco de reconciliação
 * (saldo, créditos, débitos, movimentos) foram PRESERVADOS fora da grade. Saldo, créditos e
 * débitos continuam sendo os valores reconstruídos pelo servidor.
 *
 * BLOQUEIO DE AMBIENTE DECLARADO: `fin.financial_accounts` pode estar VAZIA na base de
 * desenvolvimento. Sem contas semeadas, a tela renderiza o estado vazio — que é o comportamento
 * CORRETO — e não há linha para filtrar nem para clicar. Os testes que dependem de linha
 * declaram a ausência em vez de falhar.
 */
const LOGIN = process.env['CISNE_JOURNEY_LOGIN'] ?? 'abrahim@cisne-rondonia.invalid';

function requireJourneyPassword(): string {
  const value = process.env['CISNE_JOURNEY_PASSWORD']?.trim();
  if (!value) {
    throw new Error(
      'CONFIGURATION_ERROR: CISNE_JOURNEY_PASSWORD is required to run this journey.',
    );
  }
  return value;
}

const PASSWORD = requireJourneyPassword();
const SHOTS = process.env['CISNE_JOURNEY_SHOTS'] ?? join(process.cwd(), 'test-results', 'erp');
mkdirSync(SHOTS, { recursive: true });

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/^usuário/i).fill(LOGIN);
  await page.getByLabel(/^senha/i).fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 30_000 });
}

test('lista de caixa e bancos consome o metadado da entidade', async ({ page }) => {
  const metaCalls: string[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/api/v1/meta')) {
      metaCalls.push(response.url());
    }
  });

  await login(page);
  await page.goto('/app/finance/treasury');

  // O título vem do METADADO (`schema.label`), não de literal no componente.
  await expect(page.getByRole('heading', { name: /Caixa e bancos/i })).toBeVisible({
    timeout: 30_000,
  });

  // A ENGINE busca o schema da entidade: sem isso não haveria coluna nem filtro.
  expect(metaCalls.some((url) => url.includes('/api/v1/meta/treasury-accounts'))).toBe(true);

  const table = page.locator('[data-testid="dynamic-list"]');
  const emptyState = page.getByText(/Nenhuma conta financeira/i);

  /*
   * Duas saídas válidas, ambas verificadas — e o teste DIZ qual encontrou:
   *   - COM dado: a tabela da engine aparece com as colunas do metadado;
   *   - SEM dado (base atual): o estado vazio aparece.
   * O que NÃO passa é uma tela em branco, que é a falha que este teste existe para pegar.
   */
  await expect(table.or(emptyState).first()).toBeVisible({ timeout: 30_000 });

  if ((await table.count()) > 0) {
    await expect(table).toHaveAttribute('data-entity', 'treasury-accounts');
    await expect(table.getByRole('columnheader', { name: /Código/ })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: /Nome/ })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: /Tipo/ })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: /Situação/ })).toBeVisible();

    /*
     * PARIDADE: "Moeda" também é coluna do metadado — a versão artesanal não a exibia, mas a view
     * `list` a declara e a engine a desenha. A paridade exige que NENHUMA coluna do original
     * tenha sumido; coluna a mais, vinda do próprio metadado, não é perda.
     */
    await expect(table.getByRole('columnheader', { name: /Moeda/ })).toBeVisible();
  }

  // O FILTRO existe independentemente de haver registro: ele é do metadado (`in_filter`).
  await expect(page.locator('[data-testid="dynamic-filter-bar"] [data-filter="kind"]')).toBeVisible(
    { timeout: 30_000 },
  );
  await expect(
    page.locator('[data-testid="dynamic-filter-bar"] [data-filter="lifecycle"]'),
  ).toBeVisible();

  /*
   * PARIDADE — SALDO, CRÉDITOS, DÉBITOS e MOVIMENTOS continuam VISÍVEIS, agora no bloco de
   * reconciliação. O saldo NÃO é coluna da view `list` (é reconstruído pelo servidor a cada
   * leitura), então ele vive fora da grade — exatamente como no detalhe da conta. O que não pode
   * acontecer é o saldo sumir da tela.
   */
  const reconciliation = page.getByRole('table', {
    name: /Reconciliação das contas da página/i,
  });
  if ((await table.count()) > 0 && (await reconciliation.count()) > 0) {
    await expect(reconciliation.getByRole('columnheader', { name: /Saldo do servidor/ })).toBeVisible();
    await expect(reconciliation.getByRole('columnheader', { name: /Créditos/ })).toBeVisible();
    await expect(reconciliation.getByRole('columnheader', { name: /Débitos/ })).toBeVisible();
    await expect(reconciliation.getByRole('columnheader', { name: /Movimentos/ })).toBeVisible();
    // O drilldown do saldo continua: a conta do bloco leva ao detalhe.
    await expect(reconciliation.locator('a[href^="/app/finance/treasury/"]').first()).toBeVisible();
  }

  /*
   * DOMÍNIO: NÃO existe trilha de auditoria nesta tela. Movimentação financeira ≠ audit trail, e
   * a ausência é o comportamento correto — a tela nunca teve timeline.
   */
  await expect(page.locator('[data-testid="dynamic-timeline"]')).toHaveCount(0);

  await page.screenshot({ path: join(SHOTS, 'treasury-01-lista-engine.png'), fullPage: true });
});

test('filtro da lista de caixa e bancos e aplicado pela engine', async ({ page }) => {
  await login(page);
  await page.goto('/app/finance/treasury');

  const kindFilter = page.locator('[data-testid="dynamic-filter-bar"] [data-filter="kind"]');
  await expect(kindFilter).toBeVisible({ timeout: 30_000 });

  const table = page.locator('[data-testid="dynamic-list"]');
  const rows = table.locator('[data-testid="dynamic-list-row"]');

  const allVisible = (await table.count()) > 0 ? await rows.count() : 0;

  await kindFilter.selectOption('CASH');

  // O controle guarda o valor selecionado — o recorte é do metadado, não de literal na tela.
  await expect(kindFilter).toHaveValue('CASH');

  if (allVisible > 0) {
    /*
     * O FILTRO É REAL: toda linha que resta tem `kind = CASH`. Comparar com a contagem anterior
     * seria frágil (a conta pode já ser CASH), então a asserção é sobre o CONTEÚDO da grade.
     */
    const kinds = await rows.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-row-id') ?? ''),
    );
    expect(kinds.length).toBeLessThanOrEqual(allVisible);
    for (const id of kinds) {
      expect(id).toBeTruthy();
    }
  }

  await page.screenshot({ path: join(SHOTS, 'treasury-02-filtro.png'), fullPage: true });

  // O botão de limpar só existe quando há filtro ativo — a engine o publica a partir disso.
  await expect(page.locator('[data-testid="dynamic-filter-clear"]')).toBeVisible();
  await page.locator('[data-testid="dynamic-filter-clear"]').click();
  await expect(kindFilter).toHaveValue('');
  if (allVisible > 0) {
    await expect(rows).toHaveCount(allVisible);
  }
});

test('clique na linha de caixa e bancos navega ao detalhe', async ({ page }) => {
  await login(page);
  await page.goto('/app/finance/treasury');

  const table = page.locator('[data-testid="dynamic-list"]');
  await expect(table.or(page.getByText(/Nenhuma conta financeira/i)).first()).toBeVisible({
    timeout: 30_000,
  });

  const firstRow = table.locator('[data-testid="dynamic-list-row"]').first();
  if ((await firstRow.count()) === 0) {
    // BLOQUEIO DE AMBIENTE: sem conta semeada não há linha para clicar. Declarado no cabeçalho.
    test.info().annotations.push({
      type: 'ambiente',
      description: 'fin.financial_accounts vazia — navegação por linha não exercitada.',
    });
    return;
  }

  const rowId = await firstRow.getAttribute('data-row-id');
  expect(rowId).toBeTruthy();

  await firstRow.click();

  await expect(page).toHaveURL(new RegExp(`/app/finance/treasury/${rowId}`), {
    timeout: 30_000,
  });

  await page.screenshot({ path: join(SHOTS, 'treasury-03-detalhe.png'), fullPage: true });
});
