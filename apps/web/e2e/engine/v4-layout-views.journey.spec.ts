import { expect, test, type Page } from '@playwright/test';
import { LOGIN, PASSWORD } from './journey-credentials';

/**
 * PROVA DE BROWSER — VIEWS DIRIGIDAS POR LAYOUT (pivot, tree, graph).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTA JORNADA USA A BANCADA, E NÃO O METADATA STORE
 *
 * Medido contra o banco real, `meta.views` tem:
 *
 *   CONSTRAINT meta_views_type_chk CHECK (view_type IN ('form','list','kanban','calendar'))
 *
 * `pivot`, `tree` e `graph` são capacidades da ENGINE, mas NÃO PODEM ser declaradas no store
 * hoje — ampliar o CHECK exige migration em `packages/database/`, que esta track não escreve
 * (GAP_DE_BANCO, declarado no relatório e visível na tela).
 *
 * A bancada `/app/admin/view-lab` dirige as três pelo MESMO caminho de código que uma view do
 * store usaria (`readLayout` → renderizador), com o schema e as LINHAS REAIS da entidade.
 * O layout é editável na tela — é o "SQL" desta bancada, já que o SQL está bloqueado pelo
 * CHECK. Se o renderizador ignorasse o layout, estas provas falhariam igual.
 *
 * A metade "o valor veio do banco" é o gap, e a bancada o declara em `[data-testid="lab-db-gap"]`
 * em vez de se passar por uma view do store.
 */

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/^usuário/i).fill(LOGIN);
  await page.getByLabel(/^senha/i).fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 30_000 });
}

