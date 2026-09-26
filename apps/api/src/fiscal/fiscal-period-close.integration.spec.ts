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
import { ApprovalMatrixAccessService } from '../authorization/services/approval-matrix-access.service';
import { enableCriticalSodFor } from '../authorization/test/critical-sod-harness';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import { FISCAL_SOURCE_KINDS } from './domain/fiscal-document';
import {
  FISCAL_PERIOD_FAILURE_STAGES,
  FiscalPeriodFailureInjection,
} from './domain/fiscal-period-failure-injection';
import { FISCAL_ERROR_CODES } from './errors/fiscal-error-codes';
import { FiscalModule } from './fiscal.module';
import { FiscalAccessService } from './services/fiscal-access.service';
import { FiscalPeriodAccessService } from './services/fiscal-period-access.service';

const UNIT = 'unit-fis-close';
const PERIOD_KEY = '2026-03';

async function grantFiscalCloseAdmin(pool: Pool, identityId: string): Promise<void> {
  for (const action of [
    AUTHZ_ACTIONS.FiscalDocumentDraft,
    AUTHZ_ACTIONS.FiscalDocumentSubmit,
    AUTHZ_ACTIONS.FiscalDocumentCancel,
    AUTHZ_ACTIONS.FiscalDocumentRead,
  ]) {
    await insertGrant(pool, {
      identityId,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.FiscalDocument,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: identityId,
    });
  }
  for (const action of [
    AUTHZ_ACTIONS.FiscalPeriodOpen,
    AUTHZ_ACTIONS.FiscalPeriodClose,
    AUTHZ_ACTIONS.FiscalPeriodReopen,
    AUTHZ_ACTIONS.FiscalPeriodRead,
  ]) {
    await insertGrant(pool, {
      identityId,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.FiscalPeriod,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: identityId,
    });
  }
}

