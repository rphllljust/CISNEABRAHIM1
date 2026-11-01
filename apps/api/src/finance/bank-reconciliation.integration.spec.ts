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
import { BANK_LINE_MATCH_STATUSES, RECONCILIATION_TARGET_KINDS } from './domain/bank-reconciliation';
import { FINANCIAL_ACCOUNT_KINDS, FINANCIAL_DIRECTIONS, TREASURY_ORIGIN_KINDS } from './domain/treasury';
import { FinanceHttpException } from './errors/finance-http.exception';
import { FinanceModule } from './finance.module';
import { BankReconciliationAccessService } from './services/bank-reconciliation-access.service';
import { TreasuryAccessService } from './services/treasury-access.service';

const UNIT = 'unit-fin-br-a';
const DAY = '2026-09-15';
const OCCURRED = '2026-09-15T15:00:00.000Z';

async function grantTreasuryAdmin(pool: Pool, identityId: string): Promise<void> {
  for (const action of [
    AUTHZ_ACTIONS.FinanceTreasuryAccountOpen,
    AUTHZ_ACTIONS.FinanceTreasuryRead,
    AUTHZ_ACTIONS.FinanceTreasuryList,
    AUTHZ_ACTIONS.FinanceTreasuryPost,
    AUTHZ_ACTIONS.FinanceTreasuryTransfer,
    AUTHZ_ACTIONS.FinanceTreasuryReverse,
    AUTHZ_ACTIONS.FinanceBankStatementImport,
    AUTHZ_ACTIONS.FinanceReconciliationMatch,
    AUTHZ_ACTIONS.FinanceReconciliationConfirm,
    AUTHZ_ACTIONS.FinanceReconciliationUnreconcile,
    AUTHZ_ACTIONS.FinanceReconciliationRead,
  ]) {
    await insertGrant(pool, {
      identityId,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.FinanceTreasury,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: identityId,
    });
  }
}

