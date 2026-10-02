import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * ENGINE DE ERP — JORNADA REAL (sem mock, sem page.route, sem sleep).
 *
 * Roda contra a APLICAÇÃO REAL: API + PostgreSQL + autorização. Cada prova abaixo muta o
 * METADATA STORE e verifica o efeito NO BROWSER — não em `psql`. É a diferença entre
 * "o modelo de dados aceita a mutação" e "a capacidade existe".
 *
 * As mutações usam o helper `mutateMetadata`, que fala com o Postgres pelo `pg` do próprio
 * projeto. Não há atalho HTTP: o metadata store é escrito como um administrador escreveria.
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
const SHOTS = process.env['CISNE_JOURNEY_SHOTS'] ?? join(process.cwd(), 'test-results', 'engine');
mkdirSync(SHOTS, { recursive: true });

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/^usuário/i).fill(LOGIN);
  await page.getByLabel(/^senha/i).fill(PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 30_000 });
}

/** Abre a lista renderizada pela engine. */
async function openEngineList(page: Page): Promise<void> {
  await page.goto('/app/suppliers');
  await expect(page.locator('[data-testid="dynamic-list"]')).toBeVisible({ timeout: 30_000 });
}

async function openFirstSupplier(page: Page): Promise<void> {
  await openEngineList(page);
  const firstRow = page.locator('[data-testid="dynamic-list"] tbody tr').first();
  await expect(firstRow).toBeVisible({ timeout: 30_000 });
  await firstRow.click();
  await expect(page.locator('[data-testid="dynamic-form"]')).toBeVisible({ timeout: 30_000 });
}

test('a lista de fornecedores e renderizada pela ENGINE, nao por JSX artesanal', async ({
  page,
}) => {
  const metaCalls: string[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/api/v1/meta')) {
      metaCalls.push(response.url());
    }
  });

  await login(page);
  await openEngineList(page);

  // A engine consome o metadado: sem isso, a lista nao teria como saber as colunas.
  expect(metaCalls.some((url) => url.includes('/api/v1/meta/suppliers'))).toBe(true);

  // As colunas vem de `meta.fields` — e o cabecalho carrega os ROTULOS do metadado.
  const table = page.locator('[data-testid="dynamic-list"]');
  await expect(table).toHaveAttribute('data-entity', 'suppliers');
  await expect(table.getByRole('columnheader', { name: /Razão social/ })).toBeVisible();

  await page.screenshot({ path: join(SHOTS, '01-lista-engine.png'), fullPage: true });
});

test('PROVA A — campo novo aparece no formulario sem nenhuma linha de JSX', async ({ page }) => {
  await login(page);

  /*
   * MUTAÇÃO no metadata store: um campo novo. É tudo que um administrador faria.
   * Nenhum arquivo React é tocado — não há como: o formulário é `DynamicForm`.
   *
   * O campo entra TAMBÉM na seção da view `form`. Isso não é atalho: `DynamicForm` renderiza
   * as seções declaradas em `view.layout.sections`, que é justamente o mecanismo que permite
   * compor o formulário sem deploy. A Prova C reescreve essas seções, então cada prova que
   * depende delas as declara — senão o resultado passaria a depender da ORDEM dos testes,
   * que é exatamente o tipo de acoplamento que torna um E2E mentiroso.
   */
  await mutateMetadata(`
    INSERT INTO meta.fields
      (entity_id, name, label, type, required, perm_level, options, field_order,
       in_form, in_list, list_order, in_filter, in_search)
    SELECT id, 'inscricao_estadual', 'Inscrição estadual', 'data', false, 0, NULL, 2.6,
           true, true, 8, false, true
    FROM meta.entities WHERE name = 'suppliers'
    ON CONFLICT (entity_id, name) DO UPDATE SET label = EXCLUDED.label, in_form = true
  `);
  await mutateMetadata(`
    UPDATE meta.views SET layout = jsonb_set(
      layout, '{sections,0,fields}',
      '["legal_name","trade_name","inscricao_estadual","normalized_tax_id","external_erp_id"]'::jsonb
    ) WHERE entity_id = (SELECT id FROM meta.entities WHERE name='suppliers') AND view_type = 'form'
  `);

  await openFirstSupplier(page);

  // O CAMPO APARECE — renderizado pelo FieldRenderer a partir do metadado.
  const field = page.locator('[data-testid="dynamic-form"] [data-field="inscricao_estadual"]');
  await expect(field).toBeVisible({ timeout: 30_000 });
  await expect(
    page.locator('[data-testid="dynamic-form"] label[for="dynamic-inscricao_estadual"]'),
  ).toHaveText(/Inscrição estadual/);

  await page.screenshot({ path: join(SHOTS, '02-prova-a-campo-novo.png'), fullPage: true });
});

