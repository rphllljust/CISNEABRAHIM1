import { test, expect } from '@playwright/test';
import { stabilizePage } from '../fixtures/visual-helpers';

test.describe('login page visual regression', () => {
  test('login form layout', async ({ page }, testInfo) => {
    await page.goto('/login');
    // Contrato estrutural (alem do pixel): os campos e a acao de entrada precisam existir.
    await expect(page.getByLabel(/^usuário/i)).toBeVisible();
    await expect(page.getByLabel(/^senha/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /^entrar/i })).toBeVisible();
    await stabilizePage(page);
    if (testInfo.project.name !== 'mobile') {
      await expect(page.locator('main')).toHaveScreenshot('login-form.png', {
        animations: 'disabled',
      });
    }
  });

  test('mobile preserves the institutional hero and a complete login flow', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Mobile composition contract.');

    await page.goto('/login');
    const hero = page.getByRole('complementary', { name: 'Identidade institucional' });
    const card = page.locator('.login-page .card');

    await expect(hero).toBeVisible();
    await expect(hero.locator('.login-hero__headline')).toContainText('Sua empresa');
    await expect(card).toBeVisible();
    await expect(page.getByLabel(/^usuário/i)).toBeVisible();
    await expect(page.getByLabel(/^senha/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /^entrar/i })).toBeVisible();

    const geometry = await page.evaluate(() => {
      const heroElement = document.querySelector<HTMLElement>('.login-hero');
      const cardElement = document.querySelector<HTMLElement>('.login-page .card');
      if (!heroElement || !cardElement) {
        return null;
      }
      const heroRect = heroElement.getBoundingClientRect();
      const cardRect = cardElement.getBoundingClientRect();
      return {
        heroHeight: heroRect.height,
        heroBottom: heroRect.bottom,
        cardTop: cardRect.top,
        heroTop: heroRect.top,
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });

    expect(geometry).not.toBeNull();
    expect(geometry!.heroHeight).toBeGreaterThan(200);
    expect(geometry!.heroHeight).toBeLessThanOrEqual(270);
    expect(geometry!.cardTop).toBeGreaterThan(geometry!.heroTop);
    expect(geometry!.cardTop).toBeLessThan(geometry!.heroBottom);
    expect(geometry!.scrollWidth).toBeLessThanOrEqual(geometry!.viewportWidth + 1);
  });

  test('reference desktop composition', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Reference raster is desktop-only.');
    await page.setViewportSize({ width: 1016, height: 510 });
    await page.goto('/login');
    await stabilizePage(page);
    await expect(page.locator('main')).toHaveScreenshot('login-reference.png', {
      animations: 'disabled',
    });
  });
});
