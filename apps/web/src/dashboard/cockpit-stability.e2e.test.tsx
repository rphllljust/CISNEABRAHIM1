import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { resetTokenStoreForTests } from '../auth/storage/token-store';
import { createDashboardFetchMock } from '../test/dashboard-fetch-mock';
import { loginAndReachApp } from '../test/login-ui-helpers';
import { requestUrl } from '../test/request-url';
import { createShellFetchMock } from '../test/shell-fetch-mock';

/**
 * ESTRUTURA ESTAVEL DO COCKPIT NA ROTA REAL — `/app` com dado escasso.
 *
 * A tese desta wave e que a interface NAO desmonta quando falta publicacao. Estes testes rodam a
 * rota de verdade e provam, no DOM renderizado:
 *
 *   1. o fluxo mantém o recorte operacional; o business context permanece mesmo sem seleção;
 *   2. a FILA VAZIA nao desmonta o cockpit (cabecalho de grade + superficie reservada);
 *   3. as TRES superficies ANALITICAS permanecem, com estado governado quando nao ha dado;
 *   4. a faixa de KPIs continua com a mesma estrutura.
 *
 * Sem isso, a tela volta ao estado reprovado: conteudo nos primeiros ~470px e o resto em branco.
 */

const EMPTY_INBOX = {
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

function mockApp(workInbox: unknown = EMPTY_INBOX) {
  const shellMock = createShellFetchMock();
  const dashboardMock = createDashboardFetchMock();
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (url.includes('/api/v1/work-inbox')) {
      return new Response(JSON.stringify(workInbox), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/api/v1/dashboard/executive')) {
      return dashboardMock(input, init);
    }
    return shellMock(input, init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('cockpit /app — estrutura estavel com dado escasso', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/login');
  });

  /* O contexto neutro do recorte permanece na support surface; a entidade selecionada evolui
   * esse mesmo espaço. O fluxo continua nomeado e navegável no recorte de Operações. */
  it('keeps the process flow and neutral business context in the operations section', async () => {
    mockApp();
    render(<App />);
    const user = userEvent.setup();
    await loginAndReachApp(user);

    const main = within(screen.getByRole('main'));
    const domains = within(await main.findByRole('group', { name: /recorte por domínio/i }));
    const operations = domains.getByRole('button', { name: /^operações$/i });
    await user.click(operations);

    await waitFor(() => {
      expect(operations).toHaveAttribute('aria-pressed', 'true');
      expect(new URLSearchParams(window.location.search).get('domain')).toBe('OPERACOES');
    });

    const flow = within(await main.findByRole('region', { name: /^fluxo operacional$/i }));
    expect(flow.getByRole('heading', { level: 2, name: /^fluxo operacional$/i })).toBeVisible();
    expect(flow.getByRole('link', { name: /^ordem de serviço:/i })).toHaveAttribute(
      'href',
      '/app/service-orders?status=active',
    );
    const context = main.getByRole('region', { name: /contexto da decisão/i });
    expect(within(context).getByText(/contexto operacional/i)).toBeInTheDocument();
  });

  /*
   * FILA VAZIA NAO DESMONTA O COCKPIT.
   *
   * Zero itens = o cabecalho de colunas CONTINUA, a linha de vazio e compacta e a superficie de
   * grade permanece reservada. O operador reconhece a mesma mesa de trabalho.
   */
  it('does not dismantle the workbench when the queue is empty', async () => {
    mockApp(EMPTY_INBOX);
    render(<App />);
    await loginAndReachApp(userEvent.setup());

    const queue = await screen.findByRole('region', { name: /fila de trabalho do recorte/i });

    // 1. O cabecalho de colunas continua no DOM — a grade nao desaparece.
    expect(within(queue).getByRole('columnheader', { name: /próxima ação/i })).toBeInTheDocument();
    expect(within(queue).getByRole('columnheader', { name: /natureza \/ atraso/i })).toBeInTheDocument();
    expect(within(queue).getByRole('columnheader', { name: /^domínio$/i })).toBeInTheDocument();
    expect(within(queue).queryByRole('columnheader', { name: /prioridade/i })).not.toBeInTheDocument();
    expect(within(queue).queryByRole('columnheader', { name: /responsável/i })).not.toBeInTheDocument();

    // 2. A linha de vazio e UNICA e compacta, na mesma superficie.
    expect(within(queue).getByText(/nenhum trabalho neste recorte/i)).toBeInTheDocument();

    // 3. A superficie reservada continua marcada como tal.
    expect(queue.className).toMatch(/dashboard-queue--empty/);

    // 4. As unicas linhas sao o CABECALHO de colunas e a linha de VAZIO — nenhum dado inventado.
    const rows = within(queue).getAllByRole('row');
    expect(rows).toHaveLength(2);
    const dataRows = queue.querySelectorAll(
      '.dashboard-queue__row:not(.dashboard-queue__row--head)',
    );
    expect(dataRows).toHaveLength(0);
  });

  /*
   * AS TRES SUPERFICIES ANALITICAS PERMANECEM — o que muda e o estado interno.
   *
   * `analytics` sem publicacao nao vira buraco: cada superficie declara o que o servidor NAO
   * entregou, e a de excecoes declara o estado positivo quando nao ha excecao.
   */
  it('keeps the three analytics surfaces, governed by the available data', async () => {
    mockApp();
    render(<App />);
    await loginAndReachApp(userEvent.setup());

    const analytics = await screen.findByRole('region', { name: /análise operacional/i });

    // As tres superficies do cockpit, sempre nomeadas.
    expect(within(analytics).getByRole('heading', { name: /ordens por situação/i })).toBeInTheDocument();
    expect(within(analytics).getByRole('heading', { name: /atraso por faixa/i })).toBeInTheDocument();
    expect(within(analytics).getByRole('heading', { name: /alertas e exceções/i })).toBeInTheDocument();

    // A superficie de excecoes com dado publicado e uma WORKLIST, nao um banner.
    expect(within(analytics).getAllByRole('link').length).toBeGreaterThan(0);
  });

  /* A FAIXA DE KPIs CONTINUA HORIZONTAL E NOMEADA com o recorte ativo. */
  it('keeps the KPI band present and structurally intact', async () => {
    mockApp();
    render(<App />);
    await loginAndReachApp(userEvent.setup());

    const strip = await screen.findByRole('region', { name: /indicadores operacionais/i });
    const cells = within(strip).getAllByRole('link');

    expect(cells.length).toBeGreaterThanOrEqual(5);
    // Toda celula DIZ de qual metrica se trata — inclusive as sem valor publicado.
    for (const cell of cells) {
      expect(cell.textContent?.trim().length).toBeGreaterThan(0);
    }
  });
});
