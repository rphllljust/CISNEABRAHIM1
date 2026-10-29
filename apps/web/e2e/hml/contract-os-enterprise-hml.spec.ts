import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * PROVA EMPRESARIAL COM CHROMIUM REAL (sem mock e sem escrita).
 *
 * Os IDs são exportados PELO verificador PostgreSQL fail-closed, após ALFA/BETA
 * liquidados, conciliados e contabilizados. A navegação nunca presume que duas
 * OS do mesmo Cliente pertencem ao mesmo Contrato: o backend filtra contractId.
 * O HTML testado é servido pelo container Web HML, não pelo Vite dev server.
 */
type Scenario = {
  scenario: string;
  clientId: string;
  contractId: string;
  serviceOrderId: string;
  measurementId: string;
  billingRecordId: string;
  billingDocumentId: string;
  receivableId: string;
  settlementId: string;
  economicTraceState: string;
};
type Proof = {
  economicChainVerified: boolean;
  source: string;
  productionValidated: boolean;
  scenarios: Scenario[];
};

const root = process.env.HML_WEB_URL ?? 'http://127.0.0.1:5174';
const evidenceFile = process.env.HML_NAVIGATION_EVIDENCE;

function loadEvidence(): Proof {
  if (!evidenceFile) throw new Error('HML_NAVIGATION_EVIDENCE_REQUIRED');
  const result = JSON.parse(readFileSync(resolve(evidenceFile), 'utf8')) as Proof;
  if (result.economicChainVerified !== true ||
      result.source !== 'HML_ISOLATED_POSTGRES' ||
      result.productionValidated !== false ||
      result.scenarios.length !== 2 ||
      !result.scenarios.every((scenario) => scenario.contractId && scenario.serviceOrderId)) {
    throw new Error('HML_ECONOMIC_NAVIGATION_EVIDENCE_INCOMPLETE');
  }
  return result;
}

async function signIn(page: Page): Promise<void> {
  const login = process.env.HML_SMOKE_LOGIN ?? '';
  const password = process.env.HML_SMOKE_PASSWORD ?? '';
  expect(login, 'Login HML obrigatório').not.toBe('');
  expect(password, 'Senha HML obrigatória').not.toBe('');
  await page.goto(`${root}/login`, { waitUntil: 'domcontentloaded' });
  const alreadySignedIn = await page
    .getByRole('heading', { level: 1, name: /central de operações/i })
    .isVisible().catch(() => false);
  if (!alreadySignedIn) {
    // Não confundir hidratação assíncrona com sessão já autenticada.
    const user = page.getByLabel(/^usuário/i);
    await user.waitFor({ state: 'visible', timeout: 30_000 });
    await user.fill(login);
    await page.getByLabel(/^senha/i).fill(password);
    await page.getByRole('button', { name: /^entrar/i }).click();
  }
  await expect(page.getByRole('heading', { level: 1, name: /central de operações/i }))
    .toBeVisible({ timeout: 30_000 });
}

