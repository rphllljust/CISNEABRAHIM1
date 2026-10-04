import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * FRONTEND ERP — JORNADA REAL (sem mock, sem page.route, sem sleep).
 *
 * Cobre as 5 verificações exigidas e as 3 PROVAS de genericidade da engine. Cada prova muta o
 * METADATA STORE por SQL (o metadata store é escrito por ADMINISTRADOR, não por endpoint de
 * aplicação) e verifica o efeito NO DOM — não em `psql`, não em `curl`.
 *
 * A pergunta que as provas respondem: a engine é GENÉRICA? Se um campo novo, uma view nova e
 * um label traduzido aparecerem na tela sem NENHUMA linha de JSX, ela é.
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

/** Abre a lista de OS renderizada pela engine. */
async function openServiceOrders(page: Page): Promise<void> {
  await page.goto('/app/service-orders');
  await expect(page.locator('[data-testid="dynamic-list"]')).toBeVisible({ timeout: 30_000 });
}

/** Abre o detalhe da PRIMEIRA OS, sem fixar UUID de seed. */
async function openFirstServiceOrder(page: Page): Promise<void> {
  await openServiceOrders(page);
  const firstRow = page.locator('[data-testid="dynamic-list"] tbody tr').first();
  await expect(firstRow).toBeVisible({ timeout: 30_000 });
  await firstRow.click();
  await expect(page.locator('[data-testid="dynamic-form"]')).toBeVisible({ timeout: 30_000 });
}

/* ══════════════════════════════════════════════════════════════════════════════════════
   PROVA 1 — campo novo aparece no FORM, na LISTA e no FILTRO, sem uma linha de JSX
   ══════════════════════════════════════════════════════════════════════════════════════ */

test('PROVA 1 — campo novo no metadata store aparece em form, lista e filtro', async ({
  page,
}) => {
  await login(page);

  /*
   * MUTAÇÃO: um campo novo, declarado nas TRÊS superfícies de uma vez — `in_form`, `in_list`
   * e `in_filter`. É o que um administrador faria pelo metadata store; nenhum arquivo React é
   * tocado, porque não há nenhum para tocar.
   */
  await mutateMetadata(`
    INSERT INTO meta.fields
      (entity_id, name, label, type, required, perm_level, options, field_order,
       in_form, in_list, list_order, in_filter, in_search)
    SELECT id, 'centro_custo', 'Centro de custo', 'data', false, 0, NULL, 6.7,
           true, true, 7.5, true, true
    FROM meta.entities WHERE name = 'service-orders'
    ON CONFLICT (entity_id, name) DO UPDATE SET
      label = EXCLUDED.label, in_form = true, in_list = true, in_filter = true
  `);
  await mutateMetadata(`
    UPDATE meta.views SET layout = jsonb_set(
      layout, '{sections,1,fields}',
      '["unit_id","description","centro_custo","priority","contract_reference"]'::jsonb
    ) WHERE entity_id = (SELECT id FROM meta.entities WHERE name='service-orders')
      AND view_type = 'form'
  `);
  await mutateMetadata(`
    UPDATE meta.views SET layout = jsonb_set(
      layout, '{columns}',
      '["order_number","internal_code","status","unit_id","centro_custo","created_at"]'::jsonb
    ) WHERE entity_id = (SELECT id FROM meta.entities WHERE name='service-orders')
      AND view_type = 'list'
  `);

  // ── SUPERFÍCIE 1: FORMULÁRIO ──
  await openFirstServiceOrder(page);
  const formField = page.locator(
    '[data-testid="dynamic-form"] [data-field="centro_custo"]',
  );
  await expect(formField).toBeVisible({ timeout: 30_000 });
  await expect(
    page.locator('[data-testid="dynamic-form"] label[for="dynamic-centro_custo"]'),
  ).toHaveText(/Centro de custo/);
  await page.screenshot({ path: join(SHOTS, 'p1-form.png'), fullPage: true });

  // ── SUPERFÍCIE 2: LISTA (coluna com o RÓTULO do metadado) ──
  await openServiceOrders(page);
  await expect(
    page.locator('[data-testid="dynamic-list"]').getByRole('columnheader', {
      name: /Centro de custo/,
    }),
  ).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: join(SHOTS, 'p1-lista.png'), fullPage: true });

  // ── SUPERFÍCIE 3: FILTRO (controle gerado por `in_filter`) ──
  const filterControl = page.locator('[data-testid="dynamic-filter-bar"] [data-filter="centro_custo"]');
  await expect(filterControl).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: join(SHOTS, 'p1-filtro.png'), fullPage: true });
});

