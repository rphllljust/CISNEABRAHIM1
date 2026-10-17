import { test, expect } from '@playwright/test';
import { prepareAuthenticatedSession, stabilizePage } from '../fixtures/visual-helpers';

test.describe('mobile operations control center geometry', () => {
  test('keeps controls inside the viewport and preserves a horizontal process rail', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Mobile geometry contract.');

    await prepareAuthenticatedSession(page, 'dashboard');
    await page.goto('/app');
    await expect(page.getByRole('heading', { level: 1, name: 'Central de operações' })).toBeVisible();
    await stabilizePage(page);

    const geometry = await page.evaluate(() => {
      const rect = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, width: box.width, height: box.height };
      };

      const stages = Array.from(
        document.querySelectorAll<HTMLElement>('.dashboard-chain__step'),
      ).slice(0, 2);

      return {
        viewportWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        main: rect('#main-content'),
        controls: rect('.dashboard-workspace-head__controls'),
        refresh: rect('.dashboard-workspace-head__refresh'),
        period: rect('.dashboard-workspace-head__select'),
        tabs: rect('.dashboard-workspace-head__chips'),
        chain: rect('.dashboard-chain__stages'),
        chainScrollWidth:
          document.querySelector<HTMLElement>('.dashboard-chain__stages')?.scrollWidth ?? 0,
        stageTops: stages.map((stage) => stage.getBoundingClientRect().top),
      };
    });

    expect(geometry.documentScrollWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.main).not.toBeNull();
    expect(geometry.main!.left).toBeLessThanOrEqual(13);
    expect(geometry.main!.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);

    for (const control of [geometry.controls, geometry.refresh, geometry.period, geometry.tabs]) {
      expect(control).not.toBeNull();
      expect(control!.left).toBeGreaterThanOrEqual(0);
      expect(control!.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    }

    expect(geometry.chain).not.toBeNull();
    expect(geometry.chain!.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.chainScrollWidth).toBeGreaterThan(geometry.chain!.width);
    expect(geometry.stageTops).toHaveLength(2);
    expect(Math.abs(geometry.stageTops[0]! - geometry.stageTops[1]!)).toBeLessThanOrEqual(2);
  });
});
