import {
  hashPassword,
  insertGrant,
  insertIdentity,
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
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import {
  TAX_CALCULATION_METHODS,
  TEST_FIXTURE_RULE_CODE,
  TEST_FIXTURE_SOURCE_REFERENCE,
} from './domain/tax-engine';
import { FISCAL_ERROR_CODES } from './errors/fiscal-error-codes';
import { FiscalHttpException } from './errors/fiscal-http.exception';
import { FiscalModule } from './fiscal.module';
import { TaxEngineAccessService } from './services/tax-engine-access.service';

const UNIT = 'unit-tax-a';

async function grantTaxAdmin(pool: Pool, identityId: string): Promise<void> {
  for (const action of [
    AUTHZ_ACTIONS.FiscalTaxRuleManage,
    AUTHZ_ACTIONS.FiscalTaxCalculate,
    AUTHZ_ACTIONS.FiscalTaxRead,
  ]) {
    await insertGrant(pool, {
      identityId,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.FiscalTaxEngine,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: identityId,
    });
  }
}

describe('Tax engine PostgreSQL integration', () => {
  let pool: Pool;
  let tax: TaxEngineAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for tax engine integration tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    const module: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, AuditModule, AuthorizationModule, FiscalModule],
    }).compile();
    tax = module.get(TaxEngineAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateFiscalTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedActor(withGrant = true) {
    const login = normalizeLoginIdentifier(`tax-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    if (withGrant) {
      await grantTaxAdmin(pool, identityId);
    }
    return { identityId, sessionId: 'test-session' };
  }

  async function publishFixture(
    actor: { identityId: string; sessionId: string },
    overrides: { rate?: string; effectiveFrom?: string; effectiveTo?: string | null } = {},
  ) {
    const rule = await tax.createRule(actor, {
      unitId: UNIT,
      code: TEST_FIXTURE_RULE_CODE,
      name: 'Configured test percent fixture',
    });
    const draft = await tax.createVersion(actor, rule.id, {
      calculationMethod: TAX_CALCULATION_METHODS.PercentOfBase,
      rate: overrides.rate ?? '5.0000',
      sourceReference: TEST_FIXTURE_SOURCE_REFERENCE,
      effectiveFrom: overrides.effectiveFrom ?? '2026-01-01',
      effectiveTo: overrides.effectiveTo === undefined ? '2026-06-30' : overrides.effectiveTo,
    });
    const published = await tax.publishVersion(actor, draft.id);
    return { rule, published };
  }

  it('versions a published rule immutably and requires a new version for new legislation', async () => {
    const actor = await seedActor();
    const { rule, published } = await publishFixture(actor);
    expect(published.status).toBe('PUBLISHED');
    expect(published.versionNumber).toBe(1);
    await expect(
      pool.query(`UPDATE fis.tax_rule_versions SET rate = 9 WHERE id = $1`, [published.id]),
    ).rejects.toThrow(/TAX_VERSION_IMMUTABLE/);
    const nextDraft = await tax.createVersion(actor, rule.id, {
      calculationMethod: TAX_CALCULATION_METHODS.PercentOfBase,
      rate: '7.0000',
      sourceReference: TEST_FIXTURE_SOURCE_REFERENCE,
      effectiveFrom: '2026-07-01',
      effectiveTo: null,
    });
    const next = await tax.publishVersion(actor, nextDraft.id);
    expect(next.versionNumber).toBe(2);
    expect(next.rate).toBe('7');
    const overlapping = await tax.createVersion(actor, rule.id, {
      calculationMethod: TAX_CALCULATION_METHODS.PercentOfBase,
      rate: '8.0000',
      sourceReference: TEST_FIXTURE_SOURCE_REFERENCE,
      effectiveFrom: '2026-06-01',
      effectiveTo: null,
    });
    await expect(tax.publishVersion(actor, overlapping.id)).rejects.toMatchObject({
      code: FISCAL_ERROR_CODES.TAX_VERSION_OVERLAP,
    });
  });

  it('reproduces a historical calculation from the stored version after a later version is published', async () => {
    const actor = await seedActor();
    const { rule, published } = await publishFixture(actor, { rate: '5.0000' });
    const historical = await tax.calculate(actor, {
      unitId: UNIT,
      ruleVersionId: published.id,
      currencyCode: 'BRL',
      baseAmount: '100.0000',
      effectiveOn: '2026-03-01',
      idempotencyKey: `hist-${crypto.randomUUID()}`,
    });
    expect(historical.ruleVersionId).toBe(published.id);
    expect(historical.resultAmount).toBe('5');
    const nextDraft = await tax.createVersion(actor, rule.id, {
      calculationMethod: TAX_CALCULATION_METHODS.PercentOfBase,
      rate: '12.0000',
      sourceReference: TEST_FIXTURE_SOURCE_REFERENCE,
      effectiveFrom: '2026-07-01',
      effectiveTo: null,
    });
    await tax.publishVersion(actor, nextDraft.id);
    const replay = await tax.reproduce(actor, historical.id);
    expect(replay.matches).toBe(true);
    expect(replay.recomputed.ruleVersionId).toBe(published.id);
    expect(replay.recomputed.rate).toBe('5');
    expect(replay.recomputed.resultAmount).toBe(historical.resultAmount);
    const later = await tax.calculate(actor, {
      unitId: UNIT,
      ruleCode: TEST_FIXTURE_RULE_CODE,
      currencyCode: 'BRL',
      baseAmount: '100.0000',
      effectiveOn: '2026-08-01',
      idempotencyKey: `later-${crypto.randomUUID()}`,
    });
    expect(later.resultAmount).toBe('12');
    expect(later.ruleVersionId).not.toBe(historical.ruleVersionId);
  });

  it('applies stored HALF_UP rounding and rejects invalid context', async () => {
    const actor = await seedActor();
    const { published } = await publishFixture(actor);
    const rounded = await tax.calculate(actor, {
      unitId: UNIT,
      ruleVersionId: published.id,
      currencyCode: 'BRL',
      baseAmount: '10.0015',
      effectiveOn: '2026-03-01',
      idempotencyKey: `round-${crypto.randomUUID()}`,
    });
    expect(rounded.resultAmount).toBe('0.5001');
    await expect(
      tax.calculate(actor, {
        unitId: UNIT,
        ruleVersionId: published.id,
        currencyCode: 'BRL',
        baseAmount: '0',
        effectiveOn: '2026-03-01',
        idempotencyKey: `zero-${crypto.randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: FISCAL_ERROR_CODES.TAX_INVALID_CONTEXT });
    await expect(
      tax.calculate(actor, {
        unitId: UNIT,
        ruleVersionId: published.id,
        currencyCode: 'REAL',
        baseAmount: '10.0000',
        effectiveOn: '2026-03-01',
        idempotencyKey: `cur-${crypto.randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: FISCAL_ERROR_CODES.TAX_INVALID_CONTEXT });
  });

  it('returns TAX_RULE_NOT_CONFIGURED when the rule or published version is missing', async () => {
    const actor = await seedActor();
    await expect(
      tax.calculate(actor, {
        unitId: UNIT,
        ruleCode: TEST_FIXTURE_RULE_CODE,
        currencyCode: 'BRL',
        baseAmount: '10.0000',
        effectiveOn: '2026-03-01',
        idempotencyKey: `missing-${crypto.randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: FISCAL_ERROR_CODES.TAX_RULE_NOT_CONFIGURED });
    await expect(
      tax.createRule(actor, { unitId: UNIT, code: 'ISS', name: 'Invented official label' }),
    ).rejects.toMatchObject({ code: FISCAL_ERROR_CODES.TAX_RULE_NOT_CONFIGURED });
  });

  it('is idempotent under concurrent calculate and does not write ledger or fiscal documents', async () => {
    const actor = await seedActor();
    const { published } = await publishFixture(actor);
    const key = `conc-${crypto.randomUUID()}`;
    const payload = {
      unitId: UNIT,
      ruleVersionId: published.id,
      currencyCode: 'BRL',
      baseAmount: '40.0000',
      effectiveOn: '2026-03-01',
      idempotencyKey: key,
    };
    const [first, second] = await Promise.all([
      tax.calculate(actor, payload),
      tax.calculate(actor, payload),
    ]);
    expect(first.id).toBe(second.id);
    const count = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM fis.tax_calculations WHERE idempotency_key = $1`,
      [key],
    );
    expect(count.rows[0]?.count).toBe('1');
    const journals = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM acc.journal_entries`,
    );
    const documents = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM fis.fiscal_documents`,
    );
    expect(journals.rows[0]?.count).toBe('0');
    expect(documents.rows[0]?.count).toBe('0');
  });

  it('denies unauthorized calculate and records publish plus calculate audit', async () => {
    const admin = await seedActor(true);
    const stranger = await seedActor(false);
    const { published } = await publishFixture(admin);
    await expect(
      tax.calculate(stranger, {
        unitId: UNIT,
        ruleVersionId: published.id,
        currencyCode: 'BRL',
        baseAmount: '10.0000',
        effectiveOn: '2026-03-01',
        idempotencyKey: `deny-${crypto.randomUUID()}`,
      }),
    ).rejects.toBeInstanceOf(FiscalHttpException);
    const calculation = await tax.calculate(admin, {
      unitId: UNIT,
      ruleVersionId: published.id,
      currencyCode: 'BRL',
      baseAmount: '10.0000',
      effectiveOn: '2026-03-01',
      idempotencyKey: `aud-${crypto.randomUUID()}`,
    });
    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM audit.security_audit_events
       WHERE resource_id IN ($1, $2)
       ORDER BY occurred_at`,
      [published.id, calculation.id],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        'security:fiscal:tax-rule:publish',
        'security:fiscal:tax:calculate',
      ]),
    );
  });

  describe('rule list surface', () => {
    // O controller injeta page/pageSize por padrao; aqui repetimos o contrato real do servico.
    const listQuery = (overrides: Record<string, unknown> = {}) => ({
      unitId: UNIT,
      page: 0,
      pageSize: 20,
      ...overrides,
    });

    it('lists rules for the unit with the published version and version count', async () => {
      const actor = await seedActor();
      const { rule, published } = await publishFixture(actor);
      await tax.createVersion(actor, rule.id, {
        calculationMethod: TAX_CALCULATION_METHODS.PercentOfBase,
        rate: '7.0000',
        sourceReference: TEST_FIXTURE_SOURCE_REFERENCE,
        effectiveFrom: '2026-07-01',
        effectiveTo: null,
      });

      const page = await tax.listRules(actor, listQuery());
      expect(page.total).toBe(1);
      const row = page.items[0]!;
      expect(row.id).toBe(rule.id);
      expect(row.code).toBe(TEST_FIXTURE_RULE_CODE);
      expect(row.versionCount).toBe(2);
      expect(row.publishedVersion?.versionNumber).toBe(published.versionNumber);
      expect(row.publishedVersion?.status).toBe('PUBLISHED');
      expect(row.publishedVersion?.rate).toBe(published.rate);
      expect(row.publishedVersion?.effectiveFrom).toBe(published.effectiveFrom);

      const otherUnit = await tax.listRules(actor, listQuery({ unitId: 'unit-tax-other' }));
      expect(otherUnit.total).toBe(0);
      expect(otherUnit.items).toEqual([]);
    });

    it('denies the rule list without tax read authorization', async () => {
      const admin = await seedActor();
      const stranger = await seedActor(false);
      await publishFixture(admin);
      await expect(tax.listRules(stranger, listQuery())).rejects.toBeInstanceOf(FiscalHttpException);
    });
  });
});
