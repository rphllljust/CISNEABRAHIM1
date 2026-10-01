import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { renderWithProviders } from '../test/render-with-providers';
import { ChartOfAccountsPage } from './pages/ChartOfAccountsPage';

const CHART_A = '10000000-0000-4000-8000-00000000000a';
const CHART_B = '10000000-0000-4000-8000-00000000000b';
const CASH_ID = '10000000-0000-4000-8000-000000000010';
const BANK_ID = '10000000-0000-4000-8000-000000000011';
const JOURNAL_ID = '30000000-0000-4000-8000-000000000003';

const CHARTS_BY_UNIT: Record<string, Array<Record<string, unknown>>> = {
  'unit-a': [{ id: CHART_A, unitId: 'unit-a', code: 'COA-A', name: 'Plano da unidade A', status: 'ACTIVE' }],
  'unit-b': [{ id: CHART_B, unitId: 'unit-b', code: 'COA-B', name: 'Plano da unidade B', status: 'ACTIVE' }],
};

const ACCOUNTS_BY_CHART: Record<string, Array<Record<string, unknown>>> = {
  [CHART_A]: [
    { id: CASH_ID, chartId: CHART_A, parentId: null, code: '1.1.01', name: 'Caixa da unidade A', class: 'ASSET', status: 'ACTIVE' },
  ],
  [CHART_B]: [
    { id: BANK_ID, chartId: CHART_B, parentId: null, code: '1.1.02', name: 'Banco da unidade B', class: 'ASSET', status: 'ACTIVE' },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function journalPayload() {
  return {
    id: JOURNAL_ID,
    chartId: CHART_B,
    periodId: '20000000-0000-4000-8000-000000000002',
    unitId: 'unit-b',
    status: 'POSTED',
    kind: 'ENTRY',
    description: 'Recebimento da unidade B',
    occurredOn: '2026-10-05',
    currencyCode: 'BRL',
    sourceKind: 'MANUAL',
    sourceId: '00000000-0000-4000-8000-000000000001',
    sourceReference: 'Recebimento 001',
    idempotencyKey: 'journal-drill-1',
    reversesEntryId: null,
    reversedByEntryId: null,
    reversedByEntryNumber: null,
    entryNumber: 7,
    postedAt: '2026-10-05T10:00:00.000Z',
    postedBy: null,
    rowVersion: 2,
    debitTotal: '100.0000',
    creditTotal: '100.0000',
    balanced: true,
    lines: [],
  };
}

/**
 * Servidor simulado no nivel de rede: as unidades operacionais vem do mesmo endpoint que o
 * contexto do shell consome, e os planos/contas/lancamentos sao recortados pela unidade e pelo
 * plano realmente enviados na URL — assim o teste prova que a escolha humana chega a API.
 */
function createFetchMock(options: { units?: string[] } = {}) {
  const units = options.units ?? ['unit-a', 'unit-b'];
  const calls: string[] = [];
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const raw =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(raw, 'http://127.0.0.1');
      // Chamadas registradas como caminho + query: prova que a unidade/plano escolhidos na tela
      // chegaram a API, sem depender do host base configurado no ambiente.
      calls.push(`${url.pathname}${url.search}`);
      const method = (init?.method ?? 'GET').toUpperCase();

      if (method === 'GET' && url.pathname === '/api/v1/auth/session') {
        return jsonResponse({
          identityId: '00000000-0000-4000-8000-000000000001',
          session: { id: 'sid', expiresAt: '2026-12-31T00:00:00.000Z', status: 'ACTIVE' },
        });
      }

      if (method === 'GET' && url.pathname === '/api/v1/requests/service-requests/operational-units') {
        return jsonResponse({ items: units });
      }

      if (method === 'GET' && url.pathname === '/api/v1/accounting/charts') {
        const unitId = url.searchParams.get('unitId') ?? '';
        return jsonResponse({ unitId, items: CHARTS_BY_UNIT[unitId] ?? [] });
      }

      const accountsMatch = /^\/api\/v1\/accounting\/charts\/([^/]+)\/accounts$/.exec(url.pathname);
      if (method === 'GET' && accountsMatch) {
        const chartId = accountsMatch[1] ?? '';
        return jsonResponse({ chartId, items: ACCOUNTS_BY_CHART[chartId] ?? [] });
      }

      if (method === 'GET' && url.pathname === '/api/v1/accounting/ledger') {
        return jsonResponse({
          chartId: url.searchParams.get('chartId') ?? '',
          totalDebits: '0.0000',
          totalCredits: '0.0000',
          balanced: true,
          accounts: [],
        });
      }

      const journalsMatch = /^\/api\/v1\/accounting\/charts\/([^/]+)\/journals$/.exec(url.pathname);
      if (method === 'GET' && journalsMatch) {
        const items = url.searchParams.get('accountId') === BANK_ID ? [journalPayload()] : [];
        return jsonResponse({ page: 0, pageSize: 25, total: items.length, totalPages: 1, items });
      }

      return jsonResponse({ error: { code: 'ACCOUNTING_NOT_FOUND' } }, 404);
    },
  );
  return { fetchMock, calls };
}

function unitField(): HTMLElement {
  return screen.getByLabelText(/^unidade$/i);
}

function chartField(): HTMLElement {
  return screen.getByLabelText(/plano de contas/i);
}

configure({ asyncUtilTimeout: 1500 });

