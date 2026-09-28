import {
  hashPassword,
  insertGrant,
  insertIdentity,
  truncateFinanceTables,
  truncateIdentityAndAuthorizationTables,
} from '@cisne/database';
import { Test, TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AUTH_TEST_PASSWORD, applyAuthTestEnv } from '../auth/test/auth-test-env';
import { normalizeLoginIdentifier } from '../auth/crypto/token-crypto';
import { AuthorizationModule } from '../authorization/authorization.module';
import { APPROVAL_OPERATIONS } from '../authorization/domain/approval-matrix';
import { ApprovalMatrixAccessService } from '../authorization/services/approval-matrix-access.service';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import { AUTHZ_ERROR_CODES } from '../authorization/errors/authz-error-codes';
import { PAYABLE_ORIGIN_KINDS } from './domain/payable';
import { EXPENSE_FAILURE_STAGES, ExpenseFailureInjection } from './domain/expense-failure-injection';
import { EXPENSE_STATUSES } from './domain/expense';
import { FINANCE_ERROR_CODES } from './errors/finance-error-codes';
import { FinanceModule } from './finance.module';
import { ExpenseAccessService } from './services/expense-access.service';
import { PayablesAccessService } from './services/payables-access.service';
import { PayablesRepository } from './repositories/payables.repository';

const UNIT = 'unit-expense-a';

async function grantExpense(pool: Pool, identityId: string): Promise<void> {
  const actions = [
    AUTHZ_ACTIONS.FinanceExpenseCreate,
    AUTHZ_ACTIONS.FinanceExpenseSubmit,
    AUTHZ_ACTIONS.FinanceExpenseApprove,
    AUTHZ_ACTIONS.FinanceExpenseReject,
    AUTHZ_ACTIONS.FinanceExpenseRead,
    AUTHZ_ACTIONS.FinanceExpenseList,
    AUTHZ_ACTIONS.FinanceExpenseCategoryCreate,
    AUTHZ_ACTIONS.FinancePayableRead,
  ];
  for (const action of actions) {
    await insertGrant(pool, {
      identityId,
      action,
      resourceType:
        action === AUTHZ_ACTIONS.FinancePayableRead
          ? AUTHZ_RESOURCE_TYPES.FinancePayable
          : action === AUTHZ_ACTIONS.FinanceExpenseCategoryCreate
            ? AUTHZ_RESOURCE_TYPES.FinancePayable
            : AUTHZ_RESOURCE_TYPES.FinanceExpense,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: identityId,
    });
  }
}

