import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { resetTokenStoreForTests } from '../auth/storage/token-store';
import { createDashboardFetchMock } from '../test/dashboard-fetch-mock';
import { loginAndReachApp } from '../test/login-ui-helpers';
import { requestUrl } from '../test/request-url';
import { createShellFetchMock } from '../test/shell-fetch-mock';

describe('operational dashboard e2e (frontend)', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/login');
  });

  async function login(user: ReturnType<typeof userEvent.setup>) {
    await loginAndReachApp(user);
  }

  it('loads the operational workspace from a single executive API call', async () => {
    const shellMock = createShellFetchMock();
    const dashboardMock = createDashboardFetchMock();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.includes('/api/v1/dashboard/executive') || url.includes('/api/v1/work-inbox')) {
        return dashboardMock(input, init);
      }
      return shellMock(input, init);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    const user = userEvent.setup();
    await login(user);

    const dashboard = within(screen.getByRole('main'));

    /*
     * CENTRAL OPERACIONAL — o contrato estrutural da rota `/app`.
     *
     * A composicao passou a ser: indicadores acionaveis -> analitico (distribuicao | periodo |
     * EXCECOES) -> fluxo -> views/toolbar -> FILA DOMINANTE, com a coluna de contexto ancorada a
     * direita quando ha selecao. A prova abaixo e da ESTRUTURA, nao da copy.
     */
    await waitFor(() => {
      expect(dashboard.getByRole('group', { name: /central operacional/i })).toBeInTheDocument();
    });

    const central = within(dashboard.getByRole('group', { name: /central operacional/i }));

    // EXCECOES — worklist compacta com a contagem REAL publicada, dentro da faixa analitica.
    const exceptions = central.getByRole('region', { name: /alertas e exceções/i });
    const criticalRow = within(exceptions).getByRole('link', { name: /OS vencidas: 3 itens/i });
    expect(criticalRow).toBeInTheDocument();

    // PRAZO/AGING REAL: o atraso publicado pelo servidor aparece como FATO numerico proprio,
    // independente de a tela escrever "8 d" ou "8 dias". A prova e a semantica, nao a copy.
    const decisionText = criticalRow.textContent ?? '';
    expect(decisionText).toMatch(/\b8\b/);
    expect(decisionText).toMatch(/atraso|d\b/i);

    // ACAO NAVEGAVEL: a excecao leva ao recorte REAL que produziu o numero.
    expect(criticalRow).toHaveAttribute('href', '/app/service-orders?filter=overdue');

    // FLUXO OPERACIONAL como cadeia de processo, com os estagios reais do negocio.
    // Escopo pelo NOME da regiao: "Faturamento" tambem e o rotulo de um atalho de modulo, e uma
    // assercao global provaria a existencia do rotulo, nao da ETAPA da cadeia.
    const chain = central.getByRole('region', { name: /fluxo operacional/i });
    for (const stage of [
      'Solicitação',
      'Proposta',
      'Contrato',
      'Ordem de serviço',
      'Medição',
      'Faturamento',
      'Recebimento',
    ]) {
      expect(within(chain).getByText(stage)).toBeInTheDocument();
    }

    // A FILA E O ELEMENTO DOMINANTE — grade real, com cabecalho de colunas e rodape de paginacao.
    const queue = central.getByRole('region', { name: /fila de trabalho do recorte/i });
    expect(within(queue).getByRole('table')).toBeInTheDocument();
    expect(within(queue).getByRole('columnheader', { name: /próxima ação/i })).toBeInTheDocument();
    // A grade publica as referencias REAIS do read model, uma linha por item de trabalho.
    expect(within(queue).getAllByRole('button', { name: /^SO-\d{4}-\d{6}$/ }).length).toBeGreaterThan(0);
    // Rodape com paginacao real, sempre visivel sob a grade.
    expect(within(queue).getByRole('button', { name: 'Próxima' })).toBeInTheDocument();

    // VIEWS DA FILA — tabs reais, mapeadas para recortes que o servidor executa.
    expect(central.getByRole('button', { name: 'Bloqueios' })).toHaveAttribute('aria-pressed', 'false');
    expect(central.getByRole('button', { name: 'Fila completa' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // A COLUNA DE CONTEXTO NAO RESERVA AREA SEM SELECAO ATIVA.
    expect(
      dashboard.queryByRole('complementary', { name: /contexto da entidade selecionada/i }),
    ).not.toBeInTheDocument();

    // FAIXA DE INDICADORES: cada numero tem drill para o recorte que o produziu.
    const kpiStrip = central.getByRole('region', { name: /indicadores operacionais/i });
    expect(
      within(kpiStrip).getByLabelText(/Ordens de serviço vencidas: 3 ordens/i),
    ).toHaveAttribute('href', '/app/service-orders?filter=overdue');
    expect(
      within(kpiStrip).getByLabelText(/Recebíveis vencidos: 2 títulos/i),
    ).toHaveAttribute('href', '/app/finance/receivables?status=OVERDUE');

    // ANALYTICS COM DADO AUTORITATIVO: distribuicao real, cada barra com drilldown.
    expect(central.getByRole('heading', { name: /ordens por situação/i })).toBeInTheDocument();
    expect(central.getByRole('heading', { name: /atraso por faixa/i })).toBeInTheDocument();
    expect(central.getByRole('link', { name: /Em execução: 4 ordens/i })).toHaveAttribute(
      'href',
      '/app/service-orders?status=IN_EXECUTION',
    );
    expect(central.getAllByRole('link', { name: /títulos vencidos/i }).length).toBeGreaterThan(0);

    // Resumo executivo continua na tela.
    expect(central.getByRole('heading', { name: /sa.de da empresa/i })).toBeInTheDocument();

    const dashboardCalls = fetchMock.mock.calls.filter(([callInput]) =>
      requestUrl(callInput).includes('/api/v1/dashboard/executive'),
    );
    expect(dashboardCalls.length).toBeGreaterThanOrEqual(1);
    expect(requestUrl(dashboardCalls[0]![0])).toContain('period=week');

    // BI RUNTIME UI WIRING: as ancoras semanticas continuam no DOM da rota /app.
    const mainElement = screen.getByRole('main');
    const productivity = mainElement.querySelector('[data-bi-metrics*="productivity.completed_count"]');
    expect(productivity).not.toBeNull();
    // metrica BLOCKED nunca e renderizada como card valido
    expect(
      mainElement.querySelectorAll('[data-bi-metrics*="overdue_count_by_finalized_billing_documents"]'),
    ).toHaveLength(0);
    // METRIC STRIP: os indicadores sao LINHAS compactas, nao a grade de cards do painel anterior.
    expect(mainElement.querySelectorAll('.dashboard-kpi')).toHaveLength(0);
    expect(mainElement.querySelectorAll('.dashboard-kpi-list__item').length).toBeGreaterThanOrEqual(1);
    /*
     * O CABECALHO ESCURO NAO EXISTE MAIS — o workspace opera em tema claro e a faixa de contexto e
     * densa. `dashboard-command` era o bloco teal/slate de ~200px que dominava a primeira dobra.
     */
    expect(mainElement.querySelectorAll('[class*="dashboard-command"]')).toHaveLength(0);
    expect(mainElement.querySelector('.dashboard-workspace-head')).not.toBeNull();
    /*
     * LINGUAGEM TECNICA DE IMPLEMENTACAO NAO EXISTE NA TELA.
     *
     * O que se prova aqui e o que a TELA gera. `detail`/`summary` sao texto do servidor: se ele
     * publicar "8 dia(s)", a tela repassa — isso e contrato de dados, nao copy de apresentacao.
     * A varredura cobre, portanto, os rotulos e estados que o frontend escreve.
     */
    expect(mainElement.textContent).not.toMatch(/PARK_BI_GAP|snapshot executivo|backend|amostra técnica/i);
  });

  it('keeps domain and overdue operational recorte in the URL', async () => {
    const shellMock = createShellFetchMock();
    const dashboardMock = createDashboardFetchMock();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.includes('/api/v1/dashboard/executive')) {
        return dashboardMock(input, init);
      }
      return shellMock(input, init);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    const user = userEvent.setup();
    await login(user);

    await user.click(await screen.findByRole('button', { name: 'Financeiro' }));
    await waitFor(() => expect(window.location.search).toContain('domain=FINANCEIRO'));

    await user.click(screen.getByRole('checkbox', { name: 'Somente vencidos' }));
    await waitFor(() => expect(window.location.search).toContain('overdue=true'));

    expect(
      fetchMock.mock.calls.some(([callInput]) => {
        const url = requestUrl(callInput);
        return url.includes('/api/v1/work-inbox') && url.includes('domain=FINANCEIRO') && url.includes('overdue=true');
      }),
    ).toBe(true);
  });

  it('reflects period filter in URL when user changes period', async () => {
    const shellMock = createShellFetchMock();
    const dashboardMock = createDashboardFetchMock();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.includes('/api/v1/dashboard/executive')) {
        return dashboardMock(input, init);
      }
      return shellMock(input, init);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    const user = userEvent.setup();
    await login(user);

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Período' })).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Período' }), 'month');

    await waitFor(() => {
      expect(window.location.search).toContain('period=month');
      expect(fetchMock.mock.calls.some(([callInput]) => requestUrl(callInput).includes('period=month'))).toBe(
        true,
      );
    });
  });
});
