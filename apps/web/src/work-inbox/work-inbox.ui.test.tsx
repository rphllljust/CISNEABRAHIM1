import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../auth/storage/token-store';
import { renderWithProviders } from '../test/render-with-providers';
import type { WorkInboxPage as WorkInboxPageData } from './api/work-inbox-api';
import { WorkInboxPage, daysOverdue } from './pages/WorkInboxPage';

/**
 * WORK INBOX — comportamento da superficie.
 *
 * Cobre o que o contrato exige: filtros dirigidos por URL, contagem coerente com o
 * recorte, drawer de contexto, estado vazio honesto, estado de erro que nao mascara falha
 * e o aviso de fila incompleta.
 */

const DOMAIN_FINANCE = 'FINANCEIRO';

function pageData(overrides: Partial<WorkInboxPageData> = {}): WorkInboxPageData {
  return {
    items: [
      {
        id: 'FINANCEIRO:RECEIVABLE:r1',
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
        unitId: 'UN-1',
      },
    ],
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

const UNIT = 'unit-synthetic-homolog';

/**
 * MOCK CONSCIENTE DE URL.
 *
 * O mock anterior respondia o MESMO payload de fila para QUALQUER URL. Isso bastava enquanto a
 * Central de trabalho so consultava a propria fila. Agora a tela tambem resolve o ESCOPO
 * (`operational-units`) para oferecer a unidade em linguagem humana — e essa rota tem contrato
 * proprio (`{ items: string[] }`). Devolver o payload da fila ali deixava o seletor de unidade sem
 * opcoes e a renderizacao presa.
 *
 * O comportamento de produto testado nao mudou: o que muda e o harness responder a rota CERTA com
 * o CONTRATO certo — que e o que o servidor real faz.
 */
function mockFetch(response: Response | (() => Response)) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    // `RequestInfo` pode ser `Request` (objeto) alem de string/URL: lemos o `url` real em vez de
    // stringificar o objeto, que produziria "[object Object]" e nunca casaria a rota.
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/requests/service-requests/operational-units')) {
      return jsonResponse({ items: [UNIT] });
    }
    return typeof response === 'function' ? response() : response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function requestedUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]));
}