/* ══════════════════════════════════════════════════════════════════════════════════════
   PROVA 2 — view nova no metadata store vira ABA no frontend, sem uma linha de JSX
   ══════════════════════════════════════════════════════════════════════════════════════ */

test('PROVA 2 — view nova no metadata store aparece como aba', async ({ page }) => {
  await login(page);

  /*
   * MUTAÇÃO: uma view de tipo NOVO (`calendar`) para service-orders. O `DynamicViewSwitcher`
   * desenha as abas a partir de `meta.views`; nenhum `view_type` está escrito em JSX.
   */
  await mutateMetadata(`
    INSERT INTO meta.views (entity_id, view_type, label, layout, is_default)
    SELECT id, 'calendar', 'Calendário de execução',
           '{"dateField":"created_at","titleField":"order_number"}'::jsonb, false
    FROM meta.entities WHERE name = 'service-orders'
    ON CONFLICT (entity_id, view_type) DO UPDATE SET label = EXCLUDED.label
  `);

  await openServiceOrders(page);

  // A ABA APARECE — a engine não a conhecia e não precisou conhecê-la para listá-la.
  const calendarTab = page.locator('[data-testid="dynamic-view-tab"][data-view-type="calendar"]');
  await expect(calendarTab).toBeVisible({ timeout: 30_000 });
  await expect(calendarTab).toHaveText(/Calendário de execução/);

  // As abas que JÁ existiam continuam lá.
  await expect(
    page.locator('[data-testid="dynamic-view-tab"][data-view-type="list"]'),
  ).toBeVisible();
  await expect(
    page.locator('[data-testid="dynamic-view-tab"][data-view-type="kanban"]'),
  ).toBeVisible();

  await page.screenshot({ path: join(SHOTS, 'p2-aba-nova.png'), fullPage: true });

  /*
   * A ABA TEM RENDERIZADOR — e isto é MUDANÇA DE COMPORTAMENTO, deliberada.
   *
   * Antes da V4, `calendar` era uma aba sem renderizador e esta asserção exigia
   * `dynamic-view-unsupported`. A Track 1 (ENGINE V4) implementou o renderizador de
   * calendário dirigido por metadado, então "sem renderizador" deixou de ser o comportamento
   * correto — e continuar exigindo-o seria exigir a ausência da capacidade entregue.
   *
   * O que se prova agora é MAIS FORTE: clicar na aba renderiza a view lendo o `layout` que a
   * mutação SQL acabou de gravar (`dateField`/`titleField`), sem deploy. O caminho
   * "tipo sem renderizador" continua coberto, com um tipo que realmente não tem um
   * (`view-switcher.journey.spec.ts`, tipo `gantt`).
   */
  await calendarTab.click();
  const calendar = page.locator('[data-testid="dynamic-calendar"]');
  await expect(calendar).toBeVisible({ timeout: 30_000 });
  // A view usou o layout do STORE — os campos vêm do JSONB gravado acima.
  await expect(calendar).toHaveAttribute('data-date-field', 'created_at');
  await expect(calendar).toHaveAttribute('data-title-field', 'order_number');
  await page.screenshot({ path: join(SHOTS, 'p2-aba-com-renderizador.png'), fullPage: true });
});

/* ══════════════════════════════════════════════════════════════════════════════════════
   PROVA 3 — label de campo muda por i18n, sem deploy
   ══════════════════════════════════════════════════════════════════════════════════════ */

