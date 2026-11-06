import { expect, test } from '@playwright/test';
import { prepareAuthenticatedSession, stabilizePage } from '../fixtures/visual-helpers';

/**
 * MASTER 010 — geometry assertions for the two commercial worklists altered by this PR.
 * Uses the existing deterministic commercial fixture; real API/HML evidence is separate.
 * Never accepts new screenshot baselines in place of geometric invariants.
 */
const ROUTES = [
  { path: '/app/contracts', title: 'Contratos' },
  { path: '/app/purchase-orders', title: 'Pedidos de compra' },
] as const;
const WIDTHS = [390, 768, 1440, 1920] as const;

test.describe('MASTER 010 — commercial filter usability', () => {
  for (const route of ROUTES) {
    test(`${route.title} — controls fit every required viewport`, async ({ page }) => {
      await prepareAuthenticatedSession(page, 'commercial');

      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(route.path);
        await stabilizePage(page);

        await expect(page.getByRole('heading', { name: route.title, level: 1 })).toBeVisible();
        const toolbar = page.locator('[data-region="workspace-toolbar"]');
        await expect(toolbar).toBeVisible();
        await expect(toolbar).toHaveAttribute('data-toolbar-layout', 'stacked');

        const measure = await toolbar.evaluate((host) => {
          const bounds = host.getBoundingClientRect();
          const controls = Array.from(host.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input, select, button'));
          return {
            pageWidth: document.documentElement.scrollWidth,
            viewportWidth: document.documentElement.clientWidth,
            toolbarRight: bounds.right,
            clippedControls: controls.filter((control) => {
              const rect = control.getBoundingClientRect();
              const css = getComputedStyle(control);
              if (css.display === 'none' || css.visibility === 'hidden' || rect.width < 1) return false;
              return rect.left < -1 || rect.right > window.innerWidth + 1;
            }).map((control) => control.id || control.getAttribute('aria-label') || control.tagName.toLowerCase()),
          };
        });

        expect(measure.pageWidth, `${route.path}: document overflow at ${width}px`)
          .toBeLessThanOrEqual(measure.viewportWidth + 1);
        expect(measure.toolbarRight, `${route.path}: toolbar clipped at ${width}px`)
          .toBeLessThanOrEqual(width + 1);
        expect(measure.clippedControls, `${route.path}: inaccessible filters at ${width}px`)
          .toEqual([]);
      }
    });
  }
});
