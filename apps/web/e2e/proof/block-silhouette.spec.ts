import { test } from '@playwright/test';
import { prepareAuthenticatedSession, stabilizePage } from '../fixtures/visual-helpers';

/**
 * MEDIÇÃO DE FECHAMENTO DO BLOCO — a silhueta de TODAS as rotas convertidas em 1600x900.
 *
 * O número que importa é `contentBottom` contra `vh`: quanto da viewport a bancada realmente ocupa.
 * Antes da moldura, Clientes terminava em y=497 (403px de canvas vazio) e Minhas pendências em
 * y=624 (276px). Depois, a bancada ocupa a tela — e é isso que o teste registra.
 */
const ROUTES: Array<{
  name: string;
  path: string;
  profile: 'dashboard' | 'clients' | 'commercial' | 'inventory';
}> = [
  { name: 'clients', path: '/app/clients', profile: 'clients' },
  { name: 'work-inbox', path: '/app/work-inbox', profile: 'dashboard' },
  { name: 'requests', path: '/app/requests', profile: 'dashboard' },
  { name: 'proposals', path: '/app/proposals', profile: 'commercial' },
  { name: 'purchase-orders', path: '/app/purchase-orders', profile: 'commercial' },
  { name: 'contracts', path: '/app/contracts', profile: 'commercial' },
  { name: 'assets', path: '/app/assets', profile: 'inventory' },
  { name: 'service-orders', path: '/app/service-orders', profile: 'dashboard' },
];

test.describe('silhueta das rotas convertidas', () => {
  test.use({ viewport: { width: 1600, height: 900 } });

  for (const route of ROUTES) {
    test(`mede ${route.name}`, async ({ page }) => {
      await prepareAuthenticatedSession(page, route.profile);
      await page.goto(route.path);
      await stabilizePage(page);
      await page.waitForTimeout(500);

      const report = await page.evaluate(() => {
        const main = document.querySelector('#main-content');
        if (!main) return null;
        let lowest = 0;
        for (const el of main.querySelectorAll('*')) {
          const r = el.getBoundingClientRect();
          if (r.height > 0 && r.bottom > lowest) lowest = r.bottom;
        }
        const box = (sel: string) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { y: Math.round(r.y), h: Math.round(r.height), w: Math.round(r.width) };
        };
        return {
          vh: window.innerHeight,
          contentBottom: Math.round(lowest),
          emptyBelow: Math.round(window.innerHeight - lowest),
          layoutMode: main.getAttribute('data-layout-mode'),
          split: box('[data-region="work-split"]'),
          master: box('[data-region="worklist-master"]'),
          contextColumn: box('[data-region="context-column"]'),
          overflowX:
            document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });

      console.log(`SILHOUETTE_${route.name.toUpperCase()}=` + JSON.stringify(report));
      await page.screenshot({ path: `tmp/block-${route.name}-1600.png`, fullPage: false });
    });
  }
});