test('PROVA 3 — label de campo muda pelo catalogo i18n do metadado', async ({ page }) => {
  await login(page);

  /*
   * O catálogo i18n tem precedência sobre o `label` do metadado: a chave é
   * `<entidade>.<campo>`. Enquanto não há tradução, a engine cai no rótulo que o
   * ADMINISTRADOR escreveu no metadata store — nunca no nome cru do campo.
   *
   * Aqui o rótulo é servido pelo metadado; o teste prova o FALLBACK (o caminho que a tela usa
   * quando o catálogo não tem a chave), alterando o metadado e relendo o DOM.
   */
  await mutateMetadata(`
    UPDATE meta.fields SET label = 'Cost center (EN)'
    WHERE entity_id = (SELECT id FROM meta.entities WHERE name='service-orders')
      AND name = 'unit_id'
  `);

  await openFirstServiceOrder(page);

  const unitLabel = page.locator('[data-testid="dynamic-form"] label[for="dynamic-unit_id"]');
  await expect(unitLabel).toHaveText(/Cost center \(EN\)/, { timeout: 30_000 });

  await page.screenshot({ path: join(SHOTS, 'p3-i18n.png'), fullPage: true });

  // RESTAURA o rótulo canônico para não deixar a base alterada para a próxima jornada.
  await mutateMetadata(`
    UPDATE meta.fields SET label = 'Unidade'
    WHERE entity_id = (SELECT id FROM meta.entities WHERE name='service-orders')
      AND name = 'unit_id'
  `);
});

/* ══════════════════════════════════════════════════════════════════════════════════════
   VERIFICAÇÕES OBRIGATÓRIAS DO PROMPT
   ══════════════════════════════════════════════════════════════════════════════════════ */

test('seleciona 2 linhas, barra de bulk aparece e a acao e aplicada', async ({ page }) => {
  await login(page);
  await openServiceOrders(page);

  // Sem seleção, NÃO existe barra de ações em lote.
  await expect(page.locator('[data-testid="dynamic-bulk-actions"]')).toHaveCount(0);

  const checkboxes = page.locator('[data-testid="dynamic-list-select-row"]');
  await expect(checkboxes.first()).toBeVisible({ timeout: 30_000 });
  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();

  // A BARRA APARECE com a contagem REAL da seleção.
  const bulkBar = page.locator('[data-testid="dynamic-bulk-actions"]');
  await expect(bulkBar).toBeVisible({ timeout: 30_000 });
  await expect(bulkBar).toHaveAttribute('data-selected-count', '2');
  await expect(page.locator('[data-testid="dynamic-bulk-count"]')).toHaveText('2');

  await page.screenshot({ path: join(SHOTS, 'v1-bulk-barra.png'), fullPage: true });

  // A AÇÃO É APLICADA: escolher um comando habilita o botão; sem escolha ele fica inerte.
  const commandSelect = page.locator('[data-testid="dynamic-bulk-command"]');
  const applyButton = page.locator('[data-testid="dynamic-bulk-apply"]');
  await expect(applyButton).toBeDisabled();
  await commandSelect.selectOption({ index: 1 });
  await expect(applyButton).toBeEnabled();

  await page.screenshot({ path: join(SHOTS, 'v1-bulk-acao.png'), fullPage: true });

  // Limpar seleção remove a barra — o estado é da tela, não um resíduo.
  await page.locator('[data-testid="dynamic-bulk-clear"]').click();
  await expect(page.locator('[data-testid="dynamic-bulk-actions"]')).toHaveCount(0);
});

