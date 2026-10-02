import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * V2 · AGGREGATIONS — prova no browser, sem mock e sem sleep.
 *
 * O total de coluna é declarado em `meta.fields.aggregation` e calculado pela engine sobre o
 * conjunto EXIBIDO. A engine não pede total ao servidor: não existe endpoint para isso.
 *
 * BLOQUEIO DE TRANSPORTE DECLARADO: `aggregation` existe no schema (0087) mas não está na
 * projeção de `GET /api/v1/meta/:entity`. O teste verifica o store e o DOM separadamente, para
 * que a falha aponte o lado certo.
 */
const LOGIN = process.env['CISNE_JOURNEY_LOGIN'] ?? 'abrahim@cisne-rondonia.invalid';

function requireJourneyPassword(): string {
  const value = process.env['CISNE_JOURNEY_PASSWORD']?.trim();
  if (!value) {
    throw new Error('CONFIGURATION_ERROR: CISNE_JOURNEY_PASSWORD is required.');
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

test('agregacao declarada no metadata store aparece no rodape da lista', async ({ page }) => {
  await login(page);
  await page.goto('/app/service-orders');
  await expect(page.locator('[data-testid="dynamic-list"]')).toBeVisible({ timeout: 30_000 });

  const declared = await readAggregationDeclaration();
  expect(declared, 'meta.fields.row_version deve declarar aggregation=sum').toBe(true);

  const footer = page.locator('[data-testid="dynamic-list-totals"]');
  await expect(footer).toBeVisible({ timeout: 30_000 });

  // O rótulo DIZ a agregação aplicada — a engine não esconde a origem do número.
  const aggregate = footer.locator(
    '[data-total-field="row_version"] [data-aggregate-kind="sum"]',
  );
  await expect(aggregate).toBeVisible({ timeout: 30_000 });
  await expect(aggregate).toHaveText(/Total:/);

  const parsed = Number((await aggregate.innerText()).replace(/[^\d-]/g, ''));
  expect(Number.isFinite(parsed)).toBe(true);
  expect(parsed).toBeGreaterThan(0);

  await page.screenshot({ path: join(SHOTS, 'v2-aggregations.png'), fullPage: true });
});

/** Confirma no banco a declaração de agregação — lado independente da projeção da API. */
async function readAggregationDeclaration(): Promise<boolean> {
  const { execFileSync } = await import('node:child_process');
  const container = process.env['CISNE_METADATA_DB_CONTAINER'] ?? 'cisne_local_postgres';
  const database = process.env['CISNE_METADATA_DB_NAME'] ?? 'cisne_local_dev';
  const user = process.env['CISNE_METADATA_DB_USER'] ?? 'cisne_local_dev';
  const sql =
    "SELECT COUNT(*) FROM meta.fields f JOIN meta.entities e ON e.id = f.entity_id WHERE e.name = 'service-orders' AND f.name = 'row_version' AND f.aggregation = 'sum'";
  const out = execFileSync(
    'docker',
    ['exec', container, 'psql', '-U', user, '-d', database, '-t', '-A', '-c', sql],
    { encoding: 'utf8' },
  );
  return out.trim() === '1';
}
