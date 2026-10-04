/**
 * PROVA E2E — as views V4 dirigidas pelo METADATA STORE.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTE SPEC EXISTE, E O QUE ELE SUBSTITUI
 *
 * A bancada (`/app/admin/view-lab`) prova o RENDERIZADOR: dado um layout, a view desenha
 * certo. Ela NÃO prova o CANAL — que a view declarada em `meta.views` chega à tela. Eram
 * dois gaps reais:
 *
 *   GAP_DE_BANCO  `meta_views_type_chk` recusava 'pivot'/'tree'/'graph' (constraint de 0084)
 *   GAP_DE_API    as 5 rotas de /api/v1/meta eram todas GET; escrever dava 404
 *
 * Ambos foram fechados (migration 0088 + rotas de escrita). Este spec é o que trava a
 * regressão: se o CHECK voltar a estreitar, ou se alguém remover as rotas, ele cai.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * A PROVA INVERSA É A QUE IMPORTA
 *
 * Ver a aba aparecer NÃO prova que ela veio do store — poderia estar numa lista fixa em JSX.
 * Por isso a prova decisiva é o INVERSO: remover a view por SQL faz a aba DESAPARECER, sem
 * deploy e sem reload de bundle. É este teste que distingue "views como dados" de "views
 * escritas no componente".
 */
import { expect, test, type Page } from '@playwright/test';
import { LOGIN, PASSWORD } from './journey-credentials';
import { dropView, ensureView } from './v4-helpers';

const ENTITY = 'service-orders';
const WEB_URL = process.env['CISNE_JOURNEY_WEB_URL'] ?? 'http://127.0.0.1:5173';

const STORE_VIEWS = {
  pivot: { groupBy: ['status'], aggregateOp: 'count' },
  tree: { parentField: 'unit_id', labelField: 'order_number' },
  graph: { categoryField: 'status', chartType: 'bar', aggregateOp: 'count' },
} as const;

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/^usuário/i).fill(LOGIN);
  await page.getByLabel(/^senha/i).fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 30_000 });
}

async function openServiceOrders(page: Page): Promise<void> {
  await page.goto('/app/service-orders');
  await expect(page.locator('[data-testid="dynamic-view-switcher"]')).toBeVisible({
    timeout: 30_000,
  });
}

test.describe('V4 — as views do metadata store dirigem a tela', () => {
  test.beforeAll(async () => {
    // Garante os três registros no store — o CHECK ampliado por 0088 é pré-requisito.
    await ensureView(ENTITY, 'pivot', 'Tabela dinâmica', STORE_VIEWS.pivot);
    await ensureView(ENTITY, 'tree', 'Árvore por unidade', STORE_VIEWS.tree);
    await ensureView(ENTITY, 'graph', 'Gráfico por estado', STORE_VIEWS.graph);
  });

  test('as tres abas existem porque o STORE as declara', async ({ page }) => {
    await login(page);
    await openServiceOrders(page);

    for (const viewType of Object.keys(STORE_VIEWS)) {
      const tab = page.locator(`[data-view-type="${viewType}"]`);
      await expect(tab, `aba ${viewType} deve existir`).toBeVisible({ timeout: 30_000 });
      // `data-view-supported` prova que a engine reconhece o tipo — nao e aba decorativa.
      await expect(tab).toHaveAttribute('data-view-supported', 'true');
    }
  });

  test('PIVOT renderiza >= 4 celulas e um total, com eixo declarado no DOM', async ({ page }) => {
    await login(page);
    await openServiceOrders(page);
    await page.locator('[data-view-type="pivot"]').click();

    const pivot = page.locator('[data-testid="dynamic-pivot"]');
    await expect(pivot).toBeVisible({ timeout: 30_000 });
    await expect(pivot).toHaveAttribute('data-group-by', 'status');
    await expect(pivot).toHaveAttribute('data-aggregate-op', 'count');

    await expect
      .poll(async () => page.locator('[data-pivot-cell]').count(), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(4);
    expect(await page.locator('[data-pivot-total]').count()).toBeGreaterThanOrEqual(1);
  });

  test('TREE renderiza >= 2 nos, com o eixo de hierarquia declarado', async ({ page }) => {
    await login(page);
    await openServiceOrders(page);
    await page.locator('[data-view-type="tree"]').click();

    const tree = page.locator('[data-testid="dynamic-tree"]');
    await expect(tree).toBeVisible({ timeout: 30_000 });
    await expect(tree).toHaveAttribute('data-parent-field', 'unit_id');

    await expect
      .poll(async () => page.locator('[data-tree-node]').count(), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(2);
  });

  test('GRAPH renderiza >= 2 barras, com eixo e medida declarados', async ({ page }) => {
    await login(page);
    await openServiceOrders(page);
    await page.locator('[data-view-type="graph"]').click();

    const graph = page.locator('[data-testid="dynamic-graph"]');
    await expect(graph).toBeVisible({ timeout: 30_000 });
    await expect(graph).toHaveAttribute('data-category-field', 'status');

    await expect
      .poll(async () => page.locator('[data-graph-bar]').count(), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(2);
  });

  test('PROVA INVERSA — remover a view no STORE faz a aba desaparecer, sem deploy', async ({
    page,
  }) => {
    /*
     * A prova que distingue "views como dados" de "abas em JSX".
     *
     * Se a lista de abas estivesse escrita no componente, apagar o registro em `meta.views`
     * não teria efeito nenhum. O DELETE não toca em TypeScript, não recompila e não recarrega
     * bundle — só muda o banco.
     */
    await login(page);
    await openServiceOrders(page);
    await expect(page.locator('[data-view-type="graph"]')).toBeVisible({ timeout: 30_000 });

    try {
      await dropView(ENTITY, 'graph');

      // Recarrega a PÁGINA (não o bundle): a engine relê o metadado e a aba some.
      await page.reload();
      await expect(page.locator('[data-testid="dynamic-view-switcher"]')).toBeVisible({
        timeout: 30_000,
      });

      await expect(
        page.locator('[data-view-type="graph"]'),
        'A aba deveria sumir quando a view sai do store — se continuar, e lista fixa em JSX.',
      ).toHaveCount(0);

      // As demais permanecem: a remoção foi cirúrgica, não uma quebra do switcher.
      await expect(page.locator('[data-view-type="pivot"]')).toBeVisible();
      await expect(page.locator('[data-view-type="tree"]')).toBeVisible();
    } finally {
      await ensureView(ENTITY, 'graph', 'Gráfico por estado', STORE_VIEWS.graph);
    }
  });

  test('a capacidade vem do BACKEND — o bundle nao foi recompilado na prova', async ({ page }) => {
    /*
     * Reforço da prova inversa: reafirmar a view no store faz a aba VOLTAR, ainda na mesma
     * sessão de browser e sem redeploy. Ida e volta provam que o eixo é o banco.
     */
    await login(page);
    await openServiceOrders(page);

    await ensureView(ENTITY, 'graph', 'Gráfico por estado', STORE_VIEWS.graph);
    await page.reload();

    const graphTab = page.locator('[data-view-type="graph"]');
    await expect(graphTab).toBeVisible({ timeout: 30_000 });
    await expect(graphTab).toHaveAttribute('data-view-supported', 'true');

    await graphTab.click();
    await expect(page.locator('[data-testid="dynamic-graph"]')).toBeVisible({ timeout: 30_000 });
    expect(page.url()).toContain('view=graph');
    expect(WEB_URL).toBeTruthy();
  });
});
