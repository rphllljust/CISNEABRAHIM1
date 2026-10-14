import { test, expect } from '@playwright/test';
import { prepareAuthenticatedSession, stabilizePage } from '../fixtures/visual-helpers';

/**
 * MAPA ESTRUTURAL PROFUNDO — o que cada rota REALMENTE desenha, regiao por regiao.
 *
 * A pergunta que este spec responde nao e "como esta bonito", e sim: QUANTO DA VIEWPORT cada
 * regiao ocupa, ONDE o conteudo termina, e QUANTOS elementos carregam caixa propria (borda,
 * raio, fundo diferente). Sem isso, "a tela parece CRUD" e opiniao.
 */

const WORK_INBOX_PAGE = {
  items: [
    {
      id: 'wi-1',
      domain: 'OPERACOES',
      kind: 'OVERDUE',
      businessReference: 'OS-2026-0184',
      title: 'Execução de manutenção preventiva',
      contextLabel: 'Cliente Alfa · Unidade autorizada',
      status: 'Em execução',
      reason: 'Prazo de execução vencido e ainda sem conclusão registrada',
      occurredAt: '2026-08-01T10:00:00.000Z',
      dueAt: '2026-08-19T10:00:00.000Z',
      actionLabel: 'Abrir ordem',
      targetRoute: '/app/service-orders',
      unitId: 'UN-DEV-001',
    },
    {
      id: 'wi-2',
      domain: 'FINANCEIRO',
      kind: 'BLOCKER',
      businessReference: 'NF-2026-000005',
      title: 'Conta a receber vencida',
      contextLabel: 'Cliente Beta',
      status: 'Vencido',
      reason: 'Título vencido e não liquidado',
      occurredAt: '2026-08-10T10:00:00.000Z',
      dueAt: '2026-08-24T10:00:00.000Z',
      actionLabel: 'Abrir recebível',
      targetRoute: '/app/finance/receivables',
      unitId: 'UN-DEV-001',
    },
  ],
  limit: 25,
  offset: 0,
  total: 2,
  totalPages: 1,
  byDomain: {
    FINANCEIRO: 1,
    FISCAL: 0,
    CONTABILIDADE: 0,
    OPERACOES: 1,
    COMERCIAL: 0,
    SUPRIMENTOS: 0,
  },
  unavailableDomains: [],
};

async function regionMap(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const main = document.querySelector('#main-content');
    if (!main) return null;
    const vh = window.innerHeight;

    const describe = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(),
        cls: (el.className && typeof el.className === 'string'
          ? el.className
          : ''
        )
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 6)
          .join(' '),
        region: el.getAttribute('data-region'),
        y: Math.round(r.y),
        h: Math.round(r.height),
        w: Math.round(r.width),
        display: s.display,
        cols: s.gridTemplateColumns !== 'none' ? s.gridTemplateColumns : null,
        bg: s.backgroundColor,
        borderW: s.borderTopWidth,
        radius: s.borderRadius,
        shadow: s.boxShadow === 'none' ? null : s.boxShadow,
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 70),
      };
    };

    // Regiões = filhos diretos do main + elementos com data-region.
    const topLevel = [...main.children].map(describe);
    const regions = [...main.querySelectorAll('[data-region]')].map(describe);

    // "Caixas": qualquer elemento com borda visível, raio ou fundo próprio.
    const boxes = [...main.querySelectorAll('*')]
      .map(describe)
      .filter(
        (d) =>
          Number.parseFloat(d.borderW) > 0 ||
          (d.radius !== '0px' && d.radius !== '') ||
          (d.shadow !== null && d.shadow !== undefined),
      );

    let lowest = 0;
    for (const el of main.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.bottom > lowest) lowest = r.bottom;
    }

    const bgs = new Set(regions.map((r) => r.bg));
    const borders = new Set(
      [...main.querySelectorAll('*')].map((el) => getComputedStyle(el).borderTopColor),
    );

    return {
      vh,
      contentBottom: Math.round(lowest),
      emptyBelow: Math.round(vh - lowest),
      topLevelCount: topLevel.length,
      topLevel,
      regionCount: regions.length,
      regions: regions.slice(0, 25),
      boxCount: boxes.length,
      boxes: boxes.slice(0, 40),
      distinctRegionBgs: [...bgs],
      distinctBorderColors: borders.size,
      headingCount: main.querySelectorAll('h1,h2,h3').length,
      tableCount: main.querySelectorAll('table').length,
      buttonCount: main.querySelectorAll('button,a').length,
    };
  });
}

test.describe('mapa estrutural', () => {
  test.use({ viewport: { width: 1600, height: 900 } });

  test('work-inbox com fila', async ({ page }) => {
    await prepareAuthenticatedSession(page, 'dashboard');
    await page.route('**/api/v1/work-inbox**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(WORK_INBOX_PAGE),
      });
    });
    await page.goto('/app/work-inbox');
    await stabilizePage(page);
    await page.waitForTimeout(500);
    const map = await regionMap(page);
    console.log('MAP_WORKINBOX=' + JSON.stringify(map));
    expect(map).not.toBeNull();
  });

  test('clients workspace', async ({ page }) => {
    await prepareAuthenticatedSession(page, 'clients');
    await page.goto('/app/clients');
    await expect(page.getByRole('table', { name: 'Lista de clientes' })).toBeVisible();
    await stabilizePage(page);
    const map = await regionMap(page);
    console.log('MAP_CLIENTS=' + JSON.stringify(map));
    expect(map).not.toBeNull();
  });

  test('app dashboard', async ({ page }) => {
    await prepareAuthenticatedSession(page, 'dashboard');
    await page.route('**/api/v1/work-inbox**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(WORK_INBOX_PAGE),
      });
    });
    await page.goto('/app');
    await stabilizePage(page);
    await page.waitForTimeout(500);
    const map = await regionMap(page);
    console.log('MAP_DASHBOARD=' + JSON.stringify(map));
    expect(map).not.toBeNull();
  });
});
