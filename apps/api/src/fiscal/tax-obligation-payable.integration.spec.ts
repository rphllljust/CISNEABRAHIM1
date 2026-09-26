import {
  hashPassword,
  insertGrant,
  insertIdentity,
  truncateFinanceTables,
  truncateFiscalTables,
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
import { moneyAmountsEqual } from '../platform/kernel/money-math';
import { PAYABLE_LIFECYCLES, PAYABLE_ORIGIN_KINDS } from '../finance/domain/payable';
import { FinanceModule } from '../finance/finance.module';
import { PayablesAccessService } from '../finance/services/payables-access.service';
import { FISCAL_ERROR_CODES } from './errors/fiscal-error-codes';
import {
  TAX_CALCULATION_METHODS,
  TEST_FIXTURE_RULE_CODE,
  TEST_FIXTURE_SOURCE_REFERENCE,
} from './domain/tax-engine';
import {
  TAX_PAYABLE_FAILURE_STAGES,
  TaxPayableFailureInjection,
} from './domain/tax-payable-failure-injection';
import { FiscalModule } from './fiscal.module';
import { TaxAssessmentAccessService } from './services/tax-assessment-access.service';
import { TaxEngineAccessService } from './services/tax-engine-access.service';

const UNIT = 'unit-tax-pay';

async function grantTaxPayableAdmin(pool: Pool, identityId: string): Promise<void> {
  for (const action of [
    AUTHZ_ACTIONS.FiscalTaxRuleManage,
    AUTHZ_ACTIONS.FiscalTaxCalculate,
    AUTHZ_ACTIONS.FiscalTaxRead,
    AUTHZ_ACTIONS.FiscalTaxAssessmentCreate,
    AUTHZ_ACTIONS.FiscalTaxAssessmentFinalize,
    AUTHZ_ACTIONS.FiscalTaxAssessmentAdjust,
    AUTHZ_ACTIONS.FiscalTaxAssessmentCancel,
    AUTHZ_ACTIONS.FiscalTaxAssessmentRead,
  ]) {
    await insertGrant(pool, {
      identityId,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.FiscalTaxEngine,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: identityId,
    });
  }
  await insertGrant(pool, {
    identityId,
    action: AUTHZ_ACTIONS.FinanceExpenseCategoryCreate,
    resourceType: AUTHZ_RESOURCE_TYPES.FinancePayable,
    scopeType: AUTHZ_SCOPES.Global,
    grantedByIdentityId: identityId,
  });
}

describe('Tax obligation to payable PostgreSQL integration', () => {
  let pool: Pool;
  let tax: TaxEngineAccessService;
  let assessments: TaxAssessmentAccessService;
  let payables: PayablesAccessService;
  let failures: TaxPayableFailureInjection;
  let matrices: ApprovalMatrixAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for tax payable integration tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    const module: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, AuditModule, AuthorizationModule, FinanceModule, FiscalModule],
    }).compile();
    tax = module.get(TaxEngineAccessService);
    assessments = module.get(TaxAssessmentAccessService);
    payables = module.get(PayablesAccessService);
    failures = module.get(TaxPayableFailureInjection);
    matrices = module.get(ApprovalMatrixAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    failures.reset();
    await truncateFiscalTables(pool);
    await truncateFinanceTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedActor(withGrant = true) {
    const login = normalizeLoginIdentifier(`tax-pay-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    if (withGrant) {
      await grantTaxPayableAdmin(pool, identityId);
    }
    return { identityId, sessionId: 'test-session' };
  }

  async function seedSodPair() {
    const originator = await seedActor();
    const checker = await seedActor();
    await enableCriticalSodFor(pool, matrices, checker.identityId);
    return { originator, checker };
  }

  async function publishAndCalculate(
    actor: { identityId: string; sessionId: string },
    baseAmount: string,
    effectiveOn = '2026-03-15',
  ) {
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM fis.tax_rules WHERE unit_id = $1 AND code = $2`,
      [UNIT, TEST_FIXTURE_RULE_CODE],
    );
    let ruleId = existing.rows[0]?.id;
    let versionId: string;
    if (!ruleId) {
      const rule = await tax.createRule(actor, {
        unitId: UNIT,
        code: TEST_FIXTURE_RULE_CODE,
        name: 'Configured test percent fixture',
      });
      ruleId = rule.id;
      const draft = await tax.createVersion(actor, rule.id, {
        calculationMethod: TAX_CALCULATION_METHODS.PercentOfBase,
        rate: '5.0000',
        sourceReference: TEST_FIXTURE_SOURCE_REFERENCE,
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-06-30',
      });
      const published = await tax.publishVersion(actor, draft.id);
      versionId = published.id;
    } else {
      const published = await pool.query<{ id: string }>(
        `SELECT id FROM fis.tax_rule_versions
         WHERE tax_rule_id = $1 AND status = 'PUBLISHED'
         ORDER BY version_number DESC LIMIT 1`,
        [ruleId],
      );
      versionId = published.rows[0]!.id;
    }
    const calculation = await tax.calculate(actor, {
      unitId: UNIT,
      ruleVersionId: versionId,
      currencyCode: 'BRL',
      baseAmount,
      effectiveOn,
      idempotencyKey: `calc-${crypto.randomUUID()}`,
    });
    return { calculation };
  }

  async function payableFields(actor: { identityId: string; sessionId: string }) {
    const category = await payables.createExpenseCategory(actor, {
      code: `TAX-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Tax obligation',
    });
    return {
      counterpartyId: crypto.randomUUID(),
      expenseCategoryId: category.id,
      costCenterId: crypto.randomUUID(),
      costCenterCode: 'CC-TAX',
      dueDate: '2026-04-20',
      paymentTerms: 'DARF',
    };
  }

  it('finalizes a valid assessment into one obligation and one payable', async () => {
    const { originator: actor, checker } = await seedSodPair();
    const journalsBefore = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM acc.journal_entries`,
    );
    const { calculation } = await publishAndCalculate(actor, '100.0000');
    const draft = await assessments.create(actor, {
      taxCalculationId: calculation.id,
      idempotencyKey: `asm-${crypto.randomUUID()}`,
    });
    expect(draft.status).toBe('DRAFT');
    expect(draft.assessedAmount).toBe('5');
    expect(draft.periodKey).toBe('2026-03');
    const finalized = await assessments.finalize(checker, draft.id, await payableFields(actor));
    expect(finalized.status).toBe('FINALIZED');
    expect(finalized.obligation?.status).toBe('OPEN');
    expect(finalized.obligation?.amount).toBe('5');
    expect(finalized.obligation?.originCalculationId).toBe(calculation.id);
    expect(finalized.reconciliation.matched).toBe(true);
    expect(finalized.reconciliation.payableOriginKind).toBe(PAYABLE_ORIGIN_KINDS.TaxObligation);
    const payable = await payables.findByTaxObligation(finalized.obligation!.id);
    expect(payable?.originKind).toBe(PAYABLE_ORIGIN_KINDS.TaxObligation);
    expect(payable?.originId).toBe(finalized.obligation!.id);
    expect(payable ? moneyAmountsEqual(payable.principal, '5') : false).toBe(true);
    const journalsAfter = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM acc.journal_entries`,
    );
    expect(journalsAfter.rows[0]!.count).toBe(journalsBefore.rows[0]!.count);
    const assessmentsCount = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM fis.tax_assessments`,
    );
    const obligationsCount = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM fis.tax_obligations`,
    );
    const payablesCount = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM fin.payables WHERE origin_kind = 'TAX_OBLIGATION'`,
    );
    expect(assessmentsCount.rows[0]!.count).toBe('1');
    expect(obligationsCount.rows[0]!.count).toBe('1');
    expect(payablesCount.rows[0]!.count).toBe('1');
  });

  it('replays finalize without duplicating assessment, obligation or payable', async () => {
    const { originator: actor, checker } = await seedSodPair();
    const { calculation } = await publishAndCalculate(actor, '100.0000');
    const key = `asm-${crypto.randomUUID()}`;
    const firstDraft = await assessments.create(actor, {
      taxCalculationId: calculation.id,
      idempotencyKey: key,
    });
    const replayDraft = await assessments.create(actor, {
      taxCalculationId: calculation.id,
      idempotencyKey: key,
    });
    expect(replayDraft.id).toBe(firstDraft.id);
    const fields = await payableFields(actor);
    const first = await assessments.finalize(checker, firstDraft.id, fields);
    const replay = await assessments.finalize(checker, firstDraft.id, fields);
    expect(replay.id).toBe(first.id);
    expect(replay.obligation?.id).toBe(first.obligation?.id);
    expect(replay.obligation?.payableId).toBe(first.obligation?.payableId);
    const payablesCount = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM fin.payables WHERE origin_kind = 'TAX_OBLIGATION'`,
    );
    expect(payablesCount.rows[0]!.count).toBe('1');
  });

  it('keeps a single payable under concurrent finalize workers', async () => {
    const { originator: actor, checker } = await seedSodPair();
    const { calculation } = await publishAndCalculate(actor, '100.0000');
    const draft = await assessments.create(actor, {
      taxCalculationId: calculation.id,
      idempotencyKey: `asm-${crypto.randomUUID()}`,
    });
    const fields = await payableFields(actor);
    const [left, right] = await Promise.all([
      assessments.finalize(checker, draft.id, fields),
      assessments.finalize(checker, draft.id, fields),
    ]);
    expect(left.obligation?.id).toBe(right.obligation?.id);
    expect(left.obligation?.payableId).toBe(right.obligation?.payableId);
    const payablesCount = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM fin.payables WHERE origin_kind = 'TAX_OBLIGATION'`,
    );
    const obligationsCount = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM fis.tax_obligations`,
    );
    expect(obligationsCount.rows[0]!.count).toBe('1');
    expect(payablesCount.rows[0]!.count).toBe('1');
  });

  it('rolls back obligation insert so nothing is leftover', async () => {
    const { originator: actor, checker } = await seedSodPair();
    const { calculation } = await publishAndCalculate(actor, '100.0000');
    const draft = await assessments.create(actor, {
      taxCalculationId: calculation.id,
      idempotencyKey: `asm-${crypto.randomUUID()}`,
    });
    failures.stage = TAX_PAYABLE_FAILURE_STAGES.AfterObligationInsert;
    await expect(assessments.finalize(checker, draft.id, await payableFields(actor))).rejects.toMatchObject({
      code: FISCAL_ERROR_CODES.VALIDATION_FAILED,
    });
    const leftover = await assessments.getById(actor, draft.id);
    expect(leftover.status).toBe('DRAFT');
    expect(leftover.obligation).toBeNull();
    const obligations = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM fis.tax_obligations`,
    );
    const payablesCount = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM fin.payables WHERE origin_kind = 'TAX_OBLIGATION'`,
    );
    expect(obligations.rows[0]!.count).toBe('0');
    expect(payablesCount.rows[0]!.count).toBe('0');
  });

  it('adjusts by cancelling the current obligation and opening a new payable without deleting history', async () => {
    const { originator: actor, checker } = await seedSodPair();
    const firstCalc = await publishAndCalculate(actor, '100.0000');
    const draft = await assessments.create(actor, {
      taxCalculationId: firstCalc.calculation.id,
      idempotencyKey: `asm-${crypto.randomUUID()}`,
    });
    const first = await assessments.finalize(checker, draft.id, await payableFields(actor));
    const secondCalc = await publishAndCalculate(actor, '200.0000');
    const successor = await assessments.adjust(actor, first.id, {
      taxCalculationId: secondCalc.calculation.id,
      idempotencyKey: `asm-${crypto.randomUUID()}`,
      reason: 'Recalculated stored base',
      ...(await payableFields(actor)),
    });
    expect(successor.status).toBe('DRAFT');
    const adjusted = await assessments.finalize(checker, successor.id, await payableFields(actor));
    expect(adjusted.status).toBe('FINALIZED');
    expect(adjusted.supersedesAssessmentId).toBe(first.id);
    expect(adjusted.assessedAmount).toBe('10');
    expect(adjusted.reconciliation.matched).toBe(true);
    const previous = await assessments.getById(actor, first.id);
    expect(previous.status).toBe('ADJUSTED');
    expect(previous.obligation?.status).toBe('CANCELLED');
    const previousPayable = await payables.findByTaxObligation(previous.obligation!.id);
    expect(previousPayable?.lifecycle).toBe(PAYABLE_LIFECYCLES.Cancelled);
    await expect(pool.query(`DELETE FROM fis.tax_assessments WHERE id = $1`, [first.id])).rejects.toThrow(
      /TAX_HISTORY_IMMUTABLE/,
    );
    const counts = await pool.query<{ assessments: string; obligations: string; payables: string }>(
      `SELECT
         (SELECT count(*)::text FROM fis.tax_assessments) AS assessments,
         (SELECT count(*)::text FROM fis.tax_obligations) AS obligations,
         (SELECT count(*)::text FROM fin.payables WHERE origin_kind = 'TAX_OBLIGATION') AS payables`,
    );
    expect(counts.rows[0]!.assessments).toBe('2');
    expect(counts.rows[0]!.obligations).toBe('2');
    expect(counts.rows[0]!.payables).toBe('2');
  });

  it('denies finalize without tax assessment authorization', async () => {
    const admin = await seedActor();
    const ops = await seedActor(false);
    const { calculation } = await publishAndCalculate(admin, '100.0000');
    const draft = await assessments.create(admin, {
      taxCalculationId: calculation.id,
      idempotencyKey: `asm-${crypto.randomUUID()}`,
    });
    await expect(assessments.finalize(ops, draft.id, await payableFields(admin))).rejects.toMatchObject({
      code: FISCAL_ERROR_CODES.DENIED,
    });
    await expect(assessments.getById(ops, draft.id)).rejects.toMatchObject({
      code: FISCAL_ERROR_CODES.DENIED,
    });
  });

  it('reconciles fiscal obligation amount to finance payable principal', async () => {
    const { originator: actor, checker } = await seedSodPair();
    const { calculation } = await publishAndCalculate(actor, '100.0000');
    const draft = await assessments.create(actor, {
      taxCalculationId: calculation.id,
      idempotencyKey: `asm-${crypto.randomUUID()}`,
    });
    const finalized = await assessments.finalize(checker, draft.id, await payableFields(actor));
    const read = await assessments.getById(actor, finalized.id);
    expect(read.reconciliation.matched).toBe(true);
    expect(read.reconciliation.assessedAmount).toBe(read.reconciliation.obligationAmount);
    expect(read.reconciliation.obligationAmount).toBe(read.reconciliation.payablePrincipal);
    expect(read.obligation?.originCalculationId).toBe(calculation.id);
  });

  describe('assessment list surface', () => {
    // O controller injeta page/pageSize por padrao; aqui repetimos o contrato real do servico.
    const listQuery = (overrides: Record<string, unknown> = {}) => ({
      unitId: UNIT,
      page: 0,
      pageSize: 20,
      ...overrides,
    });

    it('lists assessments by unit, competence and tax component with the obligation reference', async () => {
      const { originator: actor, checker } = await seedSodPair();
      const { calculation } = await publishAndCalculate(actor, '100.0000');
      const draft = await assessments.create(actor, {
        taxCalculationId: calculation.id,
        idempotencyKey: `asm-${crypto.randomUUID()}`,
      });
      const finalized = await assessments.finalize(checker, draft.id, await payableFields(actor));

      const all = await assessments.list(actor, listQuery());
      expect(all.total).toBe(1);
      const row = all.items[0]!;
      expect(row.id).toBe(finalized.id);
      expect(row.periodKey).toBe('2026-03');
      expect(row.status).toBe('FINALIZED');
      expect(row.assessedAmount).toBe('5');
      expect(row.finalizedAt).toBeTruthy();
      expect(row.obligation?.id).toBe(finalized.obligation?.id);
      expect(row.obligation?.status).toBe('OPEN');
      expect(row.obligation?.amount).toBe('5');
      expect(row.obligation?.payableId).toBe(finalized.obligation?.payableId);

      const byComponent = await assessments.list(
        actor,
        listQuery({ periodKey: '2026-03', taxComponent: row.taxComponent }),
      );
      expect(byComponent.total).toBe(1);

      const otherPeriod = await assessments.list(actor, listQuery({ periodKey: '2026-04' }));
      expect(otherPeriod.total).toBe(0);
      expect(otherPeriod.items).toEqual([]);

      const otherUnit = await assessments.list(actor, listQuery({ unitId: 'unit-tax-other' }));
      expect(otherUnit.total).toBe(0);
    });

    it('denies the assessment list without tax assessment read authorization', async () => {
      const admin = await seedActor();
      const ops = await seedActor(false);
      const { calculation } = await publishAndCalculate(admin, '100.0000');
      await assessments.create(admin, {
        taxCalculationId: calculation.id,
        idempotencyKey: `asm-${crypto.randomUUID()}`,
      });
      await expect(assessments.list(ops, listQuery())).rejects.toMatchObject({
        code: FISCAL_ERROR_CODES.DENIED,
      });
    });
  });
});
