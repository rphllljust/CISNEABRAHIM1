import { test, expect } from '@playwright/test';
import { prepareAuthenticatedSession, stabilizePage } from '../fixtures/visual-helpers';

/**
 * PROVA VISUAL DA FILA DECISORIA — Visao geral em 1440x900.
 *
 * O fixture generico de `dashboard` nao mocka `/work-inbox`, entao a fila nao era exercitada na
 * captura anterior. Aqui o read model da fila e mockado SOMENTE DENTRO DESTE SPEC, com o contrato
 * REAL de `WorkInboxPage` (items/limit/offset/total/totalPages/byDomain/unavailableDomains) e um
 * item real com `dueAt` no passado. NENHUMA linha de codigo de producao foi alterada para a fila
 * aparecer — a prova e do que a tela faz com o dado que o servidor entrega.
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
      status: 'OVERDUE',
      reason: 'Prazo de execução vencido e ainda sem conclusão registrada',
      occurredAt: '2026-08-01T10:00:00.000Z',
      dueAt: '2026-08-19T10:00:00.000Z',
      actionLabel: 'Abrir ordem',
      targetRoute: '/app/service-orders',
      unitId: 'UN-DEV-001',
    },
  ],
  limit: 6,
  offset: 0,
  total: 1,
  totalPages: 1,
  byDomain: {
    FINANCEIRO: 0,
    FISCAL: 0,
    CONTABILIDADE: 0,
    OPERACOES: 1,
    COMERCIAL: 0,
    SUPRIMENTOS: 0,
  },
  unavailableDomains: [],
};

test.describe('visao geral — fila decisoria exercitada', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('primeira dobra com fila, excecao, acao, contexto e fluxo', async ({ page }) => {
    /*
     * ORDEM IMPORTA: `prepareAuthenticatedSession` instala o mock global de toda a API. O
     * Playwright avalia handlers na ordem INVERSA do registro, entao o handler da fila tem de ser
     * registrado DEPOIS do login — senao o catch-all do fixture o suplanta e a chamada escapa para
     * o dev server (era isso que produzia 404 e 200 para a MESMA rota).
     */
    await prepareAuthenticatedSession(page, 'dashboard');
    await expect(page.getByRole('heading', { level: 1, name: /visão geral/i })).toBeVisible();

    await page.route('**/api/v1/work-inbox**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(WORK_INBOX_PAGE),
      });
    });

    // Recarrega JA com o intercept da fila ativo: a prova e desta renderizacao.
    await page.goto('/app');
    await expect(page.getByRole('heading', { level: 1, name: /visão geral/i })).toBeVisible();
    await stabilizePage(page);

    const fold = 900;

    // 1. FILA DECISORIA visivel, com o item REAL da fila.
    const queueHeading = page.getByRole('heading', { name: /minha fila/i });
    await expect(queueHeading).toBeVisible();
    expect((await queueHeading.boundingBox())!.y).toBeLessThan(fold);

    // 2. EXCECAO real: o atraso derivado do dueAt persistido aparece como fato.
    const overdueRow = page.locator('article').filter({ hasText: 'OS-2026-0184' }).first();
    await expect(overdueRow).toBeVisible();
    expect((await overdueRow.textContent()) ?? '').toMatch(/dia/i);

    // 3. ACAO REAL: o item da fila entrega uma acao semantica.
    await expect(page.getByRole('button', { name: /abrir ordem/i }).first()).toBeVisible();

    // 4. CONTEXTO do item selecionado (a fila auto-seleciona o primeiro item).
    const contextPanel = page.getByRole('complementary', { name: /contexto executivo/i });
    await expect(contextPanel).toBeVisible();
    await expect(contextPanel.getByText('OS-2026-0184')).toBeVisible();

    // 5. RESUMO OPERACIONAL / FLUXO.
    await expect(page.getByRole('heading', { name: /fluxo empresarial/i })).toBeVisible();
    await expect(page.getByText('Operação')).toBeVisible();
    await expect(page.getByText('Recebimento')).toBeVisible();

    // 6. CENTRAL DE DECISAO visivel na primeira dobra.
    const decision = page.getByRole('heading', { name: /central de decisão/i });
    expect((await decision.boundingBox())!.y).toBeLessThan(fold);

    // 7. NENHUMA LINGUAGEM TECNICA DE IMPLEMENTACAO NA TELA.
    const text = (await page.locator('#main-content').textContent()) ?? '';
    expect(text).not.toMatch(/PARK_BI_GAP|snapshot executivo|backend publica|amostra técnica/i);

    // 8. SEM OVERFLOW HORIZONTAL / CORTE.
    const overflow = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      mainScrollW: document.querySelector('#main-content')!.scrollWidth,
    }));
    expect(overflow.scrollW).toBeLessThanOrEqual(overflow.clientW + 1);
    expect(overflow.mainScrollW).toBeLessThanOrEqual(overflow.clientW + 1);

    await page.screenshot({ path: 'tmp-dashboard-1440.png', fullPage: false });
  });
});
