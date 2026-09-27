import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { renderWithProviders } from '../test/render-with-providers';
import { ClosingCenterPage } from './pages/ClosingCenterPage';
import type { ClosingReadiness } from './types/accounting.types';

const UNIT = 'unit-closing';
const PERIOD_ID = '20000000-0000-4000-8000-000000000002';
const PERIOD_CLOSED_ID = '20000000-0000-4000-8000-000000000003';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function period(id: string, code: string, status: 'OPEN' | 'CLOSED') {
  return {
    id,
    chartId: '10000000-0000-4000-8000-000000000001',
    unitId: UNIT,
    code,
    startsOn: `${code}-01`,
    endsOn: `${code}-28`,
    status,
    reopenCount: 0,
    rowVersion: 1,
    closedAt: null,
    reopenedAt: null,
    closeChecks: [],
  };
}

function readiness(overrides: Partial<ClosingReadiness> = {}): ClosingReadiness {
  return {
    unitId: UNIT,
    period: period(PERIOD_ID, '2026-09', 'OPEN'),
    closeReady: false,
    accounting: { evaluated: true, periodStatus: 'OPEN', journalCounts: { DRAFT: 5 } },
    fiscal: { evaluated: true, unauthorized: 2, rejected: 2, pendingAuthorization: 0, draft: 0 },
    blockers: [
      {
        kind: 'ACCOUNTING',
        severity: 'BLOCKING',
        observedCount: 5,
        detail: 'Draft journals remain in the period.',
        area: 'accounting',
        drilldown: { path: '/app/accounting/journals', label: 'Ver lançamentos não postados' },
      },
      {
        kind: 'FISCAL',
        severity: 'BLOCKING',
        observedCount: 2,
        detail: 'Fiscal documents in the period that are not authorized or cancelled.',
        area: 'fiscal',
        drilldown: { path: '/app/fiscal/documents', label: 'Ver documentos fiscais' },
      },
    ],
    pending: [],
    nextActions: [
      {
        label: 'Resolver bloqueadores antes de fechar',
        kind: 'CLOSE_PERIOD',
        enabled: false,
        reason: 'Existem bloqueadores persistidos para este período.',
      },
    ],
    withheld: [],
    ...overrides,
  };
}

function createClosingFetchMock(options: {
  readiness?: () => Response;
  closeCalls?: { count: number };
  periodStatus?: 'OPEN' | 'CLOSED';
} = {}) {
  const closeCalls = options.closeCalls ?? { count: 0 };
  const status = options.periodStatus ?? 'OPEN';
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw, 'http://127.0.0.1');
    const pathname = url.pathname;
    const method = (init?.method ?? 'GET').toUpperCase();

    if (pathname === '/api/v1/auth/session' && method === 'GET') {
      return jsonResponse({
        identityId: '00000000-0000-4000-8000-000000000001',
        session: { id: 'sid', expiresAt: '2026-12-31T00:00:00.000Z', status: 'ACTIVE' },
      });
    }
    if (pathname === '/api/v1/requests/service-requests/operational-units' && method === 'GET') {
      return jsonResponse({ items: [UNIT] });
    }
    if (pathname === '/api/v1/accounting/periods' && method === 'GET') {
      return jsonResponse({
        unitId: UNIT,
        items: [period(PERIOD_ID, '2026-09', status), period(PERIOD_CLOSED_ID, '2026-08', 'CLOSED')],
      });
    }
    if (pathname === '/api/v1/closing/readiness' && method === 'GET') {
      return options.readiness ? options.readiness() : jsonResponse(readiness());
    }
    if (pathname.endsWith('/close') && method === 'POST') {
      closeCalls.count += 1;
      return jsonResponse(period(PERIOD_ID, '2026-09', 'CLOSED'));
    }
    if (pathname.endsWith('/reopen') && method === 'POST') {
      return jsonResponse(period(PERIOD_ID, '2026-09', 'OPEN'));
    }
    return jsonResponse({ error: { code: 'ACCOUNTING_NOT_FOUND', message: 'Not found.' } }, 404);
  });
}

function requestedUrls(mock: ReturnType<typeof createClosingFetchMock>): string[] {
  return mock.mock.calls.map(([input]) => {
    const raw =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return new URL(raw, 'http://127.0.0.1').pathname + new URL(raw, 'http://127.0.0.1').search;
  });
}

configure({ asyncUtilTimeout: 3000 });

/**
 * Escolhe a competencia pelo rotulo humano, esperando a lista real chegar do servidor.
 *
 * O valor enviado e sempre o identificador interno da opcao; o operador nao digita nada.
 */
async function choosePeriod(user: ReturnType<typeof userEvent.setup>) {
  const select = await screen.findByLabelText(/competência/i);
  await waitFor(() => {
    expect(within(select).getAllByRole('option').length).toBeGreaterThan(1);
  });
  await user.selectOptions(select, PERIOD_ID);
}

