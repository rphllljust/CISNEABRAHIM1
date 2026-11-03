import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../../auth/storage/token-store';
import { renderWithProviders } from '../../test/render-with-providers';
import { parseRequestPath } from '../../test/request-url';
import { WORK_DOMAINS, type WorkItem } from '../../work-inbox/api/work-inbox-api';
import { parseWorkspaceOffset } from '../api/workspace-queue-model';
import { WorkspaceQueueSurface } from './WorkspaceQueueSurface';

/** Dados exclusivos da suíte: nenhuma entidade empresarial criada no ambiente real. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function exampleItem(index: number): WorkItem {
  return {
    id: `work-${index}`,
    domain: 'OPERACOES',
    kind: 'BLOCKER',
    businessReference: `OS-TEST-${index}`,
    title: `Trabalho ${index}`,
    contextLabel: 'Unidade de teste',
    status: 'Pendente',
    reason: 'Aguardando ação autorizada',
    occurredAt: '2026-09-01T12:00:00.000Z',
    dueAt: null,
    actionLabel: 'Abrir OS',
    targetRoute: '/app/service-orders',
    unitId: null,
  };
}

function stubQueue({ total = 0, paged = false }: { total?: number; paged?: boolean } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const { pathname, searchParams } = parseRequestPath(input);
    if (pathname === '/api/v1/auth/session') {
      return json({
        identityId: '11111111-1111-4111-8111-111111111111',
        session: {
          id: '22222222-2222-4222-8222-222222222222',
          expiresAt: new Date(Date.now() + 900_000).toISOString(),
          status: 'active',
        },
      });
    }
    if (pathname !== '/api/v1/work-inbox') {
      return json({ error: { code: 'UNKNOWN', message: 'Not found' } }, 404);
    }
    const offset = Number(searchParams.get('offset') ?? 0);
    const limit = Number(searchParams.get('limit') ?? 20);
    const items = paged && offset === 20 ? [exampleItem(21), exampleItem(22), exampleItem(23)] : [];
    return json({
      items,
      limit,
      offset,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      byDomain: Object.fromEntries(
        WORK_DOMAINS.map((domain) => [domain, domain === 'OPERACOES' ? total : 0]),
      ),
      unavailableDomains: [],
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function QueueLocation() {
  const { search } = useLocation();
  return <span data-testid="queue-location">{search}</span>;
}

function Queue({
  paginate = true,
  lockDomain,
}: {
  paginate?: boolean;
  lockDomain?: 'OPERACOES';
}) {
  return (
    <WorkspaceQueueSurface
      title="Fila de trabalho"
      savedViewsScope="test.e02.workspaces"
      scopeSource="url"
      limit={20}
      paginate={paginate}
      lockDomain={lockDomain}
    />
  );
}

describe('E02 — contrato de navegação e contexto da fila empresarial', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
  });

  it('aceita somente offsets decimais canônicos, seguros e não negativos', () => {
    for (const invalid of [null, '-20', '3xyz', '01', '1.5', '1e3', 'Infinity', '9007199254740992']) {
      expect(parseWorkspaceOffset(invalid)).toBe(0);
    }
    expect(parseWorkspaceOffset('0')).toBe(0);
    expect(parseWorkspaceOffset('20')).toBe(20);
    expect(parseWorkspaceOffset('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('não envia offset negativo da URL para GET /work-inbox', async () => {
    const fetchMock = stubQueue();
    renderWithProviders(<Queue />, {
      router: { initialEntries: ['/app/work-inbox?offset=-20'] },
    });

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) => {
          const { pathname, searchParams } = parseRequestPath(input);
          return pathname === '/api/v1/work-inbox' && searchParams.get('offset') === '0';
        }),
      ).toBe(true);
    });
    expect(
      fetchMock.mock.calls.some(([input]) => {
        const { pathname, searchParams } = parseRequestPath(input);
        return pathname === '/api/v1/work-inbox' && searchParams.get('offset') === '-20';
      }),
    ).toBe(false);
  });

  it('recupera uma página fora do total sem exibir intervalo impossível nem ocultar Anterior', async () => {
    stubQueue({ total: 23, paged: true });
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <Queue />
        <QueueLocation />
      </>,
      { router: { initialEntries: ['/app/work-inbox?offset=40'] } },
    );

    expect(await screen.findByText('Nenhum trabalho nesta página.')).toBeInTheDocument();
    expect(screen.getByText('0 nesta página · 23 no recorte')).toBeInTheDocument();
    expect(screen.queryByText('41–23 de 23')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Anterior' }));
    await waitFor(() => {
      expect(screen.getByTestId('queue-location')).toHaveTextContent('offset=20');
    });
    expect(await screen.findByText('21–23 de 23')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Próxima' })).toBeDisabled();
  });

  it('mostra a unidade do recorte mesmo sem item selecionado', async () => {
    stubQueue();
    renderWithProviders(<Queue />, {
      router: { initialEntries: ['/app/work-inbox?unitId=UNIT-42'] },
    });

    await screen.findByText('Nenhum trabalho pendente neste recorte.');
    // WorkspaceBody monta a coluna de contexto sob demanda, inclusive em layout compacto.
    // Sem abrir o contexto, a unidade nao faz parte do DOM e o teste nao exercita o recurso.
    await userEvent.setup().click(screen.getByRole('button', { name: 'Contexto do processo' }));
    await waitFor(() => {
      expect(screen.getAllByText('Unidade autorizada').length).toBeGreaterThan(0);
    });
    expect(screen.queryByText('UNIT-42')).not.toBeInTheDocument();
  });

  it('mantém Tudo ativo no domínio travado, sem eliminar o recorte de domínio', async () => {
    const fetchMock = stubQueue();
    const user = userEvent.setup();
    renderWithProviders(<Queue lockDomain="OPERACOES" paginate={false} />, {
      router: { initialEntries: ['/app/workspaces/operacoes'] },
    });

    const all = screen.getByRole('button', { name: 'Tudo' });
    expect(all).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Bloqueios' }));
    expect(all).toHaveAttribute('aria-pressed', 'false');
    await user.click(all);
    expect(all).toHaveAttribute('aria-pressed', 'true');

    await waitFor(() => {
      const urls = fetchMock.mock.calls
        .map(([input]) => parseRequestPath(input))
        .filter((call) => call.pathname === '/api/v1/work-inbox');
      expect(urls.length).toBeGreaterThan(0);
      expect(urls.every((call) => call.searchParams.get('domain') === 'OPERACOES')).toBe(true);
    });
  });
});
