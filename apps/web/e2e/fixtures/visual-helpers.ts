import { expect, type Page } from '@playwright/test';
import { installApiMocks, type ApiMockProfile } from './api-routes';

const TEST_LOGIN = 'visual.user';
const TEST_PASSWORD = 'Password1!';

export async function prepareAuthenticatedSession(
  page: Page,
  profile: ApiMockProfile = 'dashboard',
): Promise<void> {
  await installApiMocks(page, profile);
  await page.goto('/login');
  await page.getByLabel(/^usuário/i).fill(TEST_LOGIN);
  await page.getByLabel(/^senha/i).fill(TEST_PASSWORD);
  await page.getByRole('button', { name: /^entrar/i }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^central de operações\b/i })).toBeVisible();
}

export async function stabilizePage(page: Page): Promise<void> {
  await page.waitForLoadState('load');
  await page.evaluate(() => document.fonts.ready);
}

export const DASHBOARD_SCREENSHOT_MASKS = ['.dashboard-page__meta time', '.dashboard-page__refresh'];

export const BILLING_READY_SELECTOR = '[aria-label="Fila de faturamento"]';
