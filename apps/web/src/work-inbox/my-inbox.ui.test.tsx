import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { renderWithProviders } from '../test/render-with-providers';
import { parseRequestPath } from '../test/request-url';
import type { WorkInboxPage as WorkInboxPageData, WorkItem } from './api/work-inbox-api';
import { MyInboxPage } from './pages/MyInboxPage';
/**
 * MY INBOX — a fila unificada de trabalho.
 *
 * O que este arquivo prova, e nada alem disso:
 *
 * - a tela E uma FILA (linha de trabalho), nao uma grade de consulta;
 * - o recorte vive na URL e vai INTEIRO ao servidor (`domain`, `kind`, `overdue`, `unitId`), sem
 *   filtro silenciosamente aplicado no navegador;
 * - `total` do servidor e amostra da pagina aparecem separados ("Exibindo N de M");
 * - ausencia NAO vira zero: durante a carga e depois de falha nenhum contador e publicado;
 * - dominio que nao respondeu e DITO e nao recebe contagem;
 * - o contexto do item abre sem sair da fila, com a proxima acao autorizada pelo dominio.
 */

const UNIT = 'unit-synthetic-homolog';

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'FINANCEIRO:OVERDUE:r1',
    domain: 'FINANCEIRO',
    kind: 'OVERDUE',
    businessReference: 'NF-2026-000005',
    title: 'Conta a receber vencida',
    contextLabel: 'Cliente Gate Novo',
    status: 'Vencido',
    reason: 'Título vencido e ainda não recebido',
    occurredAt: '2026-09-20T10:00:00.000Z',
    dueAt: '2026-09-24T10:00:00.000Z',
    actionLabel: 'Abrir recebível',
    targetRoute: '/app/finance/receivables/r1',
    unitId: UNIT,
    ...overrides,
  };
}

function pageData(overrides: Partial<WorkInboxPageData> = {}): WorkInboxPageData {
  return {
    items: [item()],
    limit: 25,
    offset: 0,
    total: 1,
    totalPages: 1,
    byDomain: {
      FINANCEIRO: 1,
      FISCAL: 0,
      CONTABILIDADE: 0,
      OPERACOES: 0,
      COMERCIAL: 0,
      SUPRIMENTOS: 0,
    },
    unavailableDomains: [],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Mock CONSCIENTE DE URL.
 *
 * A tela faz DUAS leituras do MESMO read model: a situacao (`limit=0`, sem pagina — so os numeros
 * do recorte) e a fila paginada (`limit=25`). O mock responde as duas com o MESMO contrato, porque e
 * o que o servidor faz — e a rota de unidades responde o proprio contrato (`{ items: string[] }`),
 * que nao tem nada a ver com a fila.
 */
function mockFetch(response: Response | (() => Response)) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const { pathname } = parseRequestPath(input);
    if (pathname.endsWith('/requests/service-requests/operational-units')) {
      return jsonResponse({ items: [UNIT] });
    }
    return typeof response === 'function' ? response() : response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** O mesmo `Response` nao pode ser consumido duas vezes: cada leitura recebe o proprio corpo. */
function jsonResponseFactory(body: () => unknown, status = 200): () => Response {
  return () => jsonResponse(body(), status);
}

function requestedUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]));
}

/** Somente as leituras da FILA paginada (`limit=25`), separadas da leitura de situacao (`limit=0`). */
function pagedQueueRequests(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return requestedUrls(fetchMock).filter(
    (url) => url.includes('/work-inbox') && !url.includes('limit=0'),
  );
}