describe('Fiscal period close PostgreSQL integration', () => {
  let pool: Pool;
  let fiscal: FiscalAccessService;
  let periods: FiscalPeriodAccessService;
  let failures: FiscalPeriodFailureInjection;
  let matrices: ApprovalMatrixAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for fiscal period close tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    const module: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, AuditModule, AuthorizationModule, FiscalModule],
    }).compile();
    fiscal = module.get(FiscalAccessService);
    periods = module.get(FiscalPeriodAccessService);
    failures = module.get(FiscalPeriodFailureInjection);
    matrices = module.get(ApprovalMatrixAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    failures.reset();
    await truncateFiscalTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedActor(withGrant = true) {
    const login = normalizeLoginIdentifier(`fis-close-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    if (withGrant) {
      await grantFiscalCloseAdmin(pool, identityId);
    }
    return { identityId, sessionId: 'test-session' };
  }

  async function seedSodPair() {
    const originator = await seedActor();
    const checker = await seedActor();
    await enableCriticalSodFor(pool, matrices, checker.identityId);
    return { originator, checker };
  }

  function draftInput() {
    const billingDocumentId = crypto.randomUUID();
    return {
      unitId: UNIT,
      sourceKind: FISCAL_SOURCE_KINDS.BillingDocument,
      sourceId: billingDocumentId,
      billingDocumentId,
      description: 'Official fiscal document',
      currencyCode: 'BRL',
      issuedOn: '2026-03-15',
      idempotencyKey: `fis-${crypto.randomUUID()}`,
      parties: [
        { role: 'ISSUER', legalName: 'Issuer Co', taxIdentifier: 'ISSUER-REF' },
        { role: 'RECIPIENT', legalName: 'Recipient Co', taxIdentifier: 'RECIPIENT-REF' },
      ],
      items: [
        {
          lineNumber: 1,
          description: 'Line',
          quantity: '1.0000',
          unitAmount: '100.0000',
          lineAmount: '100.0000',
        },
      ],
    };
  }

  it('closes an open period with no documents, assessments or pendencies', async () => {
    const actor = await seedActor();
    const opened = await periods.open(actor, { unitId: UNIT, periodKey: PERIOD_KEY });
    expect(opened.status).toBe('OPEN');
    const closed = await periods.close(actor, opened.id);
    expect(closed.status).toBe('CLOSED');
    expect(closed.closeChecks.every((item) => item.result === 'PASS')).toBe(true);
  });

  it('treats double-close as idempotent', async () => {
    const actor = await seedActor();
    const opened = await periods.open(actor, { unitId: UNIT, periodKey: PERIOD_KEY });
    const first = await periods.close(actor, opened.id);
    const second = await periods.close(actor, opened.id);
    expect(second.id).toBe(first.id);
    expect(second.status).toBe('CLOSED');
    expect(second.rowVersion).toBe(first.rowVersion);
    const runs = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM fis.fiscal_period_close_runs WHERE fiscal_period_id = $1 AND status = 'SUCCEEDED'`,
      [opened.id],
    );
    expect(runs.rows[0]!.count).toBe('1');
  });

  it('serializes concurrent close workers to a single CLOSED period', async () => {
    const actor = await seedActor();
    const opened = await periods.open(actor, { unitId: UNIT, periodKey: PERIOD_KEY });
    const [left, right] = await Promise.all([
      periods.close(actor, opened.id),
      periods.close(actor, opened.id),
    ]);
    expect(left.status).toBe('CLOSED');
    expect(right.status).toBe('CLOSED');
    const closed = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM fis.fiscal_periods WHERE id = $1 AND status = 'CLOSED'`,
      [opened.id],
    );
    expect(closed.rows[0]!.count).toBe('1');
  });

  it('blocks close when a draft document remains in the period', async () => {
    const actor = await seedActor();
    await fiscal.createDraft(actor, draftInput());
    const opened = await periods.open(actor, { unitId: UNIT, periodKey: PERIOD_KEY });
    await expect(periods.close(actor, opened.id)).rejects.toMatchObject({
      code: FISCAL_ERROR_CODES.PERIOD_CLOSE_BLOCKED,
    });
    const stillOpen = await periods.getById(actor, opened.id);
    expect(stillOpen.status).toBe('OPEN');
  });

  it('reopens a closed period and then accepts ordinary writes', async () => {
    const { originator: actor, checker } = await seedSodPair();
    const opened = await periods.open(actor, { unitId: UNIT, periodKey: PERIOD_KEY });
    await periods.close(actor, opened.id);
    const reopened = await periods.reopen(checker, opened.id, { reason: 'Authorized reopen' });
    expect(reopened.status).toBe('OPEN');
    const draft = await fiscal.createDraft(actor, draftInput());
    expect(draft.status).toBe('DRAFT');
  });

  it('denies close without fiscal period authorization', async () => {
    const admin = await seedActor();
    const ops = await seedActor(false);
    const opened = await periods.open(admin, { unitId: UNIT, periodKey: PERIOD_KEY });
    await expect(periods.close(ops, opened.id)).rejects.toMatchObject({
      code: FISCAL_ERROR_CODES.DENIED,
    });
  });

  it('rolls back close so the period stays OPEN and no succeeded run remains', async () => {
    const actor = await seedActor();
    const opened = await periods.open(actor, { unitId: UNIT, periodKey: PERIOD_KEY });
    failures.stage = FISCAL_PERIOD_FAILURE_STAGES.BeforeMarkClosed;
    await expect(periods.close(actor, opened.id)).rejects.toMatchObject({
      code: FISCAL_ERROR_CODES.VALIDATION_FAILED,
    });
    const current = await periods.getById(actor, opened.id);
    expect(current.status).toBe('OPEN');
    const succeeded = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM fis.fiscal_period_close_runs WHERE fiscal_period_id = $1 AND status = 'SUCCEEDED'`,
      [opened.id],
    );
    expect(succeeded.rows[0]!.count).toBe('0');
  });

  it('rejects ordinary document writes after close and records zero closed-period violations', async () => {
    const actor = await seedActor();
    const opened = await periods.open(actor, { unitId: UNIT, periodKey: PERIOD_KEY });
    await periods.close(actor, opened.id);
    await expect(fiscal.createDraft(actor, draftInput())).rejects.toMatchObject({
      code: FISCAL_ERROR_CODES.PERIOD_CLOSED,
    });
    await expect(
      pool.query(
        `INSERT INTO fis.fiscal_documents (
           unit_id, status, source_kind, description, currency_code, issued_on, idempotency_key,
           created_by_identity_id, updated_by_identity_id
         ) VALUES ($1, 'DRAFT', 'MANUAL', 'late', 'BRL', '2026-03-20', $2, $3, $3)`,
        [UNIT, `raw-${crypto.randomUUID()}`, actor.identityId],
      ),
    ).rejects.toThrow(/FISCAL_PERIOD_CLOSED/);
    const docs = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM fis.fiscal_documents
       WHERE unit_id = $1 AND to_char(issued_on::date, 'YYYY-MM') = $2`,
      [UNIT, PERIOD_KEY],
    );
    expect(docs.rows[0]!.count).toBe('0');
  });

  describe('list surface', () => {
    // O controller injeta page/pageSize por padrao; aqui repetimos o contrato real do servico.
    const listQuery = (overrides: Record<string, unknown> = {}) => ({
      unitId: UNIT,
      page: 0,
      pageSize: 20,
      ...overrides,
    });

    it('lists periods for the unit with key range and status filters', async () => {
      const actor = await seedActor();
      const march = await periods.open(actor, { unitId: UNIT, periodKey: '2026-03' });
      const april = await periods.open(actor, { unitId: UNIT, periodKey: '2026-04' });
      await periods.close(actor, april.id);

      const all = await periods.listPeriods(actor, listQuery());
      expect(all.total).toBe(2);
      expect(all.items.map((item) => item.id).sort()).toEqual([march.id, april.id].sort());

      const closed = await periods.listPeriods(actor, listQuery({ status: 'CLOSED' }));
      expect(closed.total).toBe(1);
      expect(closed.items[0]?.id).toBe(april.id);
      expect(closed.items[0]?.closedAt).toBeTruthy();

      const ranged = await periods.listPeriods(
        actor,
        listQuery({ periodKeyFrom: '2026-04', periodKeyTo: '2026-04' }),
      );
      expect(ranged.items.map((item) => item.id)).toEqual([april.id]);

      const otherUnit = await periods.listPeriods(actor, listQuery({ unitId: 'unit-fis-other' }));
      expect(otherUnit.total).toBe(0);
      expect(otherUnit.items).toEqual([]);
    });

    it('denies the period list without fiscal period read authorization', async () => {
      const admin = await seedActor();
      const ops = await seedActor(false);
      await periods.open(admin, { unitId: UNIT, periodKey: PERIOD_KEY });
      await expect(periods.listPeriods(ops, listQuery())).rejects.toMatchObject({
        code: FISCAL_ERROR_CODES.DENIED,
      });
    });

    it('rejects a malformed period key filter instead of ignoring it', async () => {
      const actor = await seedActor();
      await expect(
        periods.listPeriods(actor, listQuery({ periodKeyFrom: '2026/03' })),
      ).rejects.toMatchObject({ code: FISCAL_ERROR_CODES.VALIDATION_FAILED });
    });
  });
});
