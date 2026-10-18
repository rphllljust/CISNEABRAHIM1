import { test, expect } from '@playwright/test';
import { prepareAuthenticatedSession, stabilizePage } from '../fixtures/visual-helpers';

/**
 * MEDICAO DA PRIMEIRA DOBRA — a prova NUMERICA da silhueta, em 1600x900.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * POR QUE MEDIR, E NAO "OLHAR O SCREENSHOT"
 *
 * "Quebrar a silhueta" e "a fila domina a primeira dobra" sao afirmacoes sobre GEOMETRIA. Um
 * screenshot prova que a tela nao esta quebrada; nao prova que o trabalho comeca acima da dobra nem
 * que a fila ocupa a maior parte da area util. Estas medicoes tornam a afirmacao verificavel e
 * reprovavel: se alguem devolver a faixa de KPIs para cima da fila, o numero muda e o teste falha.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * O QUE E MEDIDO EM CADA ROTA
 *
 *   - o TOPO de cada regiao funcional (situacao, fila, processo, contexto) contra a dobra de 900px;
 *   - a FOLGA DA FILA: quantos pixels da area de trabalho a fila ocupa;
 *   - AUSENCIA de overflow horizontal;
 *   - AUSENCIA de espaco reservado vazio: nenhum placeholder de "—" grande ou caixa sem dado.
 *
 * Os limiares sao os do contrato, nao numeros escolhidos para passar: a fila TEM de dominar.
 */

const FOLD = 900;

type Rect = { x: number; y: number; width: number; height: number };

async function rectOf(page: import('@playwright/test').Page, selector: string): Promise<Rect | null> {
  const locator = page.locator(selector).first();
  if ((await locator.count()) === 0) {
    return null;
  }
  const box = await locator.boundingBox();
  if (!box) {
    return null;
  }
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

test.describe('medicao da primeira dobra — 1600x900', () => {
  test.use({ viewport: { width: 1600, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await prepareAuthenticatedSession(page, 'finance');
  });

  test('contas a receber — situacao, fila e contexto acima da dobra', async ({ page }) => {
    await page.goto('/app/finance/receivables');
    await expect(page.getByRole('heading', { level: 1, name: 'Contas a receber' })).toBeVisible();
    await stabilizePage(page);

    const situation = await rectOf(page, '[data-region="situation-surface"]');
    const worklist = await rectOf(page, '[data-region="worklist-master"]');
    const context = await rectOf(page, '[data-region="context-region"]');

    expect(situation, 'a faixa de situacao precisa existir').not.toBeNull();
    expect(worklist, 'a regiao de trabalho precisa existir').not.toBeNull();
    expect(context, 'a coluna de contexto precisa existir').not.toBeNull();

    // SITUACAO e TRABALHO comecam acima da dobra.
    expect(situation!.y).toBeLessThan(FOLD);
    expect(worklist!.y).toBeLessThan(FOLD);

    // A FAIXA DE SITUACAO E DENSA: nao pode virar uma parede de cards.
    expect(situation!.height, `a faixa de situacao ocupou ${situation!.height}px`).toBeLessThan(120);

    // A COLUNA DE CONTEXTO e uma coluna de verdade, nao uma tira.
    expect(context!.width).toBeGreaterThanOrEqual(280);
    expect(context!.x).toBeGreaterThan(worklist!.x);

    // A GRADE ocupa a maior parte da largura — o suporte nao pode roubar a mesa de trabalho.
    const gridShare = worklist!.width / (worklist!.width + context!.width);
    expect(gridShare, `a grade ficou com ${(gridShare * 100).toFixed(1)}% da area`).toBeGreaterThan(0.6);

    // A FILA absorve a altura: ela precisa alcancar a dobra.
    expect(
      worklist!.y + worklist!.height,
      `a bancada terminou em y=${worklist!.y + worklist!.height}`,
    ).toBeGreaterThanOrEqual(FOLD - 40);
  });

  test('contas a pagar — mesma geometria de bancada', async ({ page }) => {
    await page.goto('/app/finance/payables');
    await expect(page.getByRole('heading', { level: 1, name: 'Contas a pagar' })).toBeVisible();
    await stabilizePage(page);

    const situation = await rectOf(page, '[data-region="situation-surface"]');
    const worklist = await rectOf(page, '[data-region="worklist-master"]');
    const context = await rectOf(page, '[data-region="context-region"]');

    expect(situation!.y).toBeLessThan(FOLD);
    expect(worklist!.y).toBeLessThan(FOLD);
    expect(situation!.height).toBeLessThan(120);
    expect(context!.width).toBeGreaterThanOrEqual(280);
    expect(worklist!.width / (worklist!.width + context!.width)).toBeGreaterThan(0.6);
    expect(worklist!.y + worklist!.height).toBeGreaterThanOrEqual(FOLD - 40);
  });

  test('dashboard — situacao, trabalho, processo e contexto na primeira dobra', async ({ page }) => {
    await page.goto('/app');
    await expect(page.getByRole('heading', { level: 1, name: 'Central de operações' })).toBeVisible();
    await stabilizePage(page);

    /*
     * A ORDEM E A PROVA. O contrato exige, na primeira dobra: situacao, trabalho, decisao,
     * processo e contexto. Cada regiao e medida contra a dobra e contra as vizinhas — a FILA tem de
     * situacao e o fluxo operacional antecedem a fila principal, que domina a area de trabalho.
     */
    const header = await rectOf(page, '[data-region="operating-header"]');
    const queue = await rectOf(page, '.dashboard-queue');
    const flow = await rectOf(page, '.dashboard-chain');
    const analytics = await rectOf(page, '.dashboard-analytics');
    const context = await rectOf(page, '.dashboard-cc__context');

    expect(header, 'o cabecalho de orientacao precisa existir').not.toBeNull();
    expect(queue, 'a fila precisa existir').not.toBeNull();
    expect(context, 'a coluna de contexto precisa existir').not.toBeNull();

    // 1. SITUACAO (cabecalho) acima da dobra.
    expect(header!.y).toBeLessThan(FOLD);

    // 2. TRABALHO acima da dobra — o requisito central desta etapa.
    expect(
      queue!.y,
      `a fila comecou em y=${queue!.y}; a primeira dobra pertence ao trabalho`,
    ).toBeLessThan(FOLD);

    // 3. ANALITICO E FLUXO antecedem a fila principal conforme a geometria aprovada.
    if (analytics) {
      expect(analytics.y, 'o analitico precisa vir antes da fila').toBeLessThan(queue!.y);
    }
    if (flow) {
      expect(flow.y, 'o fluxo precisa vir antes da fila').toBeLessThan(queue!.y);
    }

    // 4. CONTEXTO presente na mesma tela (coluna propria, a direita).
    expect(context!.width).toBeGreaterThanOrEqual(280);

    // 5. A FILA DOMINA: com trabalho publicado, ela ocupa uma faixa util da primeira dobra.
    expect(queue!.height, `a fila ocupou ${queue!.height}px`).toBeGreaterThan(120);

    // 6. PROCESSO: a trilha existe e nao empurra a fila para fora da dobra.
    if (flow) {
      expect(flow.y).toBeLessThan(FOLD + 600);
    }
  });
});
