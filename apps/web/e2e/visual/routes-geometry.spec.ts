import { expect, test, type Page } from '@playwright/test';
import { prepareAuthenticatedSession, stabilizePage } from '../fixtures/visual-helpers';

/**
 * AUDITORIA DE GEOMETRIA DAS ROTAS PRINCIPAIS — medida objetiva, não opinião.
 *
 * Este spec NÃO compara baseline. Ele mede, em 1600×900, quanto do viewport cada região consome e
 * quanto sobra VAZIO abaixo do conteúdo. É o instrumento que transforma "parece CRUD" em número:
 *
 *   - `emptyBelow`: pixels de área morta abaixo do último conteúdo. É o sintoma direto de
 *     "título → filtro → tabela → espaço branco".
 *   - `firstFoldRows`: linhas de grade visíveis sem rolar. Um ERP denso mostra trabalho na
 *     primeira dobra; uma página de cadastro mostra dois ou três.
 *   - `commandHeight`: altura da faixa de comando. Quando ela passa de ~160px, o chrome comeu a
 *     superfície de trabalho.
 *
 * Serve para priorizar a reconstrução por DÉFICIT MEDIDO, e não por impressão.
 */
async function measure(page: Page) {
  return page.evaluate(() => {
    const vh = window.innerHeight;
    const box = (sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const rows = document.querySelectorAll('tbody tr').length;
    const cells = document.querySelectorAll('thead th').length;
    const main = document.querySelector('#main-content');
    let lowest = 0;
    if (main) {
      for (const el of main.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.height > 0) lowest = Math.max(lowest, r.bottom);
      }
    }
    const emptyBelow = main ? Math.round(vh - lowest) : null;
    const firstFoldRows = (() => {
      let count = 0;
      for (const tr of document.querySelectorAll('tbody tr')) {
        if (tr.getBoundingClientRect().bottom <= vh) count += 1;
      }
      return count;
    })();
    return {
      rows,
      cells,
      firstFoldRows,
      emptyBelow,
      workSurface: box('[data-region="work-surface"]'),
      worklist: box('[data-region="worklist-master"]'),
      toolbar: box('[data-region="workbench-toolbar"]'),
      contextColumn: box('[data-region="context-column"]'),
      table: box('table'),
      h1: (() => {
        const el = document.querySelector('h1');
        return el ? el.textContent?.trim() : null;
      })(),
    };
  });
}

const ROUTES: Array<{ path: string; label: string }> = [
  { path: '/app', label: 'dashboard' },
  { path: '/app/clients', label: 'clients' },
  { path: '/app/requests', label: 'requests' },
  { path: '/app/proposals', label: 'proposals' },
  { path: '/app/contracts', label: 'contracts' },
  { path: '/app/service-orders', label: 'service-orders' },
  { path: '/app/assets', label: 'assets' },
  { path: '/app/finance/receivables', label: 'receivables' },
  { path: '/app/finance/payables', label: 'payables' },
  { path: '/app/suppliers', label: 'suppliers' },
  { path: '/app/documents', label: 'documents' },
  { path: '/app/people', label: 'people' },
];

test.describe('route geometry audit', () => {
  test.use({ viewport: { width: 1600, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await prepareAuthenticatedSession(page, 'clients');
  });

  for (const route of ROUTES) {
    test(`geometry: ${route.label}`, async ({ page }) => {
      const response = await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      await stabilizePage(page);
      const m = await measure(page);
      console.log(
        `GEOMETRY ${route.label} ${JSON.stringify({ status: response?.status(), ...m })}`,
      );
      await page.screenshot({
        path: `test-results/audit/${route.label}.png`,
        fullPage: false,
      });
    });
  }
});
