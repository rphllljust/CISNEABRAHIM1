import {
  hashPassword,
  insertGrant,
  insertIdentity,
  truncateAccountingTables,
  truncateFinanceTables,
  truncateIdentityAndAuthorizationTables,
} from '@cisne/database';
import { Test, type TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AUTH_TEST_PASSWORD, applyAuthTestEnv } from '../auth/test/auth-test-env';
import { normalizeLoginIdentifier } from '../auth/crypto/token-crypto';
import { AuthorizationModule } from '../authorization/authorization.module';
import { ApprovalMatrixAccessService } from '../authorization/services/approval-matrix-access.service';
import { enableCriticalSodFor } from '../authorization/test/critical-sod-harness';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import { FinanceModule } from '../finance/finance.module';
import { ReceivablesAccessService } from '../finance/services/receivables-access.service';
import { AccountingModule } from './accounting.module';
import { AccountingAccessService } from './services/accounting-access.service';
import { EconomicPostingService } from './services/economic-posting.service';
import { ACCOUNT_CLASSES } from './domain/ledger';
import { POSTING_EVENTS, POSTING_ORIGINS } from './domain/posting';
import {
  ECONOMIC_EVENT_KINDS,
  ECONOMIC_EVENT_SCHEMA_VERSION,
  ECONOMIC_EVENT_SOURCE_KINDS,
} from '../platform/bounded-contexts/economic-event-contract';

/**
 * F1.1 — ECONOMIC POSTING SPINE — PROVA DE PONTA A PONTA (PostgreSQL real).
 *
 * Cada `it` abaixo corresponde a um item do Definition of Done desta fase:
 *
 *   settlement/payment → accounting event          → 'publica evento' e 'pagamento'
 *   financial commit + outbox atomicity            → 'atomicidade'
 *   posting idempotency                            → 'idempotência'
 *   duplicate delivery                             → 'redelivery'
 *   posting failure visibility                     → 'falha visível'
 *   retry/recovery                                 → 'reprocessamento'
 *   reversal compensatório                         → 'estorno compensatório'
 *   FINANCE → ACCOUNTING boundary                  → coberto pelo gate de fronteira
 *
 * O teste NÃO simula o pipeline: ele commita de verdade e verifica as tabelas.
 */

const UNIT = 'unit-f11-spine';

async function grantFinanceAndAccounting(pool: Pool, identityId: string): Promise<void> {
  for (const action of [
    AUTHZ_ACTIONS.AccountingChartManage,
    AUTHZ_ACTIONS.AccountingPeriodOpen,
    AUTHZ_ACTIONS.AccountingPeriodClose,
    AUTHZ_ACTIONS.AccountingJournalDraft,
    AUTHZ_ACTIONS.AccountingJournalPost,
    AUTHZ_ACTIONS.AccountingJournalReverse,
    AUTHZ_ACTIONS.AccountingJournalRead,
    AUTHZ_ACTIONS.AccountingJournalList,
    AUTHZ_ACTIONS.AccountingPostingRuleManage,
    AUTHZ_ACTIONS.AccountingPostingRulePublish,
    AUTHZ_ACTIONS.AccountingPostingRequest,
  ]) {
    await insertGrant(pool, {
      identityId,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.AccountingLedger,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: identityId,
    });
  }
  for (const action of [
    AUTHZ_ACTIONS.FinanceReceivableRead,
    AUTHZ_ACTIONS.FinanceReceivableList,
    AUTHZ_ACTIONS.FinanceReceivableSettle,
    AUTHZ_ACTIONS.FinanceReceivableReverse,
    AUTHZ_ACTIONS.FinancePayableOpen,
    AUTHZ_ACTIONS.FinancePayableRead,
    AUTHZ_ACTIONS.FinancePayablePay,
    AUTHZ_ACTIONS.FinancePayableReverse,
    AUTHZ_ACTIONS.FinanceExpenseCategoryCreate,
  ]) {
    const resourceType = action.startsWith('finance:payable') || action.startsWith('finance:expense')
      ? AUTHZ_RESOURCE_TYPES.FinancePayable
      : AUTHZ_RESOURCE_TYPES.FinanceReceivable;
    await insertGrant(pool, {
      identityId,
      action,
      resourceType,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: identityId,
    });
  }
}

