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
    /*
     * ALVO DO SNAPSHOT — o landmark real da página.
     *
     * O spec mirava `#main-content.billing-page`. A classe `billing-page` não existe no
     * Faturamento interno: a página é composta por `ModulePage` (que publica `#main-content`) e
     * pelo `WorklistHeader`. O locator nunca resolvia — o teste ficava em timeout antes de
     * comparar qualquer pixel, e o snapshot persistido jamais foi exercitado.
     *
     * Mesmo defeito e mesma correção já aplicados em `dashboard.visual.spec.ts`.
     */
    await expect(page.locator('#main-content')).toHaveScreenshot('billing-empty.png', {
      animations: 'disabled',
    });
  });
});
