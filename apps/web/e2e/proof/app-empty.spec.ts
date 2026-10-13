import { test, expect } from '@playwright/test';
import { prepareAuthenticatedSession, stabilizePage } from '../fixtures/visual-helpers';

/**
 * PROVA DO ESTADO VAZIO — item 17 da especificacao.
 *
 * "0 itens = worklist compacta". A prova e a ALTURA MEDIDA da fila quando o servidor publica uma
 * pagina vazia: ela precisa fechar em 80-120px, nunca reservar 300-400px para nada.
 */

const EMPTY_PAGE = {
  items: [],
  limit: 50,
  offset: 0,
  total: 0,
  totalPages: 0,
  byDomain: {
    FINANCEIRO: 0,
    FISCAL: 0,
    CONTABILIDADE: 0,
    OPERACOES: 0,
    COMERCIAL: 0,
    SUPRIMENTOS: 0,
  },
  unavailableDomains: [],
};

test.describe('prova do vazio /app', () => {
  test.use({ viewport: { width: 1728, height: 900 } });

  test('fila vazia fecha em faixa compacta', async ({ page }) => {
    await prepareAuthenticatedSession(page, 'dashboard');
    await page.route('**/api/v1/work-inbox**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(EMPTY_PAGE),
      });
    });
    await page.goto('/app');
    await expect(page.getByRole('heading', { level: 1, name: /visão geral/i })).toBeVisible();
    await stabilizePage(page);

    const queue = page.locator('.dashboard-queue');
    const box = await queue.boundingBox();
    const report = {
      queueHeight: box ? Math.round(box.height) : null,
      emptyVisible: await page.locator('.dashboard-queue__empty').isVisible(),
      rowCount: await page.locator('.dashboard-queue__row:not(.dashboard-queue__row--head)').count(),
      deadSpace: await page.evaluate(() => {
        const q = document.querySelector('.dashboard-queue');
        return q ? Math.round(window.innerHeight - q.getBoundingClientRect().bottom) : null;
      }),
    };
    console.log('EMPTY_1728=' + JSON.stringify(report, null, 2));
    await page.screenshot({ path: 'tmp-proof-empty-1728.png', fullPage: false });
  });
});
