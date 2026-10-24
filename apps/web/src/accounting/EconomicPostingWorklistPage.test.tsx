import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EconomicPostingWorklistPage } from './pages/EconomicPostingWorklistPage';

/**
 * F1.1 — ACCOUNTING EXCEPTION WORKBENCH.
 *
 * Prova o floorplan `WORK QUEUE → ACTIVE WORK → CONTEXT` e a regra de que a tela NÃO
 * decide: `situation`, `severity`, `reason`, `nextAction` e `availableCommands` vêm do
 * backend, e a tela apenas apresenta.
 *
 * As asserções são ESCOPADAS por região (fila / caso ativo / contexto) porque o
 * floorplan expõe legitimamente a mesma informação em mais de uma coluna — o comando
 * aparece na fila E no contexto. Uma asserção global não provaria a coluna certa.
 */

const mockFetchWorklist = vi.fn();
const mockFetchSettlementTrace = vi.fn();
const mockFetchPaymentTrace = vi.fn();
const mockRetryPosting = vi.fn();

vi.mock('./api/economic-trace-api', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('./api/economic-trace-api');
  return {
    ...actual,
    fetchEconomicWorklist: (...args: unknown[]) => mockFetchWorklist(...args) as Promise<never>,
    fetchSettlementTrace: (...args: unknown[]) => mockFetchSettlementTrace(...args) as Promise<never>,
    fetchPaymentTrace: (...args: unknown[]) => mockFetchPaymentTrace(...args) as Promise<never>,
    retryEconomicPosting: (...args: unknown[]) => mockRetryPosting(...args) as Promise<never>,
  };
});

vi.mock('../shell/hooks/useOperationalUnits', () => ({
  useOperationalUnits: () => ({
    units: ['unit-1'],
    options: [{ value: 'unit-1', label: 'Unidade autorizada' }],
    unitId: 'unit-1',
    setUnitId: vi.fn(),
    status: 'ready',
    error: null,
    reload: vi.fn(),
  }),
  OperationalUnitOptions: () => <option value="unit-1">Unidade autorizada</option>,
}));

function workItem(overrides: Record<string, unknown> = {}) {
  return {
    factKind: 'SETTLEMENT',
    factId: 'settlement-1',
    unitId: 'unit-1',
    reference: 'RECEIVABLE_SETTLEMENT 12345678',
    amount: '500.0000',
    currencyCode: 'BRL',
    financialState: 'SETTLED',
    accountingState: 'FAILED',
    situation: 'ATTENTION',
    severity: 'CRITICAL',
    reason: 'Contabilização falhou após 3 tentativa(s): ACCOUNTING_RULE_NOT_CONFIGURED',
    firstFailedAt: '2026-10-15T10:00:00.000Z',
    attempts: 3,
    nextAction: {
      command: 'RETRY_POSTING',
      label: 'Reprocessar contabilização',
      reason: 'A contabilização falhou e o fato econômico permanece registrado.',
      owner: 'accounting:posting-request',
    },
    availableCommands: ['VIEW_RECEIVABLE', 'RETRY_POSTING'],
    route: '/app/accounting/economic-trace/settlement/settlement-1',
    ...overrides,
  };
}

function worklistPayload(items: Array<Record<string, unknown>> = [workItem()]) {
  return {
    counts: { pending: 0, failed: items.length, reversed: 0 },
    items,
    limit: 25,
    offset: 0,
    total: items.length,
  };
}

function renderWorkbench() {
  return render(
    <MemoryRouter>
      <EconomicPostingWorklistPage />
    </MemoryRouter>,
  );
}

function queueRegion() {
  return screen.getByRole('region', { name: 'Fila de resolução' });
}
function activeRegion() {
  return screen.getByRole('region', { name: 'Caso ativo' });
}
function contextRegion() {
  return screen.getByRole('region', { name: 'Contexto da decisão' });
}