describe('Expense management PostgreSQL integration', () => {
  let pool: Pool;
  let expenses: ExpenseAccessService;
  let payables: PayablesAccessService;
  let payablesRepository: PayablesRepository;
  let matrices: ApprovalMatrixAccessService;
  let failures: ExpenseFailureInjection;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for expense integration tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    const module: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, AuditModule, AuthorizationModule, FinanceModule],
    }).compile();
    expenses = module.get(ExpenseAccessService);
    payables = module.get(PayablesAccessService);
    payablesRepository = module.get(PayablesRepository);
    matrices = module.get(ApprovalMatrixAccessService);
    failures = module.get(ExpenseFailureInjection);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    failures.reset();
    await truncateFinanceTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedIdentity(withExpense = false, withMatrix = false) {
    const login = normalizeLoginIdentifier(`exp-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    if (withExpense) {
      await grantExpense(pool, identityId);
    }
    if (withMatrix) {
      await insertGrant(pool, {
        identityId,
        action: AUTHZ_ACTIONS.ApprovalMatrixManage,
        resourceType: AUTHZ_RESOURCE_TYPES.ApprovalMatrix,
        scopeType: AUTHZ_SCOPES.Global,
        grantedByIdentityId: identityId,
      });
    }
    return { identityId, sessionId: 'test-session' };
  }

  async function insertReceipt(actorId: string): Promise<string> {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO doc.documents (
         title, category_code, classification_code, unit_id, created_by_identity_id, updated_by_identity_id
       ) VALUES ('recibo', 'EVIDENCE', 'INTERNAL', $1, $2, $2)
       RETURNING id`,
      [UNIT, actorId],
    );
    return result.rows[0]!.id;
  }

  async function publishExpenseMatrix(admin: { identityId: string; sessionId: string }, limit = '5000') {
    const created = await matrices.create(admin, {
      code: `EXP-APPR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    });
    const withRules = await matrices.addRules(admin, created.id, {
      version: created.version,
      rules: [
        {
          operation: APPROVAL_OPERATIONS.Expense,
          roleCode: 'FINANCIAL_CONTROLLER',
          capability: 'expense.approve',
          scopeType: AUTHZ_SCOPES.Global,
          amountLimit: limit,
        },
      ],
    });
    await matrices.publish(admin, created.id, { version: withRules.version });
  }

  async function seedReadyExpense() {
    const requester = await seedIdentity(true);
    const approver = await seedIdentity(true);
    const admin = await seedIdentity(false, true);
    await publishExpenseMatrix(admin);
    await matrices.assignRole(admin, {
      identityId: approver.identityId,
      roleCode: 'FINANCIAL_CONTROLLER',
      scopeType: AUTHZ_SCOPES.Global,
    });
    const category = await payables.createExpenseCategory(requester, {
      code: `CAT-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Viagem',
    });
    const receiptDocumentId = await insertReceipt(requester.identityId);
    const created = await expenses.create(requester, {
      unitId: UNIT,
      expenseCategoryId: category.id,
      costCenterId: crypto.randomUUID(),
      costCenterCode: 'CC-OPS',
      dueDate: '2099-12-31',
      paymentTerms: 'REEMBOLSO',
      description: 'Alimentacao',
      receiptDocumentId,
      items: [{ description: 'Almoco', amount: '80' }],
      idempotencyKey: `exp-${crypto.randomUUID()}`,
    });
    const submitted = await expenses.submit(requester, created.id, { version: created.version });
    return { requester, approver, submitted };
  }

  it('lists expenses with search and status filter', async () => {
    const { requester, submitted } = await seedReadyExpense();

    const page = await expenses.list(requester, { limit: 20, offset: 0 });
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      id: submitted.id,
      costCenterCode: 'CC-OPS',
      description: 'Alimentacao',
      status: EXPENSE_STATUSES.Submitted,
    });

    const byDescription = await expenses.list(requester, { limit: 20, offset: 0, q: 'Alimentacao' });
    expect(byDescription.total).toBe(1);
    const byStatus = await expenses.list(requester, { limit: 20, offset: 0, status: 'SUBMITTED' });
    expect(byStatus.total).toBe(1);
    const wrongStatus = await expenses.list(requester, { limit: 20, offset: 0, status: 'APPROVED' });
    expect(wrongStatus.total).toBe(0);
  });

  it('denies the expenses list without the list grant', async () => {
    const { submitted } = await seedReadyExpense();
    const outsider = await seedIdentity(false);
    // Somente `read` não autoriza listar.
    await insertGrant(pool, {
      identityId: outsider.identityId,
      action: AUTHZ_ACTIONS.FinanceExpenseRead,
      resourceType: AUTHZ_RESOURCE_TYPES.FinanceExpense,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: outsider.identityId,
    });
    await expect(expenses.list(outsider, { limit: 20, offset: 0 })).rejects.toMatchObject({
      code: FINANCE_ERROR_CODES.DENIED,
    });
    expect(submitted.id).toBeTruthy();
  });

  it('approves a reimbursable expense into a single operational payable', async () => {
    const { requester, approver, submitted } = await seedReadyExpense();
    const approved = await expenses.approve(approver, submitted.id, { version: submitted.version });
    expect(approved.status).toBe(EXPENSE_STATUSES.Approved);
    expect(approved.approval?.decision).toBe('APPROVED');
    expect(approved.reimbursement).not.toBeNull();
    const payable = await payablesRepository.findByOrigin(
      PAYABLE_ORIGIN_KINDS.OperationalExpense,
      submitted.id,
    );
    expect(payable?.id).toBe(approved.reimbursement?.payableId);
    expect(Number(payable?.principal)).toBe(80);
    expect(payable?.counterparty_id).toBe(requester.identityId);
    expect(approved.receiptDocumentId).toBe(submitted.receiptDocumentId);
  });

  it('rejects without opening a payable or reimbursement', async () => {
    const { approver, submitted } = await seedReadyExpense();
    const rejected = await expenses.reject(approver, submitted.id, {
      version: submitted.version,
      reason: 'Comprovante ilegivel',
    });
    expect(rejected.status).toBe(EXPENSE_STATUSES.Rejected);
    expect(rejected.reimbursement).toBeNull();
    const payable = await payablesRepository.findByOrigin(
      PAYABLE_ORIGIN_KINDS.OperationalExpense,
      submitted.id,
    );
    expect(payable).toBeNull();
  });

  it('replays the same idempotency key without a second expense or reimbursement', async () => {
    const { requester, approver, submitted } = await seedReadyExpense();
    const replay = await expenses.create(requester, {
      unitId: UNIT,
      expenseCategoryId: submitted.expenseCategoryId,
      costCenterId: submitted.costCenterId,
      costCenterCode: submitted.costCenterCode,
      dueDate: submitted.dueDate,
      paymentTerms: submitted.paymentTerms,
      description: submitted.description,
      receiptDocumentId: submitted.receiptDocumentId,
      items: [{ description: 'Almoco', amount: '80' }],
      idempotencyKey: (
        await pool.query<{ idempotency_key: string }>(
          `SELECT idempotency_key FROM fin.expenses WHERE id = $1`,
          [submitted.id],
        )
      ).rows[0]!.idempotency_key,
    });
    expect(replay.id).toBe(submitted.id);
    await expenses.approve(approver, submitted.id, { version: submitted.version });
    const second = await expenses.approve(approver, submitted.id, { version: submitted.version });
    expect(second.reimbursement?.payableId).toBeTruthy();
    const reimbursements = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM fin.expense_reimbursements WHERE expense_id = $1`,
      [submitted.id],
    );
    const payableCount = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM fin.payables
       WHERE origin_kind = 'OPERATIONAL_EXPENSE' AND origin_id = $1`,
      [submitted.id],
    );
    expect(reimbursements.rows[0]?.count).toBe('1');
    expect(payableCount.rows[0]?.count).toBe('1');
  });

  it('rolls back approval so the expense stays submitted and no payable exists', async () => {
    const { approver, submitted } = await seedReadyExpense();
    failures.stage = EXPENSE_FAILURE_STAGES.AfterExpenseApproval;
    await expect(expenses.approve(approver, submitted.id, { version: submitted.version })).rejects.toBeTruthy();
    const current = await expenses.get(approver, submitted.id);
    expect(current.status).toBe(EXPENSE_STATUSES.Submitted);
    expect(current.reimbursement).toBeNull();
    const payable = await payablesRepository.findByOrigin(
      PAYABLE_ORIGIN_KINDS.OperationalExpense,
      submitted.id,
    );
    expect(payable).toBeNull();
    const approvals = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM fin.expense_approvals WHERE expense_id = $1`,
      [submitted.id],
    );
    expect(approvals.rows[0]?.count).toBe('0');
  });

  it('denies approval without grants and forbids self-approval', async () => {
    const stranger = await seedIdentity();
    const { requester, submitted } = await seedReadyExpense();
    await expect(expenses.approve(stranger, submitted.id, { version: submitted.version })).rejects.toMatchObject({
      code: FINANCE_ERROR_CODES.DENIED,
    });
    await expect(
      expenses.approve(requester, submitted.id, { version: submitted.version }),
    ).rejects.toMatchObject({
      code: FINANCE_ERROR_CODES.EXPENSE_SELF_APPROVAL,
    });
    expect(AUTHZ_ERROR_CODES.APPROVAL_SELF_APPROVAL).toBe('APPROVAL_MATRIX_SELF_APPROVAL');
  });

  it('serializes concurrent approvals to a single reimbursement', async () => {
    const { approver, submitted } = await seedReadyExpense();
    const results = await Promise.allSettled([
      expenses.approve(approver, submitted.id, { version: submitted.version }),
      expenses.approve(approver, submitted.id, { version: submitted.version }),
    ]);
    const fulfilled = results.filter((item) => item.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    const reimbursements = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM fin.expense_reimbursements WHERE expense_id = $1`,
      [submitted.id],
    );
    expect(reimbursements.rows[0]?.count).toBe('1');
  });
});