test.describe('HML Enterprise Journey — Cliente → Contrato → OS → Financeiro', () => {
  test.describe.configure({ mode: 'serial' });
  let page: Page;
  let context: BrowserContext;
  let proof: Proof;
  let browserErrors: string[];

  test.beforeAll(async ({ browser }) => {
    proof = loadEvidence();
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await context.newPage();
    browserErrors = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 500) {
        browserErrors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`);
      }
    });
    await signIn(page);
  });
  test.afterAll(async () => {
    await context?.close();
  });

  for (const [label, scenarioName] of [
    ['ALFA', 'locacao-full'],
    ['BETA', 'transporte-full'],
  ] as const) {
    test(`${label}: Cliente 360 → Contrato 360 → OS 360 → origem financeira real`, async () => {
      test.setTimeout(180_000);
      const scenario = proof.scenarios.find((s) => s.scenario === scenarioName);
      expect(scenario, `cenário ${label} ausente na prova PG`).toBeDefined();
      const verified = scenario!;
      const initialErrorCount = browserErrors.length;

      await page.goto(`${root}/app/clients/${verified.clientId}`, { waitUntil: 'domcontentloaded' });
      const customerRelations = page.getByLabel('Relações');
      const contractsLink = customerRelations.getByRole('link', { name: /contratos/i });
      await expect(contractsLink).toBeVisible({ timeout: 30_000 });
      await expect(contractsLink).toHaveAttribute('href', `/app/contracts?clientId=${verified.clientId}`);
      await page.screenshot({ path: test.info().outputPath(`${label.toLowerCase()}-customer-before.png`), fullPage: true });

      await contractsLink.click();
      await expect(page).toHaveURL(new RegExp('/app/contracts\\?clientId='));
      const targetContract = page.locator(`a[href="/app/contracts/${verified.contractId}"]`);
      await expect(targetContract).toBeVisible({ timeout: 30_000 });
      await targetContract.click();

      const ordersRequest = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === '/api/v1/service-orders' &&
          url.searchParams.get('contractId') === verified.contractId;
      }, { timeout: 30_000 });
      // Reload the actual object to verify the server-filtered read model, not a
      // stale response captured during the previous route transition.
      await page.reload({ waitUntil: 'domcontentloaded' });
      const response = await ordersRequest;
      expect(response.ok(), 'Contract 360 requer GET /service-orders autorizado').toBe(true);
      const payload = await response.json() as {
        items: Array<{ id: string; contractId?: string | null }>;
        total?: number;
      };
      expect(payload.items.length).toBeGreaterThan(0);
      expect(payload.total).toBeGreaterThanOrEqual(1);
      expect(payload.items.every((row) => row.contractId === verified.contractId)).toBe(true);
      expect(payload.items.some((row) => row.id === verified.serviceOrderId)).toBe(true);

      const linkedOrders = page.getByRole('table', { name: 'Ordens vinculadas ao contrato' });
      await expect(linkedOrders).toBeVisible();
      const orderLink = linkedOrders.locator(`a[href="/app/service-orders/${verified.serviceOrderId}"]`);
      await expect(orderLink).toBeVisible({ timeout: 30_000 });
      await page.screenshot({ path: test.info().outputPath(`${label.toLowerCase()}-contract.png`), fullPage: true });

      await orderLink.click();
      await expect(page).toHaveURL(new RegExp(`/app/service-orders/${verified.serviceOrderId}$`));
      const authorizedContractLink = page.getByRole("region", { name: "Relações" })
        .locator(`a[href="/app/contracts/${verified.contractId}"]`);
      await expect(authorizedContractLink).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole('link', { name: /abrir medição/i })).toBeVisible();
      await expect(page.getByRole('link', { name: /abrir faturamento/i })).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`${label.toLowerCase()}-os-after.png`), fullPage: true });

      await page.setViewportSize({ width: 1024, height: 768 });
      await page.screenshot({ path: test.info().outputPath(`${label.toLowerCase()}-os-tablet.png`), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 900 });

      // Próximos documentos são fatos já persistidos e conferidos no arquivo
      // de prova, NUNCA IDs deduzidos do número da OS ou do cliente.
      await page.getByRole('link', { name: /abrir medição/i }).click();
      await expect(page).toHaveURL(new RegExp(`/app/service-orders/${verified.serviceOrderId}/measurement`));
      await page.goto(`${root}/app/service-orders/${verified.serviceOrderId}/billing`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#main-content')).toBeVisible();
      await page.goto(`${root}/app/finance/receivables/${verified.receivableId}`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#main-content')).toBeVisible();
      await page.goto(`${root}/app/accounting/economic-trace/settlement/${verified.settlementId}`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#main-content')).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`${label.toLowerCase()}-economic-trace.png`), fullPage: true });
      expect(verified.economicTraceState).toBe('POSTED');
      expect(browserErrors.slice(initialErrorCount), '0 erros JS e HTTP 5xx na jornada').toEqual([]);
    });
  }
});
