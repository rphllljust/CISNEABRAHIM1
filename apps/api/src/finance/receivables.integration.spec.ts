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
import { ApprovalMatrixAccessService } from '../authorization/services/approval-matrix-access.service';
import { enableCriticalSodFor } from '../authorization/test/critical-sod-harness';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import { RECEIVABLE_STATUSES } from './domain/receivable';
import { FINANCE_ERROR_CODES } from './errors/finance-error-codes';
import { FinanceHttpException } from './errors/finance-http.exception';
import { FinanceModule } from './finance.module';
import { ReceivablesAccessService } from './services/receivables-access.service';

const UNIT_A = 'unit-fin-ar-a';

async function grantFinanceAdmin(pool: Pool, identityId: string, grantedBy: string): Promise<void> {
  const actions = [
    AUTHZ_ACTIONS.FinanceReceivableRead,
    AUTHZ_ACTIONS.FinanceReceivableList,
    AUTHZ_ACTIONS.FinanceReceivableSettle,
    AUTHZ_ACTIONS.FinanceReceivableCancel,
  ];
  for (const action of actions) {
    await insertGrant(pool, {
      identityId,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.FinanceReceivable,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: grantedBy,
    });
  }
}

describe('Finance receivables PostgreSQL integration', () => {
  let pool: Pool;
  let receivablesAccess: ReceivablesAccessService;
  let matrices: ApprovalMatrixAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for finance integration tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    const module: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, AuditModule, AuthorizationModule, FinanceModule],
    }).compile();
    receivablesAccess = module.get(ReceivablesAccessService);
    matrices = module.get(ApprovalMatrixAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateFinanceTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedActor(withGrant = true): Promise<{ identityId: string; sessionId: string }> {
    const login = normalizeLoginIdentifier(`finance-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    if (withGrant) {
      await grantFinanceAdmin(pool, identityId, identityId);
    }
    return { identityId, sessionId: 'test-session' };
  }

  async function seedSettlePair() {
    const originator = await seedActor();
    const checker = await seedActor();
    await enableCriticalSodFor(pool, matrices, [originator.identityId, checker.identityId]);
    return { originator, checker };
  }

  async function openReceivable(
    actor: { identityId: string; sessionId: string },
    principal = '100.0000',
    dueDate = '2099-12-31',
  ) {
    const opened = await receivablesAccess.openFromBilling({
      billingRecordId: crypto.randomUUID(),
      billingDocumentId: crypto.randomUUID(),
      serviceOrderId: crypto.randomUUID(),
      measurementId: crypto.randomUUID(),
      unitId: UNIT_A,
      clientId: crypto.randomUUID(),
      principal,
      currencyCode: 'BRL',
      dueDate,
      paymentTerms: '30 DDL',
      externalReference: 'NF-TEST-001',
      actorIdentityId: actor.identityId,
    });
    return receivablesAccess.getById(actor, opened.receivableId);
  }

  it('opens a receivable from finalized billing origin with installment and derived OPEN status', async () => {
    const actor = await seedActor();
    const receivable = await openReceivable(actor);
    expect(receivable.status).toBe(RECEIVABLE_STATUSES.Open);
    expect(receivable.principal).toBe('100');
    expect(receivable.remainingBalance).toBe('100');
    expect(receivable.installments).toHaveLength(1);
    expect(receivable.origin.kind).toBe('BILLING_DOCUMENT');
  });

  it('posts a full payment and derives PAID from settlements', async () => {
    const { originator: actor, checker } = await seedSettlePair();
    const opened = await openReceivable(actor);
    const paid = await receivablesAccess.settle(checker, opened.id, {
      amount: '100.0000',
      rowVersion: opened.rowVersion,
      idempotencyKey: `full-${crypto.randomUUID()}`,
    });
    expect(paid.status).toBe(RECEIVABLE_STATUSES.Paid);
    expect(paid.remainingBalance).toBe('0');
    expect(paid.settlements).toHaveLength(1);
  });

  it('blocks originator self-settlement and allows a different authorized finance checker to pay in full', async () => {
    const { originator: actor, checker } = await seedSettlePair();
    const opened = await openReceivable(actor);

    await expect(
      receivablesAccess.settle(actor, opened.id, {
        amount: '100.0000',
        rowVersion: opened.rowVersion,
        idempotencyKey: `self-${crypto.randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: 'APPROVAL_MATRIX_SELF_APPROVAL' });

    const afterSelfAttempt = await receivablesAccess.getById(actor, opened.id);
    expect(afterSelfAttempt.status).toBe(RECEIVABLE_STATUSES.Open);
    expect(afterSelfAttempt.settlements).toHaveLength(0);

    const paid = await receivablesAccess.settle(checker, opened.id, {
      amount: '100.0000',
      rowVersion: afterSelfAttempt.rowVersion,
      idempotencyKey: `checker-${crypto.randomUUID()}`,
    });
    expect(paid.status).toBe(RECEIVABLE_STATUSES.Paid);
    expect(paid.remainingBalance).toBe('0');
    expect(paid.settlements).toHaveLength(1);
  });

  it('posts a partial payment and derives PARTIALLY_PAID', async () => {
    const { originator: actor, checker } = await seedSettlePair();
    const opened = await openReceivable(actor);
    const partial = await receivablesAccess.settle(checker, opened.id, {
      amount: '40.0000',
      rowVersion: opened.rowVersion,
      idempotencyKey: `partial-${crypto.randomUUID()}`,
    });
    expect(partial.status).toBe(RECEIVABLE_STATUSES.PartiallyPaid);
    expect(partial.remainingBalance).toBe('60');
  });

  it('replays duplicate settlement with the same idempotency key without two baixas', async () => {
    const { originator: actor, checker } = await seedSettlePair();
    const opened = await openReceivable(actor);
    const key = `dup-${crypto.randomUUID()}`;
    const first = await receivablesAccess.settle(checker, opened.id, {
      amount: '25.0000',
      rowVersion: opened.rowVersion,
      idempotencyKey: key,
    });
    const second = await receivablesAccess.settle(checker, opened.id, {
      amount: '25.0000',
      rowVersion: first.rowVersion,
      idempotencyKey: key,
    });
    expect(second.settlements).toHaveLength(1);
    expect(second.settlements[0]?.id).toBe(first.settlements[0]?.id);
    const count = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM fin.settlements WHERE receivable_id = $1`,
      [opened.id],
    );
    expect(count.rows[0]?.count).toBe('1');
  });

  it('replays a double POST with the original rowVersion as one settlement', async () => {
    const { originator: actor, checker } = await seedSettlePair();
    const opened = await openReceivable(actor);
    const key = `dbl-${crypto.randomUUID()}`;
    const first = await receivablesAccess.settle(checker, opened.id, {
      amount: '25.0000',
      rowVersion: opened.rowVersion,
      idempotencyKey: key,
    });
    const second = await receivablesAccess.settle(checker, opened.id, {
      amount: '25.0000',
      rowVersion: opened.rowVersion,
      idempotencyKey: key,
    });
    expect(second.settlements).toHaveLength(1);
    expect(second.settlements[0]?.id).toBe(first.settlements[0]?.id);
    const count = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM fin.settlements WHERE receivable_id = $1`,
      [opened.id],
    );
    expect(count.rows[0]?.count).toBe('1');
  });

  it('serializes concurrent double POSTs with the same idempotency key to one settlement', async () => {
    const { originator: actor, checker } = await seedSettlePair();
    const opened = await openReceivable(actor);
    const key = `conc-dup-${crypto.randomUUID()}`;
    const payload = {
      amount: '25.0000',
      rowVersion: opened.rowVersion,
      idempotencyKey: key,
    };
    const results = await Promise.allSettled([
      receivablesAccess.settle(checker, opened.id, payload),
      receivablesAccess.settle(checker, opened.id, payload),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    expect(fulfilled).toHaveLength(2);
    const first = (fulfilled[0] as PromiseFulfilledResult<{ settlements: Array<{ id: string }> }>).value;
    const second = (fulfilled[1] as PromiseFulfilledResult<{ settlements: Array<{ id: string }> }>).value;
    expect(first.settlements).toHaveLength(1);
    expect(second.settlements).toHaveLength(1);
    expect(second.settlements[0]?.id).toBe(first.settlements[0]?.id);
    const count = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM fin.settlements WHERE receivable_id = $1`,
      [opened.id],
    );
    expect(count.rows[0]?.count).toBe('1');
  });

  it('serializes concurrent settlements so remaining never goes negative', async () => {
    const { originator: actor, checker } = await seedSettlePair();
    const opened = await openReceivable(actor, '100.0000');
    const results = await Promise.allSettled([
      receivablesAccess.settle(checker, opened.id, {
        amount: '100.0000',
        rowVersion: opened.rowVersion,
        idempotencyKey: `c1-${crypto.randomUUID()}`,
      }),
      receivablesAccess.settle(checker, opened.id, {
        amount: '100.0000',
        rowVersion: opened.rowVersion,
        idempotencyKey: `c2-${crypto.randomUUID()}`,
      }),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const paid = (fulfilled[0] as PromiseFulfilledResult<{ remainingBalance: string; status: string }>).value;
    expect(paid.remainingBalance).toBe('0');
    expect(paid.status).toBe(RECEIVABLE_STATUSES.Paid);
    const negative = await pool.query<{ remaining: string }>(
      `SELECT (r.principal - COALESCE(SUM(s.amount), 0))::text AS remaining
       FROM fin.receivables r
       LEFT JOIN fin.settlements s ON s.receivable_id = r.id AND s.status = 'POSTED'
       WHERE r.id = $1
       GROUP BY r.principal`,
      [opened.id],
    );
    expect(Number(negative.rows[0]?.remaining)).toBeGreaterThanOrEqual(0);
  });

  it('rejects overpayment without an explicit overpay rule', async () => {
    const { originator: actor, checker } = await seedSettlePair();
    const opened = await openReceivable(actor);
    await expect(
      receivablesAccess.settle(checker, opened.id, {
        amount: '100.0001',
        rowVersion: opened.rowVersion,
        idempotencyKey: `over-${crypto.randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: FINANCE_ERROR_CODES.OVERPAYMENT });
    const count = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM fin.settlements WHERE receivable_id = $1`,
      [opened.id],
    );
    expect(count.rows[0]?.count).toBe('0');
  });

  it('rejects settlement on a cancelled receivable', async () => {
    const { originator: actor, checker } = await seedSettlePair();
    const opened = await openReceivable(actor);
    await receivablesAccess.cancel(actor, opened.id, {
      rowVersion: opened.rowVersion,
      cancelReason: 'Cliente recusou o titulo.',
    });
    const cancelled = await receivablesAccess.getById(actor, opened.id);
    await expect(
      receivablesAccess.settle(checker, opened.id, {
        amount: '10.0000',
        rowVersion: cancelled.rowVersion,
        idempotencyKey: `after-cancel-${crypto.randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: FINANCE_ERROR_CODES.CANCELLED });
  });

  it('rejects stale rowVersion on settlement', async () => {
    const { originator: actor, checker } = await seedSettlePair();
    const opened = await openReceivable(actor);
    await expect(
      receivablesAccess.settle(checker, opened.id, {
        amount: '10.0000',
        rowVersion: opened.rowVersion + 5,
        idempotencyKey: `stale-${crypto.randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: FINANCE_ERROR_CODES.VERSION_CONFLICT });
  });

  it('denies unauthorized settlement', async () => {
    const admin = await seedActor(true);
    const stranger = await seedActor(false);
    const opened = await openReceivable(admin);
    await expect(
      receivablesAccess.settle(stranger, opened.id, {
        amount: '10.0000',
        rowVersion: opened.rowVersion,
        idempotencyKey: `deny-${crypto.randomUUID()}`,
      }),
    ).rejects.toBeInstanceOf(FinanceHttpException);
  });

  it('rolls back a rejected settlement so posted rows stay empty', async () => {
    const { originator: actor, checker } = await seedSettlePair();
    const opened = await openReceivable(actor);
    await expect(
      receivablesAccess.settle(checker, opened.id, {
        amount: '200.0000',
        rowVersion: opened.rowVersion,
        idempotencyKey: `rollback-${crypto.randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: FINANCE_ERROR_CODES.OVERPAYMENT });
    const rows = await pool.query(
      `SELECT id FROM fin.settlements WHERE receivable_id = $1`,
      [opened.id],
    );
    expect(rows.rowCount).toBe(0);
  });

  it('reconciles principal minus posted settlements to remaining balance', async () => {
    const { originator: actor, checker } = await seedSettlePair();
    const opened = await openReceivable(actor, '250.0000');
    const first = await receivablesAccess.settle(checker, opened.id, {
      amount: '100.0000',
      rowVersion: opened.rowVersion,
      idempotencyKey: `rec-1-${crypto.randomUUID()}`,
    });
    const second = await receivablesAccess.settle(checker, first.id, {
      amount: '150.0000',
      rowVersion: first.rowVersion,
      idempotencyKey: `rec-2-${crypto.randomUUID()}`,
    });
    const db = await pool.query<{ principal: string; settled: string; remaining: string }>(
      `SELECT r.principal::text AS principal,
              COALESCE(SUM(s.amount), 0)::text AS settled,
              (r.principal - COALESCE(SUM(s.amount), 0))::text AS remaining
       FROM fin.receivables r
       LEFT JOIN fin.settlements s ON s.receivable_id = r.id AND s.status = 'POSTED'
       WHERE r.id = $1
       GROUP BY r.principal`,
      [opened.id],
    );
    expect(db.rows[0]?.remaining).toBe('0.0000');
    expect(second.remainingBalance).toBe('0');
    expect(second.status).toBe(RECEIVABLE_STATUSES.Paid);
    expect(second.settledAmount).toBe('250');
  });
});