async function openLab(page: Page): Promise<void> {
  await page.goto('/app/admin/view-lab');
  await expect(page.locator('[data-testid="view-lab"]')).toBeVisible({ timeout: 30_000 });
  // As linhas reais precisam ter chegado: sem dado, a prova de layout seria vazia.
  await expect
    .poll(
      async () => Number(await page.locator('[data-testid="view-lab"]').getAttribute('data-lab-rows')),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
}

/** Escreve um layout novo na bancada — o gesto equivalente ao UPDATE no store. */
async function setLabLayout(page: Page, kind: string, layout: Record<string, unknown>): Promise<void> {
  const area = page.locator(`[data-lab-layout="${kind}"]`);
  await area.fill(JSON.stringify(layout));
}

test.describe('V4 — bancada: PIVOT dirigido por layout', () => {
  test('renderiza >= 4 celulas e um total geral', async ({ page }) => {
    await login(page);
    await openLab(page);

    const pivot = page.locator('[data-testid="dynamic-pivot"]');
    await expect(pivot).toBeVisible({ timeout: 30_000 });
    await expect(pivot).toHaveAttribute('data-entity', 'service-orders');
    // A bancada declara o gap de banco em vez de fingir que a view veio do store.
    await expect(page.locator('[data-testid="lab-db-gap"]')).toContainText('GAP_DE_BANCO');

    const cells = page.locator('[data-pivot-cell]');
    await expect.poll(async () => cells.count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(4);

    // O TOTAL é exigido explicitamente pelo critério de aceite.
    expect(await page.locator('[data-pivot-total]').count()).toBeGreaterThanOrEqual(1);
    await expect(page.locator('[data-testid="pivot-scope"]')).toBeVisible();

    await page.screenshot({ path: 'test-results/v4/pivot-01-grade.png', fullPage: true });
  });

  test('mudar groupBy troca o eixo e o numero de linhas', async ({ page }) => {
    await login(page);
    await openLab(page);

    await setLabLayout(page, 'pivot', { groupBy: ['status'], aggregateOp: 'count' });
    await expect(page.locator('[data-testid="dynamic-pivot"]')).toHaveAttribute(
      'data-group-by',
      'status',
    );
    const rowsByStatus = await page.locator('[data-pivot-row]').count();
    expect(rowsByStatus).toBeGreaterThanOrEqual(4);

    // O eixo passa de `status` (5 valores) para `unit_id` (3 valores).
    await setLabLayout(page, 'pivot', { groupBy: ['unit_id'], aggregateOp: 'count' });
    await expect(page.locator('[data-testid="dynamic-pivot"]')).toHaveAttribute(
      'data-group-by',
      'unit_id',
    );
    const rowsByUnit = await page.locator('[data-pivot-row]').count();

    expect(rowsByUnit).not.toBe(rowsByStatus);
    await page.screenshot({ path: 'test-results/v4/pivot-02-eixo-unit-id.png', fullPage: true });
  });

  test('mudar aggregateOp troca a CONTAGEM por SUM', async ({ page }) => {
    await login(page);
    await openLab(page);

    await setLabLayout(page, 'pivot', { groupBy: ['status'], aggregateOp: 'count' });
    const first = page.locator('[data-pivot-cell]').first();
    const countValue = await first.getAttribute('data-pivot-cell');
    const countRows = await first.getAttribute('data-pivot-cell-rows');
    // `count` devolve exatamente o numero de linhas da celula.
    expect(countValue).toBe(countRows);

    await setLabLayout(page, 'pivot', {
      groupBy: ['status'],
      aggregate: 'row_version',
      aggregateOp: 'sum',
    });
    const pivot = page.locator('[data-testid="dynamic-pivot"]');
    await expect(pivot).toHaveAttribute('data-aggregate-op', 'sum');
    await expect(pivot).toHaveAttribute('data-aggregate', 'row_version');

    const sumValue = await page.locator('[data-pivot-cell]').first().getAttribute('data-pivot-cell');
    const sameRows = await page.locator('[data-pivot-cell]').first().getAttribute('data-pivot-cell-rows');
    expect(sumValue, 'sum nao pode coincidir com count neste conjunto.').not.toBe(sameRows);
  });

  test('columnField abre colunas por valor', async ({ page }) => {
    await login(page);
    await openLab(page);

    await setLabLayout(page, 'pivot', { groupBy: ['status'], aggregateOp: 'count' });
    const before = await page.locator('[data-testid="dynamic-pivot"] thead th').count();

    await setLabLayout(page, 'pivot', {
      groupBy: ['status'],
      aggregateOp: 'count',
      columnField: 'unit_id',
    });
    await expect(page.locator('[data-testid="dynamic-pivot"]')).toHaveAttribute(
      'data-column-field',
      'unit_id',
    );
    const after = await page.locator('[data-testid="dynamic-pivot"] thead th').count();
    expect(after).toBeGreaterThan(before);
  });

  test('sem groupBy DEGRADA E EXPLICA em vez de tabela vazia', async ({ page }) => {
    await login(page);
    await openLab(page);

    await setLabLayout(page, 'pivot', { aggregateOp: 'count' });
    const pivot = page.locator('[data-testid="dynamic-pivot"]');
    await expect(pivot).toHaveAttribute('data-pivot-gap', 'groupBy');
    await expect(pivot).toContainText('groupBy');
  });
});

test.describe('V4 — bancada: TREE dirigida por layout', () => {
  /*
   * FIXME — requires parent_id field — schema gap, next session.
   *
   * `so.service_orders` NÃO tem coluna auto-referente: não existe hierarquia de fato para
   * percorrer. Qualquer `parentField` que a bancada declare aponta para um valor que não é
   * identidade de outro nó, e a árvore degenera em raízes planas (profundidade 0, sem filho,
   * sem órfão). O `DynamicTree` está correto — os testes de DEGRADAÇÃO e de NÃO-TRAVAR
   * passam; o que falta é o DADO. Não se inventa coluna nem migration nesta track:
   * `packages/database/` é proibido. Bloqueio estrutural para a próxima sessão de backend.
   */
  test.fixme(
    'renderiza >= 2 nos e clicar EXPANDE e RECOLHE um ramo',
    { annotation: { type: 'fixme', description: 'requires parent_id field — schema gap, next session' } },
    async ({ page }) => {
      await login(page);
      await openLab(page);

      const tree = page.locator('[data-testid="dynamic-tree"]');
      await expect(tree).toBeVisible({ timeout: 30_000 });
      await expect(tree).toHaveAttribute('data-parent-field', 'unit_id');

      await expect
        .poll(async () => page.locator('[data-tree-node]').count(), { timeout: 30_000 })
        .toBeGreaterThanOrEqual(2);

      const toggle = page.locator('[data-tree-toggle]').first();
      await expect(toggle).toBeVisible();
      const parentId = await toggle.getAttribute('data-tree-toggle');
      const parentNode = page.locator(`[data-tree-node="${parentId}"]`);

      await expect(parentNode).toHaveAttribute('data-tree-expanded', 'true');
      const expandedCount = await page.locator('[data-tree-node]').count();

      await toggle.click();
      await expect(parentNode).toHaveAttribute('data-tree-expanded', 'false');
      const collapsedCount = await page.locator('[data-tree-node]').count();
      expect(collapsedCount).toBeLessThan(expandedCount);

      await toggle.click();
      await expect(parentNode).toHaveAttribute('data-tree-expanded', 'true');
      expect(await page.locator('[data-tree-node]').count()).toBe(expandedCount);

      await page.screenshot({ path: 'test-results/v4/tree-01-expandido.png', fullPage: true });
    },
  );

  test.fixme(
    'mudar parentField muda a PROFUNDIDADE',
    { annotation: { type: 'fixme', description: 'requires parent_id field — schema gap, next session' } },
    async ({ page }) => {
      await login(page);
      await openLab(page);

      await setLabLayout(page, 'tree', { parentField: 'unit_id', labelField: 'order_number' });
      await expect(page.locator('[data-testid="dynamic-tree"]')).toHaveAttribute(
        'data-parent-field',
        'unit_id',
      );
      const depth = async (): Promise<number> =>
        page
          .locator('[data-tree-node]')
          .evaluateAll((nodes) =>
            Math.max(...nodes.map((n) => Number(n.getAttribute('data-tree-depth') ?? 0))),
          );
      const depthByUnit = await depth();
      expect(depthByUnit).toBeGreaterThanOrEqual(1);

      await setLabLayout(page, 'tree', { parentField: 'status', labelField: 'order_number' });
      await expect(page.locator('[data-testid="dynamic-tree"]')).toHaveAttribute(
        'data-parent-field',
        'status',
      );
      expect(await depth()).not.toBe(depthByUnit);
    },
  );

  test('sem parentField DEGRADA E EXPLICA', async ({ page }) => {
    await login(page);
    await openLab(page);

    await setLabLayout(page, 'tree', { labelField: 'order_number' });
    const tree = page.locator('[data-testid="dynamic-tree"]');
    await expect(tree).toHaveAttribute('data-tree-gap', 'parentField');
    await expect(tree).toContainText('parentField');
  });

  test.fixme(
    'no sem pai presente vira RAIZ e se ANUNCIA como orfao (nao some)',
    { annotation: { type: 'fixme', description: 'requires parent_id field — schema gap, next session' } },
    async ({ page }) => {
      await login(page);
      await openLab(page);

      await setLabLayout(page, 'tree', { parentField: 'parent_id', labelField: 'order_number' });
      const tree = page.locator('[data-testid="dynamic-tree"]');
      await expect(tree).toHaveAttribute('data-parent-field', 'parent_id');

      const total = Number(await tree.getAttribute('data-tree-total'));
      await expect
        .poll(async () => page.locator('[data-tree-node]').count(), { timeout: 30_000 })
        .toBe(total);
      expect(await page.locator('[data-tree-orphan-badge]').count()).toBeGreaterThanOrEqual(1);
    },
  );

  test('hierarquia degenerada nao derruba a pagina', async ({ page }) => {
    await login(page);
    await openLab(page);

    // `idField` deixa de ser `id`: o parent nunca casa, e um render recursivo ingênuo travaria.
    await setLabLayout(page, 'tree', { parentField: 'unit_id', idField: 'order_number' });
    await expect(page.locator('[data-testid="dynamic-tree"]')).toBeVisible();
    await expect
      .poll(async () => page.locator('[data-tree-node]').count(), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(1);
    // A PÁGINA CONTINUA DE PÉ.
    await expect(page.locator('[data-testid="lab-db-gap"]')).toBeVisible();
  });
});

test.describe('V4 — bancada: GRAPH dirigido por layout', () => {
  test('renderiza >= 2 barras com rotulo, eixo e tipo declarados no DOM', async ({ page }) => {
    await login(page);
    await openLab(page);

    const graph = page.locator('[data-testid="dynamic-graph"]');
    await expect(graph).toBeVisible({ timeout: 30_000 });
    await expect(graph).toHaveAttribute('data-category-field', 'status');
    await expect(graph).toHaveAttribute('data-chart-type', 'bar');

    await expect
      .poll(async () => page.locator('[data-graph-bar]').count(), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(2);

    // Cada barra tem RÓTULO — o gráfico é verificável, não uma imagem opaca.
    const labels = await page
      .locator('[data-graph-bar]')
      .evaluateAll((bars) => bars.map((b) => b.getAttribute('data-graph-bar') ?? ''));
    expect(labels.every((label) => label.trim() !== '')).toBe(true);
    expect(labels).toContain('COMPLETED');

    await page.screenshot({ path: 'test-results/v4/graph-01-barras.png', fullPage: true });
  });

  test('mudar categoryField muda o eixo e o numero de barras', async ({ page }) => {
    await login(page);
    await openLab(page);

    const barsByStatus = await page.locator('[data-graph-bar]').count();
    await setLabLayout(page, 'graph', {
      categoryField: 'unit_id',
      chartType: 'bar',
      aggregateOp: 'count',
    });
    await expect(page.locator('[data-testid="dynamic-graph"]')).toHaveAttribute(
      'data-category-field',
      'unit_id',
    );
    const barsByUnit = await page.locator('[data-graph-bar]').count();
    expect(barsByUnit).not.toBe(barsByStatus);
  });

  test('mudar chartType muda o DESENHO (largura x altura)', async ({ page }) => {
    await login(page);
    await openLab(page);

    await setLabLayout(page, 'graph', {
      categoryField: 'status',
      chartType: 'bar',
      aggregateOp: 'count',
    });
    const barStyle = await page.locator('[data-graph-bar]').first().getAttribute('style');
    expect(barStyle ?? '').toContain('width');

    await setLabLayout(page, 'graph', {
      categoryField: 'status',
      chartType: 'column',
      aggregateOp: 'count',
    });
    await expect(page.locator('[data-testid="dynamic-graph"]')).toHaveAttribute(
      'data-chart-type',
      'column',
    );
    const columnStyle = await page.locator('[data-graph-bar]').first().getAttribute('style');
    expect(columnStyle ?? '', 'column deve dimensionar por ALTURA.').toContain('height');
  });

  test('mudar valueField para sum muda os valores das barras', async ({ page }) => {
    await login(page);
    await openLab(page);

    const countValues = await page
      .locator('[data-graph-bar]')
      .evaluateAll((bars) => bars.map((b) => b.getAttribute('data-graph-value')));

    await setLabLayout(page, 'graph', {
      categoryField: 'status',
      valueField: 'row_version',
      chartType: 'bar',
      aggregateOp: 'sum',
    });
    await expect(page.locator('[data-testid="dynamic-graph"]')).toHaveAttribute(
      'data-value-field',
      'row_version',
    );

    const sumValues = await page
      .locator('[data-graph-bar]')
      .evaluateAll((bars) => bars.map((b) => b.getAttribute('data-graph-value')));
    expect(sumValues).not.toEqual(countValues);
  });

  test('sem categoryField DEGRADA E EXPLICA', async ({ page }) => {
    await login(page);
    await openLab(page);

    await setLabLayout(page, 'graph', { chartType: 'bar' });
    const graph = page.locator('[data-testid="dynamic-graph"]');
    await expect(graph).toHaveAttribute('data-graph-gap', 'categoryField');
    await expect(graph).toContainText('categoryField');
  });

  test('chartType desconhecido desenha barras e AVISA qual valor nao foi reconhecido', async ({
    page,
  }) => {
    await login(page);
    await openLab(page);

    await setLabLayout(page, 'graph', {
      categoryField: 'status',
      chartType: 'donut',
      aggregateOp: 'count',
    });
    const graph = page.locator('[data-testid="dynamic-graph"]');
    await expect(graph).toHaveAttribute('data-chart-type', 'bar');
    await expect(page.locator('[data-testid="graph-type-gap"]')).toContainText('donut');
  });
});

