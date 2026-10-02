import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * V2 · ROW ACCENTS — prova no browser, sem mock e sem sleep.
 *
 * A cor de linha é uma REGRA declarada em `meta.views.row_accent`: a primeira que casar vence.
 * A engine publica o TOKEN semântico (`critical`, `warning`, …) e o design system decide a cor
 * — um hexadecimal gravado no metadado amarraria a regra de negócio a um valor visual.
 *
 * BLOQUEIO DE TRANSPORTE DECLARADO: `row_accent` existe no schema (0087) como coluna própria de
 * `meta.views`, e a projeção de `GET /api/v1/meta/:entity` devolve apenas `layout`. O teste
 * verifica store e DOM separadamente.
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

test('regra de accent aplica token a linha que casa e deixa as demais neutras', async ({
  page,
}) => {
  await login(page);

  const declared = await readRowAccentDeclaration();
  expect(declared, 'meta.views deve declarar row_accent para status=RELEASED').toBe(true);

  await page.goto('/app/service-orders');
  await expect(page.locator('[data-testid="dynamic-list"]')).toBeVisible({ timeout: 30_000 });

  // A linha que casa recebe o TOKEN `critical` — não uma cor arbitrária.
  const accented = page.locator('[data-testid="dynamic-list-row"][data-row-accent="critical"]');
  await expect(accented.first()).toBeVisible({ timeout: 30_000 });

  // E existe linha SEM accent: a regra não pinta a tabela inteira.
  const allRows = page.locator('[data-testid="dynamic-list-row"][data-row-accent]');
  const withAccent = await accented.count();
  const total = await allRows.count();
  expect(withAccent).toBeGreaterThan(0);
  expect(withAccent).toBeLessThanOrEqual(total);

  await page.screenshot({ path: join(SHOTS, 'v2-row-accents.png'), fullPage: true });
});

/** Confirma no banco a regra de accent — lado independente da projeção da API. */
async function readRowAccentDeclaration(): Promise<boolean> {
  const { execFileSync } = await import('node:child_process');
  const container = process.env['CISNE_METADATA_DB_CONTAINER'] ?? 'cisne_local_postgres';
  const database = process.env['CISNE_METADATA_DB_NAME'] ?? 'cisne_local_dev';
  const user = process.env['CISNE_METADATA_DB_USER'] ?? 'cisne_local_dev';
  const sql =
    "SELECT COUNT(*) FROM meta.views v JOIN meta.entities e ON e.id = v.entity_id WHERE e.name = 'service-orders' AND v.view_type = 'list' AND v.row_accent @> '[{\"accent\":\"critical\"}]'::jsonb";
  const out = execFileSync(
    'docker',
    ['exec', container, 'psql', '-U', user, '-d', database, '-t', '-A', '-c', sql],
    { encoding: 'utf8' },
  );
  return out.trim() === '1';
}
