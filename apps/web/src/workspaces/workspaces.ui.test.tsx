import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { FinanceOverviewPage } from '../finance/pages/FinanceOverviewPage';
import { createFinanceFetchMock } from '../test/finance-fetch-mock';
import { renderWithProviders } from '../test/render-with-providers';
import { parseRequestPath } from '../test/request-url';
import {
  WORK_DOMAINS,
  type WorkDomain,
  type WorkItem,
  type WorkKind,
} from '../work-inbox/api/work-inbox-api';
import { DomainWorkspacePage } from './pages/DomainWorkspacePage';
import { WorkspacesIndexPage } from './pages/WorkspacesIndexPage';

/**
 * WORKSPACES DE DOMINIO — comportamento da superficie.
 *
 * O que este arquivo prova, e nada alem disso:
 * - a zona AGORA mostra exatamente `byDomain[domain]` do read model (nenhum contador paralelo);
 * - clicar em AGORA abre a Central de trabalho com o MESMO recorte;
 * - a zona ATENCAO so exibe bloqueios e excecoes reais (o recorte por natureza e do servidor);
 * - estado vazio e honesto e dominio indisponivel NAO e apresentado como zero;
 * - no workspace financeiro o trabalho (AGORA/ATENCAO) antecede o bloco de posicao.
 *
 * O fetch e mockado no estilo de `work-inbox.ui.test.tsx`: uma resposta por recorte pedido.
 */

const BLOCKER_REFERENCE = 'FECH-2026-08';
const EXCEPTION_REFERENCE = 'LANC-77';
const OVERDUE_REFERENCE = 'VENC-99';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Sessao valida para o bootstrap do AuthProvider.
 *
 * Sem isto o bootstrap falha, limpa o token e a leitura da fila passa a ser negada — o teste
 * mediria a corrida entre o bootstrap e a pagina, nao o comportamento do workspace.
 */
function sessionResponse(): Response {
  return jsonResponse({
    identityId: '11111111-1111-4111-8111-111111111111',
    session: {
      id: '22222222-2222-4222-8222-222222222222',
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
      status: 'active',
    },
  });
}

function fullByDomain(
  partial: Partial<Record<WorkDomain, number>> = {},
): Record<WorkDomain, number> {
  return WORK_DOMAINS.reduce(
    (accumulator, domain) => {
      accumulator[domain] = partial[domain] ?? 0;
      return accumulator;
    },
    {} as Record<WorkDomain, number>,
  );
}

function workItem(overrides: {
  domain: WorkDomain;
  kind: WorkKind;
  reference: string;
  title: string;
}): WorkItem {
  return {
    id: `${overrides.domain}:${overrides.kind}:${overrides.reference}`,
    domain: overrides.domain,
    kind: overrides.kind,
    businessReference: overrides.reference,
    title: overrides.title,
    contextLabel: 'Unidade Norte',
    status: 'Pendente',
    reason: 'Fato persistido no domínio de origem',
    occurredAt: '2026-09-20T10:00:00.000Z',
    dueAt: '2026-09-24T10:00:00.000Z',
    actionLabel: 'Abrir no domínio',
    targetRoute: '/app/accounting/fechamentos',
    unitId: 'UN-1',
  };
}

type WorkStub = {
  /** Contagem por dominio do read model — a MESMA que a fila exibe no chip. */
  byDomain?: Partial<Record<WorkDomain, number>>;
  unavailableDomains?: string[];
  blockers?: WorkItem[];
  exceptions?: WorkItem[];
  /** Itens que só voltam quando o recorte por natureza NÃO é aplicado (prova do recorte). */
  itemsWithoutKindFilter?: WorkItem[];
  blockerTotal?: number;
  exceptionTotal?: number;
  failure?: 'network';
};

