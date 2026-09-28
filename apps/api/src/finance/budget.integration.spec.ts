import {
  hashPassword,
  insertGrant,
  insertIdentity,
  truncateAccountingTables,
  truncateFinanceTables,
  truncateIdentityAndAuthorizationTables,
} from '@cisne/database';
import { Test, TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountingModule } from '../accounting/accounting.module';
import { ACCOUNT_CLASSES, JOURNAL_DIRECTIONS, JOURNAL_SOURCE_KINDS } from '../accounting/domain/ledger';
import { AccountingAccessService } from '../accounting/services/accounting-access.service';
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
import { FINANCE_ERROR_CODES } from './errors/finance-error-codes';
import { FinanceModule } from './finance.module';
import { BudgetAccessService } from './services/budget-access.service';
import { PayablesAccessService } from './services/payables-access.service';

const UNIT = 'unit-budget-1';

async function grantBudgetAdmin(pool: Pool, identityId: string, grantedBy: string): Promise<void> {
  const budgetActions = [
    AUTHZ_ACTIONS.FinanceBudgetCreate,
    AUTHZ_ACTIONS.FinanceBudgetUpdate,
    AUTHZ_ACTIONS.FinanceBudgetApprove,
    AUTHZ_ACTIONS.FinanceBudgetRead,
  ];
  for (const action of budgetActions) {
    await insertGrant(pool, {
      identityId,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.FinanceBudget,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: grantedBy,
    });
  }
  await insertGrant(pool, {
    identityId,
    action: AUTHZ_ACTIONS.FinanceExpenseCategoryCreate,
    resourceType: AUTHZ_RESOURCE_TYPES.FinancePayable,
    scopeType: AUTHZ_SCOPES.Global,
    grantedByIdentityId: grantedBy,
  });
}

async function grantAccountingAdmin(pool: Pool, identityId: string, grantedBy: string): Promise<void> {
  const actions = [
    AUTHZ_ACTIONS.AccountingChartManage,
    AUTHZ_ACTIONS.AccountingPeriodOpen,
    AUTHZ_ACTIONS.AccountingJournalDraft,
    AUTHZ_ACTIONS.AccountingJournalPost,
    AUTHZ_ACTIONS.AccountingJournalRead,
  ];
  for (const action of actions) {
    await insertGrant(pool, {
      identityId,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.AccountingLedger,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: grantedBy,
    });
  }
}

