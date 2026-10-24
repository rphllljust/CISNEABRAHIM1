import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EconomicTracePage } from './pages/EconomicTracePage';

/**
 * F1.1 — TRILHA ECONÔMICA.
 *
 * Prova o DoD de rastreabilidade e de visibilidade de estado:
 *
 *   RECEIVABLE → SETTLEMENT → ACCOUNTING EVENT → POSTING → JOURNAL  (cadeia visível)
 *   FINANCEIRO: LIQUIDADO · CONTABILIDADE: FALHOU                    (estado duplo)
 *   causa / impacto / tentativas / responsável / próxima ação        (falha operável)
 *
 * A tela NÃO decide nada: `summary`, `impact`, `nextAction` e `availableCommands` vêm
 * do backend. Os testes verificam que ela apresenta o que recebeu — e que NÃO inventa
 * estado quando a leitura falha.
 */

const mockFetchSettlementTrace = vi.fn();
const mockFetchPaymentTrace = vi.fn();
const mockRetryPosting = vi.fn();

vi.mock('./api/economic-trace-api', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('./api/economic-trace-api');
  return {
    ...actual,
    /**
     * A página passou a usar `fetchFactTrace(factKind, factId)` — uma função só, porque o
     * rótulo do fato vem da rota publicada pelo backend e não deve ser reclassificado no
     * frontend. O mock acompanha: os dois mocks antigos permanecem para os testes que
     * verificam qual ENDPOINT foi escolhido, mas o caminho real passa por aqui.
     */
    fetchFactTrace: (factKind: unknown, factId: unknown, ...rest: unknown[]) =>
      (String(factKind) === 'payment'
        ? mockFetchPaymentTrace(factId, ...rest)
        : mockFetchSettlementTrace(factId, ...rest)) as Promise<never>,
    fetchSettlementTrace: (...args: unknown[]) => mockFetchSettlementTrace(...args) as Promise<never>,
    fetchPaymentTrace: (...args: unknown[]) => mockFetchPaymentTrace(...args) as Promise<never>,
    retryEconomicPosting: (...args: unknown[]) => mockRetryPosting(...args) as Promise<never>,
  };
});

function traceView(overrides: Record<string, unknown> = {}) {
  return {
    factKind: 'SETTLEMENT',
    factId: 'settlement-1',
    unitId: 'unit-1',
    amount: '500.0000',
    currencyCode: 'BRL',
    occurredOn: '2026-10-15',
    financialState: 'SETTLED',
    accountingState: 'FAILED',
    situation: 'ATTENTION',
    severity: 'CRITICAL',
    summary: 'FINANCEIRO: LIQUIDADO · CONTABILIDADE: FALHOU',
    impact:
      'O caixa reconhece 500.0000, mas o lançamento contábil correspondente não existe — o balanço fica divergente até a contabilização ser concluída.',
    economicEvent: {
      id: 'event-1',
      eventKind: 'SETTLEMENT_CONFIRMED',
      sourceKind: 'RECEIVABLE_SETTLEMENT',
      sourceId: 'settlement-1',
      amount: '500.0000',
      currencyCode: 'BRL',
      occurredOn: '2026-10-15',
      outboxEventId: 'outbox-1',
      transportState: 'FAILED',
      transportAttempts: 3,
      transportLastError: 'ACCOUNTING_RULE_NOT_CONFIGURED',
    },
    posting: {
      state: 'FAILED',
      postingRequestId: null,
      journalEntryId: null,
      journalNumber: null,
      journalKind: null,
      postedAt: null,
      failure: {
        code: 'ACCOUNTING_RULE_NOT_CONFIGURED',
        message: 'ACCOUNTING_RULE_NOT_CONFIGURED',
        attempts: 3,
        maxAttempts: 10,
        firstFailedAt: '2026-10-15T10:00:00.000Z',
        lastFailedAt: '2026-10-15T10:00:00.000Z',
      },
      rule: null,
    },
    trace: [
      {
        kind: 'RECEIVABLE',
        reference: 'receivab',
        status: 'ACTIVE',
        occurredAt: null,
        route: '/app/finance/receivables/receivable-1',
      },
      {
        kind: 'SETTLEMENT',
        reference: 'settleme',
        status: 'SETTLED',
        occurredAt: '2026-10-15',
        route: '/app/finance/receivables/receivable-1',
      },
      {
        kind: 'ECONOMIC_EVENT',
        reference: 'SETTLEMENT_CONFIRMED',
        status: 'FAILED',
        occurredAt: '2026-10-15',
        route: '/app/accounting/economic-trace/settlement/settlement-1',
      },
    ],
    nextAction: {
      command: 'RETRY_POSTING',
      label: 'Reprocessar contabilização',
      reason:
        'A contabilização falhou e o fato econômico permanece registrado. Reprocessar aplica a regra de posting já publicada.',
      owner: 'accounting:posting-request',
    },
    availableCommands: ['VIEW_RECEIVABLE', 'RETRY_POSTING'],
    ...overrides,
  };
}