describe('F1.1 — economic posting spine (PostgreSQL integration)', () => {
  let pool: Pool;
  let accounting: AccountingAccessService;
  let economicPosting: EconomicPostingService;
  let receivables: ReceivablesAccessService;
  let matrices: ApprovalMatrixAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for F1.1 economic posting tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    const module: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, AuditModule, AuthorizationModule, FinanceModule, AccountingModule],
    }).compile();
    accounting = module.get(AccountingAccessService);
    economicPosting = module.get(EconomicPostingService);
    receivables = module.get(ReceivablesAccessService);
    matrices = module.get(ApprovalMatrixAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateFinanceTables(pool);
    await truncateAccountingTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
    // O LEDGER do fato econômico vive em `plt.economic_events` desde a 0105 (saiu de
    // `fin.economic_events`). Nenhum helper de TRUNCATE o cobre — nem FINANCE nem
    // ACCOUNTING — então ele é limpo aqui, antes do transporte. Sem isto os testes
    // contam fatos de execuções anteriores (a idempotência parece quebrada quando
    // na verdade só há contaminação de estado).
    await pool.query('DELETE FROM plt.economic_events');
    // O transporte fica aqui, porque `evt.outbox_events` não pertence ao helper de FINANCE.
    await pool.query('DELETE FROM evt.outbox_events');
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedActor(withGrant = true) {
    const login = normalizeLoginIdentifier(`f11-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    if (withGrant) {
      await grantFinanceAndAccounting(pool, identityId);
    }
    return { identityId, sessionId: 'test-session' };
  }

  async function seedSodPair() {
    const originator = await seedActor();
    const checker = await seedActor();
    await enableCriticalSodFor(pool, matrices, checker.identityId);
    return { originator, checker };
  }

  /**
   * Par para ESTORNO: exige TRÊS atores distintos.
   *
   * O título é aberto pelo originador, liquidado pelo `settler` e estornado pelo
   * `reverser`. SoD `REQUEST_PAY` proíbe o ator de reverter o fato que ele mesmo
   * liquidou, e a approval matrix exige papel FINANCIAL_CONTROLLER para quem aprova.
   * Os dois precisam estar atribuídos como checker.
   */
  async function seedReversalTrio() {
    const originator = await seedActor();
    const settler = await seedActor();
    const reverser = await seedActor();
    await enableCriticalSodFor(pool, matrices, [settler.identityId, reverser.identityId]);
    return { originator, settler, reverser };
  }

  async function seedLedger(actor: { identityId: string; sessionId: string }) {
    const chart = await accounting.createChart(actor, {
      unitId: UNIT,
      code: `COA-${crypto.randomUUID().slice(0, 8)}`,
      name: 'F1.1 chart',
    });
    const debit = await accounting.createAccount(actor, chart.id, {
      code: '1.1.05',
      name: 'Caixa/Banco',
      class: ACCOUNT_CLASSES.Asset,
    });
    const credit = await accounting.createAccount(actor, chart.id, {
      code: '1.1.08',
      name: 'Contas a receber',
      class: ACCOUNT_CLASSES.Asset,
    });
    const period = await accounting.createPeriod(actor, {
      chartId: chart.id,
      unitId: UNIT,
      code: '2026-10',
      startsOn: '2026-10-01',
      endsOn: '2026-10-31',
    });
    return { chart, debit, credit, period };
  }

  async function publishRule(
    actor: { identityId: string; sessionId: string },
    eventKind: string,
    debitAccountId: string,
    creditAccountId: string,
  ) {
    const rule = await accounting.createPostingRule(actor, {
      unitId: UNIT,
      code: `RULE-${eventKind}-${crypto.randomUUID().slice(0, 6)}`,
      name: eventKind,
      originKind: POSTING_ORIGINS.Finance,
      eventKind,
    });
    const draft = await accounting.createPostingRuleVersion(actor, rule.id, {
      debitAccountId,
      creditAccountId,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      sourceReference: 'F1.1-POSTING-RULE',
    });
    const published = await accounting.publishPostingRuleVersion(actor, draft.id, {
      rowVersion: draft.rowVersion,
    });
    return { rule, published };
  }

  /** Abre um recebível REAL via FINANCE (cadeia billing → receivable persistida). */
  async function openReceivable(actorIdentityId: string, principal: string) {
    const opened = await receivables.openFromBilling({
      billingRecordId: crypto.randomUUID(),
      billingDocumentId: crypto.randomUUID(),
      serviceOrderId: crypto.randomUUID(),
      measurementId: crypto.randomUUID(),
      unitId: UNIT,
      clientId: crypto.randomUUID(),
      principal,
      currencyCode: 'BRL',
      dueDate: '2026-11-30',
      paymentTerms: '30 DDL',
      actorIdentityId,
    });
    return opened.receivableId;
  }

  async function countPostedJournals(): Promise<number> {
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM acc.journal_entries WHERE status = 'POSTED'`,
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  async function outboxEventsFor(sourceId: string) {
    const result = await pool.query<{
      id: string;
      event_type: string;
      status: string;
      idempotency_key: string;
      payload: Record<string, unknown>;
      last_error: string | null;
    }>(
      `SELECT id, event_type::text AS event_type, status::text AS status,
              idempotency_key, payload, last_error
         FROM evt.outbox_events
        WHERE aggregate_id = $1::uuid
        ORDER BY sequence_number`,
      [sourceId],
    );
    return result.rows;
  }

  // ───────────────────────────────────────────────────────────────────────────────
  // DoD: settlement/payment → accounting event
  // ───────────────────────────────────────────────────────────────────────────────
  it('publica o fato econômico SETTLEMENT_CONFIRMED na MESMA transação da liquidação', async () => {
    const { originator: actor, checker } = await seedSodPair();
    const { debit, credit } = await seedLedger(actor);
    await publishRule(actor, POSTING_EVENTS.SettlementConfirmed, debit.id, credit.id);

    const receivableId = await openReceivable(actor.identityId, '500.0000');
    const before = await receivables.getById(actor, receivableId);
    await receivables.settle(checker, receivableId, {
      amount: '500.0000',
      rowVersion: before.rowVersion,
      idempotencyKey: `settle-${crypto.randomUUID()}`,
      settledAt: '2026-10-15',
    });

    const settlement = await pool.query<{ id: string; amount: string }>(
      `SELECT id, amount::text AS amount FROM fin.settlements WHERE receivable_id = $1::uuid`,
      [receivableId],
    );
    const settlementId = settlement.rows[0]!.id;

    // O FATO foi registrado, com trilha para o transporte.
    const facts = await pool.query<{
      event_kind: string;
      source_id: string;
      amount: string;
      outbox_event_id: string | null;
    }>(
      `SELECT event_kind, source_id, amount::text AS amount, outbox_event_id
         FROM plt.economic_events WHERE source_id = $1::uuid`,
      [settlementId],
    );
    expect(facts.rows).toHaveLength(1);
    expect(facts.rows[0]!.event_kind).toBe(ECONOMIC_EVENT_KINDS.SettlementConfirmed);
    expect(facts.rows[0]!.outbox_event_id).toBeTruthy();

    // O TRANSPORTE carrega o contrato canônico.
    const events = await outboxEventsFor(settlementId);
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe('SETTLEMENT_CONFIRMED');
    const payload = events[0]!.payload;
    expect(payload['eventKind']).toBe(ECONOMIC_EVENT_KINDS.SettlementConfirmed);
    expect(payload['sourceKind']).toBe(ECONOMIC_EVENT_SOURCE_KINDS.ReceivableSettlement);
    expect(payload['schemaVersion']).toBe(ECONOMIC_EVENT_SCHEMA_VERSION);
    expect(payload['amount']).toBe('500.0000');
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // DoD: posting idempotency + duplicate delivery
  // ───────────────────────────────────────────────────────────────────────────────
  it('redelivery do evento NÃO duplica journal (idempotência ponta a ponta)', async () => {
    const { originator: actor, checker } = await seedSodPair();
    const { debit, credit } = await seedLedger(actor);
    await publishRule(actor, POSTING_EVENTS.SettlementConfirmed, debit.id, credit.id);

    const receivableId = await openReceivable(actor.identityId, '300.0000');
    const before = await receivables.getById(actor, receivableId);
    await receivables.settle(checker, receivableId, {
      amount: '300.0000',
      rowVersion: before.rowVersion,
      idempotencyKey: `settle-${crypto.randomUUID()}`,
      settledAt: '2026-10-15',
    });

    const settlement = await pool.query<{ id: string }>(
      `SELECT id FROM fin.settlements WHERE receivable_id = $1::uuid`,
      [receivableId],
    );
    const settlementId = settlement.rows[0]!.id;
    const events = await outboxEventsFor(settlementId);
    expect(events).toHaveLength(1);

    // ANTES de qualquer consumo não existe journal: o settlement só publica o fato,
    // quem posta é ACCOUNTING. Este é o próprio invariante da F1.1.
    expect(await countPostedJournals()).toBe(0);

    // Primeira entrega: posta.
    const first = await economicPosting.consume(events[0]!.payload);
    expect(first.outcome).toBe('POSTED');
    expect(await countPostedJournals()).toBe(1);

    // Redelivery: MESMO payload, entregue de novo. Journal não duplica.
    const second = await economicPosting.consume(events[0]!.payload);
    expect(second.outcome).toBe('ALREADY_POSTED');
    expect(second.journalEntryId).toBe(first.journalEntryId);
    expect(await countPostedJournals()).toBe(1);
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // DoD: financial commit + outbox atomicity
  // ───────────────────────────────────────────────────────────────────────────────
  it('atomicidade: settlement sem posting rule configurada COMMITA e deixa o evento PENDING — o fato não some', async () => {
    const { originator: actor, checker } = await seedSodPair();
    await seedLedger(actor);
    // Posting rule de SETTLEMENT_CONFIRMED DELIBERADAMENTE ausente.

    const receivableId = await openReceivable(actor.identityId, '250.0000');
    const before = await receivables.getById(actor, receivableId);
    await receivables.settle(checker, receivableId, {
      amount: '250.0000',
      rowVersion: before.rowVersion,
      idempotencyKey: `settle-${crypto.randomUUID()}`,
      settledAt: '2026-10-15',
    });

    // O FATO econômico existe (cash mudou).
    const settlement = await pool.query<{ id: string }>(
      `SELECT id FROM fin.settlements WHERE receivable_id = $1::uuid`,
      [receivableId],
    );
    expect(settlement.rows).toHaveLength(1);

    // O evento foi publicado na outbox e está PENDING — visível, diagnosticável.
    const events = await outboxEventsFor(settlement.rows[0]!.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.status).toBe('PENDING');

    // Nenhum journal: o ACCOUNTING recusa por falta de regra, e isso LANÇA.
    // O contrato de erro é o CÓDIGO da exceção, não o texto da mensagem.
    await expect(economicPosting.consume(events[0]!.payload)).rejects.toMatchObject({
      code: 'ACCOUNTING_RULE_NOT_CONFIGURED',
    });
    expect(await countPostedJournals()).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // DoD: posting failure visibility + retry/recovery
  // ───────────────────────────────────────────────────────────────────────────────
  it('falha de posting é VISÍVEL e REPROCESSÁVEL: publicar a regra e reentregar resolve', async () => {
    const { originator: actor, checker } = await seedSodPair();
    const { debit, credit } = await seedLedger(actor);

    const receivableId = await openReceivable(actor.identityId, '120.0000');
    const before = await receivables.getById(actor, receivableId);
    await receivables.settle(checker, receivableId, {
      amount: '120.0000',
      rowVersion: before.rowVersion,
      idempotencyKey: `settle-${crypto.randomUUID()}`,
      settledAt: '2026-10-15',
    });

    const settlement = await pool.query<{ id: string }>(
      `SELECT id FROM fin.settlements WHERE receivable_id = $1::uuid`,
      [receivableId],
    );
    const events = await outboxEventsFor(settlement.rows[0]!.id);

    // 1. Falha explícita porque a regra não existe — NÃO é silêncio.
    await expect(economicPosting.consume(events[0]!.payload)).rejects.toThrow();
    expect(await countPostedJournals()).toBe(0);

    // 2. A regra é publicada (correção operacional real).
    await publishRule(actor, POSTING_EVENTS.SettlementConfirmed, debit.id, credit.id);

    // 3. Reentrega do MESMO evento → recuperado, sem duplicar.
    const recovered = await economicPosting.consume(events[0]!.payload);
    expect(recovered.outcome).toBe('POSTED');
    expect(await countPostedJournals()).toBe(1);

    // 4. Nova reentrega continua idempotente.
    const replay = await economicPosting.consume(events[0]!.payload);
    expect(replay.outcome).toBe('ALREADY_POSTED');
    expect(await countPostedJournals()).toBe(1);
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // DoD: reversal compensatório (sem DELETE/UPDATE de história)
  // ───────────────────────────────────────────────────────────────────────────────
  it('estorno produz REVERSAL journal compensatório; o journal original permanece POSTED', async () => {
    // SoD exige TRÊS atores distintos: originador do título, liquidante e estornante.
    const { originator: actor, settler, reverser } = await seedReversalTrio();
    const { debit, credit } = await seedLedger(actor);
    await publishRule(actor, POSTING_EVENTS.SettlementConfirmed, debit.id, credit.id);

    const receivableId = await openReceivable(actor.identityId, '400.0000');
    const before = await receivables.getById(actor, receivableId);
    await receivables.settle(settler, receivableId, {
      amount: '400.0000',
      rowVersion: before.rowVersion,
      idempotencyKey: `settle-${crypto.randomUUID()}`,
      settledAt: '2026-10-15',
    });

    const settlement = await pool.query<{ id: string }>(
      `SELECT id FROM fin.settlements WHERE receivable_id = $1::uuid`,
      [receivableId],
    );
    const settlementId = settlement.rows[0]!.id;

    // Posta o fato original.
    const originalEvents = await outboxEventsFor(settlementId);
    const posted = await economicPosting.consume(originalEvents[0]!.payload);
    const originalJournalId = posted.journalEntryId;
    expect(await countPostedJournals()).toBe(1);

    // Estorna o settlement — fato NOVO, apontando o original.
    await receivables.reverseSettlement(reverser, receivableId, settlementId, {
      reason: 'Estorno de teste F1.1',
      idempotencyKey: `rev-${crypto.randomUUID()}`,
    });

    // O settlement original NÃO foi apagado: continua existindo com status REVERSED.
    const original = await pool.query<{ status: string; amount: string }>(
      `SELECT status::text AS status, amount::text AS amount
         FROM fin.settlements WHERE id = $1::uuid`,
      [settlementId],
    );
    expect(original.rows[0]!.status).toBe('REVERSED');
    expect(original.rows[0]!.amount).toBe('400.0000');

    // Há um segundo fato econômico, para o ESTORNO, apontando o original.
    // `reverses_source_id` é COLUNA de `plt.economic_events` (a 0105 promoveu a ligação
    // de estorno a vínculo indexado, em vez de deixá-la só dentro do JSON `payload`).
    const reversalFacts = await pool.query<{
      event_kind: string;
      reverses_source_id: string | null;
    }>(
      `SELECT event_kind, reverses_source_id FROM plt.economic_events
        WHERE event_kind = $1 AND source_id = $2::uuid`,
      [ECONOMIC_EVENT_KINDS.SettlementReversed, settlementId],
    );
    expect(reversalFacts.rows).toHaveLength(1);
    expect(reversalFacts.rows[0]!.reverses_source_id).toBe(settlementId);

    // Consome o estorno → journal COMPENSATÓRIO.
    const reversalEvent = await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM evt.outbox_events
        WHERE event_type = 'SETTLEMENT_REVERSED' AND aggregate_id = $1::uuid`,
      [settlementId],
    );
    const reversed = await economicPosting.consume(reversalEvent.rows[0]!.payload);
    expect(reversed.outcome).toBe('REVERSED');
    expect(reversed.journalEntryId).not.toBe(originalJournalId);

    // O journal ORIGINAL continua POSTED — nada foi apagado nem reescrito.
    const journals = await pool.query<{ id: string; kind: string; status: string; reverses_entry_id: string | null }>(
      `SELECT id, kind::text AS kind, status::text AS status, reverses_entry_id
         FROM acc.journal_entries ORDER BY created_at`,
    );
    expect(journals.rows).toHaveLength(2);
    const originalRow = journals.rows.find((row) => row.id === originalJournalId);
    expect(originalRow?.status).toBe('POSTED');
    expect(originalRow?.kind).toBe('ENTRY');
    const reversalRow = journals.rows.find((row) => row.id === reversed.journalEntryId);
    expect(reversalRow?.kind).toBe('REVERSAL');
    expect(reversalRow?.reverses_entry_id).toBe(originalJournalId);
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // Duplicate prevention no nível do FATO
  // ───────────────────────────────────────────────────────────────────────────────
  it('a mesma liquidação reexecutada com a MESMA idempotency key não cria segundo fato', async () => {
    const { originator: actor, checker } = await seedSodPair();
    await seedLedger(actor);

    const receivableId = await openReceivable(actor.identityId, '90.0000');
    const before = await receivables.getById(actor, receivableId);
    const commandKey = `settle-${crypto.randomUUID()}`;

    await receivables.settle(checker, receivableId, {
      amount: '90.0000',
      rowVersion: before.rowVersion,
      idempotencyKey: commandKey,
      settledAt: '2026-10-15',
    });

    // Replay do MESMO comando: devolve o settlement existente (idempotente).
    const replay = await receivables.settle(checker, receivableId, {
      amount: '90.0000',
      rowVersion: before.rowVersion,
      idempotencyKey: commandKey,
      settledAt: '2026-10-15',
    });
    expect(replay.settlements.filter((item) => item.status === 'POSTED')).toHaveLength(1);

    // Um único fato econômico e um único evento de transporte.
    const facts = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM plt.economic_events WHERE source_kind = $1`,
      [ECONOMIC_EVENT_SOURCE_KINDS.ReceivableSettlement],
    );
    expect(facts.rows[0]!.count).toBe('1');

    const transports = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM evt.outbox_events WHERE event_type = 'SETTLEMENT_CONFIRMED'`,
    );
    expect(transports.rows[0]!.count).toBe('1');
  });
});
