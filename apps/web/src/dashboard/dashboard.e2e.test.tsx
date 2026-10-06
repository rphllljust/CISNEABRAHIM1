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

  it('loads the executive control tower from a single API call', async () => {
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
      expect(screen.getByRole('heading', { name: /central de decis.{1,2}o/i })).toBeInTheDocument();
    });

    const dashboard = within(screen.getByRole('main'));

    // 1+2. FILA DE DECISAO com excecao REAL: a linha existe, e nomeada e traz o volume publicado.
    const criticalRow = dashboard.getByRole('link', { name: /OS vencidas: 3 itens/i });
    expect(criticalRow).toBeInTheDocument();

    // 3. PRAZO/AGING REAL: o atraso publicado pelo servidor aparece como FATO numerico proprio,
    //    independente de a tela escrever "8 d" ou "8 dias". A prova e a semantica, nao a copy.
    const decisionText = criticalRow.textContent ?? '';
    expect(decisionText).toMatch(/\b8\b/);
    expect(decisionText).toMatch(/atraso|d\b/i);

    // 4+8. ACAO NAVEGAVEL: a excecao leva ao recorte REAL que produziu o numero.
    expect(criticalRow).toHaveAttribute('href', '/app/service-orders?filter=overdue');

    // ZONA 2 — resumo do fluxo operacional, com os estagios reais do negocio.
    expect(dashboard.getByRole('heading', { name: /fluxo empresarial/i })).toBeInTheDocument();
    expect(dashboard.getByText('Operação')).toBeInTheDocument();
    expect(dashboard.getByText('Medição')).toBeInTheDocument();
    expect(dashboard.getByText('Recebimento')).toBeInTheDocument();

    // ZONA 3 — CONTEXTO SOB DEMANDA: o drawer nao reserva area sem selecao ativa.
    expect(dashboard.queryByRole('heading', { name: /^contexto$/i })).not.toBeInTheDocument();
    expect(dashboard.getByRole('complementary', { name: /indicadores analíticos/i })).toBeInTheDocument();

    // ANALYTICS COM DADO AUTORITATIVO: distribuicao real, cada barra com drilldown.
    expect(dashboard.getByRole('heading', { name: /ordens por status/i })).toBeInTheDocument();
    expect(dashboard.getByRole('heading', { name: /atraso por faixa/i })).toBeInTheDocument();
    // Cada segmento leva a lista filtrada real que produziu o numero.
    expect(dashboard.getByRole('link', { name: /Em execução: 4 ordens/i })).toHaveAttribute(
      'href',
      '/app/service-orders?status=IN_EXECUTION',
    );
    expect(dashboard.getAllByRole('link', { name: /títulos vencidos/i }).length).toBeGreaterThan(0);

    // Resumo executivo continua na tela.
    expect(dashboard.getByRole('heading', { name: /sa.de da empresa/i })).toBeInTheDocument();

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
    expect(mainElement.querySelectorAll('.dashboard-metric-strip__item').length).toBeGreaterThanOrEqual(1);
    // A LINGUAGEM TECNICA DE IMPLEMENTACAO NAO EXISTE NA TELA.
    expect(mainElement.textContent).not.toMatch(/PARK_BI_GAP|snapshot|backend publica|amostra técnica/i);
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
