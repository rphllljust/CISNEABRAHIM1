import { test, expect } from '@playwright/test';
import {
  BILLING_READY_SELECTOR,
  prepareAuthenticatedSession,
  stabilizePage,
} from '../fixtures/visual-helpers';

test.describe('billing dashboard visual regression', () => {
  test.beforeEach(async ({ page }) => {
    await prepareAuthenticatedSession(page, 'billing-empty');
    await page.goto('/app/billing');
    await expect(page.getByRole('heading', { name: /^faturamento interno$/i })).toBeVisible();
    await expect(page.locator(BILLING_READY_SELECTOR)).toBeVisible();
    await stabilizePage(page);
  });

  test('billing work queue empty state', async ({ page }) => {
    await expect(page.locator('#main-content.billing-page')).toHaveScreenshot('billing-empty.png', {
      animations: 'disabled',
    });
  });
});
