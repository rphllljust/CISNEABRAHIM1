import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { parseRequestPath } from '../test/request-url';
import { createShellFetchMock } from '../test/shell-fetch-mock';
import { renderWithProviders } from '../test/render-with-providers';
import { AccountingPostingOriginsPage } from './pages/AccountingPostingOriginsPage';

const UNIT = 'UN-A';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function calledUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]));
}

/**
 * A tela depende da sessao (shell), da fonte unica de unidades operacionais ja existente
 * em Requests e da consulta de rastreabilidade da contabilidade.
 */
function createPostingFetchMock() {
  const shellMock = createShellFetchMock();
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { pathname, searchParams } = parseRequestPath(input);
    const method = init?.method ?? 'GET';

    if (pathname.endsWith('/operational-units')) {
      return jsonResponse({ items: [UNIT] });
    }

    if (pathname.endsWith('/accounting/posting-requests') && method === 'GET') {
      const status = searchParams.get('status');
      const empty = status === 'REJECTED';
      return jsonResponse({
        unitId: searchParams.get('unitId') ?? UNIT,
        page: 0,
        pageSize: 20,
        total: empty ? 0 : 1,
        totalPages: empty ? 0 : 1,
        statusCounts: { POSTED: 1, PENDING: 0, REJECTED: 0 },
        items: empty
          ? []
          : [
              {
                id: 'posting-1',
                unitId: UNIT,
                originKind: 'FINANCE',
                eventKind: 'RECEIVABLE_RECOGNIZED',
                sourceId: 'source-1',
                sourceReference: 'AR-2026-0001',
                amount: '1500.0000',
                currencyCode: 'BRL',
                occurredOn: '2026-09-25',
                status: 'POSTED',
                postingRuleId: 'rule-1',
                postingRuleVersionId: 'rule-version-1',
                actorIdentityId: 'actor-1',
                createdAt: '2026-09-25T10:00:00.000Z',
                journalEntryId: 'journal-1',
                journalEntryNumber: 42,
                journalEntryStatus: 'POSTED',
                journalEntryPostedAt: '2026-09-25T10:05:00.000Z',
              },
            ],
      });
    }

    return shellMock(input, init);
  });
}

describe('AccountingPostingOriginsPage', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('honors the status carried in the URL so the pending queue is a shareable view', async () => {
    const fetchMock = createPostingFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    // A visao embutida "Pendentes de lancamento" fixa ?status=PENDING: o recorte precisa
    // chegar ao servidor e o seletor precisa refletir a visao aplicada.
    renderWithProviders(<AccountingPostingOriginsPage />, {
      router: { initialEntries: ['/app/accounting/posting-origins?status=PENDING'] },
    });

    await waitFor(() => {
      expect(calledUrls(fetchMock).some((url) => url.includes('status=PENDING'))).toBe(true);
    });
    expect(screen.getByLabelText('Situação')).toHaveValue('PENDING');
  });

  it('keeps the real drill-down from a posting origin to its journal entry', async () => {
    vi.stubGlobal('fetch', createPostingFetchMock());

    renderWithProviders(<AccountingPostingOriginsPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: '#42' })).toHaveAttribute(
        'href',
        '/app/accounting/journals/journal-1',
      );
    });
  });

  it('shows a contextual empty state with a way out when a filter is applied', async () => {
    vi.stubGlobal('fetch', createPostingFetchMock());

    renderWithProviders(<AccountingPostingOriginsPage />, {
      router: { initialEntries: ['/app/accounting/posting-origins?status=REJECTED'] },
    });

    await waitFor(() => {
      expect(screen.getByText(/nenhum evento para o recorte atual/i)).toBeInTheDocument();
    });
    /*
     * A saída do recorte passou a existir em DOIS lugares legítimos da MESMA estrutura: no painel
     * de estado (que diz o que aconteceu e como voltar) e na barra de filtros compacta, onde o
     * operador procura o controle. Nenhum dos dois é um botão solto: a asserção passa a exigir a
     * presença do caminho de volta, que é o comportamento protegido.
     */
    expect(screen.getAllByRole('button', { name: /limpar filtros/i }).length).toBeGreaterThan(0);
  });
});
