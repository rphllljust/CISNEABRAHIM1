import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import {
  ECONOMIC_ACCOUNTING_STATES,
  ECONOMIC_COMMANDS,
  ECONOMIC_FINANCIAL_STATES,
  ECONOMIC_SEVERITIES,
  ECONOMIC_SITUATIONS,
  buildEconomicSummary,
  type EconomicAccountingState,
  type EconomicCommand,
  type EconomicEventSummary,
  type EconomicFinancialState,
  type EconomicNextAction,
  type EconomicPostingFact,
  type EconomicSeverity,
  type EconomicSituation,
  type EconomicTraceNode,
  type EconomicTraceView,
  type EconomicWorkItem,
  type EconomicWorklistView,
} from '../../platform/bounded-contexts/economic-trace.contract';

/**
 * F1.1 — READ MODEL DA TRILHA ECONÔMICA.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * POR QUE ELE É UM READ MODEL, E NÃO UMA VIEW
 *
 * A cadeia `settlement/payment → economic event → postings → journal` atravessa TRÊS
 * schemas de dois contexts (`fin`, `evt`, `acc`). Uma view faria o consumidor depender
 * de colunas privadas de outro contexto; uma série de chamadas no React faria a tela
 * decidir estado de negócio. Nenhum dos dois é aceitável.
 *
 * O read model resolve as duas coisas: roda no backend (que pode ler os três por
 * `rpt.*` publicado + o ledger econômico), e entrega DECIDIDO — estado contábil,
 * situação, severidade, comandos e próxima ação vêm prontos. A tela apresenta.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * ESTADOS QUE ESTE ARQUIVO DISTINGUE (e que antes não existiam em lugar nenhum)
 *
 *   NOT_REACHED — o fato econômico nem chegou a ACCOUNTING (sem evento na outbox)
 *   PENDING     — evento publicado, decisão contábil ainda não tomada
 *   POSTED      — journal emitido
 *   REVERSED    — compensação emitida
 *   FAILED      — ACCOUNTING recusou ou a outbox esgotou tentativas
 *
 * `FAILED` é o caso que a F1.1 existe para tornar OPERÁVEL: ele aparece com código,
 * mensagem, tentativas e comando de retry autorizado — não como toast.
 */

type SettlementRow = {
  id: string;
  receivable_id: string;
  amount: string;
  currency_code: string;
  status: string;
  settled_at: string;
  reversed_at: string | null;
  reversal_reason: string | null;
  external_reference: string | null;
};

type PaymentRow = {
  id: string;
  payable_id: string;
  amount: string;
  currency_code: string;
  kind: string;
  paid_at: string;
  payment_reference: string;
  reverses_payment_id: string | null;
};

type EconomicEventRow = {
  id: string;
  unit_id: string;
  event_kind: string;
  source_kind: string;
  source_id: string;
  amount: string;
  currency_code: string;
  occurred_on: string;
  outbox_event_id: string | null;
};

type OutboxRow = {
  id: string;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  created_at: string;
};

type PostingRow = {
  id: string;
  event_kind: string;
  status: string;
  journal_entry_id: string | null;
  amount: string;
  occurred_on: string;
  posting_rule_id: string;
  posting_rule_version_id: string;
  created_at: string;
};

type JournalRow = {
  id: string;
  entry_number: number | null;
  kind: string;
  status: string;
  posted_at: string | null;
};

type RuleRow = {
  id: string;
  code: string;
  version_number: number | null;
  debit_account_id: string | null;
  debit_code: string | null;
  debit_name: string | null;
  credit_account_id: string | null;
  credit_code: string | null;
  credit_name: string | null;
};

const FAILED_OUTBOX_STATUSES = new Set(['FAILED']);

