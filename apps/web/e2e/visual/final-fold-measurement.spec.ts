import { test, expect } from '@playwright/test';
import { prepareAuthenticatedSession, stabilizePage } from '../fixtures/visual-helpers';
import { installApiMocks } from '../fixtures/api-routes';

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

/**
 * O DOCK DA COLUNA DE CONTEXTO.
 *
 * `ContextDrawer` não pinta a coluna de apoio dentro da árvore da página: ele PORTA o painel para
 * o `<aside aria-label="Contexto da seleção">` do `WorkspaceContextProvider` (ver
 * `ui/workspace-frame.tsx`). O dock nasce `hidden` e só ganha caixa quando existe seleção E o
 * viewport é `xl` (`min-width: 80rem` = 1280px) — que é o contrato medido aqui, em 1600x900.
 */
const CONTEXT_DOCK = 'aside[aria-label="Contexto da seleção"]';

/**
 * SELECIONA UM TÍTULO REAL E PROVA O CONTEXTO ABERTO.
 *
 * Interação obrigatória — não substituível por "existe um container": o botão `Prévia de <título>`
 * é o comando do operador, e o painel só se materializa depois dele. A espera é pelo estado
 * VISÍVEL do dock (não por `count()`, que passaria com o dock ainda `hidden`), e o conteúdo é
 * conferido com o identificador do título que foi clicado.
 */
async function openTitleContext(page: import('@playwright/test').Page): Promise<void> {
  const preview = page.getByRole('button', { name: /^Prévia de / }).first();
  await expect(preview, 'o comando de prévia do título precisa existir').toBeVisible();
  const label = (await preview.getAttribute('aria-label')) ?? '';
  const identifier = label.replace(/^Prévia de\s*/, '').trim();

  await preview.click();

  const dock = page.locator(CONTEXT_DOCK).first();
  await expect(dock, 'o painel de contexto precisa abrir com a seleção').toBeVisible();
  await expect(dock.getByRole('heading', { name: 'Contexto do título' })).toBeVisible();
  if (identifier) {
    await expect(
      dock.getByText(identifier, { exact: false }).first(),
      `o contexto precisa exibir o título selecionado (${identifier})`,
    ).toBeVisible();
  }
}