describe('my inbox — fila unificada de trabalho', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('abre como FILA: o item real traz referencia, motivo, prazo e proxima acao', async () => {
    mockFetch(jsonResponseFactory(() => pageData()));
    renderWithProviders(<MyInboxPage />, { router: { initialEntries: ['/app/work-inbox'] } });

    /*
     * A REGIAO DA FILA E RESOLVIDA DEPOIS DA LINHA.
     *
     * A fila monta as linhas somente depois da leitura do servidor. Capturar a regiao ANTES disso
     * prende o `within` a um no que ainda nao contem linha nenhuma, e a assercao falha por um motivo
     * que nao e o do produto. Ancoramos na linha real e subimos para a secao que a contem — que e a
     * assercao que importa: o item esta DENTRO da fila, com referencia humana, motivo, prazo e acao.
     */
    const referencia = await screen.findByText('NF-2026-000005', {}, { timeout: 8000 });
    const fila = referencia.closest('section');
    expect(fila, 'a linha de trabalho deve estar dentro da secao da fila').not.toBeNull();
    const scoped = within(fila as HTMLElement);

    expect(scoped.getByText('Conta a receber vencida')).toBeInTheDocument();
    expect(scoped.getByText('Título vencido e ainda não recebido')).toBeInTheDocument();
    expect(scoped.getByRole('link', { name: 'Abrir recebível' })).toHaveAttribute(
      'href',
      '/app/finance/receivables/r1',
    );
    // A excecao operacional e o PRIMEIRO elemento lido da linha, derivada do vencimento persistido.
    expect(scoped.getByText(/dias? em atraso/)).toBeInTheDocument();
  });

  it('le o recorte da URL e envia o recorte INTEIRO ao servidor (deep link)', async () => {
    const fetchMock = mockFetch(jsonResponseFactory(() => pageData()));
    renderWithProviders(<MyInboxPage />, {
      router: {
        initialEntries: [
          '/app/work-inbox?domain=FINANCEIRO&kind=OVERDUE&overdue=true&unitId=un-9&offset=25',
        ],
      },
    });

    await waitFor(() => {
      expect(pagedQueueRequests(fetchMock).length).toBeGreaterThan(0);
    });

    const scoped = pagedQueueRequests(fetchMock).find((url) => url.includes('offset=25'));
    expect(scoped, 'a fila deve ter sido consultada com o recorte da URL').toBeDefined();
    expect(scoped).toContain('domain=FINANCEIRO');
    expect(scoped).toContain('kind=OVERDUE');
    expect(scoped).toContain('overdue=true');
    expect(scoped).toContain('unitId=un-9');
  });

  it('o chip de dominio E o filtro: clicar aplica exatamente o recorte que o servidor contou', async () => {
    const fetchMock = mockFetch(jsonResponseFactory(() => pageData()));
    const user = userEvent.setup();
    renderWithProviders(<MyInboxPage />, { router: { initialEntries: ['/app/work-inbox'] } });

    const chip = await screen.findByRole('button', { name: 'Financeiro 1' });
    await user.click(chip);

    await waitFor(() => {
      expect(
        pagedQueueRequests(fetchMock).some((url) => url.includes('domain=FINANCEIRO') && !url.includes('limit=0')),
      ).toBe(true);
    });
  });

  it('separa o TOTAL do servidor da AMOSTRA da pagina — pagina nao e conjunto', async () => {
    mockFetch(
      jsonResponseFactory(() =>
        pageData({
          items: [item()],
          total: 41,
          totalPages: 2,
          byDomain: {
            FINANCEIRO: 41,
            FISCAL: 0,
            CONTABILIDADE: 0,
            OPERACOES: 0,
            COMERCIAL: 0,
            SUPRIMENTOS: 0,
          },
        }),
      ),
    );
    renderWithProviders(<MyInboxPage />, { router: { initialEntries: ['/app/work-inbox'] } });

    /*
     * A frase de cobertura vive na FAIXA DA FILA e so aparece quando a leitura conclui. O `screen`
     * de pagina inteira e a assercao correta aqui: a faixa e unica na tela.
     */
    expect(await screen.findByText(/Exibindo 1 de 41 itens/, {}, { timeout: 8000 })).toBeInTheDocument();
  });

  it('fluxo vazio e honesto: nao inventa pendencia para parecer cheia', async () => {
    mockFetch(
      jsonResponseFactory(() =>
        pageData({
          items: [],
          total: 0,
          byDomain: {
            FINANCEIRO: 0,
            FISCAL: 0,
            CONTABILIDADE: 0,
            OPERACOES: 0,
            COMERCIAL: 0,
            SUPRIMENTOS: 0,
          },
        }),
      ),
    );
    renderWithProviders(<MyInboxPage />, { router: { initialEntries: ['/app/work-inbox'] } });

    await waitFor(() => {
      expect(screen.getByText('Nenhum trabalho pendente neste recorte.')).toBeInTheDocument();
    });
  });

  it('dominio indisponivel e DITO e nao recebe contagem — ausencia nao e zero', async () => {
    mockFetch(jsonResponseFactory(() => pageData({ unavailableDomains: ['FISCAL'] })));
    renderWithProviders(<MyInboxPage />, { router: { initialEntries: ['/app/work-inbox'] } });

    const notices = await screen.findAllByRole('status');
    expect(
      notices.some((notice) => /Fila incompleta: Fiscal/.test(notice.textContent ?? '')),
    ).toBe(true);
    // O dominio que nao respondeu nao ganha chip de contagem: "Fiscal 0" afirmaria um zero lido.
    expect(screen.queryByRole('button', { name: 'Fiscal 0' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Financeiro 1' })).toBeInTheDocument();
  });

  it('falha de rede nao vira zero nem vira lista vazia', async () => {
    mockFetch(jsonResponseFactory(() => ({ error: 'boom' }), 500));
    renderWithProviders(<MyInboxPage />, { router: { initialEntries: ['/app/work-inbox'] } });

    await waitFor(() => {
      expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    });
    expect(screen.queryByText('Nenhum trabalho pendente neste recorte.')).not.toBeInTheDocument();
  });

  it('abre o contexto do item sem sair da fila, com a proxima acao do dominio', async () => {
    mockFetch(jsonResponseFactory(() => pageData()));
    const user = userEvent.setup();
    renderWithProviders(<MyInboxPage />, { router: { initialEntries: ['/app/work-inbox'] } });

    await user.click(await screen.findByRole('button', { name: 'NF-2026-000005' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Título vencido e ainda não recebido')).toBeInTheDocument();
    expect(within(dialog).getByText('Vencido')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /Abrir recebível/ })).toHaveAttribute(
      'href',
      '/app/finance/receivables/r1',
    );
  });

  it('nao declara atraso quando o item nao tem vencimento persistido', async () => {
    mockFetch(jsonResponseFactory(() => pageData({ items: [item({ dueAt: null })] })));
    renderWithProviders(<MyInboxPage />, { router: { initialEntries: ['/app/work-inbox'] } });

    await waitFor(() => {
      expect(screen.getByText('NF-2026-000005')).toBeInTheDocument();
    });
    expect(screen.queryByText(/em atraso/)).not.toBeInTheDocument();
  });

  it('pagina com mais de um lote oferece navegacao pelo offset do servidor', async () => {
    const fetchMock = mockFetch(
      jsonResponseFactory(() => pageData({ items: [item()], total: 60, totalPages: 3, limit: 25 })),
    );
    const user = userEvent.setup();
    renderWithProviders(<MyInboxPage />, { router: { initialEntries: ['/app/work-inbox'] } });

    await user.click(await screen.findByRole('button', { name: 'Próxima' }));

    await waitFor(() => {
      expect(pagedQueueRequests(fetchMock).some((url) => url.includes('offset=25'))).toBe(true);
    });
  });
});
