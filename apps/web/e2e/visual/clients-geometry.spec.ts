import { expect, test, type Page } from '@playwright/test';
import { prepareAuthenticatedSession, stabilizePage } from '../fixtures/visual-helpers';

/**
 * CAPTURA DE GEOMETRIA — medida objetiva da composição, não inspeção visual.
 *
 * Mede as regiões da tela em 1600x900 para que "parece CRUD" vire número comparável:
 * quanto do viewport o header consome, quantas linhas cabem na primeira dobra, qual a
 * proporção entre worklist e contexto.
 */
async function measure(page: Page) {
  return page.evaluate(() => {
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const box = (sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const rows = document.querySelectorAll('tbody tr').length;
    const emptyBelow = (() => {
      const main = document.querySelector('#main-content');
      if (!main) return null;
      const children = [...main.querySelectorAll('*')];
      const lowest = children.reduce((max, el) => {
        const r = el.getBoundingClientRect();
        return r.height > 0 ? Math.max(max, r.bottom) : max;
      }, 0);
      return Math.round(vh - lowest);
    })();
    return {
      viewport: { vw, vh },
      header: box('header'),
      workSurface: box('[data-region="work-surface"]'),
      worklist: box('[data-region="worklist-master"]'),
      contextRegion: box('[data-region="context-region"]'),
      table: box('table'),
      rows,
      emptyPxBelowContent: emptyBelow,
    };
  });
}

test.describe('clients composition metrics', () => {
  test.use({ viewport: { width: 1600, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await prepareAuthenticatedSession(page, 'clients');
  });

  test('workspace metrics', async ({ page }) => {
    await page.goto('/app/clients');
    await expect(page.getByRole('table', { name: 'Lista de clientes' })).toBeVisible();
    await stabilizePage(page);
    const before = await measure(page);
    console.log('WORKSPACE_METRICS ' + JSON.stringify(before));

    // COM LINHA SELECIONADA: a coluna de contexto assume o lugar da instrução.
    //
    // O clique vai num ALVO NEUTRO da linha. A célula de seleção não serve: o clique cai no
    // próprio `input`, e o handler da linha — corretamente — ignora cliques que nascem dentro de
    // `a, button, select, input`. A célula de ESTRUTURA é dado puro, sem filho interativo.
    const row = page.getByRole('row', { name: /Alfa Madeira LTDA/ }).first();
    await row.getByRole('cell').nth(2).click();
    await page.waitForTimeout(600);
    const columnState = await page.evaluate(() => {
      const col = document.querySelector('aside[aria-label="Contexto da seleção"]');
      return {
        exists: Boolean(col),
        display: col ? getComputedStyle(col).display : null,
        text: col ? (col.textContent ?? '').slice(0, 160) : null,
        regions: [...document.querySelectorAll('[data-region]')].map((n) =>
          n.getAttribute('data-region'),
        ),
      };
    });
    console.log('CONTEXT_COLUMN ' + JSON.stringify(columnState));
    await expect(page.getByRole('region', { name: 'Contexto do cliente' })).toBeVisible();
    await stabilizePage(page);
    const after = await measure(page);
    console.log('WORKSPACE_SELECTED_METRICS ' + JSON.stringify(after));

    // A PROPORÇÃO É O ACEITE: a fila domina e a coluna de contexto coexiste com ela.
    const split = await page.evaluate(() => {
      const list = document.querySelector('[data-region="worklist-master"]');
      const ctx = document.querySelector('aside[aria-label="Contexto da seleção"]');
      const lw = list ? list.getBoundingClientRect().width : 0;
      const cw = ctx ? ctx.getBoundingClientRect().width : 0;
      return { listWidth: Math.round(lw), contextWidth: Math.round(cw), ratio: lw + cw ? Math.round((lw / (lw + cw)) * 100) : 0 };
    });
    console.log('SPLIT ' + JSON.stringify(split));
    expect(split.ratio).toBeGreaterThanOrEqual(70);
    expect(split.ratio).toBeLessThanOrEqual(78);

    await page.screenshot({ path: 'test-results/geometry/workspace-selected.png', fullPage: false });
    expect(before.rows).toBeGreaterThan(0);
  });

  test('object page metrics', async ({ page }) => {
    await page.goto('/app/clients');
    await page.getByRole('link', { name: 'Alfa Madeira LTDA' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await stabilizePage(page);
    const m = await measure(page);
    console.log('OBJECT_METRICS ' + JSON.stringify(m));
    await page.screenshot({ path: 'test-results/geometry/object.png', fullPage: false });
  });

  test('create page metrics', async ({ page }) => {
    await page.goto('/app/clients/new');
    await expect(page.getByLabel(/razão social/i)).toBeVisible();
    await stabilizePage(page);
    const m = await measure(page);
    console.log('CREATE_METRICS ' + JSON.stringify(m));
    await page.screenshot({ path: 'test-results/geometry/create.png', fullPage: false });
  });
});
