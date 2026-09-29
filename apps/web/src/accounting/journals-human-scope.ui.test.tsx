import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentType } from 'react';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { renderWithProviders } from '../test/render-with-providers';
import { JournalsPage } from './pages/JournalsPage';
import { PeriodClosePage } from './pages/PeriodClosePage';
import { JournalBookPage } from './pages/PeriodReportPages';

const CHART_A = '10000000-0000-4000-8000-00000000000a';
const CHART_B = '10000000-0000-4000-8000-00000000000b';
const PERIOD_A = '20000000-0000-4000-8000-00000000000a';
const PERIOD_B = '20000000-0000-4000-8000-00000000000b';
const JOURNAL_A = '30000000-0000-4000-8000-00000000000a';
const JOURNAL_B = '30000000-0000-4000-8000-00000000000b';
const CASH_ID = '10000000-0000-4000-8000-000000000010';

const CHARTS_BY_UNIT: Record<string, Array<Record<string, unknown>>> = {
  'unit-a': [{ id: CHART_A, unitId: 'unit-a', code: 'COA-A', name: 'Plano da unidade A', status: 'ACTIVE' }],
  'unit-b': [{ id: CHART_B, unitId: 'unit-b', code: 'COA-B', name: 'Plano da unidade B', status: 'ACTIVE' }],
};

const ACCOUNTS_BY_CHART: Record<string, Array<Record<string, unknown>>> = {
  [CHART_A]: [
    { id: CASH_ID, chartId: CHART_A, parentId: null, code: '1.1.01', name: 'Caixa da unidade A', class: 'ASSET', status: 'ACTIVE' },
  ],
  [CHART_B]: [
    { id: CASH_ID, chartId: CHART_B, parentId: null, code: '1.1.01', name: 'Caixa da unidade B', class: 'ASSET', status: 'ACTIVE' },
  ],
};