function workInboxResponse(stub: WorkStub, searchParams: URLSearchParams): Response {
  const domain = searchParams.get('domain');
  const kind = searchParams.get('kind');

  if (!domain) {
    // Leitura de AGORA: sem filtro de dominio, `byDomain` cobre o conjunto autorizado inteiro.
    const byDomain = fullByDomain(stub.byDomain);
    return jsonResponse({
      items: [],
      limit: 1,
      offset: 0,
      total: Object.values(byDomain).reduce((sum, value) => sum + value, 0),
      totalPages: 1,
      byDomain,
      unavailableDomains: stub.unavailableDomains ?? [],
    });
  }

  const items =
    kind === 'BLOCKER'
      ? (stub.blockers ?? [])
      : kind === 'EXCEPTION'
        ? (stub.exceptions ?? [])
        : (stub.itemsWithoutKindFilter ?? []);
  const total =
    kind === 'BLOCKER'
      ? (stub.blockerTotal ?? items.length)
      : kind === 'EXCEPTION'
        ? (stub.exceptionTotal ?? items.length)
        : items.length;

  return jsonResponse({
    items,
    limit: 5,
    offset: 0,
    total,
    totalPages: total > 0 ? 1 : 0,
    byDomain: fullByDomain(),
    unavailableDomains: [],
  });
}

function stubWorkFetch(stub: WorkStub) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const { pathname, searchParams } = parseRequestPath(input);
    if (pathname === '/api/v1/auth/session') {
      return sessionResponse();
    }
    if (pathname !== '/api/v1/work-inbox') {
      return jsonResponse({ error: { code: 'UNKNOWN', message: 'Not found' } }, 404);
    }
    if (stub.failure === 'network') {
      throw new TypeError('Failed to fetch');
    }
    return workInboxResponse(stub, searchParams);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Fila real do dominio + os endpoints financeiros que JA existiam na tela. */
