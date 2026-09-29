import { test, expect } from '@playwright/test';
import {
  prepareAuthenticatedSession,
  stabilizePage,
} from '../fixtures/visual-helpers';

test.describe('executive dashboard visual regression', () => {
  test.beforeEach(async ({ page }) => {
    await prepareAuthenticatedSession(page, 'dashboard');
    await page.goto('/app');
    await expect(page.getByRole('heading', { level: 1, name: /visão geral/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /central de decisão/i })).toBeVisible();
    await stabilizePage(page);
  });

  test('dashboard ready state', async ({ page }) => {
    await expect(page.locator('#main-content.dashboard-page')).toHaveScreenshot('dashboard-ready.png', {
      animations: 'disabled',
      mask: [page.locator('.dashboard-page__meta time'), page.locator('.dashboard-command__refresh')],
    });
  });
});