describe('Finance budget PostgreSQL integration', () => {
  let pool: Pool;
  let budgets: BudgetAccessService;
  let payables: PayablesAccessService;
  let accounting: AccountingAccessService;
  let matrices: ApprovalMatrixAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for finance budget integration tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    const module: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, AuditModule, AuthorizationModule, FinanceModule, AccountingModule],
    }).compile();
    budgets = module.get(BudgetAccessService);
    payables = module.get(PayablesAccessService);
    accounting = module.get(AccountingAccessService);
    matrices = module.get(ApprovalMatrixAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateFinanceTables(pool);
    await truncateAccountingTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function countJournals(): Promise<number> {
    const result = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM acc.journal_entries');
    return Number(result.rows[0]?.count ?? '0');
  }

  async function seedActor(options?: { withBudgetGrant?: boolean; withAccountingGrant?: boolean }) {
    const login = normalizeLoginIdentifier(`budget-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    if (options?.withBudgetGrant !== false) {
      await grantBudgetAdmin(pool, identityId, identityId);
    }
    if (options?.withAccountingGrant) {
      await grantAccountingAdmin(pool, identityId, identityId);
    }
    return { identityId, sessionId: 'test-session' };
  }

  async function seedBudgetChecker(originatorGrant = true) {
    const originator = await seedActor({ withBudgetGrant: originatorGrant, withAccountingGrant: true });
    const checker = await seedActor({ withBudgetGrant: true, withAccountingGrant: true });
    await enableCriticalSodFor(pool, matrices, [originator.identityId, checker.identityId]);
    return { originator, checker };
  }

  async function seedExpenseAccount(actor: { identityId: string; sessionId: string }) {
    const chart = await accounting.createChart(actor, {
      unitId: UNIT,
      code: `COA-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Budget chart',
    });
    const cash = await accounting.createAccount(actor, chart.id, {
      code: '1.1.01',
      name: 'Cash',
      class: ACCOUNT_CLASSES.Asset,
    });
    const expense = await accounting.createAccount(actor, chart.id, {
      code: '5.1.01',
      name: 'Operating expense',
      class: ACCOUNT_CLASSES.Expense,
    });
    const period = await accounting.createPeriod(actor, {
      chartId: chart.id,
      unitId: UNIT,
      code: '2026-09',
      startsOn: '2026-09-01',
      endsOn: '2026-09-30',
    });
    return { chart, cash, expense, period };
  }

  it('rejects create without authorization', async () => {
    const actor = await seedActor({ withBudgetGrant: false });
    await expect(
      budgets.create(actor, {
        unitId: UNIT,
        code: 'BUD-DENY',
        name: 'Denied',
        currencyCode: 'BRL',
      }),
    ).rejects.toMatchObject({ code: FINANCE_ERROR_CODES.DENIED });
  });

  it('rejects approval of an incomplete draft and overlapping periods', async () => {
    const actor = await seedActor();
    const created = await budgets.create(actor, {
      unitId: UNIT,
      code: `BUD-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Incomplete',
      currencyCode: 'BRL',
    });
    await expect(budgets.approve(actor, created.id, 1)).rejects.toMatchObject({
      code: FINANCE_ERROR_CODES.BUDGET_INCOMPLETE,
    });
    await budgets.addPeriod(actor, created.id, {
      periodKey: '2026-09',
      startsOn: '2026-09-01',
      endsOn: '2026-09-30',
    });
    await expect(
      budgets.addPeriod(actor, created.id, {
        periodKey: '2026-10',
        startsOn: '2026-09-15',
        endsOn: '2026-10-15',
      }),
    ).rejects.toMatchObject({ code: FINANCE_ERROR_CODES.BUDGET_PERIOD_INVALID });
  });

  it('versions an approved budget and keeps the approved version immutable', async () => {
    const { originator: actor, checker } = await seedBudgetChecker();
    const created = await budgets.create(actor, {
      unitId: UNIT,
      code: `BUD-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Versioned',
      currencyCode: 'BRL',
    });
    const withPeriod = await budgets.addPeriod(actor, created.id, {
      periodKey: '2026-09',
      startsOn: '2026-09-01',
      endsOn: '2026-09-30',
    });
    const periodId = withPeriod.versions[0]!.periods[0]!.id;
    const withLine = await budgets.addLine(actor, created.id, {
      periodId,
      amount: '1000.0000',
      costCenterCode: 'CC-OPS',
    });
    expect(withLine.versions[0]!.status).toBe('DRAFT');
    const approved = await budgets.approve(checker, created.id, 1);
    expect(approved.versions[0]!.status).toBe('APPROVED');
    await expect(
      budgets.addLine(actor, created.id, {
        periodId,
        amount: '50.0000',
        costCenterCode: 'CC-OPS',
      }),
    ).rejects.toMatchObject({ code: FINANCE_ERROR_CODES.BUDGET_VERSION_IMMUTABLE });
    const next = await budgets.createVersion(actor, created.id);
    expect(next.versions).toHaveLength(2);
    expect(next.versions[0]!.status).toBe('APPROVED');
    expect(next.versions[1]!.status).toBe('DRAFT');
    expect(next.versions[1]!.versionNumber).toBe(2);
    expect(next.versions[1]!.periods[0]!.lines).toHaveLength(1);
    const draftPeriodId = next.versions[1]!.periods[0]!.id;
    const updatedDraft = await budgets.addLine(actor, created.id, {
      periodId: draftPeriodId,
      amount: '200.0000',
      costCenterCode: 'CC-NEW',
    });
    expect(updatedDraft.versions[0]!.periods[0]!.lines).toHaveLength(1);
    expect(updatedDraft.versions[1]!.periods[0]!.lines).toHaveLength(2);
  });

  it('does not change journal entries when mutating budget only', async () => {
    const { originator: actor, checker } = await seedBudgetChecker();
    const before = await countJournals();
    const created = await budgets.create(actor, {
      unitId: UNIT,
      code: `BUD-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Ledger isolation',
      currencyCode: 'BRL',
    });
    const withPeriod = await budgets.addPeriod(actor, created.id, {
      periodKey: '2026-09',
      startsOn: '2026-09-01',
      endsOn: '2026-09-30',
    });
    await budgets.addLine(actor, created.id, {
      periodId: withPeriod.versions[0]!.periods[0]!.id,
      amount: '800.0000',
      costCenterCode: 'CC-OPS',
    });
    await budgets.approve(checker, created.id, 1);
    await budgets.createVersion(actor, created.id);
    const after = await countJournals();
    expect(after).toBe(before);
    expect(after).toBe(0);
  });

  it('compares budgeted, posted actual and variance on the backend', async () => {
    const { originator: actor, checker } = await seedBudgetChecker();
    const { chart, cash, expense, period } = await seedExpenseAccount(actor);
    const category = await payables.createExpenseCategory(actor, {
      code: `CAT-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Operacao',
    });
    const draft = await accounting.createDraft(actor, {
      chartId: chart.id,
      periodId: period.id,
      description: 'Posted expense',
      occurredOn: '2026-09-10',
      currencyCode: 'BRL',
      sourceKind: JOURNAL_SOURCE_KINDS.Manual,
      sourceId: crypto.randomUUID(),
      sourceReference: 'EXP-BUD-1',
      idempotencyKey: `bud-act-${crypto.randomUUID()}`,
      lines: [
        {
          lineNumber: 1,
          accountId: expense.id,
          direction: JOURNAL_DIRECTIONS.Debit,
          amount: '750.0000',
        },
        {
          lineNumber: 2,
          accountId: cash.id,
          direction: JOURNAL_DIRECTIONS.Credit,
          amount: '750.0000',
        },
      ],
    });
    await accounting.post(checker, draft.id, { rowVersion: draft.rowVersion });
    const journalsAfterPost = await countJournals();

    const created = await budgets.create(actor, {
      unitId: UNIT,
      code: `BUD-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Comparativo',
      currencyCode: 'BRL',
    });
    const withPeriod = await budgets.addPeriod(actor, created.id, {
      periodKey: '2026-09',
      startsOn: '2026-09-01',
      endsOn: '2026-09-30',
    });
    const periodId = withPeriod.versions[0]!.periods[0]!.id;
    await budgets.addLine(actor, created.id, {
      periodId,
      amount: '1000.0000',
      accountId: expense.id,
    });
    await budgets.addLine(actor, created.id, {
      periodId,
      amount: '200.0000',
      expenseCategoryId: category.id,
    });
    await budgets.addLine(actor, created.id, {
      periodId,
      amount: '100.0000',
      costCenterCode: 'CC-OPS',
    });
    const approved = await budgets.approve(checker, created.id, 1);
    const comparison = await budgets.compare(actor, created.id);
    expect(comparison.budgeted).toBe('1300.0000');
    expect(comparison.actual).toBe('750.0000');
    expect(comparison.variance).toBe('-550.0000');
    expect(comparison.lines).toHaveLength(3);
    const accountLine = comparison.lines.find((line) => line.actualSource === 'POSTED_JOURNAL');
    expect(accountLine).toMatchObject({
      budgeted: '1000.0000',
      actual: '750.0000',
      variance: '-250.0000',
      actualSource: 'POSTED_JOURNAL',
    });
    const unmapped = comparison.lines.filter((line) => line.actualSource === 'NONE');
    expect(unmapped).toHaveLength(2);
    expect(unmapped.every((line) => line.actual === '0.0000')).toBe(true);
    expect(approved.versions[0]!.status).toBe('APPROVED');
    expect(await countJournals()).toBe(journalsAfterPost);
  });

  /*
   * PRECONDICAO DE VERSAO — a aprovacao nao pode acontecer sobre estado velho.
   *
   * Estes casos cobrem a correcao da Wave 0: antes, `approve` nao recebia versao alguma e
   * duas aprovacoes concorrentes (ou uma aprovacao sobre um rascunho que mudou) eram ambas
   * aceitas — "ultima escrita vence".
   */
  it('recusa aprovacao cuja versao carregada nao e mais a versao corrente', async () => {
    const { originator: actor, checker } = await seedBudgetChecker();
    const created = await budgets.create(actor, {
      unitId: UNIT,
      code: `BUD-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Stale',
      currencyCode: 'BRL',
    });
    const period = await budgets.addPeriod(actor, created.id, {
      periodKey: '2026-09',
      startsOn: '2026-09-01',
      endsOn: '2026-09-30',
    });
    await budgets.addLine(actor, created.id, {
      periodId: period.versions[0]!.periods[0]!.id,
      amount: '100.0000',
      costCenterCode: 'CC-OPS',
    });

    // O aprovador carregou a versao 1, mas a versao corrente ja e outra (2).
    await expect(budgets.approve(checker, created.id, 2)).rejects.toMatchObject({
      code: FINANCE_ERROR_CODES.BUDGET_VERSION_CONFLICT,
    });

    // A versao correta continua aprovando: o bloqueio e da versao, nao do fluxo.
    const approved = await budgets.approve(checker, created.id, 1);
    expect(approved.versions[0]!.status).toBe('APPROVED');
  });

  it('recusa aprovar duas vezes a mesma versao (conflito, nao replay silencioso)', async () => {
    const { originator: actor, checker } = await seedBudgetChecker();
    const created = await budgets.create(actor, {
      unitId: UNIT,
      code: `BUD-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Double',
      currencyCode: 'BRL',
    });
    const period = await budgets.addPeriod(actor, created.id, {
      periodKey: '2026-09',
      startsOn: '2026-09-01',
      endsOn: '2026-09-30',
    });
    await budgets.addLine(actor, created.id, {
      periodId: period.versions[0]!.periods[0]!.id,
      amount: '100.0000',
      costCenterCode: 'CC-OPS',
    });

    await budgets.approve(checker, created.id, 1);
    // Segunda tentativa com a MESMA versao: a versao ja nao e DRAFT.
    await expect(budgets.approve(checker, created.id, 1)).rejects.toMatchObject({
      code: FINANCE_ERROR_CODES.BUDGET_NOT_DRAFT,
    });
  });
});
