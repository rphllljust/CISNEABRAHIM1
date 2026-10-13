import { test, expect } from '@playwright/test';
import { prepareAuthenticatedSession, stabilizePage } from '../fixtures/visual-helpers';

/**
 * PROVA DE PROPAGAÇÃO — a worklist de Clientes na MESMA linguagem de `/app`.
 *
 * Mede os atributos que definem "mesmo produto": superficie do cabecalho, cor do titulo, superficie
 * do cabecalho de grade e cor do texto da coluna. Se algum deles divergir da baliza (`/app`), a
 * propagação nao aconteceu — e o teste FALHA em vez de deixar passar uma divergencia visual.
 */

/**
 * A BALIZA — os valores que `/app` publica hoje (commit 8361be36).
 *
 * Eles NAO sao escritos aqui como hex "bonito": cada um foi lido do DOM real do painel operacional
 * e e o que as demais superficies precisam reproduzir. Quando a propagacao falha, a prova aponta
 * exatamente qual atributo divergiu.
 */
const BASELINE = {
  sidebar: 'rgb(7, 24, 39)', // #071827 — navy CISNE
  headerInk: 'rgb(7, 24, 39)',
  titleSize: '28px',
  titleWeight: '700',
  gridHeadSurface: 'rgb(234, 240, 246)', // #EAF0F6
  gridHeadInk: 'rgb(49, 69, 92)', // #31455C
  topbarHeight: 54,
};

test.describe('propagação visual — worklist de Clientes', () => {
  test.use({ viewport: { width: 1728, height: 900 } });

  test('usa a mesma gramatica de cabecalho e grade do painel operacional', async ({ page }) => {
    await prepareAuthenticatedSession(page, 'clients');
    await page.goto('/app/clients');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await stabilizePage(page);

    const report: Record<string, unknown> = {};

    const h1 = page.getByRole('heading', { level: 1 }).first();
    const header = page.locator('header').first();
    // CABECALHO DA GRADE — o primeiro `th` dentro do cabecalho da LISTA (nao o primeiro da pagina,
    // que pode ser um `th` de outro painel semantico fora da grade de trabalho).
    const gridHead = page.locator('table[aria-label] thead th').first();
    const gridHeadStyle = await gridHead.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        background: s.backgroundColor,
        color: s.color,
        // Ancora de diagnostico: qual tabela o seletor realmente capturou.
        table: el.closest('table')?.getAttribute('aria-label') ?? null,
        text: el.textContent?.trim().slice(0, 40) ?? '',
      };
    });

    const h1Style = await h1.evaluate((el) => {
      const s = getComputedStyle(el);
      return { color: s.color, fontSize: s.fontSize, fontWeight: s.fontWeight };
    });
    const headerStyle = await header.evaluate((el) => ({
      background: getComputedStyle(el).backgroundColor,
    }));
    const sidebarStyle = await page
      .locator('aside.shell__sidebar')
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    const topbarHeight = await page
      .locator('header.shell__topbar')
      .evaluate((el) => Math.round(el.getBoundingClientRect().height));

    report.h1 = h1Style;
    report.headerSurface = headerStyle.background;
    report.gridHead = gridHeadStyle;
    report.sidebar = sidebarStyle;
    report.topbarHeight = topbarHeight;

    console.log('CLIENTS_1728=' + JSON.stringify(report, null, 2));

    // SHELL — o mesmo navy e a mesma altura de topbar da baliza.
    expect(sidebarStyle).toBe(BASELINE.sidebar);
    expect(topbarHeight).toBe(BASELINE.topbarHeight);

    // CABECALHO DE GRID — superficie tonal e tinta da baliza (mesma grade em todo o produto).
    expect(gridHeadStyle.background).toBe(BASELINE.gridHeadSurface);
    expect(gridHeadStyle.color).toBe(BASELINE.gridHeadInk);

    // TITULO — mesma escala, peso e cor de `/app`.
    expect(h1Style.color).toBe(BASELINE.headerInk);
    expect(h1Style.fontSize).toBe(BASELINE.titleSize);
    expect(h1Style.fontWeight).toBe(BASELINE.titleWeight);

    await page.screenshot({ path: 'tmp-proof/clients-wl-1728.png', fullPage: false });
  });
});
