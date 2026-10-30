import { expect, test } from '@playwright/test';

const baseUrl = process.env.HML_WEB_URL ?? 'http://127.0.0.1:5174';
const login = process.env.HML_SMOKE_LOGIN ?? '';
const password = process.env.HML_SMOKE_PASSWORD ?? '';
const scenarios = [
  { label: 'ALFA', serviceOrderId: process.env.HML_ALFA_SERVICE_ORDER_ID, unitId: process.env.HML_ALFA_UNIT_ID },
  { label: 'BETA', serviceOrderId: process.env.HML_BETA_SERVICE_ORDER_ID, unitId: process.env.HML_BETA_UNIT_ID },
] as const;

/**
 * Real Chromium + real HML DB. The canonical ALFA/BETA orders are already COMPLETED.
 * They provide an immutable read/lineage fixture; this test never claims that
 * selecting a historical OS is proof of a new planning/dispatch mutation.
 * A1-A3 and A6 require independent writable cases and remain a separate gate.
 */
test.describe('HML Operations 360 — persisted OS identity and owner processing surfaces', () => {

  test.beforeEach(async ({ page }) => {
    expect(login, 'HML_SMOKE_LOGIN').not.toBe('');
    expect(password, 'HML_SMOKE_PASSWORD').not.toBe('');
    for (const scenario of scenarios) {
      expect(scenario.serviceOrderId, `${scenario.label}: persisted OS`).toBeTruthy();
      expect(scenario.unitId, `${scenario.label}: authoritative unit`).toBeTruthy();
    }
    await page.goto(`${baseUrl}/login`);
    await page.getByLabel(/^usuário/i).fill(login);
    await page.getByLabel(/^senha/i).fill(password);
    await page.getByRole('button', { name: /^entrar/i }).click();
    await expect(page.getByRole('heading', { level: 1, name: /central de operações/i })).toBeVisible();
  });

  for (const scenario of scenarios) {
    test(`${scenario.label}: OS persisted identity → three-region processing → real measurement (desktop/tablet)`, async ({ page, browserName }, testInfo) => {
      expect(browserName).toBe('chromium');
      const id = scenario.serviceOrderId!;
      const unit = scenario.unitId!;
      await page.goto(`${baseUrl}/app/operations/dispatch`);
      const authorizedUnit = page.getByRole('combobox', { name: 'Unidade operacional' });
      await expect(authorizedUnit).toBeVisible();
      await authorizedUnit.selectOption(unit);
      await expect(authorizedUnit).toHaveValue(unit);
      const read = page.waitForResponse(response =>
        response.request().method() === 'GET' &&
        response.url().includes(`/api/v1/query/service-orders/${id}/overview`) &&
        response.status() === 200,
      );
      await page.goto(`${baseUrl}/app/operations/dispatch?unitId=${encodeURIComponent(unit)}&serviceOrderId=${encodeURIComponent(id)}&focus=planning`);
      const overview = (await (await read).json()) as { identity?: { unitId?: string; serviceOrderId?: string; rowVersion?: number } };
      expect(overview.identity?.unitId).toBe(unit);
      expect(overview.identity?.serviceOrderId).toBe(id);
      expect(overview.identity?.rowVersion).toEqual(expect.any(Number));
      await expect(page.getByRole('heading', { name: /Processar OS/i })).toBeVisible({ timeout: 30_000 });
        await expect(page.getByRole('region', { name: 'Fila operacional autorizada' })).toBeVisible();
        await expect(page.getByRole('region', { name: 'OS em processamento' })).toBeVisible();
        await expect(page.getByRole('region', { name: 'Contexto de decisão' })).toBeVisible();
        await expect(page.getByRole('region', { name: 'Planejamento e alocação' })).toBeVisible();
        await expect(page.locator('[data-region="workbench-floorplan"]')).toHaveCount(1);
        await page.screenshot({ path: testInfo.outputPath(`${scenario.label}-operations-planning-desktop.png`), fullPage: true });
        await page.getByRole('button', { name: 'Executar e apontar' }).click();
        await expect(page.getByRole('region', { name: 'Execução e apontamentos' })).toBeVisible();
        await expect(page.locator('[data-region="workbench-floorplan"]')).toHaveCount(1);
        await page.getByRole('button', { name: 'Medir e aceitar' }).click();
        await expect(page.getByRole('region', { name: 'Medição e aceite' })).toBeVisible();
        await expect(page.locator('[data-region="workbench-floorplan"]')).toHaveCount(1);
        await page.setViewportSize({ width: 900, height: 1100 });
        await page.screenshot({ path: testInfo.outputPath(`${scenario.label}-operations-measurement-tablet.png`), fullPage: true });
        await expect(page).toHaveURL(new RegExp(`serviceOrderId=${id}`));
    });
  }
});
