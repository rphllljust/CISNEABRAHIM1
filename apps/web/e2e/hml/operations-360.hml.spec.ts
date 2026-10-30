import { expect, test, type Page, type Response } from '@playwright/test';

const baseUrl = process.env.HML_WEB_URL ?? 'http://127.0.0.1:5174';
const login = process.env.HML_SMOKE_LOGIN ?? '';
const password = process.env.HML_SMOKE_PASSWORD ?? '';
const scenarios = [
  { label: 'ALFA', serviceOrderId: process.env.HML_ALFA_SERVICE_ORDER_ID, unitId: process.env.HML_ALFA_UNIT_ID },
  { label: 'BETA', serviceOrderId: process.env.HML_BETA_SERVICE_ORDER_ID, unitId: process.env.HML_BETA_UNIT_ID },
] as const;

/**
 * Navigate using the same client-side React Router history subscription as the
 * authenticated workstation. A second document navigation triggered auth/refresh
 * HTTP 429 in ALFA (HML #40981897862), rendering ServiceUnavailable before the
 * overview could be requested. Never mock auth, retry 429, or accept missing reads.
 */
async function workstationRoute(page: Page, path: string): Promise<void> {
  await page.evaluate((destination) => {
    window.history.pushState(null, '', destination);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await expect(page).toHaveURL(new RegExp(path.split('?')[0]!.replaceAll('/', '\\/')));
}

async function readAuthorizedOverview(page: Page, id: string, unitId: string) {
  const observed: string[] = [];
  const failed: string[] = [];
  const captureResponse = (response: Response) => {
    if (response.url().includes('/api/v1/query/service-orders/') ||
        response.url().includes('/api/v1/auth/refresh') ||
        response.url().includes('/api/v1/query/operations/units')) {
      observed.push(`${response.request().method()} ${response.status()} ${response.url()}`);
    }
  };
  const captureFailure = (request: import('@playwright/test').Request) => {
    if (request.url().includes('/api/v1/')) {
      failed.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'transport failure'}`);
    }
  };
  page.on('response', captureResponse);
  page.on('requestfailed', captureFailure);
  const target = `/app/operations/dispatch?unitId=${encodeURIComponent(unitId)}&serviceOrderId=${encodeURIComponent(id)}&focus=planning`;
  try {
    // Status is deliberately NOT part of the predicate. A 403, 404 or 5xx
    // must fail as the real HTTP error, not masquerade as a missing request.
    const responsePromise = page.waitForResponse(response =>
      response.request().method() === 'GET' &&
      response.url().includes(`/api/v1/query/service-orders/${id}/overview`),
    { timeout: 15_000 });
    await workstationRoute(page, target);
    const response = await responsePromise;
    expect(response.status(), `overview for ${id} / ${unitId}: ${observed.join(' | ')}`).toBe(200);
    const overview = (await response.json()) as {
      identity?: { unitId?: string; serviceOrderId?: string; rowVersion?: number };
    };
    expect(overview.identity?.serviceOrderId, 'server persisted OS identity').toBe(id);
    expect(overview.identity?.unitId, 'server PDP-authorized unit identity').toBe(unitId);
    expect(overview.identity?.rowVersion, 'optimistic-concurrency version').toEqual(expect.any(Number));
    return overview;
  } catch (error) {
    const visible = (await page.locator('body').innerText().catch(() => '')).slice(0, 600);
    throw new Error([
      `HML_OVERVIEW_PROOF_FAILED: OS=${id} unit=${unitId}`,
      `page=${page.url()}`,
      `responses=${observed.join(' | ') || 'NO_MATCHING_RESPONSE'}`,
      `requestFailures=${failed.join(' | ') || 'NONE'}`,
      `visible=${visible}`,
      `cause=${error instanceof Error ? error.message : String(error)}`,
    ].join('\n'));
  } finally {
    page.off('response', captureResponse);
    page.off('requestfailed', captureFailure);
  }
}

test.describe('HML Operations 360 — persisted ALFA/BETA lineage and isolated authorization', () => {
  test.beforeEach(async ({ page }) => {
    expect(login, 'HML_SMOKE_LOGIN').not.toBe('');
    expect(password, 'HML_SMOKE_PASSWORD').not.toBe('');
    for (const scenario of scenarios) {
      expect(scenario.serviceOrderId, `${scenario.label}: persisted OS`).toBeTruthy();
      expect(scenario.unitId, `${scenario.label}: authorized unit`).toBeTruthy();
    }
    await page.goto(`${baseUrl}/login`);
    await page.getByLabel(/^usuário/i).fill(login);
    await page.getByLabel(/^senha/i).fill(password);
    await page.getByRole('button', { name: /^entrar/i }).click();
    await expect(page.getByRole('heading', { level: 1, name: /central de operações/i })).toBeVisible();
  });

  for (const scenario of scenarios) {
    test(`${scenario.label}: real overview, three-region processing and responsive measurement`, async ({ page, browserName }, info) => {
      expect(browserName).toBe('chromium');
      const id = scenario.serviceOrderId!;
      const unit = scenario.unitId!;
      await workstationRoute(page, '/app/operations/dispatch');
      const authorizedUnit = page.getByRole('combobox', { name: 'Unidade operacional' });
      await expect(authorizedUnit).toBeVisible();
      await authorizedUnit.selectOption(unit);
      await expect(authorizedUnit).toHaveValue(unit);
      // Maintain a single document session after login. Both the initial station
      // entry and subsequent OS selection are React Router client transitions:
      // HML #41048724800 proved a page.goto here can cause auth/refresh HTTP 429.
      await readAuthorizedOverview(page, id, unit);
      await expect(page.getByRole('heading', { name: /Processar OS/i })).toBeVisible();
      for (const label of ['Fila operacional autorizada', 'OS em processamento', 'Contexto de decisão']) {
        await expect(page.getByRole('region', { name: label })).toBeVisible();
      }
      await expect(page.getByRole('region', { name: 'Planejamento e alocação' })).toBeVisible();
      await expect(page.locator('[data-region="workbench-floorplan"]')).toHaveCount(1);
      await page.screenshot({ path: info.outputPath(`${scenario.label}-operations-planning-desktop.png`), fullPage: true });

      await page.getByRole('button', { name: 'Executar e apontar' }).click();
      await expect(page.getByRole('region', { name: 'Execução e apontamentos' })).toBeVisible();
      await page.getByRole('button', { name: 'Medir e aceitar' }).click();
      await expect(page.getByRole('region', { name: 'Medição e aceite' })).toBeVisible();
      await expect(page.locator('[data-region="workbench-floorplan"]')).toHaveCount(1);
      await page.setViewportSize({ width: 900, height: 1100 });
      await page.screenshot({ path: info.outputPath(`${scenario.label}-operations-measurement-tablet.png`), fullPage: true });
      await expect(page).toHaveURL(new RegExp(`serviceOrderId=${id}`));

      if (scenario.label === 'ALFA') {
        // A5 frontend contract: unauthorized unit must not trigger an
        // overview load nor render the previously authorized business chain.
        const deniedRequests: string[] = [];
        const watchRequest = (request: import('@playwright/test').Request) => {
          if (request.url().includes(`/api/v1/query/service-orders/${id}/overview`))
            deniedRequests.push(request.url());
        };
        page.on('request', watchRequest);
        try {
          await workstationRoute(page,
            `/app/operations/dispatch?unitId=unit-outside-hml-scope&serviceOrderId=${encodeURIComponent(id)}`);
          await expect(page.getByRole('alert')).toContainText('fora do escopo autorizado');
          await expect(page.getByRole('heading', { name: /Processar OS/i })).toHaveCount(0);
          expect(deniedRequests, 'no out-of-scope business overview request').toHaveLength(0);
        } finally {
          page.off('request', watchRequest);
        }
      }
    });
  }
});