describe('Plano de contas — unidade operacional escolhida no contexto do shell', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('escolhe a unidade em lista humana, sem campo de identificador digitado', async () => {
    const { fetchMock } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<ChartOfAccountsPage />);

    await waitFor(() => {
      expect(within(unitField()).getAllByRole('option')).toHaveLength(2);
    });

    expect(unitField().tagName).toBe('SELECT');
    /*
     * ESCOPO HUMANO. A tela passou a usar `OperationalUnitOptions`, o primitivo compartilhado
     * pelas superficies de backoffice: o VALOR continua sendo o identificador real (e o recorte
     * enviado a API, verificado mais abaixo), mas o TEXTO lido pelo operador nao e mais o slug.
     *
     * Antes esta assercao exigia `unit-a` como NOME visivel — fixando o vazamento do
     * identificador tecnico como comportamento esperado, exatamente o que a superficie nao pode
     * fazer quando existe rotulo humano.
     */
    const unitOptions = within(unitField()).getAllByRole('option');
    expect(unitOptions.map((option) => option.textContent)).toEqual([
      'Unidade autorizada 1',
      'Unidade autorizada 2',
    ]);
    expect(unitOptions.map((option) => (option as HTMLOptionElement).value)).toEqual([
      'unit-a',
      'unit-b',
    ]);
    // Nenhum campo de texto livre para identificador: a unidade so existe na lista do shell.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByPlaceholderText('ex.: unit-a')).toBeNull();

    await waitFor(() => expect(chartField()).not.toBeDisabled());
    await waitFor(() => {
      expect(
        within(chartField()).getByRole('option', { name: /COA-A — Plano da unidade A \(unit-a\)/ }),
      ).toBeInTheDocument();
    });
  });

  it('a unidade escolhida chega a API e o plano escolhido carrega as contas dele', async () => {
    const { fetchMock, calls } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    renderWithProviders(<ChartOfAccountsPage />);

    // Primeira unidade autorizada entra como contexto inicial do shell.
    await waitFor(() => {
      expect(calls).toContain('/api/v1/accounting/charts?unitId=unit-a');
    });
    await waitFor(() => expect(chartField()).not.toBeDisabled());
    await user.selectOptions(chartField(), CHART_A);
    await waitFor(() => {
      expect(screen.getByText('Caixa da unidade A')).toBeInTheDocument();
    });

    // Trocar a unidade na lista recarrega os planos da unidade escolhida.
    await user.selectOptions(unitField(), 'unit-b');
    await waitFor(() => {
      expect(calls).toContain('/api/v1/accounting/charts?unitId=unit-b');
    });
    await waitFor(() => {
      expect(
        within(chartField()).getByRole('option', { name: /COA-B — Plano da unidade B \(unit-b\)/ }),
      ).toBeInTheDocument();
    });
    // O plano da unidade anterior nao fica visivel como se fosse da unidade nova.
    expect(within(chartField()).queryByRole('option', { name: /COA-A/ })).toBeNull();
    expect(chartField()).toHaveValue('');
    expect(screen.queryByText('Caixa da unidade A')).toBeNull();

    await user.selectOptions(chartField(), CHART_B);
    await waitFor(() => {
      expect(calls).toContain(`/api/v1/accounting/charts/${CHART_B}/accounts`);
    });
    await waitFor(() => {
      expect(screen.getByText('Banco da unidade B')).toBeInTheDocument();
    });
    expect(screen.getByRole('table', { name: /árvore de contas/i })).toBeInTheDocument();
    expect(screen.queryByText('Caixa da unidade A')).toBeNull();
  });

  it('detalha os lancamentos da conta escolhida usando a listagem filtrada por conta', async () => {
    const { fetchMock, calls } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    renderWithProviders(<ChartOfAccountsPage />);

    await waitFor(() => expect(chartField()).not.toBeDisabled());
    await user.selectOptions(unitField(), 'unit-b');
    await waitFor(() =>
      expect(
        within(chartField()).getByRole('option', { name: /COA-B — Plano da unidade B \(unit-b\)/ }),
      ).toBeInTheDocument(),
    );
    await user.selectOptions(chartField(), CHART_B);
    await waitFor(() => expect(screen.getByText('Banco da unidade B')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /lançamentos da conta 1\.1\.02/i }));

    await waitFor(() => {
      expect(screen.getByRole('table', { name: /lançamentos da conta/i })).toBeInTheDocument();
    });
    expect(screen.getByText('Recebimento da unidade B')).toBeInTheDocument();
    expect(
      calls.some(
        (call) =>
          call ===
          `/api/v1/accounting/charts/${CHART_B}/journals?page=0&pageSize=25&accountId=${BANK_ID}`,
      ),
    ).toBe(true);
  });

  it('sem unidade autorizada, mostra estado honesto e nao oferece identificador digitado', async () => {
    const { fetchMock, calls } = createFetchMock({ units: [] });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<ChartOfAccountsPage />);

    await waitFor(() => {
      expect(screen.getByText('Nenhuma unidade operacional disponível')).toBeInTheDocument();
    });
    expect(unitField()).toBeDisabled();
    // O `<option>` de ausencia vem do primitivo compartilhado (`OperationalUnitOptions`).
    expect(
      within(unitField()).getByRole('option', { name: /nenhuma unidade autorizada/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(calls.some((call) => call.startsWith('/api/v1/accounting/charts'))).toBe(false);
  });
});
