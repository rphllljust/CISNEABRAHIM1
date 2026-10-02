import { expect, test, type Page } from '@playwright/test';
import { requireJourneyLogin, requireJourneyPassword } from './journey-credentials';

/**
 * V2 · AGGREGATIONS — BLOQUEADA · sem coluna agregável na view atual.
 *
 * O QUE A ENGINE FAZ (e continua fazendo): totaliza por coluna as colunas que a view `list`
 * EXIBE, usando o `aggregation` declarado em `meta.fields`. O total sai do conjunto exibido —
 * a engine não pede soma ao servidor, porque não existe endpoint para isso.
 *
 * POR QUE ESTE ARQUIVO NÃO PROVA UM TOTAL: varridas as 9 entidades do store, existe UMA ÚNICA
 * declaração de `aggregation` em todo o metadado — `service-orders.row_version = sum`. E
 * `row_version` NÃO está entre as colunas da view `list` de service-orders:
 *
 *     list cols = [order_number, internal_code, status, unit_id, centro_custo, created_at]
 *
 * Como a engine totaliza POR COLUNA RENDERIZADA, a célula `[data-total-field="row_version"]`
 * não pode existir — a asserção anterior era insatisfazível, não "falhando".
 *
 * O caminho óbvio (declarar `aggregation=sum` em `payables.principal`, que é `currency` e ESTÁ
 * na view) é uma alteração de METADADO — banco/migration — fora do escopo autorizado desta
 * sessão. Fica declarado como bloqueio, não contornado.
 *
 * O QUE ESTE TESTE PROVA ENQUANTO ISSO: o CONTRATO do rodapé. Se alguma coluna exibida declarar
 * agregação, ela TEM de aparecer no rodapé com o `data-aggregate-kind` correspondente. Hoje
 * nenhuma declara, então o rodapé se abstém — e abster-se é o comportamento correto: um total de
 * coluna que a view não mostra seria número sem dono.
 */
const LOGIN = requireJourneyLogin();
const PASSWORD = requireJourneyPassword();

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/^usuário/i).fill(LOGIN);
  await page.getByLabel(/^senha/i).fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 30_000 });
}

/**
 * Colunas da view `list` que declararam `aggregation`, lidas do metadado que a TELA consome.
 *
 * Lê da API (e não de SQL) de propósito: é o mesmo insumo que a engine recebe. Uma declaração
 * que exista só no banco, sem chegar à projeção, não é capacidade disponível na tela.
 */
async function declaredAggregates(
  page: Page,
): Promise<Array<{ entity: string; column: string; kind: string }>> {
  return page.evaluate(async () => {
    const entities = [
      'service-orders',
      'suppliers',
      'budgets',
      'payables',
      'receivables',
      'expenses',
      'cash-forecast',
      'treasury-accounts',
      'billing-records',
    ];
    const token = window.localStorage.getItem('cisne.accessToken') ?? '';
    const found: Array<{ entity: string; column: string; kind: string }> = [];

    for (const entity of entities) {
      const response = await fetch(`/api/v1/meta/${entity}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        continue;
      }
      const schema = (await response.json()) as {
        fields?: Array<{ name?: string; aggregation?: string }>;
        views?: Array<{ viewType?: string; layout?: { columns?: string[] } }>;
      };
      const listView = schema.views?.find((view) => view.viewType === 'list');
      const columns = listView?.layout?.columns ?? [];
      for (const field of schema.fields ?? []) {
        if (typeof field.aggregation !== 'string' || field.aggregation.trim() === '') {
          continue;
        }
        // Só conta o que a lista EXIBE — agregar coluna oculta não é capacidade da tela.
        if (field.name && columns.includes(field.name)) {
          found.push({ entity, column: field.name, kind: field.aggregation });
        }
      }
    }
    return found;
  });
}

test('rodape totaliza exatamente as colunas exibidas que declaram aggregation', async ({ page }) => {
  await login(page);

  const declared = await declaredAggregates(page);

  /*
   * O bloqueio é REGISTRADO, não mascarado. Enquanto nenhuma coluna exibida declarar agregação,
   * não há total a observar — e o rodapé não pode inventar um.
   */
  if (declared.length === 0) {
    test.info().annotations.push({
      type: 'BLOQUEADA',
      description:
        'aggregations — sem coluna agregável na view atual: a única declaração do store é service-orders.row_version, ausente da view list.',
    });
  }

  for (const target of declared) {
    await page.goto(`/app/${target.entity}`);
    await expect(page.locator('[data-testid="dynamic-list"]')).toBeVisible({ timeout: 30_000 });

    const footer = page.locator('[data-testid="dynamic-list-totals"]');
    await expect(footer).toBeVisible({ timeout: 30_000 });

    // O rótulo DIZ a agregação aplicada — a engine não esconde a origem do número.
    const aggregate = footer.locator(
      `[data-total-field="${target.column}"] [data-aggregate-kind="${target.kind}"]`,
    );
    await expect(aggregate).toBeVisible({ timeout: 30_000 });
    await expect(aggregate).toHaveText(/Total:/);

    const parsed = Number((await aggregate.innerText()).replace(/[^\d-]/g, ''));
    expect(Number.isFinite(parsed)).toBe(true);
  }

  /*
   * INVARIANTE QUE VALE SEMPRE, com ou sem declaração: o rodapé não publica total de coluna que
   * a view não exibe. É o que impede o número sem dono.
   */
  await page.goto('/app/service-orders');
  await expect(page.locator('[data-testid="dynamic-list"]')).toBeVisible({ timeout: 30_000 });
  const footerRow = page.locator('[data-testid="dynamic-list-totals"]');
  if ((await footerRow.count()) > 0) {
    const rendered = await footerRow
      .locator('[data-total-field]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-total-field')));
    expect(rendered).not.toContain('row_version');
  }
});
