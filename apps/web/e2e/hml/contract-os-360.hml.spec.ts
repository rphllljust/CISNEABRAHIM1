import { expect, test, type Page } from '@playwright/test';

const baseUrl = process.env.HML_WEB_URL ?? 'http://127.0.0.1:5174';
const login = process.env.HML_SMOKE_LOGIN ?? '';
const password = process.env.HML_SMOKE_PASSWORD ?? '';

const scenarios = [
  {
    label: 'ALFA',
    clientId: process.env.HML_ALFA_CLIENT_ID,
    contractId: process.env.HML_ALFA_CONTRACT_ID,
    serviceOrderId: process.env.HML_ALFA_SERVICE_ORDER_ID,
  },
  {
    label: 'BETA',
    clientId: process.env.HML_BETA_CLIENT_ID,
    contractId: process.env.HML_BETA_CONTRACT_ID,
    serviceOrderId: process.env.HML_BETA_SERVICE_ORDER_ID,
  },
];

test.describe('HML isolada — Customer 360 → Contract 360 ↔ OS 360 (API real, sem mocks)', () => {
  test.describe.configure({ mode: 'serial' });
  let page: Page;
  const errors: string[] = [];

  test.beforeAll(async ({ browser }) => {
    expect(login).not.toBe('');
    expect(password).not.toBe('');
    for (const scenario of scenarios) {
      expect(scenario.clientId, scenario.label + ': clientId').toBeTruthy();
      expect(scenario.contractId, scenario.label + ': contractId').toBeTruthy();
      expect(scenario.serviceOrderId, scenario.label + ': serviceOrderId').toBeTruthy();
    }
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 500) errors.push(`${response.status()} ${response.url()}`);
    });
    await page.goto(`${baseUrl}/login`);
    await page.getByLabel(/^usuário/i).fill(login);
    await page.getByLabel(/^senha/i).fill(password);
    await page.getByRole('button', { name: /^entrar/i }).click();
    await expect(page.getByRole('heading', { level: 1, name: /central de operações/i })).toBeVisible();
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  for (const scenario of scenarios) {
    test(`${scenario.label}: Cliente → Contrato → OS por vínculo persistido → medição e Billing`, async ({}, testInfo) => {
      const { clientId, contractId, serviceOrderId, label } = scenario;
      await page.goto(`${baseUrl}/app/clients/${clientId}`);
      const customerLink = page.locator(`a[href="/app/contracts?clientId=${clientId}"]`);
      await expect(customerLink).toBeVisible({ timeout: 30_000 });
      await customerLink.click();
      await expect(page).toHaveURL(new RegExp(`/app/contracts\\?clientId=${clientId}`));

      const contractLink = page.locator(`a[href="/app/contracts/${contractId}"]`);
      await expect(contractLink).toBeVisible({ timeout: 30_000 });
      await contractLink.click();
      await expect(page).toHaveURL(new RegExp(`/app/contracts/${contractId}`));

      const table = page.getByRole('table', { name: 'Ordens vinculadas ao contrato' });
      await expect(table).toBeVisible({ timeout: 30_000 });
      const osLink = table.locator(`a[href="/app/service-orders/${serviceOrderId}"]`);
      await expect(osLink).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`${label}-contract360-desktop.png`), fullPage: true });
      await osLink.click();

      await expect(page).toHaveURL(new RegExp(`/app/service-orders/${serviceOrderId}`));
      await expect(page.locator(`a[href="/app/contracts/${contractId}"]`).first()).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`${label}-os360-desktop.png`), fullPage: true });

      const measurement = page.getByRole('link', { name: 'Abrir medição' });
      const billing = page.getByRole('link', { name: 'Abrir faturamento' });
      await expect(measurement).toBeVisible();
      await expect(billing).toBeVisible();
      await measurement.click();
      await expect(page).toHaveURL(new RegExp(`/app/service-orders/${serviceOrderId}/measurement`));
      await page.goto(`${baseUrl}/app/service-orders/${serviceOrderId}`);
      await page.getByRole('link', { name: 'Abrir faturamento' }).click();
      await expect(page).toHaveURL(new RegExp(`/app/service-orders/${serviceOrderId}/billing`));
      expect(errors, `${label}: erros Javascript ou HTTP 5xx`).toEqual([]);
    });
  }
});