describe('central de trabalho', () => {
  beforeEach(() => {
    tokenStore.setTokens('access-token', 'refresh-token');
  });

  it('mostra o item real com referencia humana, motivo e acao', async () => {
    mockFetch(jsonResponse(pageData()));
    renderWithProviders(<WorkInboxPage />, { router: { initialEntries: ['/app/work-inbox'] } });

    await waitFor(() => {
      expect(screen.getByText('NF-2026-000005')).toBeInTheDocument();
    });
    expect(screen.getByText('Conta a receber vencida')).toBeInTheDocument();
    expect(screen.getByText('Título vencido e ainda não recebido')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir recebível' })).toHaveAttribute(
      'href',
      '/app/finance/receivables/r1',
    );
  });

  it('le o recorte da URL e envia o mesmo recorte ao servidor (deep link)', async () => {
    const fetchMock = mockFetch(jsonResponse(pageData()));
    renderWithProviders(<WorkInboxPage />, {
      router: {
        initialEntries: [`/app/work-inbox?domain=${DOMAIN_FINANCE}&overdue=true&offset=25`],
      },
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    /*
      A consulta da FILA e a que carrega o recorte — o harness agora tambem responde
      `operational-units` (para o seletor humano de unidade), entao procuramos a URL da fila em vez
      de assumir que ela e a primeira chamada. O que o teste protege continua igual: o recorte da
      URL vai INTEIRO ao servidor, sem filtro silenciosamente ignorado.
    */
    const queueUrl = requestedUrls(fetchMock).find((url) => url.includes('/work-inbox'));
    expect(queueUrl, 'a consulta da fila deve ter sido feita').toBeDefined();
    expect(queueUrl).toContain('domain=FINANCEIRO');
    expect(queueUrl).toContain('overdue=true');
    expect(queueUrl).toContain('offset=25');
  });

  it('o contador por dominio e o proprio filtro — sem filtro silenciosamente ignorado', async () => {
    const fetchMock = mockFetch(jsonResponse(pageData()));
    const user = userEvent.setup();
    renderWithProviders(<WorkInboxPage />, { router: { initialEntries: ['/app/work-inbox'] } });

    const chip = await screen.findByRole('button', { name: /Financeiro 1/ });
    await user.click(chip);

    await waitFor(() => {
      expect(requestedUrls(fetchMock).some((url) => url.includes('domain=FINANCEIRO'))).toBe(true);
    });
  });

  it('abre o contexto do item sem sair da fila', async () => {
    mockFetch(jsonResponse(pageData()));
    const user = userEvent.setup();
    renderWithProviders(<WorkInboxPage />, { router: { initialEntries: ['/app/work-inbox'] } });

    await user.click(await screen.findByRole('button', { name: 'NF-2026-000005' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Financeiro')).toBeInTheDocument();
    expect(within(dialog).getByText('Título vencido e ainda não recebido')).toBeInTheDocument();
  });

  it('fila vazia e honesta: diz que nao ha trabalho real, sem item sintetico', async () => {
    mockFetch(
      jsonResponse(
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
    renderWithProviders(<WorkInboxPage />, { router: { initialEntries: ['/app/work-inbox'] } });

    await waitFor(() => {
      expect(screen.getByText(/Nenhum trabalho real neste recorte/)).toBeInTheDocument();
    });
  });

  it('declara dominio indisponivel em vez de apresentar fila incompleta como completa', async () => {
    mockFetch(jsonResponse(pageData({ unavailableDomains: ['FISCAL'] })));
    renderWithProviders(<WorkInboxPage />, { router: { initialEntries: ['/app/work-inbox'] } });

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/Fila incompleta: FISCAL/);
    });
  });

  it('erro de rede nao e mascarado por estado vazio', async () => {
    mockFetch(jsonResponse({ error: 'boom' }, 500));
    renderWithProviders(<WorkInboxPage />, { router: { initialEntries: ['/app/work-inbox'] } });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Não foi possível carregar a fila/);
    });
    expect(screen.queryByText(/Nenhum trabalho real neste recorte/)).not.toBeInTheDocument();
  });

  /*
   * EXCECAO OPERACIONAL — o atraso e derivado do vencimento PERSISTIDO, nao de um
   * score ou prioridade inventada. Sem `dueAt`, nao ha atraso a declarar.
   */
  it('marca o atraso a partir do vencimento persistido, sem inventar prioridade', async () => {
    mockFetch(jsonResponse(pageData()));
    renderWithProviders(<WorkInboxPage />, { router: { initialEntries: ['/app/work-inbox'] } });

    await waitFor(() => {
      expect(screen.getByText(/em atraso/)).toBeInTheDocument();
    });
    // O atraso aparece na LINHA da fila, como primeiro elemento lido — nao escondido numa coluna.
    const item = screen.getByText('Conta a receber vencida').closest('article');
    expect(item).not.toBeNull();
    expect(within(item as HTMLElement).getByText(/em atraso/)).toBeInTheDocument();
    // O objeto relacionado e o vencimento real convivem no mesmo item.
    expect(within(item as HTMLElement).getByRole('button', { name: 'NF-2026-000005' })).toBeInTheDocument();
    expect(within(item as HTMLElement).getByText(/Vencimento/)).toBeInTheDocument();
  });

  it('abre com a faixa de resumo usando somente os numeros publicados pelo servidor', async () => {
    mockFetch(jsonResponse(pageData()));
    renderWithProviders(<WorkInboxPage />, { router: { initialEntries: ['/app/work-inbox'] } });

    await waitFor(() => {
      expect(screen.getByText('NF-2026-000005')).toBeInTheDocument();
    });

    const summary = screen.getByRole('region', { name: 'Resumo da fila' });
    // `total` do recorte: o unico numero global que o contrato publica.
    expect(within(summary).getByText(/trabalhos na fila/i).closest('div')).toHaveTextContent('1');
    expect(within(summary).getByText(/nesta página/i).closest('div')).toHaveTextContent('1');
  });

  it('nao declara atraso quando o item nao tem vencimento persistido', async () => {
    const base = pageData();
    mockFetch(
      jsonResponse({
        ...base,
        items: [{ ...base.items[0]!, dueAt: null }],
      }),
    );
    renderWithProviders(<WorkInboxPage />, { router: { initialEntries: ['/app/work-inbox'] } });

    await waitFor(() => {
      expect(screen.getByText('NF-2026-000005')).toBeInTheDocument();
    });
    expect(screen.queryByText(/em atraso/)).not.toBeInTheDocument();
  });

  it('daysOverdue so afirma atraso com vencimento real no passado', () => {
    const now = new Date('2026-10-01T12:00:00.000Z');
    expect(daysOverdue(null, now)).toBeNull();
    expect(daysOverdue('nao-e-data', now)).toBeNull();
    // Vencimento no futuro e hoje NAO sao atraso.
    expect(daysOverdue('2026-10-10T10:00:00.000Z', now)).toBeNull();
    expect(daysOverdue('2026-10-01T08:00:00.000Z', now)).toBeNull();
  });
});