describe('F1.1 — Workbench: floorplan de resolução', () => {
  beforeEach(() => {
    mockFetchWorklist.mockReset();
    mockFetchSettlementTrace.mockReset();
    mockFetchPaymentTrace.mockReset();
    mockRetryPosting.mockReset();
  });

  it('renderiza as TRÊS colunas: fila, caso ativo e contexto da decisão', async () => {
    mockFetchWorklist.mockResolvedValue(worklistPayload());
    renderWorkbench();

    await screen.findByRole('region', { name: 'Fila de resolução' });
    expect(queueRegion()).toBeInTheDocument();
    expect(activeRegion()).toBeInTheDocument();
    expect(contextRegion()).toBeInTheDocument();
  });

  it('mostra a EXCEÇÃO com estado financeiro E contábil no caso ativo', async () => {
    mockFetchWorklist.mockResolvedValue(worklistPayload());
    renderWorkbench();

    await screen.findByText(/Estado do fato/i);
    const active = activeRegion();
    expect(within(active).getByText('Liquidado')).toBeInTheDocument();
    expect(within(active).getByText('Falhou')).toBeInTheDocument();
  });

  it('mostra CAUSA e tentativas do caso ativo', async () => {
    mockFetchWorklist.mockResolvedValue(worklistPayload());
    renderWorkbench();

    await screen.findByText(/Causa registrada/i);
    const active = activeRegion();
    expect(within(active).getByText(/ACCOUNTING_RULE_NOT_CONFIGURED/)).toBeInTheDocument();
    expect(within(active).getByText('3')).toBeInTheDocument();
  });

  it('mostra PRÓXIMA AÇÃO, responsável e comando no contexto da decisão', async () => {
    mockFetchWorklist.mockResolvedValue(worklistPayload());
    renderWorkbench();

    await screen.findByText(/Próxima ação/i);
    const context = contextRegion();
    // O label aparece como TEXTO da ação e como NOME do botão: a asserção de texto
    // usa o motivo (exclusivo do contexto), e a de comando usa o role.
    expect(
      within(context).getByText(/A contabilização falhou e o fato econômico permanece/),
    ).toBeInTheDocument();
    expect(
      within(context).getByText(/Responsável: accounting:posting-request/),
    ).toBeInTheDocument();
    expect(
      within(context).getByRole('button', { name: /Reprocessar contabilização/i }),
    ).toBeInTheDocument();
  });

  it('oferece o comando na FILA somente quando o backend o autorizou', async () => {
    mockFetchWorklist.mockResolvedValue(worklistPayload());
    renderWorkbench();

    await screen.findByRole('region', { name: 'Fila de resolução' });
    expect(
      within(queueRegion()).getByRole('button', { name: /Reprocessar contabilização/i }),
    ).toBeInTheDocument();
  });

  it('NÃO oferece o comando quando o backend não o autorizou', async () => {
    mockFetchWorklist.mockResolvedValue(
      worklistPayload([
        workItem({
          availableCommands: ['VIEW_RECEIVABLE'],
          nextAction: {
            command: null,
            label: 'Verificar competência contábil',
            reason: 'Aguardando decisão contábil.',
            owner: 'accounting:journal:post',
          },
        }),
      ]),
    );
    renderWorkbench();

    await screen.findByRole('region', { name: 'Fila de resolução' });
    expect(
      within(queueRegion()).queryAllByRole('button', { name: /Reprocessar contabilização/i }),
    ).toHaveLength(0);
    expect(within(contextRegion()).getByText(/Verificar competência contábil/)).toBeInTheDocument();
  });

  it('declara fila vazia de forma honesta', async () => {
    mockFetchWorklist.mockResolvedValue(worklistPayload([]));
    renderWorkbench();

    expect(await screen.findByText(/Nenhuma exceção de contabilização/i)).toBeInTheDocument();
    expect(screen.getByText(/Nenhum caso selecionado/i)).toBeInTheDocument();
  });

  it('declara falha de leitura em vez de mostrar fila vazia', async () => {
    const { EconomicTraceApiError } = await vi.importActual<
      typeof import('./api/economic-trace-api')
    >('./api/economic-trace-api');
    mockFetchWorklist.mockRejectedValue(new EconomicTraceApiError('network'));
    renderWorkbench();

    expect(await screen.findByText(/Leitura indisponível/i)).toBeInTheDocument();
    expect(screen.getByText(/desconhecida nesta leitura — não é zero/i)).toBeInTheDocument();
  });

  it('declara acesso negado sem sugerir que não há trabalho', async () => {
    const { EconomicTraceApiError } = await vi.importActual<
      typeof import('./api/economic-trace-api')
    >('./api/economic-trace-api');
    mockFetchWorklist.mockRejectedValue(new EconomicTraceApiError('denied'));
    renderWorkbench();

    expect(await screen.findByText(/Acesso negado/i)).toBeInTheDocument();
  });

  it('linka a trilha completa a partir da fila', async () => {
    mockFetchWorklist.mockResolvedValue(worklistPayload());
    renderWorkbench();

    await screen.findByRole('region', { name: 'Fila de resolução' });
    const link = within(queueRegion()).getByRole('link', { name: /Trilha/i });
    expect(link).toHaveAttribute(
      'href',
      '/app/accounting/economic-trace/settlement/settlement-1',
    );
  });

  it('lê a unidade a partir do escopo do ator', async () => {
    mockFetchWorklist.mockResolvedValue(worklistPayload());
    renderWorkbench();

    await waitFor(() => {
      expect(mockFetchWorklist).toHaveBeenCalledWith(
        'unit-1',
        expect.objectContaining({ limit: 25, offset: 0 }),
        expect.anything(),
      );
    });
  });

  it('seleciona outro caso da fila no centro', async () => {
    mockFetchWorklist.mockResolvedValue(
      worklistPayload([
        workItem(),
        workItem({
          factKind: 'PAYMENT',
          factId: 'payment-9',
          amount: '900.0000',
          reason: 'Pagamento sem contabilização.',
          route: '/app/accounting/economic-trace/payment/payment-9',
        }),
      ]),
    );
    const user = userEvent.setup();
    renderWorkbench();

    await screen.findByRole('region', { name: 'Fila de resolução' });
    // Dois fatos na fila ⇒ dois seletores de caso.
    const selectionButtons = within(queueRegion()).getAllByTitle('Abrir este caso no centro');
    expect(selectionButtons).toHaveLength(2);
    await user.click(selectionButtons[1]!);

    const active = activeRegion();
    // O valor aparece no bloco de estado E na trilha econômica: `getAllByText`
    // prova presença sem exigir unicidade que a tela legitimamente não tem.
    expect(within(active).getAllByText(/R\$\s*900,00/).length).toBeGreaterThan(0);
  });
});

