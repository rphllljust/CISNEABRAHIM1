import { test, expect } from '@playwright/test';
import { prepareAuthenticatedSession, stabilizePage } from '../fixtures/visual-helpers';

/**
 * CAPTURA DE PROVA — geometria de `/app` em 1728x900.
 *
 * Este spec NAO e um gate de regressao: ele RENDERIZA a rota e mede a geometria real (sidebar,
 * topbar, header, KPI, analitico, fluxo, toolbar, grid, rodape, drawer) contra a especificacao de
 * central operacional. O numero medido e a prova — screenshot sozinho nao mede nada.
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
    {
      id: 'wi-3',
      domain: 'OPERACOES',
      kind: 'APPROVAL',
      businessReference: 'SO-2026-000042',
      title: 'Medição aguardando aprovação',
      contextLabel: 'Unidade Sul',
      status: 'Pendente',
      reason: 'Medição aguardando análise',
      occurredAt: '2026-08-12T10:00:00.000Z',
      dueAt: null,
      actionLabel: 'Revisar medição',
      targetRoute: '/app/billing',
      unitId: 'UN-DEV-001',
    },
  ],
  limit: 50,
  offset: 0,
  total: 3,
  totalPages: 1,
  byDomain: {
    FINANCEIRO: 1,
    FISCAL: 0,
    CONTABILIDADE: 0,
    OPERACOES: 2,
    COMERCIAL: 0,
    SUPRIMENTOS: 0,
  },
  unavailableDomains: [],
};

async function measure(page: import('@playwright/test').Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  return box ? { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) } : null;
}

test.describe('prova de geometria /app', () => {
  test.use({ viewport: { width: 1728, height: 900 } });

  test('mede a central operacional em 1728x900', async ({ page }) => {
    await prepareAuthenticatedSession(page, 'dashboard');
    await page.route('**/api/v1/work-inbox**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(WORK_INBOX_PAGE),
      });
    });
    await page.goto('/app');
    await expect(page.getByRole('heading', { level: 1, name: /visão geral/i })).toBeVisible();
    await stabilizePage(page);

    const report: Record<string, unknown> = {};
    for (const [name, sel] of Object.entries({
      sidebar: 'aside.shell__sidebar',
      topbar: 'header.shell__topbar',
      header: '.dashboard-workspace-head',
      kpiStrip: '.dashboard-kpi-strip__list',
      analytics: '.dashboard-analytics',
      flow: '.dashboard-chain',
      toolbar: '.dashboard-queuebar',
      queue: '.dashboard-queue',
      queueHead: '.dashboard-queue__head',
      gridHead: '.dashboard-queue__row--head',
      firstRow: '.dashboard-queue__row:not(.dashboard-queue__row--head)',
      footer: '.dashboard-queue__footer',
    })) {
      report[name] = await measure(page, sel);
    }

    report.kpiCount = await page.locator('.dashboard-kpi-cell').count();
    report.analyticsPanels = await page.locator('.dashboard-analytics > *').count();
    report.rowCount = await page.locator('.dashboard-queue__row:not(.dashboard-queue__row--head)').count();
    report.analyticsCols = await page.locator('.dashboard-analytics').evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns,
    );
    report.deadSpace = await page.evaluate(() => {
      const q = document.querySelector('.dashboard-queue');
      return q ? Math.round(window.innerHeight - q.getBoundingClientRect().bottom) : null;
    });
    report.horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    await page.screenshot({ path: 'tmp-proof-fold-1728.png', fullPage: false });
    console.log('GEOMETRY_1728=' + JSON.stringify(report, null, 2));

    // ESTADO B — selecao abre o drawer SEM overlay e SEM perder a fila.
    await page.locator('.dashboard-queue__ref').first().click();
    await expect(page.getByRole('complementary', { name: /contexto da entidade selecionada/i })).toBeVisible();
    const ctx: Record<string, unknown> = {};
    ctx.contextColumn = await measure(page, '.dashboard-cc__context');
    ctx.queueWithDrawer = await measure(page, '.dashboard-queue');
    ctx.drawerPanel = await measure(page, '.dashboard-context-drawer');
    ctx.ccGrid = await page.locator('.dashboard-cc').evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns,
    );
    ctx.scrimCount = await page.locator('.fixed.inset-0').count();
    await page.screenshot({ path: 'tmp-proof-drawer-1728.png', fullPage: false });
    console.log('GEOMETRY_DRAWER=' + JSON.stringify(ctx, null, 2));
  });
});
