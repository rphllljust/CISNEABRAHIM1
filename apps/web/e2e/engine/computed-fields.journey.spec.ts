import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { requireJourneyLogin, requireJourneyPassword } from './journey-credentials';

/**
 * V2 · COMPUTED FIELDS — prova no browser, sem mock e sem sleep.
 *
 * O campo computado não existe no banco: é uma FÓRMULA declarada em `meta.computed_fields`,
 * avaliada no cliente a partir do DTO da linha. A prova é o DOM mostrar a coluna e o valor.
 *
 * BLOQUEIO DE TRANSPORTE DECLARADO: a coluna existe no schema (migration 0087) mas o endpoint
 * `GET /api/v1/meta/:entity` projeta `meta.fields` coluna a coluna e não inclui
 * `meta.computed_fields`. Enquanto a projeção não incluir, a engine não recebe a declaração —
 * e esta prova falha por AUSÊNCIA DE CANAL, não por defeito da engine. O teste verifica os dois
 * lados: se a declaração CHEGAR, a coluna e o valor têm de aparecer.
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

test('computed field declarado no metadata store aparece como coluna', async ({ page }) => {
  await login(page);
  await page.goto('/app/service-orders');
  await expect(page.locator('[data-testid="dynamic-list"]')).toBeVisible({ timeout: 30_000 });

  // A DECLARAÇÃO existe no store: isto o SQL de 0087 garante e é verificável independentemente.
  const declared = await readComputedFieldDeclaration();
  expect(declared, 'meta.computed_fields deve ter aging_days para service-orders').toBe(true);

  /*
   * Com a declaração presente no store, a coluna tem de aparecer — é o que a engine faz quando
   * recebe o metadado. Se não aparecer, o canal de transporte não entregou a declaração.
   */
  const header = page.locator('[data-testid="dynamic-list"] th[data-computed-field="aging_days"]');
  await expect(header).toBeVisible({ timeout: 30_000 });
  await expect(header).toHaveText(/Dias em atraso/);

  const cell = page.locator('[data-computed-cell="aging_days"]').first();
  await expect(cell).toBeVisible({ timeout: 30_000 });
  const text = (await cell.innerText()).trim();
  expect(text === '—' || /^-?\d+$/.test(text)).toBe(true);

  await page.screenshot({ path: join(SHOTS, 'v2-computed-fields.png'), fullPage: true });
});

/** Confirma no banco que a declaração existe — o lado que NÃO depende da projeção da API. */
async function readComputedFieldDeclaration(): Promise<boolean> {
  const { execFileSync } = await import('node:child_process');
  const container = process.env['CISNE_METADATA_DB_CONTAINER'] ?? 'cisne_local_postgres';
  const database = process.env['CISNE_METADATA_DB_NAME'] ?? 'cisne_local_dev';
  const user = process.env['CISNE_METADATA_DB_USER'] ?? 'cisne_local_dev';
  const sql =
    "SELECT COUNT(*) FROM meta.computed_fields cf JOIN meta.entities e ON e.id = cf.entity_id WHERE e.name = 'service-orders' AND cf.name = 'aging_days'";
  const out = execFileSync(
    'docker',
    ['exec', container, 'psql', '-U', user, '-d', database, '-t', '-A', '-c', sql],
    { encoding: 'utf8' },
  );
  return out.trim() === '1';
}