describe('Bank reconciliation PostgreSQL integration', () => {
  let pool: Pool;
  let treasury: TreasuryAccessService;
  let recon: BankReconciliationAccessService;
  let matrices: ApprovalMatrixAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for bank reconciliation integration tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    const module: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, AuditModule, AuthorizationModule, FinanceModule],
    }).compile();
    treasury = module.get(TreasuryAccessService);
    recon = module.get(BankReconciliationAccessService);
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

  async function seedActor(withGrant = true) {
    const login = normalizeLoginIdentifier(`br-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    if (withGrant) {
      await grantTreasuryAdmin(pool, identityId);
    }
    return { identityId, sessionId: 'test-session' };
  }

  async function seedReconPair() {
    const originator = await seedActor();
    const checker = await seedActor();
    await enableCriticalSodFor(pool, matrices, [originator.identityId, checker.identityId]);
    return { originator, checker };
  }

  async function openBank(actor: { identityId: string; sessionId: string }) {
    return treasury.openAccount(actor, {
      unitId: UNIT,
      kind: FINANCIAL_ACCOUNT_KINDS.Bank,
      code: `BAN-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Conta conciliacao',
      currencyCode: 'BRL',
      openingAmount: '500.0000',
      bank: { bankCode: '001', agency: '0001', accountNumber: '7788-0' },
    });
  }

  it('rejects a manual USD statement for a BRL bank account without persisting a statement', async () => {
    const actor = await seedActor();
    const bank = await openBank(actor);
    await expect(recon.importStatement(actor, {
      unitId: UNIT,
      financialAccountId: bank.id,
      sourceKind: 'MANUAL',
      sourceReference: 'CROSS-CURRENCY-REJECTED',
      periodStartsOn: DAY,
      periodEndsOn: DAY,
      currencyCode: 'USD',
      idempotencyKey: `currency-reject-${crypto.randomUUID()}`,
      lines: [{
        sourceLineKey: 'USD-100',
        occurredOn: DAY,
        direction: FINANCIAL_DIRECTIONS.Credit,
        amount: '100.0000',
        description: 'Equal nominal amount is not a currency conversion',
      }],
    })).rejects.toMatchObject({ code: 'FINANCE_CURRENCY_MISMATCH' });
    const statements = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM fin.bank_statements',
    );
    const lines = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM fin.bank_statement_lines',
    );
    expect(statements.rows[0]?.count).toBe('0');
    expect(lines.rows[0]?.count).toBe('0');
  });

  it('auto-matches exact settlement/payment/transfer and leaves approximation and leftover partial unmatched', async () => {
    const { originator: actor, checker } = await seedReconPair();
    const bank = await openBank(actor);
    const cash = await treasury.openAccount(actor, {
      unitId: UNIT,
      kind: FINANCIAL_ACCOUNT_KINDS.Cash,
      code: `CX-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Caixa',
      currencyCode: 'BRL',
      cash: { locationCode: 'PVH-BR' },
    });
    const settlementOrigin = crypto.randomUUID();
    await treasury.postMovement(actor, bank.id, {
      direction: FINANCIAL_DIRECTIONS.Credit,
      amount: '40.0000',
      rowVersion: (await treasury.getById(actor, bank.id)).rowVersion,
      idempotencyKey: `set-partial-${crypto.randomUUID()}`,
      reference: 'SETTLE-40',
      originKind: TREASURY_ORIGIN_KINDS.ReceivableSettlement,
      originId: settlementOrigin,
      originReference: 'SETTLE-40',
      occurredAt: OCCURRED,
    });
    await treasury.postMovement(actor, bank.id, {
      direction: FINANCIAL_DIRECTIONS.Credit,
      amount: '60.0000',
      rowVersion: (await treasury.getById(actor, bank.id)).rowVersion,
      idempotencyKey: `set-rest-${crypto.randomUUID()}`,
      reference: 'SETTLE-60',
      originKind: TREASURY_ORIGIN_KINDS.ReceivableSettlement,
      originId: crypto.randomUUID(),
      originReference: 'SETTLE-60',
      occurredAt: OCCURRED,
    });
    await treasury.postMovement(actor, bank.id, {
      direction: FINANCIAL_DIRECTIONS.Debit,
      amount: '25.0000',
      rowVersion: (await treasury.getById(actor, bank.id)).rowVersion,
      idempotencyKey: `pay-${crypto.randomUUID()}`,
      reference: 'PAY-25',
      originKind: TREASURY_ORIGIN_KINDS.PayablePayment,
      originId: crypto.randomUUID(),
      originReference: 'PAY-25',
      occurredAt: OCCURRED,
    });
    await treasury.transfer(checker, {
      fromAccountId: bank.id,
      toAccountId: cash.id,
      amount: '15.0000',
      rowVersionFrom: (await treasury.getById(actor, bank.id)).rowVersion,
      rowVersionTo: (await treasury.getById(actor, cash.id)).rowVersion,
      idempotencyKey: `tr-${crypto.randomUUID()}`,
      reference: 'TR-15',
      originId: actor.identityId,
      originReference: 'TR-15',
      occurredAt: OCCURRED,
    });
    const stmtKey = `stmt-${crypto.randomUUID()}`;
    const statement = await recon.importStatement(actor, {
      unitId: UNIT,
      financialAccountId: bank.id,
      sourceKind: 'AUTHORIZED_FILE',
      sourceReference: 'OFX-FUTURE-PORT',
      periodStartsOn: DAY,
      periodEndsOn: DAY,
      currencyCode: 'BRL',
      idempotencyKey: stmtKey,
      lines: [
        {
          sourceLineKey: 'FIT-40',
          occurredOn: DAY,
          direction: FINANCIAL_DIRECTIONS.Credit,
          amount: '40.0000',
          description: 'Partial settlement',
        },
        {
          sourceLineKey: 'FIT-25',
          occurredOn: DAY,
          direction: FINANCIAL_DIRECTIONS.Debit,
          amount: '25.0000',
          description: 'Payable payment',
        },
        {
          sourceLineKey: 'FIT-15',
          occurredOn: DAY,
          direction: FINANCIAL_DIRECTIONS.Debit,
          amount: '15.0000',
          description: 'Transfer',
        },
        {
          sourceLineKey: 'FIT-APPROX',
          occurredOn: DAY,
          direction: FINANCIAL_DIRECTIONS.Credit,
          amount: '59.9900',
          description: 'Approximation must not match',
        },
      ],
    });
    const replay = await recon.importStatement(actor, {
      unitId: UNIT,
      financialAccountId: bank.id,
      sourceKind: 'AUTHORIZED_FILE',
      sourceReference: 'OFX-FUTURE-PORT',
      periodStartsOn: DAY,
      periodEndsOn: DAY,
      currencyCode: 'BRL',
      idempotencyKey: stmtKey,
      lines: statement.lines.map((line) => ({
        sourceLineKey: line.sourceLineKey,
        occurredOn: line.occurredOn,
        direction: line.direction,
        amount: line.amount,
        description: line.description,
      })),
    });
    expect(replay.idempotent).toBe(true);
    expect(replay.id).toBe(statement.id);
    const proposed = await recon.autoMatch(actor, statement.id);
    expect(proposed.autoMatchedConfirmed).toBe(0);
    expect(proposed.suggested).toHaveLength(3);
    expect(proposed.unmatched).toHaveLength(1);
    expect(proposed.reviewRequired).toHaveLength(0);
    const kinds = proposed.suggested.map((item) => item.match?.targetKind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        RECONCILIATION_TARGET_KINDS.ReceivableSettlement,
        RECONCILIATION_TARGET_KINDS.PayablePayment,
        RECONCILIATION_TARGET_KINDS.Transfer,
      ]),
    );
    for (const item of proposed.suggested) {
      const confirmed = await recon.confirm(checker, item.id);
      expect(confirmed.status).toBe('CONFIRMED');
    }
    await recon.assertIntegrity(statement.id);
    const refreshed = await recon.getStatement(actor, statement.id);
    expect(
      refreshed.lines.filter((line) => line.matchStatus === BANK_LINE_MATCH_STATUSES.Matched),
    ).toHaveLength(3);
    expect(
      refreshed.lines.find((line) => line.sourceLineKey === 'FIT-APPROX')?.matchStatus,
    ).toBe(BANK_LINE_MATCH_STATUSES.Unmatched);
  });

  it('marks ambiguous exact candidates REVIEW_REQUIRED and never auto-matches them', async () => {
    const actor = await seedActor();
    const bank = await openBank(actor);
    await treasury.postMovement(actor, bank.id, {
      direction: FINANCIAL_DIRECTIONS.Credit,
      amount: '80.0000',
      rowVersion: (await treasury.getById(actor, bank.id)).rowVersion,
      idempotencyKey: `amb-a-${crypto.randomUUID()}`,
      reference: 'AMB-A',
      originKind: TREASURY_ORIGIN_KINDS.ManualAuthorized,
      originId: actor.identityId,
      originReference: 'AMB-A',
      occurredAt: OCCURRED,
    });
    await treasury.postMovement(actor, bank.id, {
      direction: FINANCIAL_DIRECTIONS.Credit,
      amount: '80.0000',
      rowVersion: (await treasury.getById(actor, bank.id)).rowVersion,
      idempotencyKey: `amb-b-${crypto.randomUUID()}`,
      reference: 'AMB-B',
      originKind: TREASURY_ORIGIN_KINDS.ManualAuthorized,
      originId: actor.identityId,
      originReference: 'AMB-B',
      occurredAt: OCCURRED,
    });
    const statement = await recon.importStatement(actor, {
      unitId: UNIT,
      financialAccountId: bank.id,
      sourceKind: 'MANUAL',
      sourceReference: 'AMB',
      periodStartsOn: DAY,
      periodEndsOn: DAY,
      currencyCode: 'BRL',
      idempotencyKey: `amb-stmt-${crypto.randomUUID()}`,
      lines: [
        {
          sourceLineKey: 'FIT-AMB',
          occurredOn: DAY,
          direction: FINANCIAL_DIRECTIONS.Credit,
          amount: '80.0000',
          description: 'Ambiguous',
        },
      ],
    });
    const proposed = await recon.autoMatch(actor, statement.id);
    expect(proposed.autoMatchedConfirmed).toBe(0);
    expect(proposed.suggested).toHaveLength(0);
    expect(proposed.reviewRequired).toHaveLength(1);
    const after = await recon.getStatement(actor, statement.id);
    expect(after.lines[0]?.matchStatus).toBe(BANK_LINE_MATCH_STATUSES.ReviewRequired);
  });

  it('prevents double reconciliation under concurrency and requires authorized unreconcile', async () => {
    const admin = await seedActor(true);
    const checker = await seedActor(true);
    const stranger = await seedActor(false);
    await enableCriticalSodFor(pool, matrices, [admin.identityId, checker.identityId]);
    const bank = await openBank(admin);
    await treasury.postMovement(admin, bank.id, {
      direction: FINANCIAL_DIRECTIONS.Credit,
      amount: '33.0000',
      rowVersion: (await treasury.getById(admin, bank.id)).rowVersion,
      idempotencyKey: `one-${crypto.randomUUID()}`,
      reference: 'ONE',
      originKind: TREASURY_ORIGIN_KINDS.ManualAuthorized,
      originId: admin.identityId,
      originReference: 'ONE',
      occurredAt: OCCURRED,
    });
    const statement = await recon.importStatement(admin, {
      unitId: UNIT,
      financialAccountId: bank.id,
      sourceKind: 'BANK_API',
      sourceReference: 'API-FUTURE',
      periodStartsOn: DAY,
      periodEndsOn: DAY,
      currencyCode: 'BRL',
      idempotencyKey: `con-${crypto.randomUUID()}`,
      lines: [
        {
          sourceLineKey: 'FIT-33',
          occurredOn: DAY,
          direction: FINANCIAL_DIRECTIONS.Credit,
          amount: '33.0000',
          description: 'Concurrent',
        },
        {
          sourceLineKey: 'FIT-33',
          occurredOn: DAY,
          direction: FINANCIAL_DIRECTIONS.Credit,
          amount: '33.0000',
          description: 'Duplicate key',
        },
      ],
    });
    expect(statement.lines).toHaveLength(1);
    const proposed = await recon.autoMatch(admin, statement.id);
    const draftId = proposed.suggested[0]?.id as string;
    const concurrent = await Promise.allSettled([
      recon.confirm(checker, draftId),
      recon.confirm(checker, draftId),
    ]);
    const fulfilled = concurrent.filter((item) => item.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    const confirmedCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM fin.reconciliations
       WHERE bank_statement_line_id = $1 AND status = 'CONFIRMED'`,
      [statement.lines[0]!.id],
    );
    expect(confirmedCount.rows[0]?.count).toBe('1');
    await expect(recon.confirm(stranger, draftId)).rejects.toBeInstanceOf(FinanceHttpException);
    const confirmed = await recon.confirm(checker, draftId);
    await expect(
      recon.matchManual(admin, {
        bankStatementLineId: statement.lines[0]!.id,
        financialTransactionId: confirmed.match?.financialTransactionId ?? crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/CONFIRMED_IMMUTABLE/) as unknown as string });
    const opened = await recon.unreconcile(admin, draftId);
    expect(opened.status).toBe('UNRECONCILED');
    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM audit.security_audit_events WHERE resource_id = $1`,
      [draftId],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        'security:finance:reconciliation:confirm',
        'security:finance:reconciliation:unreconcile',
      ]),
    );
  });
});
