import { expect, test } from '@playwright/test';
import { prepareAuthenticatedSession, stabilizePage } from '../fixtures/visual-helpers';
import type { ApiMockProfile } from '../fixtures/api-routes';

// Browser acceptance of the supplied 1a reference across shared and legacy surfaces.
// Fixtures are test data only; production totals and capabilities remain authoritative.
const surfaces: Array<{ path: string; title: RegExp; profile: ApiMockProfile; table?: string }> = [
  { path: '/app', title: /^central de operações\b/i, profile: 'dashboard' },
  { path: '/app/clients', title: /^clientes$/i, profile: 'clients', table: 'Lista de clientes' },
  { path: '/app/proposals', title: /^propostas comerciais$/i, profile: 'commercial' },
  { path: '/app/finance/expenses', title: /^despesas$/i, profile: 'finance', table: 'Lista de Despesas' },
  { path: '/app/documents', title: /^documentos$/i, profile: 'documents' },
];

test('semantic feedback and interactive boundaries retain measurable contrast', async ({ page }) => {
  await prepareAuthenticatedSession(page, 'dashboard');
  const pairs = await page.evaluate(() => {
    const probe = document.createElement('span');
    document.body.append(probe);
    const read = (token: string) => {
      probe.style.color = `var(--${token})`;
      return getComputedStyle(probe).color;
    };
    const result = [
      ['success', 'color-success-fg', 'color-success-bg', 4.5],
      ['warning', 'color-warning-fg', 'color-warning-bg', 4.5],
      ['critical', 'color-critical-fg', 'color-critical-bg', 4.5],
      ['primary command', 'color-text-inverse', 'color-cisne-action', 4.5],
      ['input boundary', 'color-border-control', 'color-canvas-work', 3],
      ['focus on paper', 'color-focus-ring', 'color-canvas-work', 3],
      ['focus on midnight', 'color-focus-ring', 'color-shell-surface', 3],
    ].map(([name, fg, bg, minimum]) => ({
      name: String(name), fg: read(String(fg)), bg: read(String(bg)), minimum: Number(minimum),
    }));
    probe.remove();
    return result;
  });
  const luminance = (color: string) => {
    const values = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    if (!values || values.length !== 3) throw new Error(`Unresolved CSS color: ${color}`);
    const linear = values.map((value) => {
      const s = value / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
  };
  for (const pair of pairs) {
    const a = luminance(pair.fg);
    const b = luminance(pair.bg);
    const contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    expect(contrast, pair.name).toBeGreaterThanOrEqual(pair.minimum);
  }
  expect(new Set(pairs.slice(0, 3).map((pair) => pair.fg)).size).toBe(3);
});

for (const width of [1440, 390]) {
  test.describe(`Midnight & Champagne ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const surface of surfaces) {
      test(`${surface.path} shares palette, fonts and accessible navigation`, async ({ page }) => {
        await prepareAuthenticatedSession(page, surface.profile);
        await page.goto(surface.path);
        await expect(page.getByRole('heading', { level: 1, name: surface.title })).toBeVisible();
        if (surface.table) {
          await expect(page.getByRole('table', { name: surface.table, exact: true })).toBeVisible();
        }
        await expect(page.getByText('Carregando navegação…', { exact: true })).toHaveCount(0);
        await stabilizePage(page);

        await expect(page.locator('.cisne-app')).toHaveCSS('background-color', 'rgb(245, 243, 238)');
        await expect(page.locator('.shell__topbar')).toHaveCSS('background-color', 'rgb(251, 250, 247)');
        await expect(page.getByRole('heading', { level: 1, name: surface.title })).toHaveCSS(
          'color', 'rgb(20, 26, 38)',
        );
        const font = await page.locator('.cisne-app').evaluate((el) => getComputedStyle(el).fontFamily);
        expect(font).toContain('Instrument Sans');

        if (width >= 1024) {
          await expect(page.getByRole('complementary', { name: 'Barra lateral', exact: true }))
            .toHaveCSS('background-color', 'rgb(11, 18, 33)');
        } else {
          await page.getByRole('button', { name: 'Abrir menu', exact: true }).click();
          const menu = page.getByRole('dialog', { name: 'Menu de navegação', exact: true });
          await expect(menu).toBeVisible();
          await expect(menu).toHaveCSS('background-color', 'rgb(11, 18, 33)');
          await menu.getByRole('button', { name: 'Fechar', exact: true }).click();
          await expect(menu).not.toBeVisible();
        }

        const overflow = await page.evaluate(() =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, 'tables must scroll locally instead of widening the page').toBeLessThanOrEqual(1);
        await page.screenshot({ path: `tmp-proof/midnight-${width}-${surface.profile}.png`, fullPage: true });
      });
    }
  });
}