describe('Central de fechamento', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('abre por unidade e competência humanas, sem digitar identificador técnico', async () => {
    const user = userEvent.setup();
    const mock = createClosingFetchMock();
    vi.stubGlobal('fetch', mock);
    renderWithProviders(<ClosingCenterPage />);

    // A unidade vem da lista do shell; não existe campo de texto livre.
    const unitSelect = await screen.findByLabelText(/unidade/i);
    expect(unitSelect.tagName).toBe('SELECT');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByLabelText(/competência/i)).not.toBeDisabled();
    });
    const periodSelect = screen.getByLabelText(/competência/i);
    const options = within(periodSelect).getAllByRole('option');
    // Rótulo humano: competência + intervalo. O uuid nunca é o texto da opção.
    expect(options.some((option) => /2026-09/.test(option.textContent ?? ''))).toBe(true);
    expect(options.every((option) => !(option.textContent ?? '').includes(PERIOD_ID))).toBe(true);

    await user.selectOptions(periodSelect, PERIOD_ID);
    await waitFor(() => {
      expect(requestedUrls(mock).some((url) => url.includes('/api/v1/closing/readiness'))).toBe(true);
    });
    const readinessUrl = requestedUrls(mock).find((url) => url.includes('/api/v1/closing/readiness'));
    expect(readinessUrl).toContain(`unitId=${UNIT}`);
    expect(readinessUrl).toContain(`periodId=${PERIOD_ID}`);
  });

  it('mostra bloqueadores reais primeiro, com drill-down navegável para cada um', async () => {
    const user = userEvent.setup();
    const mock = createClosingFetchMock();
    vi.stubGlobal('fetch', mock);
    renderWithProviders(<ClosingCenterPage />);
    await choosePeriod(user);

    await waitFor(() => {
      expect(screen.getByRole('list', { name: /bloqueadores do fechamento/i })).toBeInTheDocument();
    });
    const blockers = screen.getByRole('list', { name: /bloqueadores do fechamento/i });
    expect(within(blockers).getAllByRole('listitem')).toHaveLength(2);

    // Cada bloqueador levar ao recorte REAL que o resolve.
    expect(
      within(blockers).getByRole('link', { name: /ver lançamentos não postados/i }),
    ).toHaveAttribute('href', '/app/accounting/journals');
    expect(
      within(blockers).getByRole('link', { name: /ver documentos fiscais/i }),
    ).toHaveAttribute('href', '/app/fiscal/documents');

    // Nada de percentual ou score inventado.
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('não habilita fechar com bloqueador e executa a ação real do backend quando liberado', async () => {
    const user = userEvent.setup();
    const closeCalls = { count: 0 };
    const mock = createClosingFetchMock({ closeCalls });
    vi.stubGlobal('fetch', mock);
    renderWithProviders(<ClosingCenterPage />);
    await choosePeriod(user);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Fechar período' })).toBeDisabled();
    });
    expect(closeCalls.count).toBe(0);
  });

  it('omite a seção fiscal por inteiro quando o backend não autoriza documento fiscal', async () => {
    const user = userEvent.setup();
    const mock = createClosingFetchMock({
      readiness: () =>
        jsonResponse(
          readiness({
            fiscal: null,
            blockers: [readiness().blockers[0]!],
            closeReady: null,
            withheld: [
              {
                area: 'fiscal',
                reason:
                  'Sem autorização para ler documentos fiscais: a verificação fiscal do fechamento não foi avaliada.',
              },
            ],
          }),
        ),
    });
    vi.stubGlobal('fetch', mock);
    renderWithProviders(<ClosingCenterPage />);
    await choosePeriod(user);

    await waitFor(() => {
      expect(screen.getByText(/omitido por autorização/i)).toBeInTheDocument();
    });
    // Sem contagem, sem vínculo e sem existência de documento fiscal na tela.
    expect(screen.queryByRole('link', { name: /ver documentos fiscais/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/rejeitado\(s\)/i)).not.toBeInTheDocument();
    expect(screen.getByText(/sem autorização para ler documentos fiscais/i)).toBeInTheDocument();
    // O fechamento não é afirmado como pronto quando há verificação não avaliada.
    expect(screen.getByRole('button', { name: 'Fechar período' })).toBeDisabled();
  });

  it('mostra estado negado honesto quando o servidor recusa a leitura do período', async () => {
    const user = userEvent.setup();
    const mock = createClosingFetchMock({
      readiness: () =>
        jsonResponse({ error: { code: 'ACCOUNTING_DENIED', message: 'Access denied.' } }, 403),
    });
    vi.stubGlobal('fetch', mock);
    renderWithProviders(<ClosingCenterPage />);
    await choosePeriod(user);

    await waitFor(() => {
      expect(screen.getByText(/não tem permissão para ler o fechamento/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('list', { name: /bloqueadores do fechamento/i })).not.toBeInTheDocument();
  });
});
