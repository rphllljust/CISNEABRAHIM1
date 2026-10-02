import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { requireJourneyLogin, requireJourneyPassword } from './journey-credentials';

/**
 * ENGINE DE ERP — GENERICIDADE PROVADA EM ORDEM DE SERVIÇO (sem mock, sem page.route, sem sleep).
 *
 * A pergunta desta jornada NÃO é "a tela funciona": é "a engine é GENÉRICA ou é
 * suppliers-specific?". As três mutações abaixo são ESTRUTURALMENTE AS MESMAS que a jornada de
 * fornecedores executa — campo novo, transição nova, ordem nova — aplicadas a OUTRA entidade,
 * com OUTRO workflow e OUTRA view.
 *
 * Se as três passarem sem uma linha nova na engine, a engine é genérica. O SQL NÃO é a prova:
 * a prova é o DOM RENDERIZADO mudar depois da mutação, sem deploy.
 */
const LOGIN = requireJourneyLogin();
const PASSWORD = requireJourneyPassword();
const SHOTS = process.env['CISNE_JOURNEY_SHOTS'] ?? join(process.cwd(), 'test-results', 'engine');
mkdirSync(SHOTS, { recursive: true });

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/^usuário/i).fill(LOGIN);
  await page.getByLabel(/^senha/i).fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 30_000 });
}

/** Abre a lista de OS renderizada pela engine. */
async function openEngineList(page: Page): Promise<void> {
  await page.goto('/app/service-orders');
  await expect(page.locator('[data-testid="dynamic-list"]')).toBeVisible({ timeout: 30_000 });
}

/**
 * Abre o detalhe da PRIMEIRA OS.
 *
 * Não fixa um id: o registro vem do que a listagem real devolve, então a jornada não depende
 * de um UUID de seed que pode deixar de existir.
 */
async function openFirstServiceOrder(page: Page): Promise<void> {
  await openEngineList(page);
  const firstRow = page.locator('[data-testid="dynamic-list"] tbody tr').first();
  await expect(firstRow).toBeVisible({ timeout: 30_000 });
  await firstRow.click();
  await expect(page.locator('[data-testid="dynamic-form"]')).toBeVisible({ timeout: 30_000 });
}

test('a lista de OS e renderizada pela ENGINE, nao por JSX artesanal', async ({ page }) => {
  const metaCalls: string[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/api/v1/meta')) {
      metaCalls.push(response.url());
    }
  });

  await login(page);
  await openEngineList(page);

  expect(metaCalls.some((url) => url.includes('/api/v1/meta/service-orders'))).toBe(true);

  const table = page.locator('[data-testid="dynamic-list"]');
  await expect(table).toHaveAttribute('data-entity', 'service-orders');
  // A coluna carrega o ROTULO do metadado (`meta.fields.label`), nao texto do componente.
  await expect(table.getByRole('columnheader', { name: /Número da OS/ })).toBeVisible();

  await page.screenshot({ path: join(SHOTS, 'so-01-lista-engine.png'), fullPage: true });
});

test('PROVA A (OS) — campo novo aparece no formulario sem nenhuma linha de JSX', async ({
  page,
}) => {
  await login(page);

  /*
   * MUTAÇÃO no metadata store para `service-orders`: um campo novo. Nenhum arquivo React é
   * tocado. O campo entra também na seção da view `form` — mesma mecânica usada em
   * fornecedores, agora sobre OUTRA entidade e OUTRA view.
   */
  await mutateMetadata(`
    INSERT INTO meta.fields
      (entity_id, name, label, type, required, perm_level, options, field_order,
       in_form, in_list, list_order, in_filter, in_search)
    SELECT id, 'observacao_interna', 'Observação interna', 'text', false, 0, NULL, 6.5,
           true, false, 0, false, false
    FROM meta.entities WHERE name = 'service-orders'
    ON CONFLICT (entity_id, name) DO UPDATE SET label = EXCLUDED.label, in_form = true
  `);
  await mutateMetadata(`
    UPDATE meta.views SET layout = jsonb_set(
      layout, '{sections,1,fields}',
      '["unit_id","description","observacao_interna","priority","contract_reference"]'::jsonb
    ) WHERE entity_id = (SELECT id FROM meta.entities WHERE name='service-orders')
      AND view_type = 'form'
  `);

  await openFirstServiceOrder(page);

  const field = page.locator('[data-testid="dynamic-form"] [data-field="observacao_interna"]');
  await expect(field).toBeVisible({ timeout: 30_000 });
  await expect(
    page.locator('[data-testid="dynamic-form"] label[for="dynamic-observacao_interna"]'),
  ).toHaveText(/Observação interna/);

  await page.screenshot({ path: join(SHOTS, 'so-02-prova-a-campo-novo.png'), fullPage: true });
});

