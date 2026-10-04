import { expect, test, type Page } from '@playwright/test';

/**
 * DESPESAS — PARIDADE E RENDERIZAÇÃO REAL.
 *
 * A tela foi migrada para a engine. Este arquivo prova DUAS coisas que o teste condicional não
 * provaria:
 *
 *   1. as CINCO colunas do original continuam na grade — em especial "Centro de custo", que a
 *      view `list` do metadado NÃO declara e que a projeção da tela reabilita;
 *   2. a grade RENDERIZA as despesas reais, com valor, data e situação vindos do servidor.
 *
 * Roda contra a aplicação real (API + PostgreSQL + autorização). Nenhum `page.route`, nenhum
 * `fulfill`. `fin.expenses` tem 3 registros na base de desenvolvimento.
 */
const LOGIN = process.env['CISNE_JOURNEY_LOGIN']?.trim();
const PASSWORD = process.env['CISNE_JOURNEY_PASSWORD']?.trim();

test.skip(
  !LOGIN || !PASSWORD,
  'CONFIGURATION_ERROR: CISNE_JOURNEY_LOGIN/PASSWORD são exigidos para a prova de paridade.',
);

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/^usuário/i).fill(LOGIN!);
  await page.getByLabel(/^senha/i).fill(PASSWORD!);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 30_000 });
}

test('a lista de despesas preserva as cinco colunas do original', async ({ page }) => {
  await login(page);
  await page.goto('/app/finance/expenses');

  const list = page.locator('[data-testid="dynamic-list"]');
  await expect(list).toBeVisible({ timeout: 30_000 });
  await expect(list).toHaveAttribute('data-entity', 'expenses');

  /*
   * PARIDADE DE COLUNAS — a ordem é a do JSX original. "Centro de custo" é a coluna que a
   * projeção da tela existe para salvar: sem ela, `useColumns` devolveria só o que a view `list`
   * declara e a coluna sumiria em silêncio.
   *
   * O rótulo da quarta coluna é "Valor total" — o do METADADO. O JSX original escrevia "Valor" à
   * mão; como a grade agora é dirigida pelo metadado, o rótulo é o que `meta.fields` declara.
   * Asserção sobre o rótulo real, não sobre o texto que o autor do teste esperava.
   */
  const headers = list.locator('thead th');
  const labels = (await headers.allTextContents()).map((text) => text.trim());
  expect(labels).toEqual([
    'Descrição',
    'Centro de custo',
    'Vencimento',
    'Valor total',
    'Situação',
  ]);

  /*
   * CINCO COLUNAS, EXATAMENTE. Nenhuma perdida, nenhuma inventada — em especial NENHUMA coluna
   * de "Aging": o `DynamicList` a derivaria de `created_at` sozinho, e o original não a tinha.
   */
  expect(labels).not.toContain('Aging');
  await expect(list).toHaveAttribute('data-column-count', '5');
});

test('a grade renderiza as despesas reais com valor, data e situacao', async ({ page }) => {
  await login(page);
  await page.goto('/app/finance/expenses');

  const list = page.locator('[data-testid="dynamic-list"]');
  await expect(list).toBeVisible({ timeout: 30_000 });

  const rows = list.locator('[data-testid="dynamic-list-row"]');
  await expect(rows.first()).toBeVisible();

  // O servidor tem despesas: a grade NÃO pode estar vazia.
  const rowCount = await rows.count();
  expect(rowCount).toBeGreaterThan(0);

  const first = rows.first();
  await expect(first).toHaveAttribute('data-row-id', /.+/);

  // VALOR formatado em moeda pelo servidor — não string crua nem ISO.
  await expect(first).toContainText(/R\$\s?\d[\d.]*,\d{2}/);

  /*
   * VENCIMENTO como data HUMANA, não ISO cru. O controle `DateTime` formata em pt-BR longo
   * ("1 de out. de 2026"), então a asserção é sobre a FORMA HUMANA — e, sobretudo, sobre a
   * ausência do ISO que o DTO entrega (`2026-10-01`).
   */
  const firstRowText = (await first.textContent()) ?? '';
  expect(firstRowText).toMatch(/\d{1,2}\s+de\s+\p{L}+\.?\s+de\s+\d{4}/u);
  expect(firstRowText).not.toMatch(/\d{4}-\d{2}-\d{2}/);

  /*
   * DRILLDOWN — navegação REAL, não inspeção de atributo.
   *
   * A linha inteira é o caminho de navegação (`onRowClick` → rota do detalhe). O clique é feito
   * na própria linha, que é exatamente o gesto do operador, e o destino é verificado pela URL.
   */
  const rowId = await first.getAttribute('data-row-id');
  expect(rowId).toBeTruthy();

  await first.click();

  await expect(page).toHaveURL(new RegExp(`/app/finance/expenses/${rowId}$`), {
    timeout: 30_000,
  });
  // E o destino é o detalhe da despesa — não uma lista vazia nem uma página de erro.
  await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/não tem permissão|não encontrad/i)).toHaveCount(0);
});

