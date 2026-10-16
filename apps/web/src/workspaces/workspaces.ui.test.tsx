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
  /**
   * Itens que só voltam quando o recorte `overdue=true` é aplicado.
   *
   * O stub precisa honrar ESTE recorte como honra `kind`/`domain`: um mock que devolve a mesma lista
   * para qualquer recorte faz o teste passar sem provar que o recorte foi pedido — e é exatamente o
   * defeito que um recorte rápido silenciosamente ignorado produziria em produção.
   */
  overdueOnly?: WorkItem[];
  blockerTotal?: number;
  exceptionTotal?: number;
  failure?: 'network';
};

function workInboxResponse(stub: WorkStub, searchParams: URLSearchParams): Response {
  const domain = searchParams.get('domain');
  const kind = searchParams.get('kind');
  const overdue = searchParams.get('overdue') === 'true';

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

  /*
   * ORDEM DO RECORTE — igual à do servidor: `kind` primeiro, `overdue` depois. Os itens
   * "somente vencidos" NÃO aparecem nas leituras sem o recorte, e os demais NÃO aparecem com ele.
   */
  if (overdue) {
    const items = stub.overdueOnly ?? [];
    return jsonResponse({
      items,
      limit: 6,
      offset: 0,
      total: items.length,
      totalPages: items.length > 0 ? 1 : 0,
      byDomain: fullByDomain(),
      unavailableDomains: [],
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
    limit: 6,
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
  /*
   * PAGINA VAZIA — a forma REAL do contrato de titulos: `{ items, limit, offset, total,
   * totalPages }`. Antes o stub devolvia `[]` (lista crua), o que nao e o payload publicado pelo
   * endpoint: a tela lia `items` de um array e caia. Corrigir o stub e o que torna o cenario
   * "posicao zerada" um cenario de verdade — e nao uma resposta que o servidor nunca da.
   */
  const emptyTitlePage = { items: [], limit: 100, offset: 0, total: 0, totalPages: 0 };
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const { pathname, searchParams } = parseRequestPath(input);
    if (pathname === '/api/v1/auth/session') {
      return sessionResponse();
    }
    if (pathname === '/api/v1/work-inbox') {
      return workInboxResponse(stub, searchParams);
    }
    if (pathname === '/api/v1/finance/receivables') {
      return jsonResponse(emptyTitlePage);
    }
    if (pathname === '/api/v1/finance/payables') {
      return jsonResponse(emptyTitlePage);
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

    /*
     * A assercao e ESCOPADA a zona AGORA.
     *
     * O workspace passou a ter mais de uma regiao que fala sobre o estado da leitura — a zona AGORA
     * e a fila de trabalho declararam cada uma o seu `role="status"`. Um `findByRole('status')` sem
     * escopo passou a encontrar dois elementos e a falhar, mas o que este teste protege sempre foi a
     * afirmacao DA ZONA DE CONTAGEM: dominio indisponivel nao vira zero. Escopar mantem a prova
     * intacta; enfraquecer o seletor (pegar o primeiro) e que a teria destruido.
     */
    const agora = within(await screen.findByRole('region', { name: 'Agora' }));
    const aviso = await agora.findByRole('status');
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

    await userEvent.setup().click(
      await screen.findByRole('button', { name: 'Contexto do processo' }),
    );
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

    /*
     * ═══════════════════════════════════════════════════════════════════════════════════════════
     * COMPOSICAO DA CENTRAL FINANCEIRA — A ASSERCAO MUDOU PORQUE A COMPOSICAO MUDOU.
     *
     * ANTES: o teste protegia uma ORDEM VERTICAL — excecao, posicao, AGORA, ATENCAO — porque a tela
     * era uma PILHA de faixas no mesmo eixo vertical.
     *
     * O QUE A MEDICAO REVELOU: essa pilha media 2972px de altura numa viewport de 900px (3,3
     * viewports). A ordem estava certa e o resultado estava errado: com tudo no mesmo eixo, a FILA
     * DE TRABALHO nunca aparecia junto do que ela significa, e o operador precisava rolar mais de
     * duas telas para alcancar o primeiro titulo acionavel.
     *
     * AGORA a tela usa `WorkspaceBody`: a FILA ocupa o eixo principal e o CONTEXTO fica na coluna de
     * apoio (320-380px). A "ordem" deixa de ser uma sequencia vertical e passa a ser uma RELACAO
     * ENTRE REGIOES — por isso o teste verifica ESTRUTURA, e nao indices de heading.
     *
     * O que continua protegido, e e o que importa:
     *   1. a fila de trabalho E a regiao principal;
     *   2. excecoes, posicao e as filas do dominio (AGORA/ATENCAO) continuam SERVIDAS — nada foi
     *      removido da tela;
     *   3. o contexto nao esta dentro do eixo da fila: ele e IRMAO dela na divisao.
     * ═══════════════════════════════════════════════════════════════════════════════════════════
     */
    const split = document.querySelector('[data-region="work-split"]');
    expect(split, 'a Central Financeira deve declarar a divisao principal').not.toBeNull();

    const mainColumn = split!.firstElementChild;
    const supportColumn = split!.lastElementChild;
    expect(mainColumn, 'a divisao precisa de uma coluna principal').not.toBeNull();
    expect(supportColumn, 'a divisao precisa de uma coluna de apoio').not.toBeNull();

    /* 1. A FILA DE TRABALHO E A REGIAO PRINCIPAL — o trabalho, no eixo principal. */
    expect(mainColumn!.textContent ?? '').toContain('Fila financeira');

    /*
     * 2. O CONTEXTO E IRMAO DA FILA, NAO DESCENDENTE — esta e a garantia estrutural de que a coluna
     *    de apoio nao empurra o trabalho para baixo.
     */
    expect(supportColumn!.contains(mainColumn)).toBe(false);
    expect(mainColumn!.contains(supportColumn)).toBe(false);

    /* 3. NADA FOI REMOVIDO: excecoes, posicao, AGORA/ATENCAO e a posicao financeira continuam. */
    expect(headings).toContain('Exceções financeiras');
    expect(await screen.findByText('CONC-88')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: /aging de contas a pagar/i })).toBeInTheDocument();

    /* 4. A SUPERFICIE DE APOIO E DISTINTA DO TRABALHO — o painel de contexto pinta a camada LEVEL 2. */
    expect(
      supportColumn!.innerHTML,
      'a coluna de apoio deve declarar a superficie de contexto',
    ).toContain('surface-context');
  });

  it('posição zerada não vira parede de zeros: diz que não há títulos nem contas', async () => {
    stubEmptyFinanceFetch({ byDomain: { FINANCEIRO: 0 } });
    renderWithProviders(<FinanceOverviewPage />, { router: { initialEntries: ['/app/finance'] } });

    const contextToggle = await screen.findByRole('button', { name: 'Contexto do processo' });
    expect(contextToggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.setup().click(contextToggle);

    /*
     * A frase mudou com a leitura: a posicao zerada nao afirma apenas "nada vencido" — ela diz que
     * NAO HA TITULO NEM CONTA, que e o fato que o servidor publicou (total 0 nas duas carteiras e
     * nenhuma conta devolvida pela tesouraria). Zero continua sendo zero declarado, e nao uma
     * parede de zeros: os indicadores nao sao renderizados.
     */
    expect(
      await screen.findByText('Não há títulos nem contas na posição financeira.'),
    ).toBeInTheDocument();
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

/**
 * FILA DE TRABALHO DO WORKSPACE — a zona que faltava.
 *
 * O workspace tinha AGORA, ATENCAO e CONTINUAR: o operador via O NUMERO e O PROBLEMA, mas nao
 * trabalhava ali — tinha de sair para a Central de trabalho para executar qualquer coisa. Estes
 * testes travam a capacidade nova: a fila do DOMINIO, com recorte aplicado no SERVIDOR e contexto
 * sem sair dela.
 *
 * O que NAO se prova aqui: que a fila e completa. A zona mostra os primeiros itens e DIZ quantos
 * existem no total — apresentar a pagina como se fosse o conjunto e o defeito que o `total` do read
 * model existe para impedir.
 */
describe('workspaces de domínio — fila de trabalho do domínio', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('mostra a fila do domínio com referência humana, contexto e próxima ação', async () => {
    stubWorkFetch({
      itemsWithoutKindFilter: [
        workItem({
          domain: 'OPERACOES',
          kind: 'OVERDUE',
          reference: 'SO-2026-000042',
          title: 'Ordem de serviço vencida',
        }),
      ],
    });

    renderWithProviders(<DomainWorkspacePage domain="OPERACOES" />, {
      router: { initialEntries: ['/app/workspaces/operacoes'] },
    });

    const fila = within(await screen.findByRole('region', { name: 'Fila de trabalho' }));
    expect(await fila.findByText('SO-2026-000042')).toBeInTheDocument();
    expect(fila.getByText('Ordem de serviço vencida')).toBeInTheDocument();
    expect(fila.getByText('Unidade Norte')).toBeInTheDocument();
    // A proxima acao e real: o rotulo vem do read model, nao de uma copia da state machine na tela.
    expect(fila.getByRole('link', { name: 'Abrir no domínio' })).toHaveAttribute(
      'href',
      '/app/accounting/fechamentos',
    );
  });

  it('recorta o domínio no SERVIDOR — a consulta leva `domain`, nunca filtra no navegador', async () => {
    const fetchMock = stubWorkFetch({ itemsWithoutKindFilter: [] });

    renderWithProviders(<DomainWorkspacePage domain="FINANCEIRO" />, {
      router: { initialEntries: ['/app/workspaces/financeiro'] },
    });

    await waitFor(() => {
      expect(
        requestedUrls(fetchMock).some(
          (url) => url.includes('/work-inbox') && url.includes('domain=FINANCEIRO'),
        ),
      ).toBe(true);
    });
  });

  it('declara o total do recorte em vez de apresentar a página como o conjunto', async () => {
    stubWorkFetch({
      itemsWithoutKindFilter: [
        workItem({
          domain: 'OPERACOES',
          kind: 'OVERDUE',
          reference: 'SO-1',
          title: 'Primeira',
        }),
      ],
    });

    renderWithProviders(<DomainWorkspacePage domain="OPERACOES" />, {
      router: { initialEntries: ['/app/workspaces/operacoes'] },
    });

    const fila = within(await screen.findByRole('region', { name: 'Fila de trabalho' }));
    // A faixa diz de quantos itens a pagina e recorte; o conjunto nunca e afirmado pela pagina.
    expect(await fila.findByText(/de \d+ (item|itens)/)).toBeInTheDocument();
  });

  it('fila vazia não inventa pendência e oferece a saída real', async () => {
    stubWorkFetch({ itemsWithoutKindFilter: [] });

    renderWithProviders(<DomainWorkspacePage domain="OPERACOES" />, {
      router: { initialEntries: ['/app/workspaces/operacoes'] },
    });

    const fila = within(await screen.findByRole('region', { name: 'Fila de trabalho' }));
    expect(
      await fila.findByText('Nenhum trabalho pendente neste recorte.'),
    ).toBeInTheDocument();
    /*
     * O mesmo rotulo existe no cabecalho da pagina E na saida do estado vazio da fila — os dois
     * levam ao mesmo destino, e o segundo existe porque o estado vazio precisa do proprio caminho de
     * saida: mandar o operador procurar o botao no topo e o defeito que o estado vazio compacto
     * corrige. A assercao e escopada a fila para provar a saida LOCAL.
     */
    expect(fila.getByRole('link', { name: 'Abrir fila completa' })).toHaveAttribute(
      'href',
      '/app/work-inbox?domain=OPERACOES',
    );
  });
});