/**
 * BASE DA ROTA DA TRILHA — a MESMA que o router registra (`/app/accounting/...`).
 *
 * O backend emitia `/app/finance/economic-trace/...` enquanto o `AppRoutes` registra
 * `/app/accounting/economic-trace/:factKind/:factId`. O efeito era exatamente o pior
 * tipo de defeito: a worklist mostrava "Trilha" clicável, e todo clique levava a uma
 * rota inexistente. A cadeia econômica é da CONTROLADORIA (é ela que decide o posting),
 * então o endereço correto é `accounting`.
 *
 * Ficando em constante única, o caminho não pode divergir entre a lista e os nós da trilha.
 */
export const ECONOMIC_TRACE_ROUTE_BASE = '/app/accounting/economic-trace';

@Injectable()
export class EconomicTraceReadModelService {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  /**
   * Dono de uma liquidação — para AUTORIZAR antes de ler a trilha.
   *
   * A autorização de leitura do journal passa pela capability do RECEBÍVEL: quem não
   * pode ver o título não pode ver o lançamento contábil dele (valor, conta,
   * competência). Buscar o dono primeiro é o que permite decidir antes de montar.
   */
  async settlementOwner(
    settlementId: string,
  ): Promise<{ receivableId: string; unitId: string; clientId: string } | null> {
    const result = await this.pool().query<{
      receivable_id: string;
      unit_id: string;
      client_id: string;
    }>(
      `SELECT s.receivable_id, r.unit_id, r.client_id
         FROM rpt.read_settlements s
         JOIN rpt.read_receivables r ON r.id = s.receivable_id
        WHERE s.id = $1::uuid`,
      [settlementId],
    );
    const row = result.rows[0];
    return row
      ? { receivableId: row.receivable_id, unitId: row.unit_id, clientId: row.client_id }
      : null;
  }

  /** Dono de um pagamento — idem, para a capability do TÍTULO A PAGAR. */
  async paymentOwner(
    paymentId: string,
  ): Promise<{ payableId: string; unitId: string } | null> {
    const result = await this.pool().query<{ payable_id: string; unit_id: string }>(
      `SELECT p.payable_id, y.unit_id
         FROM rpt.read_payments p
         JOIN rpt.read_payables y ON y.id = p.payable_id
        WHERE p.id = $1::uuid`,
      [paymentId],
    );
    const row = result.rows[0];
    return row ? { payableId: row.payable_id, unitId: row.unit_id } : null;
  }

  /**
   * Trilha completa de uma liquidação (recebível).
   *
   * Retorna `null` quando o settlement não existe — o chamador decide 404. A
   * autorização é aplicada ANTES, no serviço de acesso do domínio dono.
   */
  async forSettlement(settlementId: string): Promise<EconomicTraceView | null> {
    const settlement = await this.pool().query<SettlementRow>(
      `SELECT s.id, s.receivable_id, s.amount::text AS amount, s.currency_code,
              s.status::text AS status, s.settled_at, s.reversed_at, s.reversal_reason,
              r.external_reference
         FROM rpt.read_settlements s
         JOIN rpt.read_receivables r ON r.id = s.receivable_id
        WHERE s.id = $1::uuid`,
      [settlementId],
    );
    const row = settlement.rows[0];
    if (!row) {
      return null;
    }
    return this.buildTrace({
      factKind: 'SETTLEMENT',
      factId: row.id,
      ownerId: row.receivable_id,
      ownerKind: 'RECEIVABLE',
      amount: row.amount,
      currencyCode: row.currency_code,
      occurredOn: toCivilDate(row.settled_at),
      isReversed: row.status === 'REVERSED',
      reversedAt: row.reversed_at,
      reference: row.external_reference,
      reversalCommand: ECONOMIC_COMMANDS.ReverseSettlement,
      viewCommand: ECONOMIC_COMMANDS.ViewReceivable,
      ownerRouteSegment: 'receivables',
      factRouteSegment: 'settlements',
    });
  }