const PERIODS_BY_CHART: Record<string, Array<Record<string, unknown>>> = {
  [CHART_A]: [
    {
      id: PERIOD_A,
      chartId: CHART_A,
      unitId: 'unit-a',
      code: '2026-10',
      startsOn: '2026-10-01',
      endsOn: '2026-10-31',
      status: 'OPEN',
      reopenCount: 0,
      rowVersion: 1,
      closedAt: null,
      reopenedAt: null,
      closeChecks: [],
    },
  ],
  [CHART_B]: [
    {
      id: PERIOD_B,
      chartId: CHART_B,
      unitId: 'unit-b',
      code: '2026-11',
      startsOn: '2026-11-01',
      endsOn: '2026-11-30',
      status: 'OPEN',
      reopenCount: 0,
      rowVersion: 1,
      closedAt: null,
      reopenedAt: null,
      closeChecks: [],
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Lancamento da unidade B: `sourceKind` e `sourceReference` sao os valores persistidos em
 * acc.journal_entries e devolvidos pela listagem. O historico fala de apuracao do periodo, e a
 * origem exibida tem de vir do campo persistido (TAX), nunca do texto do historico.
 */
function journalPayloadB() {
  return {
    id: JOURNAL_B,
    chartId: CHART_B,
    periodId: PERIOD_B,
    unitId: 'unit-b',
    status: 'POSTED',
    kind: 'ENTRY',
    description: 'Apuração do período',
    occurredOn: '2026-11-05',
    currencyCode: 'BRL',
    sourceKind: 'TAX',
    sourceId: '00000000-0000-4000-8000-0000000000f1',
    sourceReference: 'FIS-2026-0001',
    idempotencyKey: 'journal-b-1',
    reversesEntryId: null,
    reversedByEntryId: null,
    reversedByEntryNumber: null,
    entryNumber: 9,
    postedAt: '2026-11-05T10:00:00.000Z',
    postedBy: null,
    rowVersion: 1,
    debitTotal: '250.0000',
    creditTotal: '250.0000',
    balanced: true,
    lines: [],
  };
}

function journalPayloadA() {
  return {
    ...journalPayloadB(),
    id: JOURNAL_A,
    chartId: CHART_A,
    periodId: PERIOD_A,
    unitId: 'unit-a',
    description: 'Venda da unidade A',
    occurredOn: '2026-10-05',
    sourceKind: 'BILLING',
    sourceReference: 'FAT-2026-0001',
    idempotencyKey: 'journal-a-1',
    entryNumber: 3,
  };
}

/**
 * Servidor simulado no nivel de rede: as unidades vem do mesmo endpoint que o contexto do shell
 * consome e planos/periodos/lancamentos sao recortados pela unidade, plano e periodo realmente
 * enviados na URL — assim o teste prova que a escolha humana (unidade -> plano -> periodo)
 * chega a API.
 */
function createFetchMock(options: { units?: string[] } = {}) {
  const units = options.units ?? ['unit-a', 'unit-b'];
  const calls: string[] = [];
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const raw =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(raw, 'http://127.0.0.1');
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

      const periodsMatch = /^\/api\/v1\/accounting\/charts\/([^/]+)\/periods$/.exec(url.pathname);
      if (method === 'GET' && periodsMatch) {
        const chartId = periodsMatch[1] ?? '';
        return jsonResponse({ chartId, items: PERIODS_BY_CHART[chartId] ?? [] });
      }

      const journalsMatch = /^\/api\/v1\/accounting\/charts\/([^/]+)\/journals$/.exec(url.pathname);
      if (method === 'GET' && journalsMatch) {
        const chartId = journalsMatch[1] ?? '';
        const periodId = url.searchParams.get('periodId') ?? '';
        const items =
          chartId === CHART_B && periodId === PERIOD_B
            ? [journalPayloadB()]
            : chartId === CHART_A && periodId === PERIOD_A
              ? [journalPayloadA()]
              : [];
        return jsonResponse({ page: 0, pageSize: 25, total: items.length, totalPages: 1, items });
      }

      const closeRunsMatch = /^\/api\/v1\/accounting\/periods\/([^/]+)\/close-runs$/.exec(url.pathname);
      if (method === 'GET' && closeRunsMatch) {
        return jsonResponse({ periodId: closeRunsMatch[1] ?? '', runs: [] });
      }

      return jsonResponse({ error: { code: 'ACCOUNTING_NOT_FOUND' } }, 404);
    },
  );
  return { fetchMock, calls };
}

function unitField(): HTMLElement {
  return screen.getByLabelText(/unidade operacional/i);
}

function chartField(): HTMLElement {
  return screen.getByLabelText(/plano de contas/i);
}

function periodField(): HTMLElement {
  return screen.getByLabelText(/período contábil/i);
}

type User = ReturnType<typeof userEvent.setup>;

/** Escolha humana da unidade autorizada: nenhum identificador e digitado em nenhum passo. */
async function chooseUnit(user: User, unit: string) {
  await waitFor(() => expect(unitField()).not.toBeDisabled());
  await user.selectOptions(unitField(), unit);
}

async function chooseChart(user: User, chartId: string) {
  await waitFor(() => expect(chartField()).not.toBeDisabled());
  await user.selectOptions(chartField(), chartId);
}

async function choosePeriod(user: User, periodId: string) {
  await waitFor(() => expect(periodField()).not.toBeDisabled());
  await user.selectOptions(periodField(), periodId);
}

configure({ asyncUtilTimeout: 1500 });

describe('Lançamentos — escopo humano vindo do shell (unidade -> plano -> período)', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  function renderJournals() {
    return renderWithProviders(
      <Routes>
        <Route path="/app/accounting/journals" element={<JournalsPage />} />
        <Route path="/app/accounting/journals/:journalId" element={<JournalsPage />} />
      </Routes>,
      { router: { initialEntries: ['/app/accounting/journals'] } },
    );
  }

  it('oferece a unidade em lista do shell e nao aceita identificador digitado', async () => {
    const { fetchMock } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    renderJournals();

    await waitFor(() => expect(unitField()).not.toBeDisabled());
    expect(unitField().tagName).toBe('SELECT');
    /*
     * ESCOPO HUMANO, NAO SLUG. O `<option>` carrega o identificador REAL no `value` — o recorte
     * enviado a API continua sendo a unidade autorizada — mas o TEXTO lido pelo operador nunca e
     * o identificador interno: a superficie declara a posicao no escopo. Antes este teste
     * afirmava `['unit-a', 'unit-b']` como texto visivel, fixando o vazamento como esperado.
     */
    const unitOptions = within(unitField()).getAllByRole('option');
    expect(unitOptions.map((option) => option.textContent)).toEqual(['Unidade 1', 'Unidade 2']);
    expect(unitOptions.map((option) => (option as HTMLOptionElement).value)).toEqual([
      'unit-a',
      'unit-b',
    ]);
    // Nenhum campo de texto livre para identificador tecnico nesta tela.
    expect(screen.queryByPlaceholderText('ex.: unit-a')).toBeNull();
    // O botao que submetia a unidade digitada deixou de existir.
    expect(screen.queryByRole('button', { name: /^carregar$/i })).toBeNull();
  });

  it('leva unidade, plano e periodo escolhidos ate a API com o caminho e a query corretos', async () => {
    const { fetchMock, calls } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    renderJournals();

    // A primeira unidade autorizada entra como contexto inicial do shell.
    await waitFor(() => {
      expect(calls).toContain('/api/v1/accounting/charts?unitId=unit-a');
    });

    await chooseUnit(user, 'unit-b');
    await waitFor(() => {
      expect(calls).toContain('/api/v1/accounting/charts?unitId=unit-b');
    });

    await chooseChart(user, CHART_B);
    await waitFor(() => {
      expect(calls).toContain(`/api/v1/accounting/charts/${CHART_B}/periods`);
    });

    await choosePeriod(user, PERIOD_B);
    await waitFor(() => {
      expect(calls).toContain(
        `/api/v1/accounting/charts/${CHART_B}/journals?page=0&pageSize=25&periodId=${PERIOD_B}`,
      );
    });
    await waitFor(() => {
      expect(screen.getByText('Apuração do período')).toBeInTheDocument();
    });
  });

  it('mostra o periodo pelo codigo humano e intervalo de datas, nunca pelo uuid', async () => {
    const { fetchMock } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    renderJournals();

    await chooseUnit(user, 'unit-b');
    await chooseChart(user, CHART_B);
    await waitFor(() => expect(periodField()).not.toBeDisabled());

    // Controle de período e uma lista de periodos reais do plano escolhido.
    expect(periodField().tagName).toBe('SELECT');
    const option = within(periodField()).getByRole('option', {
      name: '2026-11 — 2026-11-01 a 2026-11-30 (Aberto)',
    });
    expect(option).toBeInTheDocument();
    // O uuid continua apenas no valor tecnico da opcao, nunca visivel ao operador.
    expect((option as HTMLOptionElement).value).toBe(PERIOD_B);
    expect(
      within(periodField())
        .getAllByRole('option')
        .some((candidate) => (candidate.textContent ?? '').includes(PERIOD_B)),
    ).toBe(false);
  });

  it('exibe a origem persistida do lancamento sem inferir pelo historico e sem link de drill-down', async () => {
    const { fetchMock } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    renderJournals();

    await chooseUnit(user, 'unit-b');
    await chooseChart(user, CHART_B);
    await choosePeriod(user, PERIOD_B);

    const table = await screen.findByRole('table', { name: /lançamentos do período/i });
    const row = within(table).getAllByRole('row')[1] as HTMLElement;
    // Rotulo do source_kind persistido (TAX) + referencia persistida.
    expect(within(row).getByText('Tributos')).toBeInTheDocument();
    expect(within(row).getByText('FIS-2026-0001')).toBeInTheDocument();
    // O historico do lancamento nao define a origem; ele fica na coluna propria.
    expect(within(row).getByText('Apuração do período')).toBeInTheDocument();
    // Nenhum link de drill-down inventado para o registro de origem.
    expect(within(row).queryByRole('link')).toBeNull();
  });

  it('trocar a unidade limpa plano e periodo escolhidos antes (nenhum uuid orfao)', async () => {
    const { fetchMock } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    renderJournals();

    await chooseUnit(user, 'unit-a');
    await chooseChart(user, CHART_A);
    await choosePeriod(user, PERIOD_A);
    await waitFor(() => {
      expect(screen.getByText('Venda da unidade A')).toBeInTheDocument();
    });

    await user.selectOptions(unitField(), 'unit-b');

    await waitFor(() => {
      expect(chartField()).toHaveValue('');
    });
    await waitFor(() => {
      expect(periodField()).toHaveValue('');
    });
    expect(screen.queryByText('Venda da unidade A')).toBeNull();
    expect(screen.queryByRole('table', { name: /lançamentos do período/i })).toBeNull();
  });

  async function honestEmptyUnitState(Page: ComponentType) {
    const { fetchMock, calls } = createFetchMock({ units: [] });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<Page />);

    await waitFor(() => {
      expect(screen.getByText('Nenhuma unidade operacional disponível')).toBeInTheDocument();
    });
    expect(unitField()).toBeDisabled();
    expect(
      within(unitField()).getByRole('option', { name: /nenhuma unidade disponível/i }),
    ).toBeInTheDocument();
    // Sem unidade autorizada nao existe alternativa digitada: nenhum campo de texto livre.
    expect(screen.queryByPlaceholderText('ex.: unit-a')).toBeNull();
    expect(calls.some((call) => call.startsWith('/api/v1/accounting/charts'))).toBe(false);
  }

  it('Lançamentos: sem unidade autorizada mostra estado honesto e nao consulta a contabilidade', async () => {
    await honestEmptyUnitState(JournalsPage);
  });

  it('Fechamentos: sem unidade autorizada mostra estado honesto e nao consulta a contabilidade', async () => {
    await honestEmptyUnitState(PeriodClosePage);
  });

  it('Diário: sem unidade autorizada mostra estado honesto e nao consulta a contabilidade', async () => {
    await honestEmptyUnitState(JournalBookPage);
  });
});

