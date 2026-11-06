import { expect, test, type Page } from '@playwright/test';
import { installApiMocks } from '../fixtures/api-routes';
import { installAccountingMocks } from '../fixtures/accounting-api-routes';

// Diagnostic only: exercise the real login UI against synthetic visual-test API
// fixtures. This is NOT production evidence or business acceptance.
async function checkFixtureLogin(
  page: Page,
  fixture: 'dashboard' | 'accounting',
): Promise<void> {
  const observed: Array<{ endpoint: string; status: number }> = [];
  page.on('response', (response) => {
    const pathname = new URL(response.url()).pathname;
    if (/^\/api\/v1\/(?:auth\/(?:login|session|refresh)|me)$/.test(pathname)) {
      observed.push({ endpoint: pathname, status: response.status() });
    }
  });
  if (fixture === 'accounting') {
    await installAccountingMocks(page);
  } else {
    await installApiMocks(page, 'dashboard');
  }
  await page.goto('/login');
  await page.getByLabel(/^usuário/i).fill('visual.user');
  await page.getByLabel(/^senha/i).fill('Password1!');
  await page.getByRole('button', { name: /^entrar/i }).click();
  // Bound diagnostic hold gives auth redirects and async initial pages a chance
  // to render before recording their observed state.
  await page.waitForTimeout(1500);
  const state = await page.evaluate(() => ({
    pathname: window.location.pathname,
    title: document.title,
    headings: [...document.querySelectorAll('h1')].map((node) => node.textContent?.trim()),
    alerts: [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent?.trim()),
    busy: [...document.querySelectorAll('[aria-busy="true"]')].length,
    bodyPreview: document.body.innerText.slice(0, 350),
  }));
  console.log('MASTER010_VISUAL_SESSION_DIAG', JSON.stringify({ fixture, observed, state }));
  // This assertion must fail if the visual fixture never enters the shell.
  await expect(
    page.getByRole('heading', { level: 1, name: /central de operações/i }),
  ).toBeVisible({ timeout: 5000 });
}

test('shared dashboard visual fixture enters authenticated shell', async ({ page }) => {
  await checkFixtureLogin(page, 'dashboard');
});

test('isolated accounting visual fixture enters authenticated shell', async ({ page }) => {
  await checkFixtureLogin(page, 'accounting');
});
