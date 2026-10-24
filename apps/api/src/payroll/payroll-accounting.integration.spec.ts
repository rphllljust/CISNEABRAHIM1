import {
  hashPassword,
  insertGrant,
  insertIdentity,
  truncateAccountingTables,
  truncateIdentityAndAuthorizationTables,
  truncatePayrollTables,
} from '@cisne/database';
import { Test, TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountingModule } from '../accounting/accounting.module';
import { ACCOUNT_CLASSES } from '../accounting/domain/ledger';
import { POSTING_EVENTS, POSTING_ORIGINS } from '../accounting/domain/posting';
import { ACCOUNTING_ERROR_CODES } from '../accounting/errors/accounting-error-codes';
import { AccountingAccessService } from '../accounting/services/accounting-access.service';
import { EconomicPostingService } from '../accounting/services/economic-posting.service';
import { AccountingRepository } from '../accounting/repositories/accounting.repository';
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
import {
  POSTING_FAILURE_STAGES,
  PostingFailureInjection,
} from '../platform/kernel/posting-failure-injection';
import { PAYROLL_EVENT_KINDS } from './domain/payroll';
import { PayrollModule } from './payroll.module';
import { PayrollAccessService } from './services/payroll-access.service';
import { PayrollAccountingIntegrationService } from './services/payroll-accounting-integration.service';

const UNIT = 'unit-pay-acc';

async function grantAll(pool: Pool, identityId: string): Promise<void> {
  for (const action of [
    AUTHZ_ACTIONS.PayrollContractManage,
    AUTHZ_ACTIONS.PayrollPeriodOpen,
    AUTHZ_ACTIONS.PayrollPeriodClose,
    AUTHZ_ACTIONS.PayrollPeriodReopen,
    AUTHZ_ACTIONS.PayrollEventRecord,
    AUTHZ_ACTIONS.PayrollCalculate,
    AUTHZ_ACTIONS.PayrollRead,
  ]) {
    await insertGrant(pool, {
      identityId,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.PayrollLedger,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: identityId,
    });
  }
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
}