describe('Fechamentos e relatórios de período — escopo humano vindo do shell', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('Fechamentos: escolhe plano e periodo pelo servidor e mantem as acoes de fechar/reabrir', async () => {
    const { fetchMock, calls } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    renderWithProviders(<PeriodClosePage />);

    await waitFor(() => {
      expect(calls).toContain('/api/v1/accounting/charts?unitId=unit-a');
    });
    await chooseChart(user, CHART_A);
    await waitFor(() => {
      expect(calls).toContain(`/api/v1/accounting/charts/${CHART_A}/periods`);
    });
    await choosePeriod(user, PERIOD_A);
    await waitFor(() => {
      expect(calls).toContain(`/api/v1/accounting/periods/${PERIOD_A}/close-runs`);
    });

    // Período humano (codigo + intervalo), nunca uuid.
    const option = within(periodField()).getByRole('option', {
      name: '2026-10 — 2026-10-01 a 2026-10-31 (Aberto)',
    });
    expect((option as HTMLOptionElement).value).toBe(PERIOD_A);

    // As acoes de fechamento continuam existindo, com o mesmo fluxo de confirmacao.
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reabrir' })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('ex.: unit-a')).toBeNull();
  });

  it('Diário: consulta o servidor com plano e periodo escolhidos e mostra o periodo humano', async () => {
    const { fetchMock, calls } = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    renderWithProviders(<JournalBookPage />);

    await chooseUnit(user, 'unit-b');
    await chooseChart(user, CHART_B);
    await choosePeriod(user, PERIOD_B);

    await waitFor(() => {
      expect(calls).toContain(
        `/api/v1/accounting/charts/${CHART_B}/journals?page=0&pageSize=50&periodId=${PERIOD_B}&status=POSTED`,
      );
    });
    await waitFor(() => {
      expect(screen.getByRole('table', { name: /livro diário/i })).toBeInTheDocument();
    });
    expect(
      within(periodField()).getByRole('option', {
        name: '2026-11 — 2026-11-01 a 2026-11-30 (Aberto)',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('ex.: unit-a')).toBeNull();
  });
});
