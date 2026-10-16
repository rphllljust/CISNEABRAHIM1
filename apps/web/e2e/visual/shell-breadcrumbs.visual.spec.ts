import { expect, test } from '@playwright/test';
import { prepareAuthenticatedSession, stabilizePage } from '../fixtures/visual-helpers';

const ROUTES = [
  { path: '/app', profile: 'dashboard' as const, label: 'Central de operações' },
  { path: '/app/billing', profile: 'billing-empty' as const, label: 'Faturamento interno' },
];

test.describe('breadcrumb do shell', () => {
  for (const route of ROUTES) {
    test(`${route.label} permanece dentro da barra superior`, async ({ page }) => {
      await prepareAuthenticatedSession(page, route.profile);

      for (const width of [1280, 1880]) {
        await page.setViewportSize({ width, height: 976 });
        await page.goto(route.path);
        await stabilizePage(page);

        const geometry = await page.evaluate(() => {
          const topbar = document.querySelector<HTMLElement>('.shell__topbar');
          const breadcrumbs = document.querySelector<HTMLElement>('.shell-breadcrumbs');
          const trail = breadcrumbs?.querySelector<HTMLElement>('.shell-breadcrumbs__trail');
          if (!topbar || !breadcrumbs || !trail) {
            throw new Error('Barra superior ou breadcrumb ausente');
          }

          const topbarRect = topbar.getBoundingClientRect();
          const breadcrumbRect = breadcrumbs.getBoundingClientRect();
          const trailRect = trail.getBoundingClientRect();
          const trailStyle = getComputedStyle(trail);

          return {
            topbarTop: topbarRect.top,
            topbarBottom: topbarRect.bottom,
            breadcrumbTop: breadcrumbRect.top,
            breadcrumbBottom: breadcrumbRect.bottom,
            trailHeight: trailRect.height,
            flexWrap: trailStyle.flexWrap,
            whiteSpace: trailStyle.whiteSpace,
          };
        });

        expect(
          geometry.breadcrumbTop,
          `breadcrumb não sobe para fora da barra a ${width}px`,
        ).toBeGreaterThanOrEqual(geometry.topbarTop);
        expect(
          geometry.breadcrumbBottom,
          `breadcrumb não invade o conteúdo a ${width}px`,
        ).toBeLessThanOrEqual(geometry.topbarBottom);
        expect(
          geometry.trailHeight,
          `breadcrumb mantém uma linha a ${width}px`,
        ).toBeLessThanOrEqual(24);
        expect(geometry.flexWrap).toBe('nowrap');
        expect(geometry.whiteSpace).toBe('nowrap');
      }
    });
  }
});