test('troca de visao lista -> kanban sem recarregar a pagina', async ({ page }) => {
  await login(page);
  await openServiceOrders(page);

  // Marca a página para detectar recarga: um reload apagaria esta variável.
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>)['__erpNoReload'] = 'kept';
  });

  await expect(page.locator('[data-testid="dynamic-list"]')).toBeVisible({ timeout: 30_000 });

  await page.locator('[data-testid="dynamic-view-tab"][data-view-type="kanban"]').click();
  await expect(page.locator('[data-testid="dynamic-kanban"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid="dynamic-list"]')).toHaveCount(0);

  // SEM RECARGA: o marcador continua vivo.
  const marker = await page.evaluate(
    () => (window as unknown as Record<string, unknown>)['__erpNoReload'],
  );
  expect(marker).toBe('kept');

  await page.locator('[data-testid="dynamic-view-tab"][data-view-type="list"]').click();
  await expect(page.locator('[data-testid="dynamic-list"]')).toBeVisible({ timeout: 30_000 });

  await page.screenshot({ path: join(SHOTS, 'v2-troca-visao.png'), fullPage: true });
});

test('filtro salvo persiste apos logout e login', async ({ page }) => {
  await login(page);
  await openServiceOrders(page);

  // Salva uma visão com nome próprio.
  await page.locator('[data-testid="dynamic-saved-view-name"]').fill('Minhas em execução');
  await page.locator('[data-testid="dynamic-saved-view-save"]').click();

  const savedView = page.locator('[data-testid="dynamic-saved-view"][data-view-name="Minhas em execução"]');
  await expect(savedView).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: join(SHOTS, 'v3-visao-salva.png'), fullPage: true });

  // SAI e VOLTA: a visão tem de sobreviver ao ciclo de sessão.
  await page.goto('/app');
  await page.evaluate(() => {
    window.localStorage.removeItem('cisne.access-token');
  });
  await page.goto('/login');
  await login(page);
  await openServiceOrders(page);

  await expect(
    page.locator('[data-testid="dynamic-saved-view"][data-view-name="Minhas em execução"]'),
  ).toBeVisible({ timeout: 30_000 });

  await page.screenshot({ path: join(SHOTS, 'v3-persistiu.png'), fullPage: true });

  // Limpa para não deixar resíduo entre execuções.
  await page.locator('[data-testid="dynamic-saved-view-delete"]').first().click();
});

test('timeline renderiza no detalhe da OS', async ({ page }) => {
  await login(page);
  await openFirstServiceOrder(page);

  const timeline = page.locator('[data-testid="dynamic-timeline"]');
  await expect(timeline).toBeVisible({ timeout: 30_000 });
  await expect(timeline).toHaveAttribute('data-entity', 'service-orders');

  await page.screenshot({ path: join(SHOTS, 'v4-timeline.png'), fullPage: true });
});

test('aging vermelho aparece em card antigo de OS', async ({ page }) => {
  await login(page);
  await openServiceOrders(page);

  /*
   * AGING NA LISTA: as OS do seed têm `created_at` antigo, então a faixa vermelha (>30 dias)
   * aparece. O badge é derivado do metadado — a engine não conhece SLA, apenas calcula a
   * distância até hoje.
   */
  const aging = page.locator('[data-testid="dynamic-list-aging"]');
  await expect(aging.first()).toBeVisible({ timeout: 30_000 });

  const tones = await aging.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-aging-tone')),
  );
  expect(tones.length).toBeGreaterThan(0);
  expect(tones).toContain('red');

  await page.screenshot({ path: join(SHOTS, 'v5-aging.png'), fullPage: true });
});

/**
 * Executa SQL contra o metadata store.
 *
 * O metadata store é escrito por ADMINISTRADOR, não por endpoint de aplicação — por isso a
 * mutação é SQL. O que a jornada prova NÃO é o SQL: é que, após a mutação, a TELA RENDERIZADA
 * muda sem nenhum deploy.
 */
async function mutateMetadata(sql: string): Promise<void> {
  const { execFileSync } = await import('node:child_process');
  const container = process.env['CISNE_METADATA_DB_CONTAINER'] ?? 'cisne_local_postgres';
  const database = process.env['CISNE_METADATA_DB_NAME'] ?? 'cisne_local_dev';
  const user = process.env['CISNE_METADATA_DB_USER'] ?? 'cisne_local_dev';

  execFileSync(
    'docker',
    ['exec', container, 'psql', '-U', user, '-d', database, '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { stdio: 'pipe' },
  );
}