function renderAt(factKind: string) {
  return render(
    <MemoryRouter initialEntries={[`/app/accounting/economic-trace/${factKind}/settlement-1`]}>
      <Routes>
        <Route
          path="/app/accounting/economic-trace/:factKind/:factId"
          element={<EconomicTracePage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('F1.1 — EconomicTracePage', () => {
  beforeEach(() => {
    mockFetchSettlementTrace.mockReset();
    mockFetchPaymentTrace.mockReset();
    mockRetryPosting.mockReset();
  });

  it('mostra o ESTADO DUPLO como o backend decidiu', async () => {
    mockFetchSettlementTrace.mockResolvedValue(traceView());
    renderAt('settlement');

    expect(
      await screen.findByText(/FINANCEIRO: LIQUIDADO · CONTABILIDADE: FALHOU/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Contabilidade/)).toBeInTheDocument();
    expect(screen.getByText('Falhou')).toBeInTheDocument();
  });

  it('mostra a CADEIA completa até o lançamento', async () => {
    mockFetchSettlementTrace.mockResolvedValue(traceView());
    renderAt('settlement');

    expect(await screen.findByText(/Título a receber/)).toBeInTheDocument();
    expect(screen.getByText(/Liquidação/)).toBeInTheDocument();
    expect(screen.getByText(/Evento econômico/)).toBeInTheDocument();
  });

  it('mostra a FALHA persistida com causa, tentativas e responsável', async () => {
    mockFetchSettlementTrace.mockResolvedValue(traceView());
    renderAt('settlement');

    expect(await screen.findByText(/Contabilização não concluída/)).toBeInTheDocument();
    // O motivo registrado aparece na seção de falha (rótulo explícito, não só o valor).
    expect(screen.getByText(/Motivo registrado:/)).toBeInTheDocument();
    expect(screen.getByText(/3 de 10/)).toBeInTheDocument();
  });

  it('mostra o IMPACTO econômico do desvio', async () => {
    mockFetchSettlementTrace.mockResolvedValue(traceView());
    renderAt('settlement');

    expect(
      await screen.findByText(/o balanço fica divergente até a contabilização/i),
    ).toBeInTheDocument();
  });

  it('mostra a PRÓXIMA AÇÃO e o responsável vindos do backend', async () => {
    mockFetchSettlementTrace.mockResolvedValue(traceView());
    renderAt('settlement');

    // O comando vem como BOTÃO real (não como texto solto na explicação).
    expect(
      await screen.findByRole('button', { name: /Reprocessar contabilização/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Responsável: accounting:posting-request/)).toBeInTheDocument();
  });

  it('exibe o journal quando o fato está contabilizado', async () => {
    mockFetchSettlementTrace.mockResolvedValue(
      traceView({
        accountingState: 'POSTED',
        situation: 'CONSISTENT',
        severity: 'NONE',
        summary: 'FINANCEIRO: LIQUIDADO · CONTABILIDADE: CONTABILIZADO',
        impact: null,
        posting: {
          state: 'POSTED',
          postingRequestId: 'posting-1',
          journalEntryId: 'journal-1',
          journalNumber: 42,
          journalKind: 'ENTRY',
          postedAt: '2026-10-15T10:00:00.000Z',
          failure: null,
          rule: {
            ruleId: 'rule-1',
            ruleCode: 'SETTLEMENT-RULE',
            versionId: 'version-1',
            versionNumber: 2,
            debitAccountId: 'acc-1',
            debitAccountLabel: '1.1.05 · Caixa/Banco',
            creditAccountId: 'acc-2',
            creditAccountLabel: '1.1.08 · Contas a receber',
          },
        },
        trace: [
          ...traceView().trace,
          {
            kind: 'JOURNAL',
            reference: '#42',
            status: 'POSTED',
            occurredAt: '2026-10-15T10:00:00.000Z',
            route: '/app/accounting/journals',
          },
        ],
        nextAction: {
          command: null,
          label: 'Nenhuma ação necessária',
          reason: 'O fato financeiro e a contabilização estão consistentes.',
          owner: null,
        },
        availableCommands: ['VIEW_RECEIVABLE', 'OPEN_JOURNAL'],
      }),
    );
    renderAt('settlement');

    expect(
      await screen.findByText(/CONTABILIDADE: CONTABILIZADO/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Regra SETTLEMENT-RULE · versão 2/)).toBeInTheDocument();
    expect(screen.getByText(/Lançamento #42/)).toBeInTheDocument();
    expect(screen.getByText(/1.1.05 · Caixa\/Banco/)).toBeInTheDocument();
  });

  it('NÃO mostra botão de reprocessar quando o backend não autorizou', async () => {
    mockFetchSettlementTrace.mockResolvedValue(
      traceView({ availableCommands: ['VIEW_RECEIVABLE'] }),
    );
    renderAt('settlement');

    await screen.findByText(/FINANCEIRO: LIQUIDADO/);
    expect(
      screen.queryByRole('button', { name: /Reprocessar contabilização/i }),
    ).not.toBeInTheDocument();
  });

  it('declara falha de leitura em vez de afirmar que está consistente', async () => {
    const { EconomicTraceApiError } = await vi.importActual<
      typeof import('./api/economic-trace-api')
    >('./api/economic-trace-api');
    mockFetchSettlementTrace.mockRejectedValue(new EconomicTraceApiError('network'));
    renderAt('settlement');

    expect(await screen.findByText(/Leitura indisponível/)).toBeInTheDocument();
    expect(
      screen.getByText(/desconhecida nesta leitura — não é "sem pendência"/),
    ).toBeInTheDocument();
  });

  it('usa o endpoint de PAGAMENTO quando a rota é de pagamento', async () => {
    mockFetchPaymentTrace.mockResolvedValue(
      traceView({ factKind: 'PAYMENT', factId: 'payment-1' }),
    );
    render(
      <MemoryRouter initialEntries={['/app/accounting/economic-trace/payment/payment-1']}>
        <Routes>
          <Route
            path="/app/accounting/economic-trace/:factKind/:factId"
            element={<EconomicTracePage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/Trilha do pagamento/)).toBeInTheDocument();
    expect(mockFetchPaymentTrace).toHaveBeenCalledWith('payment-1', expect.anything());
    expect(mockFetchSettlementTrace).not.toHaveBeenCalled();
  });
});