test('PROVA B (OS) — transicao nova aparece na ActionBar sem nenhum TypeScript', async ({
  page,
}) => {
  await login(page);

  /*
   * MUTAÇÃO no workflow de OS: estado `SUSPENDED` e a transição `suspend`
   * (IN_EXECUTION -> SUSPENDED). O seed cobre 7 transições; esta é a 8ª e chega pelo metadado.
   *
   * A permissão usada é uma que o ator JÁ possui (`service-orders:service-order:prepare`),
   * para que o teste isole o que ele diz isolar: a ENGINE montar o botão a partir do
   * metadado — não a autorização do ator.
   */
  await mutateMetadata(`
    UPDATE meta.workflows SET states = states || '["SUSPENDED"]'::jsonb
    WHERE entity_id = (SELECT id FROM meta.entities WHERE name='service-orders')
      AND NOT states @> '["SUSPENDED"]'::jsonb
  `);
  await mutateMetadata(`
    INSERT INTO meta.workflow_transitions
      (workflow_id, command, label, from_states, to_state, permission, requires_reason, button_order)
    SELECT w.id, 'suspend', 'Suspender', '["IN_EXECUTION"]'::jsonb, 'SUSPENDED',
           'service-orders:service-order:prepare', false, 0
    FROM meta.workflows w
    JOIN meta.entities e ON e.id = w.entity_id AND e.name = 'service-orders'
    ON CONFLICT (workflow_id, command) DO UPDATE SET
      label = EXCLUDED.label, from_states = EXCLUDED.from_states, to_state = EXCLUDED.to_state,
      button_order = EXCLUDED.button_order
  `);

  /*
   * O detalhe precisa estar em IN_EXECUTION para a transição valer. Em vez de forçar o
   * estado do registro (o que falsearia a jornada), a navegação procura na LISTA uma OS
   * REALMENTE em IN_EXECUTION — o seed tem duas.
   *
   * O filtro usa o ROTULO do metadado ("Em execução"), não o valor cru: a coluna `status` é
   * do tipo `select`, então `FieldRenderer` desenha o rótulo declarado em `meta.fields.options`.
   * Filtrar por "IN_EXECUTION" não acharia nada — e é justamente essa tradução que prova que a
   * coluna vem do metadado.
   */
  await openEngineList(page);
  const executionRow = page
    .locator('[data-testid="dynamic-list"] tbody tr')
    .filter({ hasText: 'Em execução' })
    .first();
  await expect(executionRow).toBeVisible({ timeout: 30_000 });
  await executionRow.click();
  await expect(page.locator('[data-testid="dynamic-form"]')).toBeVisible({ timeout: 30_000 });

  const state = await page.locator('[data-testid="engine-current-state"]').textContent();
  expect(state?.trim()).toBe('IN_EXECUTION');

  const suspendButton = page.locator('[data-testid="action-bar"] button[data-command="suspend"]');
  await expect(suspendButton).toBeVisible({ timeout: 30_000 });
  await expect(suspendButton).toHaveText('Suspender');

  await page.screenshot({ path: join(SHOTS, 'so-03-prova-b-transicao.png'), fullPage: true });
});

test('PROVA C (OS) — reordenar campos nao exige deploy', async ({ page }) => {
  await login(page);

  /*
   * MUTAÇÃO na ordem: `unit_id` sobe para antes de `description` na seção "Execução" da view
   * `form` de service-orders. O formulário é renderizado a partir de `view.layout.sections`;
   * para que a ordem do metadado mande, a view precisa listar os campos na ordem nova.
   *
   * A ordem declarada aqui é o INVERSO da ordem de `field_order` (description=6, unit_id=4),
   * para que a asserção distinga "a view mandou" de "o field_order mandou".
   */
  await mutateMetadata(`
    UPDATE meta.views SET layout = jsonb_set(
      layout, '{sections,1,fields}',
      '["description","unit_id","priority","contract_reference"]'::jsonb
    ) WHERE entity_id = (SELECT id FROM meta.entities WHERE name='service-orders')
      AND view_type = 'form'
  `);

  await openFirstServiceOrder(page);

  const labels = await page
    .locator('[data-testid="dynamic-form"] label')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ''));

  const descriptionIndex = labels.findIndex((label) => label.includes('Descrição'));
  const unitIndex = labels.findIndex((label) => label.includes('Unidade'));
  expect(descriptionIndex).toBeGreaterThanOrEqual(0);
  expect(unitIndex).toBeGreaterThanOrEqual(0);
  expect(
    descriptionIndex,
    `ordem renderizada: ${JSON.stringify(labels)}`,
  ).toBeLessThan(unitIndex);

  await page.screenshot({ path: join(SHOTS, 'so-04-prova-c-ordem.png'), fullPage: true });
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
