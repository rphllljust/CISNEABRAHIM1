import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { requireJourneyLogin, requireJourneyPassword } from './journey-credentials';

/**
 * V2 · CONDITIONAL FIELDS — prova no browser, sem mock e sem sleep.
 *
 * A visibilidade condicional é declarada em `meta.fields.visible_when`: o campo aparece se e
 * somente se o campo apontado tem o valor exigido. É o que substitui o `{isBank ? <>…</> : null}`
 * que cada tela escrevia à mão.
 *
 * BLOQUEIO DE TRANSPORTE DECLARADO: `visible_when` existe no schema (0087) mas não está na
 * projeção de `GET /api/v1/meta/:entity`. O teste verifica store e DOM separadamente.
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

test('campo condicional respeita o valor do campo do qual depende', async ({ page }) => {
  await login(page);

  const declared = await readVisibleWhenDeclaration();
  expect(
    declared,
    'meta.fields.contract_reference deve declarar visible_when para origin=PROPOSAL',
  ).toBe(true);

  await page.goto('/app/service-orders');
  await expect(page.locator('[data-testid="dynamic-list"]')).toBeVisible({ timeout: 30_000 });

  const firstRow = page.locator('[data-testid="dynamic-list"] tbody tr').first();
  await firstRow.click();
  await expect(page.locator('[data-testid="dynamic-form"]')).toBeVisible({ timeout: 30_000 });

  const originControl = page.locator('[data-testid="dynamic-form"] [data-field="origin"]');
  await expect(originControl).toBeVisible({ timeout: 30_000 });

  /*
   * A COERÊNCIA é o que se prova: o campo aparece se e somente se a origem é PROPOSAL. Fixar
   * um estado esperado faria o teste depender do seed, não da regra.
   */
  const originValue = await originControl.inputValue();
  const conditionalField = page.locator(
    '[data-testid="dynamic-form"] [data-field="contract_reference"]',
  );

  if (originValue === 'PROPOSAL') {
    await expect(conditionalField).toBeVisible({ timeout: 30_000 });
  } else {
    await expect(conditionalField).toHaveCount(0);
  }

  await page.screenshot({ path: join(SHOTS, 'v2-conditional-fields.png'), fullPage: true });
});

/** Confirma no banco a regra de visibilidade — lado independente da projeção da API. */
async function readVisibleWhenDeclaration(): Promise<boolean> {
  const { execFileSync } = await import('node:child_process');
  const container = process.env['CISNE_METADATA_DB_CONTAINER'] ?? 'cisne_local_postgres';
  const database = process.env['CISNE_METADATA_DB_NAME'] ?? 'cisne_local_dev';
  const user = process.env['CISNE_METADATA_DB_USER'] ?? 'cisne_local_dev';
  const sql =
    "SELECT COUNT(*) FROM meta.fields f JOIN meta.entities e ON e.id = f.entity_id WHERE e.name = 'service-orders' AND f.name = 'contract_reference' AND f.visible_when ->> 'field' = 'origin' AND f.visible_when ->> 'equals' = 'PROPOSAL'";
  const out = execFileSync(
    'docker',
    ['exec', container, 'psql', '-U', user, '-d', database, '-t', '-A', '-c', sql],
    { encoding: 'utf8' },
  );
  return out.trim() === '1';
}
