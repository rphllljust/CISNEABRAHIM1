import { test, expect } from '@playwright/test';
import { prepareAuthenticatedSession, stabilizePage } from '../fixtures/visual-helpers';

/**
 * MEDIÇÃO FORENSE DO APP SHELL — o que existe HOJE, medido, não descrito.
 *
 * Este spec é a BASE DE COMPARAÇÃO da reconstrução visual. Ele mede a silhueta real das rotas
 * prioritárias em 1600×900 e imprime `SHELL_<ROTA>=` em JSON, além de capturar o screenshot da
 * dobra. Nada aqui é gate de regressão por snapshot: o número medido é a prova.
 */

const ROUTES: Array<{ name: string; path: string; profile: 'dashboard' | 'clients' }> = [
  { name: 'app', path: '/app', profile: 'dashboard' },
  { name: 'clients', path: '/app/clients', profile: 'clients' },
  { name: 'work-inbox', path: '/app/work-inbox', profile: 'dashboard' },
];

test.describe('shell — linha de base medida', () => {
  test.use({ viewport: { width: 1600, height: 900 } });

  for (const route of ROUTES) {
    test(`mede ${route.name}`, async ({ page }) => {
      await prepareAuthenticatedSession(page, route.profile);
      await page.goto(route.path);
      await stabilizePage(page);
      await page.waitForTimeout(400);

      const report = await page.evaluate(() => {
        const box = (sel: string) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return {
            x: Math.round(r.x),
            y: Math.round(r.y),
            w: Math.round(r.width),
            h: Math.round(r.height),
          };
        };
        const main = document.querySelector('#main-content');
        let lowest = 0;
        if (main) {
          for (const el of main.querySelectorAll('*')) {
            const r = el.getBoundingClientRect();
            if (r.height > 0) lowest = Math.max(lowest, r.bottom);
          }
        }
        const sidebar = document.querySelector('aside.shell__sidebar');
        const topbar = document.querySelector('header.shell__topbar');
        const brand = document.querySelector('.shell__brand');
        const activeNav = document.querySelector('nav[aria-label="Navegação principal"] a[aria-current="page"]');
        return {
          viewport: { w: window.innerWidth, h: window.innerHeight },
          sidebar: box('aside.shell__sidebar'),
          sidebarBg: sidebar ? getComputedStyle(sidebar).backgroundColor : null,
          brand: box('.shell__brand'),
          topbar: box('header.shell__topbar'),
          topbarBg: topbar ? getComputedStyle(topbar).backgroundColor : null,
          brandH: brand ? Math.round(brand.getBoundingClientRect().height) : null,
          activeNav: activeNav
            ? {
                ...box('nav[aria-label="Navegação principal"] a[aria-current="page"]'),
                text: activeNav.textContent?.trim().slice(0, 30),
              }
            : null,
          canvas: box('.shell__content'),
          canvasBg: document.querySelector('.shell__content')
            ? getComputedStyle(document.querySelector('.shell__content')!).backgroundColor
            : null,
          main: box('#main-content'),
          emptyBelow: Math.round(window.innerHeight - lowest),
          h1: (() => {
            const h = document.querySelector('#main-content h1');
            if (!h) return null;
            const r = h.getBoundingClientRect();
            const s = getComputedStyle(h);
            return {
              text: h.textContent?.trim().slice(0, 40),
              x: Math.round(r.x),
              y: Math.round(r.y),
              fontSize: s.fontSize,
              fontWeight: s.fontWeight,
              color: s.color,
            };
          })(),
          tables: [...document.querySelectorAll('table')].map((t) => {
            const r = t.getBoundingClientRect();
            return {
              label: t.getAttribute('aria-label'),
              y: Math.round(r.y),
              h: Math.round(r.height),
              cols: t.querySelectorAll('thead th').length,
              rows: t.querySelectorAll('tbody tr').length,
            };
          }),
          dataRegions: [...document.querySelectorAll('[data-region]')].map((n) =>
            n.getAttribute('data-region'),
          ),
        };
      });

      console.log(`SHELL_${route.name.toUpperCase()}=` + JSON.stringify(report));
      await page.screenshot({ path: `tmp/base-${route.name}-1600.png`, fullPage: false });
      expect(report.sidebar).not.toBeNull();
    });
  }
});