test('a busca por descricao viaja ao servidor e o recorte zera a grade sem desmonta-la', async ({
  page,
}) => {
  await login(page);
  await page.goto('/app/finance/expenses');

  const list = page.locator('[data-testid="dynamic-list"]');
  await expect(list).toBeVisible({ timeout: 30_000 });
  const before = await list.getAttribute('data-list-count');
  expect(Number(before)).toBeGreaterThan(0);

  /*
   * TERMO QUE CASA. Além de zerar, a prova precisa mostrar que o recorte POSITIVO funciona — um
   * termo real devolve menos linhas que o conjunto inteiro, e todas contêm o termo.
   */
  const search = page.getByLabel('Buscar');
  await search.fill('EPI');
  await search.press('Enter');

  await expect(list).toBeVisible({ timeout: 30_000 });
  const matched = Number(await list.getAttribute('data-list-count'));
  expect(matched).toBeGreaterThan(0);
  expect(matched).toBeLessThan(Number(before));
  const matchedRows = list.locator('[data-testid="dynamic-list-row"]');
  for (let index = 0; index < matched; index += 1) {
    await expect(matchedRows.nth(index)).toContainText(/EPI/i);
  }

  /*
   * ZERO RESULTADO FILTRADO ≠ BASE SEM DADOS (baseline ERP). Termo que não casa: o SERVIDOR
   * responde vazio, e o painel explica o RECORTE — nomeando a saída. O que NÃO pode acontecer é a
   * tela afirmar "nenhuma despesa registrada ainda", que é outra coisa e é falsa.
   */
  await search.fill('zzz-nao-existe-zzz');
  await search.press('Enter');

  await expect(
    page.getByText(/Nenhuma despesa encontrada para os filtros selecionados/i),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Ajuste ou limpe os filtros/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /Ver todas as despesas/i })).toBeVisible();
  // A afirmação de base vazia NÃO aparece — são estados distintos, e a tela os distingue.
  await expect(page.getByText(/Nenhuma despesa registrada ainda/i)).toHaveCount(0);

  // LIMPAR restaura o conjunto ORIGINAL — o filtro não é destrutivo.
  await page.getByRole('button', { name: /Ver todas as despesas/i }).click();
  await expect(list).toBeVisible({ timeout: 30_000 });
  await expect(list).toHaveAttribute('data-list-count', before!, { timeout: 30_000 });
  await expect(page.getByLabel('Buscar')).toHaveValue('');
});

test('o recorte de status vindo da URL chega ao servidor', async ({ page }) => {
  await login(page);

  // O Ctrl+K promete `?status=...`; a tela honra o parâmetro em vez de descartá-lo.
  await page.goto('/app/finance/expenses?status=SUBMITTED');

  /*
   * `exact: true` desempata: o badge de situação de cada linha tem `aria-label="Status: …"`, então
   * um `getByLabel('Status')` casaria também com ele. O alvo é o CONTROLE de filtro.
   */
  const statusControl = page.getByLabel('Status', { exact: true });
  await expect(statusControl).toHaveValue('SUBMITTED', { timeout: 30_000 });

  /*
   * E o recorte é do SERVIDOR: toda linha exibida está em "Enviada". Uma máscara local sobre uma
   * página não filtrada também passaria no `toHaveValue` acima — esta asserção é a que prova que
   * o parâmetro chegou ao backend.
   */
  const list = page.locator('[data-testid="dynamic-list"]');
  const empty = page.getByText(/Nenhuma despesa encontrada para os filtros selecionados/i);
  await expect(list.or(empty).first()).toBeVisible({ timeout: 30_000 });

  if ((await list.count()) > 0) {
    const rows = list.locator('[data-testid="dynamic-list-row"]');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      await expect(rows.nth(index)).toContainText(/Enviada/);
    }
  }
});