function stubFinanceFetch(stub: WorkStub) {
  const financeMock = createFinanceFetchMock();
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { pathname, searchParams } = parseRequestPath(input);
    if (pathname === '/api/v1/work-inbox') {
      return workInboxResponse(stub, searchParams);
    }
    return financeMock(input, init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Financeiro respondendo zero em TODAS as leituras de posicao. */
function stubEmptyFinanceFetch(stub: WorkStub) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const { pathname, searchParams } = parseRequestPath(input);
    if (pathname === '/api/v1/auth/session') {
      return sessionResponse();
    }
    if (pathname === '/api/v1/work-inbox') {
      return workInboxResponse(stub, searchParams);
    }
    if (pathname === '/api/v1/finance/receivables') {
      return jsonResponse([]);
    }
    if (pathname === '/api/v1/finance/payables') {
      return jsonResponse([]);
    }
    if (pathname === '/api/v1/finance/payables/aging') {
      return jsonResponse({
        asOf: '2026-09-01T12:00:00.000Z',
        buckets: { CURRENT: { count: 0, remaining: '0.0000' } },
      });
    }
    if (pathname === '/api/v1/finance/treasury/accounts') {
      return jsonResponse([]);
    }
    return jsonResponse({ error: { code: 'UNKNOWN', message: 'Not found' } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function requestedUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]));
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

describe('workspaces de domínio', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('a zona AGORA mostra exatamente o byDomain do read model, sem contador paralelo', async () => {
    stubWorkFetch({ byDomain: { FISCAL: 3, CONTABILIDADE: 9 } });
    renderWithProviders(<DomainWorkspacePage domain="FISCAL" />, {
      router: { initialEntries: ['/app/workspaces/fiscal'] },
    });

    const agora = await screen.findByRole('link', {
      name: 'Abrir a Central de trabalho filtrada por Fiscal: 3 pendências',
    });
    expect(agora).toHaveAttribute('href', '/app/work-inbox?domain=FISCAL');

    // O trabalho de OUTRO dominio nao vira numero nesta tela.
    expect(screen.queryByText('9')).not.toBeInTheDocument();
  });

  it('clicar em AGORA abre a Central de trabalho com o MESMO recorte', async () => {
    const user = userEvent.setup();
    stubWorkFetch({ byDomain: { FISCAL: 2 } });
    renderWithProviders(
      <Routes>
        <Route path="/app/workspaces/fiscal" element={<DomainWorkspacePage domain="FISCAL" />} />
        <Route path="/app/work-inbox" element={<LocationProbe />} />
      </Routes>,
      { router: { initialEntries: ['/app/workspaces/fiscal'] } },
    );

    await user.click(
      await screen.findByRole('link', {
        name: 'Abrir a Central de trabalho filtrada por Fiscal: 2 pendências',
      }),
    );

    expect(screen.getByTestId('location')).toHaveTextContent('/app/work-inbox?domain=FISCAL');
  });

  it('a zona ATENÇÃO lista somente bloqueios e exceções reais do domínio', async () => {
    const fetchMock = stubWorkFetch({
      byDomain: { CONTABILIDADE: 3 },
      blockers: [
        workItem({
          domain: 'CONTABILIDADE',
          kind: 'BLOCKER',
          reference: BLOCKER_REFERENCE,
          title: 'Fechamento do período bloqueado',
        }),
      ],
      exceptions: [
        workItem({
          domain: 'CONTABILIDADE',
          kind: 'EXCEPTION',
          reference: EXCEPTION_REFERENCE,
          title: 'Lançamento divergente na origem',
        }),
      ],
      // Um vencido do dominio: NAO e bloqueio nem excecao, entao nao entra na zona.
      itemsWithoutKindFilter: [
        workItem({
          domain: 'CONTABILIDADE',
          kind: 'OVERDUE',
          reference: OVERDUE_REFERENCE,
          title: 'Título vencido do domínio',
        }),
      ],
    });

    renderWithProviders(<DomainWorkspacePage domain="CONTABILIDADE" />, {
      router: { initialEntries: ['/app/workspaces/contabilidade'] },
    });

    await screen.findByText(BLOCKER_REFERENCE);
    const atencao = screen.getByRole('region', { name: 'Atenção' });
    expect(within(atencao).getAllByRole('listitem')).toHaveLength(2);
    expect(within(atencao).getByText(EXCEPTION_REFERENCE)).toBeInTheDocument();
    expect(within(atencao).queryByText(OVERDUE_REFERENCE)).not.toBeInTheDocument();

    const urls = requestedUrls(fetchMock);
    expect(
      urls.some((url) => url.includes('domain=CONTABILIDADE') && url.includes('kind=BLOCKER')),
    ).toBe(true);
    expect(
      urls.some((url) => url.includes('domain=CONTABILIDADE') && url.includes('kind=EXCEPTION')),
    ).toBe(true);
    expect(urls.some((url) => url.includes('kind=OVERDUE'))).toBe(false);
  });

  it('estado vazio é honesto: nenhum trabalho e nenhum bloqueio, sem item sintético', async () => {
    stubWorkFetch({ byDomain: {} });
    renderWithProviders(<DomainWorkspacePage domain="SUPRIMENTOS" />, {
      router: { initialEntries: ['/app/workspaces/suprimentos'] },
    });

    expect(await screen.findByText('Nenhum trabalho pendente neste domínio.')).toBeInTheDocument();
    expect(screen.getByText('Nenhum bloqueio ou exceção neste domínio agora.')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Atenção' })).queryAllByRole('listitem'),
    ).toHaveLength(0);
  });

  it('domínio indisponível é declarado indisponível, nunca apresentado como zero', async () => {
    stubWorkFetch({ byDomain: {}, unavailableDomains: ['FISCAL'] });
    renderWithProviders(<DomainWorkspacePage domain="FISCAL" />, {
      router: { initialEntries: ['/app/workspaces/fiscal'] },
    });

    const aviso = await screen.findByRole('status');
    expect(aviso).toHaveTextContent(/não respondeu nesta leitura/i);
    expect(aviso).toHaveTextContent(/não é zero/i);
    expect(screen.queryByText('Nenhum trabalho pendente neste domínio.')).not.toBeInTheDocument();
  });

  it('falha de leitura não vira zero: o workspace diz que não conseguiu ler', async () => {
    stubWorkFetch({ byDomain: {}, failure: 'network' });
    renderWithProviders(<DomainWorkspacePage domain="OPERACOES" />, {
      router: { initialEntries: ['/app/workspaces/operacoes'] },
    });

    const alerts = await screen.findAllByRole('alert');
    expect(
      alerts.some((alert) => /Não foi possível falar com o servidor/.test(alert.textContent ?? '')),
    ).toBe(true);
    expect(screen.queryByText('Nenhum trabalho pendente neste domínio.')).not.toBeInTheDocument();
  });

  it('no workspace financeiro o AGORA e a ATENÇÃO antecedem o bloco de posição', async () => {
    stubFinanceFetch({
      byDomain: { FINANCEIRO: 5 },
      blockers: [
        workItem({
          domain: 'FINANCEIRO',
          kind: 'BLOCKER',
          reference: 'CONC-88',
          title: 'Conciliação bancária travada',
        }),
      ],
    });

    renderWithProviders(<FinanceOverviewPage />, {
      router: { initialEntries: ['/app/finance'] },
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Quantidade de títulos a receber')).toHaveTextContent('2');
    });

    // A contagem do trabalho vem do read model (5), nao da contagem de titulos (2).
    expect(
      await screen.findByRole('link', {
        name: 'Abrir a Central de trabalho filtrada por Financeiro: 5 pendências',
      }),
    ).toBeInTheDocument();
    expect(await screen.findByText('CONC-88')).toBeInTheDocument();

    const headings = screen.getAllByRole('heading').map((heading) => heading.textContent ?? '');
    const agora = headings.indexOf('Agora');
    const atencao = headings.indexOf('Atenção');
    const posicao = headings.indexOf('Posição financeira');

    expect(agora).toBeGreaterThanOrEqual(0);
    expect(atencao).toBeGreaterThan(agora);
    expect(posicao).toBeGreaterThan(atencao);
    // A posicao financeira continua sendo servida: nada foi removido da tela.
    expect(screen.getByRole('table', { name: /aging de contas a pagar/i })).toBeInTheDocument();
  });

  it('posição zerada não vira parede de zeros: diz que não há valores vencidos', async () => {
    stubEmptyFinanceFetch({ byDomain: { FINANCEIRO: 0 } });
    renderWithProviders(<FinanceOverviewPage />, { router: { initialEntries: ['/app/finance'] } });

    expect(await screen.findByText('Não há valores vencidos.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Quantidade de títulos a receber')).not.toBeInTheDocument();
    expect(await screen.findByText('Nenhum trabalho pendente neste domínio.')).toBeInTheDocument();
  });

  it('o índice de workspaces aponta para as rotas canônicas, sem contagem própria', async () => {
    const fetchMock = stubWorkFetch({ byDomain: { COMERCIAL: 7 } });
    renderWithProviders(<WorkspacesIndexPage />, {
      router: { initialEntries: ['/app/workspaces'] },
    });

    expect(screen.getByRole('link', { name: /^Comercial/ })).toHaveAttribute(
      'href',
      '/app/workspaces/comercial',
    );
    expect(screen.getByRole('link', { name: /^Financeiro/ })).toHaveAttribute(
      'href',
      '/app/finance',
    );
    // O indice nao le a fila: contagem pertence ao workspace de cada dominio.
    expect(requestedUrls(fetchMock).some((url) => url.includes('/work-inbox'))).toBe(false);
    expect(screen.queryByText('7')).not.toBeInTheDocument();

    // O bootstrap de sessao do AuthProvider conclui fora do fluxo deste teste: deixa-o assentar
    // para nao registrar atualizacao de estado fora de `act`.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });
});