test('PROVA B — transicao nova aparece na ActionBar sem nenhum TypeScript', async ({ page }) => {
  await login(page);

  /*
   * MUTAÇÃO no workflow: um estado novo e uma transição que leva a ele.
   * `activate` já cobre ACTIVE->? ; usamos `deactivate` a partir de ACTIVE, que o
   * fornecedor do seed possui. A transição abaixo chega pelo metadado.
   */
  await mutateMetadata(`
    UPDATE meta.workflows SET states = states || '["ON_HOLD"]'::jsonb
    WHERE entity_id = (SELECT id FROM meta.entities WHERE name='suppliers')
      AND NOT states @> '["ON_HOLD"]'::jsonb
  `);
  await mutateMetadata(`
    INSERT INTO meta.workflow_transitions
      (workflow_id, command, label, from_states, to_state, permission, requires_reason, button_order)
    SELECT w.id, 'hold', 'Colocar em espera', '["ACTIVE"]'::jsonb, 'ON_HOLD',
           'supplier:supplier:activate', false, 0
    FROM meta.workflows w
    JOIN meta.entities e ON e.id = w.entity_id AND e.name = 'suppliers'
    ON CONFLICT (workflow_id, command) DO UPDATE SET
      label = EXCLUDED.label, from_states = EXCLUDED.from_states, to_state = EXCLUDED.to_state,
      button_order = EXCLUDED.button_order
  `);

  await openFirstSupplier(page);

  // O BOTÃO APARECE — a ActionBar le as transicoes do metadado para o estado atual.
  const state = await page.locator('[data-testid="engine-current-state"]').textContent();
  expect(state?.trim()).toBe('ACTIVE');

  const holdButton = page.locator('[data-testid="action-bar"] button[data-command="hold"]');
  await expect(holdButton).toBeVisible({ timeout: 30_000 });
  await expect(holdButton).toHaveText('Colocar em espera');

  await page.screenshot({ path: join(SHOTS, '03-prova-b-transicao.png'), fullPage: true });
});

test('PROVA C — reordenar campos nao exige deploy', async ({ page }) => {
  await login(page);

  /*
   * MUTAÇÃO na ordem: `legal_name` continua primeiro, `normalized_tax_id` sobe para
   * depois dele. O formulário é renderizado a partir de `view.layout.sections`; para que a
   * ordem do metadado mande, a view precisa listar os campos na ordem nova.
   */
  await mutateMetadata(`
    UPDATE meta.views SET layout = jsonb_set(
      layout, '{sections,0,fields}',
      '["legal_name","normalized_tax_id","inscricao_estadual","trade_name","external_erp_id"]'::jsonb
    ) WHERE entity_id = (SELECT id FROM meta.entities WHERE name='suppliers') AND view_type = 'form'
  `);

  await openFirstSupplier(page);

  // A ORDEM MUDA: o CNPJ passa a vir antes do nome fantasia no formulario renderizado.
  const labels = await page
    .locator('[data-testid="dynamic-form"] label')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ''));

  const cnpjIndex = labels.findIndex((label) => label.includes('CNPJ'));
  const tradeIndex = labels.findIndex((label) => label.includes('Nome fantasia'));
  expect(cnpjIndex).toBeGreaterThanOrEqual(0);
  expect(tradeIndex).toBeGreaterThanOrEqual(0);
  expect(cnpjIndex, `ordem renderizada: ${JSON.stringify(labels)}`).toBeLessThan(tradeIndex);

  await page.screenshot({ path: join(SHOTS, '04-prova-c-ordem.png'), fullPage: true });
});

/**
 * Executa SQL contra o metadata store.
 *
 * O metadata store é escrito por ADMINISTRADOR, não por endpoint de aplicação — por isso a
 * mutação é SQL. O que a jornada prova NÃO é o SQL: é que, após a mutação, a TELA RENDERIZADA
 * muda sem nenhum deploy.
 *
 * A execução usa `psql` no container do Postgres (o mesmo caminho que o projeto já usa em
 * scripts de operação). O pacote `web` não depende de driver de banco — e não deve passar a
 * depender só para um teste.
 */
async function mutateMetadata(sql: string): Promise<void> {
  const { execFileSync } = await import('node:child_process');
  const container = process.env['CISNE_METADATA_DB_CONTAINER'] ?? 'cisne_local_postgres';
  const database = process.env['CISNE_METADATA_DB_NAME'] ?? 'cisne_local_dev';
  const user = process.env['CISNE_METADATA_DB_USER'] ?? 'cisne_local_dev';

  execFileSync('docker', ['exec', container, 'psql', '-U', user, '-d', database, '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    stdio: 'pipe',
  });
}