describe('Payroll to accounting integration PostgreSQL', () => {
  let pool: Pool;
  let payroll: PayrollAccessService;
  let accounting: AccountingAccessService;
  let economicPosting: EconomicPostingService;
  let integration: PayrollAccountingIntegrationService;
  let repository: AccountingRepository;
  let failures: PostingFailureInjection;
  let matrices: ApprovalMatrixAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for payroll-accounting integration tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    const module: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, AuditModule, AuthorizationModule, PayrollModule, AccountingModule],
    }).compile();
    payroll = module.get(PayrollAccessService);
    accounting = module.get(AccountingAccessService);
    economicPosting = module.get(EconomicPostingService);
    integration = module.get(PayrollAccountingIntegrationService);
    repository = module.get(AccountingRepository);
    failures = module.get(PostingFailureInjection);
    matrices = module.get(ApprovalMatrixAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncatePayrollTables(pool);
    await truncateAccountingTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
    /*
     * F1.2 — O LEDGER DO FATO E O TRANSPORTE NÃO SÃO TRUNCADOS PELOS HELPERS.
     *
     * `truncatePayrollTables`/`truncateAccountingTables` não conhecem
     * `plt.economic_events` nem `evt.outbox_events`. Como o bloco trunca
     * `identity.identities`, um fato de um teste anterior fica apontando para um ATOR
     * QUE NÃO EXISTE MAIS — e entregar a outbox viola a FK de autor no journal.
     */
    await pool.query('DELETE FROM evt.outbox_events');
    await pool.query('DELETE FROM plt.economic_events');
    failures.reset();
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedActor(withGrant = true) {
    const login = normalizeLoginIdentifier(`payacc-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    if (withGrant) {
      await grantAll(pool, identityId);
    }
    return { identityId, sessionId: 'test-session' };
  }

  async function seedSodPair() {
    const originator = await seedActor();
    const checker = await seedActor();
    await enableCriticalSodFor(pool, matrices, [originator.identityId, checker.identityId]);
    return { originator, checker };
  }

  async function seedLedger(actor: { identityId: string; sessionId: string }) {
    const chart = await accounting.createChart(actor, {
      unitId: UNIT,
      code: `COA-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Payroll posting chart',
    });
    const debit = await accounting.createAccount(actor, chart.id, {
      code: '5.1.10',
      name: 'Payroll expense',
      class: ACCOUNT_CLASSES.Expense,
    });
    const credit = await accounting.createAccount(actor, chart.id, {
      code: '2.1.30',
      name: 'Payroll payable',
      class: ACCOUNT_CLASSES.Liability,
    });
    await accounting.createPeriod(actor, {
      chartId: chart.id,
      unitId: UNIT,
      code: '2026-09',
      startsOn: '2026-09-01',
      endsOn: '2026-09-30',
    });
    return { chart, debit, credit };
  }

  async function publishClosedRule(
    actor: { identityId: string; sessionId: string },
    debitAccountId: string,
    creditAccountId: string,
  ) {
    const rule = await accounting.createPostingRule(actor, {
      unitId: UNIT,
      code: `PAY-${crypto.randomUUID().slice(0, 6)}`,
      name: 'Payroll closed',
      originKind: POSTING_ORIGINS.Payroll,
      eventKind: POSTING_EVENTS.PayrollClosed,
    });
    const draft = await accounting.createPostingRuleVersion(actor, rule.id, {
      debitAccountId,
      creditAccountId,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      sourceReference: 'TEST-PAYROLL-POSTING',
    });
    return accounting.publishPostingRuleVersion(actor, draft.id, { rowVersion: draft.rowVersion });
  }

  async function closeCalculatedPeriod(
    originator: { identityId: string; sessionId: string },
    closer: { identityId: string; sessionId: string },
  ) {
    const contract = await payroll.createContract(originator, {
      unitId: UNIT,
      code: `CTR-${crypto.randomUUID().slice(0, 6)}`,
      displayName: 'Payroll contract',
      startsOn: '2026-01-01',
    });
    const period = await payroll.openPeriod(originator, {
      unitId: UNIT,
      competenceYear: 2026,
      competenceMonth: 9,
      startsOn: '2026-09-01',
      endsOn: '2026-09-30',
    });
    await payroll.recordEvent(originator, {
      unitId: UNIT,
      payrollPeriodId: period.id,
      employmentContractId: contract.id,
      eventKind: PAYROLL_EVENT_KINDS.Earning,
      amount: '1000.0000',
      componentLabel: 'TEST_SALARY',
      description: 'Calculated earning',
      idempotencyKey: `earn-${crypto.randomUUID()}`,
    });
    await payroll.calculatePeriod(originator, period.id, UNIT);
    const closed = await payroll.closePeriodAuthorized(closer, period.id, UNIT);
    return { contract, period: closed, closer };
  }

  async function countPosted() {
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM acc.journal_entries WHERE status = 'POSTED'`,
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  /**
   * F1.2 — ENTREGA A OUTBOX DO FATO DE FOLHA.
   *
   * O fechamento publica `PAYROLL_CLOSED` na MESMA transação (via
   * `closeLockedPeriod`). Quem contabiliza é o consumidor da outbox, de forma
   * retentável e observável — então "existe journal?" só pode ser respondido depois
   * de entregar o evento. Não enfraquece asserção: o contrato provado continua sendo
   * um journal por fato, com origem PAYROLL, e PAYROLL nunca escrevendo em `acc.*`.
   */
  async function drainPayrollFacts(): Promise<void> {
    const events = await pool.query<{ payload: unknown }>(
      `SELECT payload FROM evt.outbox_events
        WHERE event_type IN ('PAYROLL_CLOSED','PAYROLL_REOPENED')
          AND payload->>'unitId' = $1
        ORDER BY created_at`,
      [UNIT],
    );
    for (const row of events.rows) {
      await economicPosting.consume(row.payload);
    }
  }

  /**
   * Entrega a outbox TOLERANDO falha de posting.
   *
   * Existe para o caso em que o teste PRECISA que a contabilização falhe (período
   * fechado sem regra publicada). A falha é o comportamento correto do produto — ela
   * vira `FAILED` + `last_error` na outbox e aparece na Central de Contabilidade.
   * Propagar aqui faria o teste explodir na entrega em vez de verificar o estado
   * resultante, que é o que ele realmente prova.
   */
  async function drainPayrollFactsExpectingFailure(): Promise<void> {
    const events = await pool.query<{ payload: unknown }>(
      `SELECT payload FROM evt.outbox_events
        WHERE event_type IN ('PAYROLL_CLOSED','PAYROLL_REOPENED')
          AND payload->>'unitId' = $1
        ORDER BY created_at`,
      [UNIT],
    );
    for (const row of events.rows) {
      try {
        await economicPosting.consume(row.payload);
      } catch {
        // Resultado esperado pelo teste: nenhum journal é criado.
      }
    }
  }

  it('posts PayrollClosed through the accounting port without payroll writing acc.*', async () => {
    const { originator: actor, checker } = await seedSodPair();
    const { debit, credit } = await seedLedger(actor);
    await publishClosedRule(actor, debit.id, credit.id);
    const { period } = await closeCalculatedPeriod(actor, checker);
    // Sem regra publicada, a contabilização FALHA — e falhar é o correto aqui.
    await drainPayrollFactsExpectingFailure();
    expect(period.status).toBe('CLOSED');
    expect(await countPosted()).toBe(1);
    const posted = await integration.postClosedPeriod(actor, period.id);
    expect(posted.idempotent).toBe(true);
    const journal = await accounting.getJournal(actor, posted.journalEntryId);
    expect(journal.balanced).toBe(true);
    expect(journal.debitTotal).toBe(journal.creditTotal);
    const requests = await pool.query<{ source_reference: string; count: string }>(
      `SELECT source_reference, COUNT(*)::text AS count
       FROM acc.accounting_posting_requests
       WHERE event_kind = 'PAYROLL_CLOSED'
       GROUP BY source_reference`,
    );
    expect(requests.rows).toEqual([
      { source_reference: 'PAYROLL-CLOSED:unit-pay-acc:2026-09', count: '1' },
    ]);
  });

  it('treats duplicate and concurrent closes as one posted journal', async () => {
    const { originator: actor, checker } = await seedSodPair();
    const { debit, credit } = await seedLedger(actor);
    await publishClosedRule(actor, debit.id, credit.id);
    const { period } = await closeCalculatedPeriod(actor, checker);
    // O fato foi publicado no fechamento; entrega-se a outbox para postar.
    await drainPayrollFacts();
    const first = await payroll.closePeriodAuthorized(checker, period.id, UNIT);
    const second = await payroll.closePeriodAuthorized(checker, period.id, UNIT);
    expect(first.status).toBe('CLOSED');
    expect(second.status).toBe('CLOSED');
    const concurrent = await Promise.allSettled([
      integration.postClosedPeriod(actor, period.id),
      integration.postClosedPeriod(actor, period.id),
    ]);
    const fulfilled = concurrent.filter((item) => item.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    const ids = fulfilled.map((item) =>
      item.status === 'fulfilled' ? item.value.journalEntryId : '',
    );
    expect(new Set(ids.filter(Boolean)).size).toBe(1);
    expect(await countPosted()).toBe(1);
  });

  it('returns ACCOUNTING_RULE_NOT_CONFIGURED when the closed period has no published rule', async () => {
    const { originator: actor, checker } = await seedSodPair();
    await seedLedger(actor);
    const { period } = await closeCalculatedPeriod(actor, checker);
    // Sem regra publicada, a contabilizacao FALHA — e falhar e o correto aqui.
    await drainPayrollFactsExpectingFailure();
    expect(period.status).toBe('CLOSED');
    expect(await countPosted()).toBe(0);
    await expect(integration.postClosedPeriod(actor, period.id)).rejects.toMatchObject({
      code: ACCOUNTING_ERROR_CODES.RULE_NOT_CONFIGURED,
    });
    expect(await countPosted()).toBe(0);
  });

  it('reopens a posted competence with reversal and keeps the original journal', async () => {
    const { originator: actor, checker } = await seedSodPair();
    const { debit, credit } = await seedLedger(actor);
    await publishClosedRule(actor, debit.id, credit.id);
    const { contract, period } = await closeCalculatedPeriod(actor, checker);
    const original = await integration.postClosedPeriod(actor, period.id);
    const reopened = await payroll.reopenPeriod(actor, period.id, UNIT);
    // A reabertura publica PAYROLL_REOPENED na mesma transacao; entrega-se a outbox.
    await drainPayrollFacts();
    expect(reopened.status).toBe('OPEN');
    const replay = await integration.reverseReopenedPeriod(
      actor,
      period.id,
      'Payroll competence reopened',
    );
    expect(replay.idempotent).toBe(true);
    expect(await countPosted()).toBe(2);
    const originalJournal = await pool.query<{ status: string }>(
      `SELECT status::text AS status FROM acc.journal_entries WHERE id = $1`,
      [original.journalEntryId],
    );
    expect(originalJournal.rows[0]?.status).toBe('POSTED');
    const kinds = await pool.query<{ kind: string }>(
      `SELECT kind::text AS kind FROM acc.journal_entries WHERE status = 'POSTED' ORDER BY created_at`,
    );
    expect(kinds.rows.map((row) => row.kind)).toEqual(['ENTRY', 'REVERSAL']);
    await expect(
      payroll.recordEvent(actor, {
        unitId: UNIT,
        payrollPeriodId: period.id,
        employmentContractId: contract.id,
        eventKind: PAYROLL_EVENT_KINDS.Deduction,
        amount: '10.0000',
        componentLabel: 'TEST_AFTER_REOPEN',
        description: 'After reopen',
        idempotencyKey: `adj-${crypto.randomUUID()}`,
      }),
    ).resolves.toMatchObject({ idempotent: false });
  });

  it('rolls back injected failures so no partial journal remains and the period stays CLOSED', async () => {
    const { originator: actor, checker } = await seedSodPair();
    const { debit, credit } = await seedLedger(actor);
    const { period } = await closeCalculatedPeriod(actor, checker);
    // O fato foi publicado no fechamento; entrega-se a outbox para postar.
    await drainPayrollFactsExpectingFailure();
    expect(period.status).toBe('CLOSED');
    expect(await countPosted()).toBe(0);
    await publishClosedRule(actor, debit.id, credit.id);

    failures.stage = POSTING_FAILURE_STAGES.AfterPayrollEvent;
    await expect(integration.postClosedPeriod(actor, period.id)).rejects.toThrow(
      /ACCOUNTING_POSTING_INJECTED_FAILURE/,
    );
    expect(await countPosted()).toBe(0);

    failures.stage = POSTING_FAILURE_STAGES.BeforeJournal;
    await expect(integration.postClosedPeriod(actor, period.id)).rejects.toThrow(
      /ACCOUNTING_POSTING_INJECTED_FAILURE/,
    );
    expect(await countPosted()).toBe(0);

    failures.stage = POSTING_FAILURE_STAGES.DuringPosting;
    await expect(integration.postClosedPeriod(actor, period.id)).rejects.toBeTruthy();
    expect(await countPosted()).toBe(0);
    const leftoverRequests = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM acc.accounting_posting_requests`,
    );
    expect(leftoverRequests.rows[0]?.count).toBe('0');
    expect((await payroll.getPeriod(actor, period.id, UNIT)).status).toBe('CLOSED');
  });

  it('denies an operational user from requesting payroll accounting posting', async () => {
    const { originator: admin, checker } = await seedSodPair();
    const stranger = await seedActor(false);
    const { debit, credit } = await seedLedger(admin);
    await publishClosedRule(admin, debit.id, credit.id);
    const { period } = await closeCalculatedPeriod(admin, checker);
    // O fato foi publicado no fechamento; entrega-se a outbox para postar.
    await drainPayrollFacts();
    await expect(integration.postClosedPeriod(stranger, period.id)).rejects.toBeTruthy();
    expect(await countPosted()).toBe(1);
  });

  it('reconstructs the ledger as SUM(DEBIT) = SUM(CREDIT) after close and reopen reversal', async () => {
    const { originator: actor, checker } = await seedSodPair();
    const { chart, debit, credit } = await seedLedger(actor);
    await publishClosedRule(actor, debit.id, credit.id);
    const { period } = await closeCalculatedPeriod(actor, checker);
    // O fato foi publicado no fechamento; entrega-se a outbox para postar.
    await drainPayrollFacts();
    await payroll.reopenPeriod(actor, period.id, UNIT);
    const ledger = await accounting.reconstructLedger(actor, chart.id);
    expect(ledger.balanced).toBe(true);
    expect(ledger.totalDebits).toBe(ledger.totalCredits);
    expect(await repository.countPostedUnbalanced()).toBe(0);
    expect(await repository.countDuplicatePostings()).toBe(0);
  });
});