  /** Trilha completa de um pagamento (título a pagar). */
  async forPayment(paymentId: string): Promise<EconomicTraceView | null> {
    const payment = await this.pool().query<PaymentRow>(
      `SELECT id, payable_id, amount::text AS amount, currency_code,
              kind::text AS kind, paid_at, payment_reference, reverses_payment_id
         FROM rpt.read_payments p
        WHERE id = $1::uuid`,
      [paymentId],
    );
    const row = payment.rows[0];
    if (!row) {
      return null;
    }
    return this.buildTrace({
      factKind: 'PAYMENT',
      factId: row.id,
      ownerId: row.payable_id,
      ownerKind: 'PAYABLE',
      amount: row.amount,
      currencyCode: row.currency_code,
      occurredOn: toCivilDate(row.paid_at),
      isReversed: row.kind === 'REVERSAL',
      reversedAt: null,
      reference: row.payment_reference,
      reversalCommand: ECONOMIC_COMMANDS.ReversePayment,
      viewCommand: ECONOMIC_COMMANDS.ViewPayable,
      ownerRouteSegment: 'payables',
      factRouteSegment: 'payments',
    });
  }

  /**
   * Worklist de exceções econômicas — o que exige ação AGORA.
   *
   * Duas condições entram na fila:
   *   1. evento econômico cuja outbox esgotou tentativas (`FAILED`);
   *   2. evento publicado sem posting (`PENDING`) — a decisão contábil não ocorreu.
   *
   * Uma liquidação consistente NÃO entra: a worklist é de exceção, não de tudo.
   */
  async worklist(
    unitId: string,
    limit: number,
    offset: number,
    situation?: string,
  ): Promise<EconomicWorklistView> {
    const rows = await this.pool().query<{
      event_id: string;
      event_kind: string;
      source_kind: string;
      source_id: string;
      unit_id: string;
      amount: string;
      currency_code: string;
      occurred_on: string;
      outbox_status: string | null;
      attempts: number | null;
      max_attempts: number | null;
      last_error: string | null;
      posting_status: string | null;
      journal_entry_id: string | null;
      first_seen: string | null;
    }>(
      `SELECT e.id AS event_id, e.event_kind, e.source_kind, e.source_id, e.unit_id,
              e.amount::text AS amount, e.currency_code, e.occurred_on::text AS occurred_on,
              o.status::text AS outbox_status, o.attempts, o.max_attempts, o.last_error,
              p.status::text AS posting_status, p.journal_entry_id,
              o.created_at AS first_seen
         FROM rpt.read_economic_events e
         LEFT JOIN rpt.read_outbox_events o ON o.id = e.outbox_event_id
         LEFT JOIN rpt.read_accounting_posting_requests p
                ON p.source_id = e.source_id
               AND p.origin_kind = 'FINANCE'
               AND p.event_kind::text = e.event_kind
        WHERE e.unit_id = $1
          AND (
            o.status = 'FAILED'
            OR (p.status IS NULL AND o.status IN ('PENDING', 'PROCESSING'))
          )
        ORDER BY o.created_at ASC NULLS LAST
        LIMIT $2 OFFSET $3`,
      [unitId, limit, offset],
    );

    const all = rows.rows;
    const items: EconomicWorkItem[] = all
      .map((row) => this.toWorkItem(row))
      .filter((item) => (situation ? item.situation === situation : true));

    const countResult = await this.pool().query<{
      pending: string;
      failed: string;
      reversed: string;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE o.status IN ('PENDING','PROCESSING') AND p.status IS NULL)::text AS pending,
         COUNT(*) FILTER (WHERE o.status = 'FAILED')::text AS failed,
         COUNT(*) FILTER (WHERE p.status = 'POSTED' AND j.kind = 'REVERSAL')::text AS reversed
       FROM rpt.read_economic_events e
       LEFT JOIN rpt.read_outbox_events o ON o.id = e.outbox_event_id
       LEFT JOIN rpt.read_accounting_posting_requests p
              ON p.source_id = e.source_id AND p.origin_kind = 'FINANCE'
             AND p.event_kind::text = e.event_kind
       LEFT JOIN rpt.read_journal_entries j ON j.id = p.journal_entry_id
       WHERE e.unit_id = $1`,
      [unitId],
    );

    return {
      counts: {
        pending: Number(countResult.rows[0]?.pending ?? '0'),
        failed: Number(countResult.rows[0]?.failed ?? '0'),
        reversed: Number(countResult.rows[0]?.reversed ?? '0'),
      },
      items,
      limit,
      offset,
      total: items.length,
    };
  }

  /**
   * Monta a trilha de um fato.
   *
   * Toda a decisão de ESTADO acontece aqui. Nenhuma condição contábil é deixada para
   * o consumidor avaliar.
   */
  private async buildTrace(input: {
    factKind: 'SETTLEMENT' | 'PAYMENT';
    factId: string;
    ownerId: string;
    ownerKind: 'RECEIVABLE' | 'PAYABLE';
    amount: string;
    currencyCode: string;
    occurredOn: string;
    isReversed: boolean;
    reversedAt: string | null;
    reference: string | null;
    reversalCommand: EconomicCommand;
    viewCommand: EconomicCommand;
    ownerRouteSegment: string;
    factRouteSegment: string;
  }): Promise<EconomicTraceView> {
    const eventKind =
      input.factKind === 'SETTLEMENT'
        ? input.isReversed
          ? 'SETTLEMENT_REVERSED'
          : 'SETTLEMENT_CONFIRMED'
        : input.isReversed
          ? 'PAYMENT_REVERSED'
          : 'PAYMENT_CONFIRMED';

    const event = await this.pool().query<EconomicEventRow>(
      `SELECT id, unit_id, event_kind, source_kind, source_id,
              amount::text AS amount, currency_code, occurred_on::text AS occurred_on,
              outbox_event_id
         FROM rpt.read_economic_events
        WHERE event_kind = $1 AND source_id = $2::uuid`,
      [eventKind, input.factId],
    );
    const eventRow = event.rows[0] ?? null;

    let outbox: OutboxRow | null = null;
    if (eventRow?.outbox_event_id) {
      const outboxResult = await this.pool().query<OutboxRow>(
        `SELECT id, status::text AS status, attempts, max_attempts, last_error, created_at
           FROM rpt.read_outbox_events WHERE id = $1::uuid`,
        [eventRow.outbox_event_id],
      );
      outbox = outboxResult.rows[0] ?? null;
    }

    let posting: PostingRow | null = null;
    let journal: JournalRow | null = null;
    let rule: RuleRow | null = null;
    if (eventRow) {
      const postingResult = await this.pool().query<PostingRow>(
        `SELECT id, event_kind::text AS event_kind, status::text AS status, journal_entry_id,
                amount::text AS amount, occurred_on::text AS occurred_on,
                posting_rule_id, posting_rule_version_id, created_at
           FROM rpt.read_accounting_posting_requests
          WHERE source_id = $1::uuid AND origin_kind = 'FINANCE' AND event_kind::text = $2`,
        [eventRow.source_id, eventRow.event_kind],
      );
      posting = postingResult.rows[0] ?? null;

      if (posting?.journal_entry_id) {
        const journalResult = await this.pool().query<JournalRow>(
          `SELECT id, entry_number, kind::text AS kind, status::text AS status, posted_at
             FROM rpt.read_journal_entries WHERE id = $1::uuid`,
          [posting.journal_entry_id],
        );
        journal = journalResult.rows[0] ?? null;
      }

      if (posting) {
        const ruleResult = await this.pool().query<RuleRow>(
          `SELECT r.id, r.code, v.version_number,
                  v.debit_account_id, da.code AS debit_code, da.name AS debit_name,
                  v.credit_account_id, ca.code AS credit_code, ca.name AS credit_name
             FROM acc.accounting_posting_rules r
             LEFT JOIN acc.accounting_posting_rule_versions v ON v.id = $2
             LEFT JOIN acc.accounting_accounts da ON da.id = v.debit_account_id
             LEFT JOIN acc.accounting_accounts ca ON ca.id = v.credit_account_id
            WHERE r.id = $1`,
          [posting.posting_rule_id, posting.posting_rule_version_id],
        );
        rule = ruleResult.rows[0] ?? null;
      }
    }

    // ── DECISÃO DE ESTADO (backend autoritativo) ────────────────────────────────
    const accountingState = this.resolveAccountingState({ eventRow, outbox, posting, journal });
    const financialState: EconomicFinancialState = input.isReversed
      ? ECONOMIC_FINANCIAL_STATES.Reversed
      : ECONOMIC_FINANCIAL_STATES.Settled;

    const { situation, severity } = resolveSituation(financialState, accountingState);
    const nextAction = resolveNextAction({
      financialState,
      accountingState,
      eventKind,
      ownerKind: input.ownerKind,
      reversalCommand: input.reversalCommand,
      viewCommand: input.viewCommand,
    });

    const trace = buildTraceNodes({
      input,
      eventRow,
      outbox,
      posting,
      journal,
      accountingState,
    });

    return {
      factKind: input.factKind,
      factId: input.factId,
      unitId: eventRow?.unit_id ?? '',
      amount: eventRow?.amount ?? input.amount,
      currencyCode: eventRow?.currency_code ?? input.currencyCode,
      occurredOn: eventRow?.occurred_on ?? input.occurredOn,
      financialState,
      accountingState,
      situation,
      severity,
      summary: buildEconomicSummary({ financialState, accountingState }),
      impact: resolveImpact({ financialState, accountingState, amount: input.amount }),
      economicEvent: eventRow ? this.toEventSummary(eventRow, outbox) : null,
      posting: this.toPostingFact({ accountingState, posting, journal, rule, outbox }),
      trace,
      nextAction,
      availableCommands: resolveAvailableCommands({
        accountingState,
        financialState,
        eventKind,
        ownerKind: input.ownerKind,
        reversalCommand: input.reversalCommand,
        viewCommand: input.viewCommand,
        journalEntryId: journal?.id ?? null,
        eventId: eventRow?.id ?? null,
      }),
    };
  }

  private resolveAccountingState(input: {
    eventRow: EconomicEventRow | null;
    outbox: OutboxRow | null;
    posting: PostingRow | null;
    journal: JournalRow | null;
  }): EconomicAccountingState {
    if (!input.eventRow) {
      return ECONOMIC_ACCOUNTING_STATES.NotReached;
    }
    if (input.outbox && FAILED_OUTBOX_STATUSES.has(input.outbox.status)) {
      return ECONOMIC_ACCOUNTING_STATES.Failed;
    }
    if (input.journal?.kind === 'REVERSAL' && input.journal.status === 'POSTED') {
      return ECONOMIC_ACCOUNTING_STATES.Reversed;
    }
    if (input.journal?.status === 'POSTED') {
      return ECONOMIC_ACCOUNTING_STATES.Posted;
    }
    if (input.posting?.status === 'REJECTED') {
      return ECONOMIC_ACCOUNTING_STATES.Failed;
    }
    return ECONOMIC_ACCOUNTING_STATES.Pending;
  }

  private toEventSummary(eventRow: EconomicEventRow, outbox: OutboxRow | null): EconomicEventSummary {
    return {
      id: eventRow.id,
      eventKind: eventRow.event_kind,
      sourceKind: eventRow.source_kind,
      sourceId: eventRow.source_id,
      amount: eventRow.amount,
      currencyCode: eventRow.currency_code,
      occurredOn: eventRow.occurred_on,
      outboxEventId: eventRow.outbox_event_id,
      transportState: outbox?.status ?? null,
      transportAttempts: outbox?.attempts ?? null,
      transportLastError: outbox?.last_error ?? null,
    };
  }

  private toPostingFact(input: {
    accountingState: EconomicAccountingState;
    posting: PostingRow | null;
    journal: JournalRow | null;
    rule: RuleRow | null;
    outbox: OutboxRow | null;
  }): EconomicPostingFact {
    const failed = input.accountingState === ECONOMIC_ACCOUNTING_STATES.Failed;
    return {
      state: input.accountingState,
      postingRequestId: input.posting?.id ?? null,
      journalEntryId: input.journal?.id ?? null,
      journalNumber: input.journal?.entry_number ?? null,
      journalKind: input.journal?.kind ?? null,
      postedAt: input.journal?.posted_at ?? null,
      failure: failed
        ? {
            code: input.outbox?.last_error ?? 'ACCOUNTING_POSTING_FAILED',
            message:
              input.outbox?.last_error ??
              'A contabilização deste fato não foi concluída e exige reprocessamento.',
            attempts: input.outbox?.attempts ?? 0,
            maxAttempts: input.outbox?.max_attempts ?? 0,
            firstFailedAt: input.outbox?.created_at ?? null,
            lastFailedAt: input.outbox?.created_at ?? null,
          }
        : null,
      rule: input.rule
        ? {
            ruleId: input.rule.id,
            ruleCode: input.rule.code,
            versionId: input.posting?.posting_rule_version_id ?? null,
            versionNumber: input.rule.version_number ?? null,
            debitAccountId: input.rule.debit_account_id,
            debitAccountLabel: input.rule.debit_code
              ? `${input.rule.debit_code} · ${input.rule.debit_name ?? ''}`.trim()
              : null,
            creditAccountId: input.rule.credit_account_id,
            creditAccountLabel: input.rule.credit_code
              ? `${input.rule.credit_code} · ${input.rule.credit_name ?? ''}`.trim()
              : null,
          }
        : null,
    };
  }

  private toWorkItem(row: {
    event_id: string;
    event_kind: string;
    source_kind: string;
    source_id: string;
    unit_id: string;
    amount: string;
    currency_code: string;
    occurred_on: string;
    outbox_status: string | null;
    attempts: number | null;
    max_attempts: number | null;
    last_error: string | null;
    posting_status: string | null;
    journal_entry_id: string | null;
    first_seen: string | null;
  }): EconomicWorkItem {
    const isPayment = row.event_kind.startsWith('PAYMENT');
    const factKind = isPayment ? ('PAYMENT' as const) : ('SETTLEMENT' as const);
    const failed = row.outbox_status === 'FAILED';
    const accountingState = failed
      ? ECONOMIC_ACCOUNTING_STATES.Failed
      : ECONOMIC_ACCOUNTING_STATES.Pending;
    const financialState = ECONOMIC_FINANCIAL_STATES.Settled;
    const { situation, severity } = resolveSituation(financialState, accountingState);
    const reversalCommand = isPayment
      ? ECONOMIC_COMMANDS.ReversePayment
      : ECONOMIC_COMMANDS.ReverseSettlement;
    const viewCommand = isPayment ? ECONOMIC_COMMANDS.ViewPayable : ECONOMIC_COMMANDS.ViewReceivable;

    return {
      factKind,
      factId: row.source_id,
      unitId: row.unit_id,
      reference: `${row.source_kind} ${row.source_id.slice(0, 8)}`,
      amount: row.amount,
      currencyCode: row.currency_code,
      financialState,
      accountingState,
      situation,
      severity,
      reason: failed
        ? `Contabilização falhou após ${row.attempts ?? 0} tentativa(s): ${row.last_error ?? 'motivo não registrado'}`
        : 'Fato econômico publicado sem contabilização — a decisão contábil está pendente.',
      firstFailedAt: row.first_seen,
      attempts: row.attempts ?? 0,
      nextAction: resolveNextAction({
        financialState,
        accountingState,
        eventKind: row.event_kind,
        ownerKind: isPayment ? 'PAYABLE' : 'RECEIVABLE',
        reversalCommand,
        viewCommand,
      }),
      availableCommands: resolveAvailableCommands({
        accountingState,
        financialState,
        eventKind: row.event_kind,
        ownerKind: isPayment ? 'PAYABLE' : 'RECEIVABLE',
        reversalCommand,
        viewCommand,
        journalEntryId: row.journal_entry_id,
        eventId: row.event_id,
      }),
      route: `${ECONOMIC_TRACE_ROUTE_BASE}/${factKind.toLowerCase()}/${row.source_id}`,
    };
  }
}

// ── Helpers puros (testáveis sem banco) ─────────────────────────────────────────

export function toCivilDate(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

export function resolveSituation(
  financialState: EconomicFinancialState,
  accountingState: EconomicAccountingState,
): { situation: EconomicSituation; severity: EconomicSeverity } {
  if (accountingState === ECONOMIC_ACCOUNTING_STATES.Failed) {
    return { situation: ECONOMIC_SITUATIONS.Attention, severity: ECONOMIC_SEVERITIES.Critical };
  }
  if (accountingState === ECONOMIC_ACCOUNTING_STATES.Pending) {
    return { situation: ECONOMIC_SITUATIONS.InProgress, severity: ECONOMIC_SEVERITIES.Warning };
  }
  if (accountingState === ECONOMIC_ACCOUNTING_STATES.NotReached) {
    return { situation: ECONOMIC_SITUATIONS.Attention, severity: ECONOMIC_SEVERITIES.Critical };
  }
  if (financialState === ECONOMIC_FINANCIAL_STATES.Cancelled) {
    return { situation: ECONOMIC_SITUATIONS.NotApplicable, severity: ECONOMIC_SEVERITIES.None };
  }
  return { situation: ECONOMIC_SITUATIONS.Consistent, severity: ECONOMIC_SEVERITIES.None };
}

export function resolveImpact(input: {
  financialState: EconomicFinancialState;
  accountingState: EconomicAccountingState;
  amount: string;
}): string | null {
  if (
    input.accountingState === ECONOMIC_ACCOUNTING_STATES.Failed ||
    input.accountingState === ECONOMIC_ACCOUNTING_STATES.NotReached
  ) {
    return `O caixa reconhece ${input.amount}, mas o lançamento contábil correspondente não existe — o balanço fica divergente até a contabilização ser concluída.`;
  }
  if (input.accountingState === ECONOMIC_ACCOUNTING_STATES.Pending) {
    return 'O lançamento contábil ainda não foi emitido; o período pode fechar sem este fato.';
  }
  return null;
}

export function resolveNextAction(input: {
  financialState: EconomicFinancialState;
  accountingState: EconomicAccountingState;
  eventKind: string;
  ownerKind: 'RECEIVABLE' | 'PAYABLE';
  reversalCommand: EconomicCommand;
  viewCommand: EconomicCommand;
}): EconomicNextAction {
  if (input.accountingState === ECONOMIC_ACCOUNTING_STATES.Failed) {
    return {
      command: ECONOMIC_COMMANDS.RetryPosting,
      label: 'Reprocessar contabilização',
      reason:
        'A contabilização falhou e o fato econômico permanece registrado. Reprocessar aplica a regra de posting já publicada.',
      owner: 'accounting:posting-request',
    };
  }
  if (input.accountingState === ECONOMIC_ACCOUNTING_STATES.Pending) {
    return {
      command: ECONOMIC_COMMANDS.OpenAccountingPeriod,
      label: 'Verificar competência contábil',
      reason:
        'O fato econômico aguarda decisão contábil. Se não houver período aberto ou regra publicada, a contabilização não avança.',
      owner: 'accounting:journal:post',
    };
  }
  if (input.accountingState === ECONOMIC_ACCOUNTING_STATES.NotReached) {
    return {
      command: input.viewCommand,
      label: 'Verificar o fato econômico',
      reason:
        'Este registro não publicou evento econômico: a contabilidade não tem como saber que ele existe.',
      owner: 'finance',
    };
  }
  return {
    command: null,
    label: 'Nenhuma ação necessária',
    reason: 'O fato financeiro e a contabilização estão consistentes.',
    owner: null,
  };
}

export function resolveAvailableCommands(input: {
  accountingState: EconomicAccountingState;
  financialState: EconomicFinancialState;
  eventKind: string;
  ownerKind: 'RECEIVABLE' | 'PAYABLE';
  reversalCommand: EconomicCommand;
  viewCommand: EconomicCommand;
  journalEntryId: string | null;
  eventId: string | null;
}): EconomicCommand[] {
  const commands: EconomicCommand[] = [input.viewCommand];

  if (input.eventId) {
    commands.push(ECONOMIC_COMMANDS.OpenEconomicEvent);
  }
  if (input.journalEntryId) {
    commands.push(ECONOMIC_COMMANDS.OpenJournal);
  }
  // Retry SOMENTE quando o backend reconhece falha — nunca como botão permanente.
  if (
    input.accountingState === ECONOMIC_ACCOUNTING_STATES.Failed ||
    input.accountingState === ECONOMIC_ACCOUNTING_STATES.Pending
  ) {
    commands.push(ECONOMIC_COMMANDS.RetryPosting);
  }
  // Estorno somente para fato confirmado e ainda não estornado.
  if (
    input.financialState === ECONOMIC_FINANCIAL_STATES.Settled &&
    !input.eventKind.endsWith('_REVERSED')
  ) {
    commands.push(input.reversalCommand);
  }
  return commands;
}

export function buildTraceNodes(input: {
  input: {
    factKind: 'SETTLEMENT' | 'PAYMENT';
    factId: string;
    ownerId: string;
    ownerKind: 'RECEIVABLE' | 'PAYABLE';
    amount: string;
    occurredOn: string;
    ownerRouteSegment: string;
    factRouteSegment: string;
  };
  eventRow: EconomicEventRow | null;
  outbox: OutboxRow | null;
  posting: PostingRow | null;
  journal: JournalRow | null;
  accountingState: EconomicAccountingState;
}): EconomicTraceNode[] {
  const nodes: EconomicTraceNode[] = [
    {
      kind: input.input.ownerKind,
      reference: input.input.ownerId.slice(0, 8),
      status: 'ACTIVE',
      occurredAt: null,
      route: `/app/finance/${input.input.ownerRouteSegment}/${input.input.ownerId}`,
    },
    {
      kind: input.input.factKind,
      reference: input.input.factId.slice(0, 8),
      status: 'SETTLED',
      occurredAt: input.input.occurredOn,
      route: `/app/finance/${input.input.ownerRouteSegment}/${input.input.ownerId}`,
    },
  ];
  if (input.eventRow) {
    nodes.push({
      kind: 'ECONOMIC_EVENT',
      reference: input.eventRow.event_kind,
      status: input.outbox?.status ?? 'NOT_PUBLISHED',
      occurredAt: input.eventRow.occurred_on,
      route: `${ECONOMIC_TRACE_ROUTE_BASE}/${input.input.factKind.toLowerCase()}/${input.input.factId}`,
    });
  }
  if (input.posting) {
    nodes.push({
      kind: 'POSTING',
      reference: input.posting.event_kind,
      status: input.posting.status,
      occurredAt: input.posting.occurred_on,
      route: `/app/accounting/posting-origins`,
    });
  }
  if (input.journal) {
    nodes.push({
      kind: 'JOURNAL',
      reference: input.journal.entry_number ? `#${input.journal.entry_number}` : input.journal.id.slice(0, 8),
      status: input.journal.status,
      occurredAt: input.journal.posted_at,
      route: `/app/accounting/journals`,
    });
  }
  return nodes;
}