describe('F1.1 — comando de reprocessamento', () => {
  beforeEach(() => {
    mockFetchWorklist.mockReset();
    mockFetchSettlementTrace.mockReset();
    mockFetchPaymentTrace.mockReset();
    mockRetryPosting.mockReset();
  });

  async function clickResolve() {
    const user = userEvent.setup();
    renderWorkbench();
    const context = await screen.findByRole('region', { name: 'Contexto da decisão' });
    await user.click(
      within(context).getByRole('button', { name: /Reprocessar contabilização/i }),
    );
  }

  it('não dispara o comando sem evento de transporte identificado', async () => {
    mockFetchWorklist.mockResolvedValue(worklistPayload());
    mockFetchSettlementTrace.mockResolvedValue({ economicEvent: null });

    await clickResolve();

    expect(
      await screen.findByText(/não possui evento de transporte identificado/i),
    ).toBeInTheDocument();
    expect(mockRetryPosting).not.toHaveBeenCalled();
  });

  it('executa o comando REAL e declara o resultado', async () => {
    mockFetchWorklist.mockResolvedValue(worklistPayload());
    mockFetchSettlementTrace.mockResolvedValue({
      economicEvent: { outboxEventId: 'outbox-1' },
    });
    mockRetryPosting.mockResolvedValue({
      outcome: 'POSTED',
      journalEntryId: 'journal-1',
      postingRequestId: 'posting-1',
    });

    await clickResolve();

    expect(mockRetryPosting).toHaveBeenCalledWith('outbox-1');
    expect(await screen.findByText(/Contabilização reprocessada: POSTED/i)).toBeInTheDocument();
  });

  it('declara a falha do comando sem esconder o erro', async () => {
    mockFetchWorklist.mockResolvedValue(worklistPayload());
    mockFetchSettlementTrace.mockResolvedValue({
      economicEvent: { outboxEventId: 'outbox-1' },
    });
    const { EconomicTraceApiError } = await vi.importActual<
      typeof import('./api/economic-trace-api')
    >('./api/economic-trace-api');
    mockRetryPosting.mockRejectedValue(new EconomicTraceApiError('denied'));

    await clickResolve();

    expect(
      await screen.findByText(/não tem permissão para ler as exceções/i),
    ).toBeInTheDocument();
  });
});