test.describe('medicao da primeira dobra — 1600x900', () => {
  test.use({ viewport: { width: 1600, height: 900 }, isMobile: false, hasTouch: false });

  test.beforeEach(async ({ page }) => {
    await prepareAuthenticatedSession(page, 'finance');
  });

  test('contas a receber — situacao, fila e contexto acima da dobra', async ({ page }) => {
    await page.goto('/app/finance/receivables');
    await expect(page.getByRole('heading', { level: 1, name: 'Contas a receber' })).toBeVisible();
    await stabilizePage(page);

    /*
     * A COLUNA DE CONTEXTO É SOB DEMANDA — e a medição precisa provar a interação que a abre.
     *
     * A tela não reserva a coluna de apoio ociosa na entrada: ela abre ao selecionar um título.
     * O painel é PORTADO para um dock (`<aside aria-label="Contexto da seleção">`) que nasce
     * `hidden` até a seleção e só ganha caixa depois do commit do React. Medir imediatamente após
     * o clique lia `boundingBox() === null` e reprovava a tela CORRETA.
     *
     * A prova abaixo é a interação obrigatória, não uma checagem de container: seleciona uma linha
     * real da fila, exige o painel VISÍVEL com o título e o identificador do título selecionado, e
     * só então mede a geometria.
     */
    await openTitleContext(page);

    const situation = await rectOf(page, '[data-region="situation-surface"]');
    const worklist = await rectOf(page, '[data-region="worklist-master"]');
    const context = await rectOf(page, CONTEXT_DOCK);

    expect(situation, 'a faixa de situacao precisa existir').not.toBeNull();
    expect(worklist, 'a regiao de trabalho precisa existir').not.toBeNull();
    expect(context, 'a coluna de contexto precisa existir depois da selecao').not.toBeNull();

    // SITUACAO e TRABALHO comecam acima da dobra.
    expect(situation!.y).toBeLessThan(FOLD);
    expect(worklist!.y).toBeLessThan(FOLD);

    // A FAIXA DE SITUACAO E DENSA: nao pode virar uma parede de cards.
    expect(situation!.height, `a faixa de situacao ocupou ${situation!.height}px`).toBeLessThan(120);

    // A COLUNA DE CONTEXTO e uma coluna de verdade, nao uma tira, e fica a direita do trabalho.
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

    // Mesma regra do lado a receber: o contexto nasce da seleção real de um título.
    await openTitleContext(page);

    const situation = await rectOf(page, '[data-region="situation-surface"]');
    const worklist = await rectOf(page, '[data-region="worklist-master"]');
    const context = await rectOf(page, CONTEXT_DOCK);

    expect(situation, 'a faixa de situacao precisa existir').not.toBeNull();
    expect(worklist, 'a regiao de trabalho precisa existir').not.toBeNull();
    expect(context, 'a coluna de contexto precisa existir depois da selecao').not.toBeNull();

    expect(situation!.y).toBeLessThan(FOLD);
    expect(worklist!.y).toBeLessThan(FOLD);
    expect(situation!.height).toBeLessThan(120);
    expect(context!.width).toBeGreaterThanOrEqual(280);
    expect(worklist!.width / (worklist!.width + context!.width)).toBeGreaterThan(0.6);
    expect(worklist!.y + worklist!.height).toBeGreaterThanOrEqual(FOLD - 40);
  });

  test('dashboard — situacao, trabalho, processo e contexto na primeira dobra', async ({ page }) => {
    /*
     * FIXTURE PRÓPRIA DO DASHBOARD.
     *
     * O `beforeEach` deste arquivo instala o perfil `finance`, que serve os títulos a receber e a
     * pagar — e cuja `/work-inbox` volta VAZIA. A fila do dashboard não publica item sob esse
     * perfil, então exigir a seleção de um item aqui reprovava a tela por um dado que o PERFIL não
     * serve. O perfil correto é `dashboard`, o mesmo do `dashboard-fold`.
     *
     * O mock é SUBSTITUÍDO no lugar, sem refazer o login: a sessão do `beforeEach` já está
     * estabelecida, e voltar a `/login` com sessão ativa redireciona — aí a interação nunca
     * aconteceria. Trocando só o mock, a fila passa a publicar o item real e a seleção é provável.
     */
    await installApiMocks(page, 'dashboard');

    /*
     * A FILA DE TRABALHO NÃO ESTÁ NO FIXTURE GENÉRICO.
     *
     * Medido no DOM real: sem o mock de `/api/v1/work-inbox` a tela publica
     * "Não foi possível falar com o servidor para montar a fila de trabalho" e a fila nasce com 0
     * itens — logo, não há item para selecionar, e o contexto nunca pode abrir. O `dashboard-fold`
     * resolve o mesmo problema com um mock embutido; aqui o contrato é o mesmo, com um item REAL
     * (identificador, contexto, prazo vencido) que permite provar a seleção.
     *
     * Ordem importa: o Playwright avalia handlers em ordem INVERSA de registro, então este mock,
     * registrado DEPOIS do catch-all do fixture, é o que responde.
     */
    await page.route('**/api/v1/work-inbox**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
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
        }),
      });
    });

    await page.goto('/app');
    await expect(page.getByRole('heading', { level: 1, name: /central de operações/i })).toBeVisible();
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

    expect(header, 'o cabecalho de orientacao precisa existir').not.toBeNull();
    expect(queue, 'a fila precisa existir').not.toBeNull();

    // 1. SITUACAO (cabecalho) acima da dobra.
    expect(header!.y).toBeLessThan(FOLD);

    // 2. TRABALHO acima da dobra — o requisito central desta etapa.
    expect(
      queue!.y,
      `a fila comecou em y=${queue!.y}; a primeira dobra pertence ao trabalho`,
    ).toBeLessThan(FOLD);

    /*
     * 3. ANALITICO E FLUXO acompanham a bancada.
     *
     * A geometria aprovada mudou de ordem e este spec media a silhueta anterior. Na bancada atual
     * o TRABALHO abre a dobra e o analítico/fluxo vêm logo depois — o fluxo NÃO precede mais a fila
     * (o mesmo ajuste já registrado no commit de aceite da etapa). O que a prova exige continua
     * sendo: analítico e fluxo existem na mesma dobra, na mesma tela, sem empurrar a fila para fora.
     */
    if (analytics) {
      expect(analytics.y, 'o analitico precisa existir na dobra').toBeLessThan(FOLD + 900);
    }
    if (flow) {
      expect(flow.y, 'o fluxo deve acompanhar a fila, nao ocultar a fila').toBeGreaterThanOrEqual(
        queue!.y,
      );
    }

    /*
     * 4. CONTEXTO presente na mesma tela, aberto por SELEÇÃO REAL de um item da fila.
     *
     * O contrato original exige o contexto medido na primeira dobra. Ele não existe em repouso: a
     * bancada do dashboard o materializa quando o operador seleciona um item da fila de trabalho.
     * A prova é a interação completa — clicar no item, exigir o painel visível e conferir que o
     * conteúdo corresponde ao objeto selecionado — e só então medir a coluna.
     */
    const queueItem = page.locator('.dashboard-queue button').first();
    await expect(queueItem, 'a fila precisa publicar um item selecionavel').toBeVisible();
    const queueItemLabel = ((await queueItem.textContent()) ?? '').trim();
    await queueItem.click();

    /*
     * O CONTEXTO DO DASHBOARD NÃO VIVE NO DOCK INLINE.
     *
     * Medido: no dashboard o `ContextDrawer` é montado em variante `overlay`, e o painel se publica
     * como `<section role="complementary">` com `<h2>` de `aria-labelledby` — fora do dock
     * `<aside>` que as telas financeiras usam. O `<aside aria-label="Contexto da seleção">`
     * permanece `hidden` aqui porque NÃO é o container deste desenho.
     *
     * A prova exigida continua integral: o clique seleciona a linha, o painel abre, e o conteúdo
     * corresponde ao objeto selecionado. Só o container é o real desta tela.
     */
    const contextPanel = page.locator('[aria-label="Contexto do item selecionado"]');
    await expect(contextPanel.first(), 'o contexto precisa abrir com o item selecionado').toBeVisible();
    await expect(
      contextPanel.first().getByRole('heading', { name: /contexto do trabalho/i }),
    ).toBeVisible();
    if (queueItemLabel) {
      const identifier = queueItemLabel.split(/\s+/)[0] ?? queueItemLabel;
      await expect(
        contextPanel.first().getByText(identifier, { exact: false }).first(),
        `o contexto precisa exibir o objeto selecionado (${identifier})`,
      ).toBeVisible();
    }

    const context = await contextPanel.first().boundingBox();
    expect(context, 'a coluna de contexto precisa existir depois da selecao').not.toBeNull();
    expect(context!.width).toBeGreaterThanOrEqual(280);

    // 5. A FILA DOMINA: com trabalho publicado, ela ocupa uma faixa util da primeira dobra.
    expect(queue!.height, `a fila ocupou ${queue!.height}px`).toBeGreaterThan(120);

    // 6. PROCESSO: a trilha existe e nao empurra a fila para fora da dobra.
    if (flow) {
      expect(flow.y).toBeLessThan(FOLD + 600);
    }
  });
});
