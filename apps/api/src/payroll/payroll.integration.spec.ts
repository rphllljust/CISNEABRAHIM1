import {
  hashPassword,
  insertGrant,
  insertIdentity,
  truncateIdentityAndAuthorizationTables,
  truncatePayrollTables,
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
import { PAYROLL_EVENT_KINDS } from './domain/payroll';
import { PAYROLL_ERROR_CODES } from './errors/payroll-error-codes';
import { PayrollHttpException } from './errors/payroll-http.exception';
import { PayrollModule } from './payroll.module';
import { PayrollAccessService } from './services/payroll-access.service';
import { PayrollRepository } from './repositories/payroll.repository';

const UNIT = 'unit-pay-a';

async function grantPayrollAdmin(pool: Pool, identityId: string): Promise<void> {
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
}

describe('Payroll foundation PostgreSQL integration', () => {
  let pool: Pool;
  let payroll: PayrollAccessService;
  let repository: PayrollRepository;
  let matrices: ApprovalMatrixAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for payroll integration tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    const module: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, AuditModule, AuthorizationModule, PayrollModule],
    }).compile();
    payroll = module.get(PayrollAccessService);
    repository = module.get(PayrollRepository);
    matrices = module.get(ApprovalMatrixAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncatePayrollTables(pool);
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

  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedActor(withGrant = true) {
    const login = normalizeLoginIdentifier(`pay-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    if (withGrant) {
      await grantPayrollAdmin(pool, identityId);
    }
    return { identityId, sessionId: 'test-session' };
  }

  async function seedSodPair() {
    const originator = await seedActor();
    const checker = await seedActor();
    await enableCriticalSodFor(pool, matrices, [originator.identityId, checker.identityId]);
    return { originator, checker };
  }

  async function seedPeriod(actor: { identityId: string; sessionId: string }) {
    const contractA = await payroll.createContract(actor, {
      unitId: UNIT,
      code: 'CTR-A',
      displayName: 'Contract A',
      startsOn: '2026-01-01',
    });
    const contractB = await payroll.createContract(actor, {
      unitId: UNIT,
      code: 'CTR-B',
      displayName: 'Contract B',
      startsOn: '2026-01-01',
    });
    const period = await payroll.openPeriod(actor, {
      unitId: UNIT,
      competenceYear: 2026,
      competenceMonth: 9,
      startsOn: '2026-09-01',
      endsOn: '2026-09-30',
    });
    return { contractA, contractB, period };
  }

  it('opens a competence period, records conceptual events, and isolates calculation by contract', async () => {
    const actor = await seedActor();
    const { contractA, contractB, period } = await seedPeriod(actor);
    const journalsBefore = await countRows(pool, 'acc.journal_entries');
    const workforceBefore = await countRows(pool, 'wrk.workforce_members');
    await payroll.recordEvent(actor, {
      unitId: UNIT,
      payrollPeriodId: period.id,
      employmentContractId: contractA.id,
      eventKind: PAYROLL_EVENT_KINDS.Earning,
      amount: '1000.0000',
      componentLabel: 'TEST_SALARY',
      description: 'Conceptual earning',
      idempotencyKey: `earn-a-${crypto.randomUUID()}`,
    });
    await payroll.recordEvent(actor, {
      unitId: UNIT,
      payrollPeriodId: period.id,
      employmentContractId: contractA.id,
      eventKind: PAYROLL_EVENT_KINDS.Deduction,
      amount: '100.0000',
      componentLabel: 'TEST_ADVANCE',
      description: 'Conceptual deduction',
      idempotencyKey: `ded-a-${crypto.randomUUID()}`,
    });
    await payroll.recordEvent(actor, {
      unitId: UNIT,
      payrollPeriodId: period.id,
      employmentContractId: contractB.id,
      eventKind: PAYROLL_EVENT_KINDS.EmployerCharge,
      amount: '80.0000',
      componentLabel: 'TEST_CHARGE',
      description: 'Conceptual employer charge',
      idempotencyKey: `chg-b-${crypto.randomUUID()}`,
    });
    await expect(
      payroll.recordEvent(actor, {
        unitId: UNIT,
        payrollPeriodId: period.id,
        employmentContractId: contractA.id,
        eventKind: PAYROLL_EVENT_KINDS.Earning,
        amount: '50.0000',
        componentLabel: 'INSS',
        description: 'Invented official formula',
        idempotencyKey: `inss-${crypto.randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: PAYROLL_ERROR_CODES.FORMULA_NOT_DECIDED });
    await expect(
      payroll.recordEvent(actor, {
        unitId: UNIT,
        payrollPeriodId: period.id,
        employmentContractId: contractA.id,
        eventKind: PAYROLL_EVENT_KINDS.Earning,
        amount: '50.0000',
        componentLabel: 'TEST_FROM_LABOR',
        description: 'Labor assignment is not payroll',
        idempotencyKey: `lab-${crypto.randomUUID()}`,
        sourceKind: 'LABOR_ASSIGNMENT',
      }),
    ).rejects.toMatchObject({ code: PAYROLL_ERROR_CODES.OPERATIONS_COUPLING_FORBIDDEN });
    const calculated = await payroll.calculatePeriod(actor, period.id, UNIT);
    expect(calculated.period.status).toBe('CALCULATED');
    const resultA = calculated.results.find((row) => row.employmentContractId === contractA.id);
    const resultB = calculated.results.find((row) => row.employmentContractId === contractB.id);
    expect(resultA?.netTotal).toBe('900');
    expect(resultA?.employerChargeTotal).toBe('0');
    expect(resultB?.employerChargeTotal).toBe('80');
    expect(resultB?.netTotal).toBe('0');
    expect(await countRows(pool, 'acc.journal_entries')).toBe(journalsBefore);
    expect(await countRows(pool, 'wrk.workforce_members')).toBe(workforceBefore);
    expect(await countPayrollClosedEvents(pool, period.id)).toBe(0);
  });

  it('treats the same payroll event as idempotent and serializes concurrent duplicates', async () => {
    const actor = await seedActor();
    const { contractA, period } = await seedPeriod(actor);
    const key = `dup-${crypto.randomUUID()}`;
    const payload = {
      unitId: UNIT,
      payrollPeriodId: period.id,
      employmentContractId: contractA.id,
      eventKind: PAYROLL_EVENT_KINDS.Earning,
      amount: '250.0000',
      componentLabel: 'TEST_DUP',
      description: 'Duplicate',
      idempotencyKey: key,
    };
    const first = await payroll.recordEvent(actor, payload);
    const second = await payroll.recordEvent(actor, payload);
    expect(second.idempotent).toBe(true);
    expect(second.id).toBe(first.id);
    expect(await repository.countEventsByIdempotency(period.id, key)).toBe(1);
    const concurrentKey = `con-${crypto.randomUUID()}`;
    const concurrentPayload = { ...payload, idempotencyKey: concurrentKey };
    const results = await Promise.allSettled([
      payroll.recordEvent(actor, concurrentPayload),
      payroll.recordEvent(actor, concurrentPayload),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    expect(fulfilled).toHaveLength(2);
    const ids = fulfilled.map((result) =>
      result.status === 'fulfilled' ? result.value.id : '',
    );
    expect(ids[0]).toBe(ids[1]);
    expect(await repository.countEventsByIdempotency(period.id, concurrentKey)).toBe(1);
  });

  it('makes a CLOSED period immutable and requires authorized reopen for correction', async () => {
    const { originator: actor, checker } = await seedSodPair();
    const { contractA, period } = await seedPeriod(actor);
    await payroll.recordEvent(actor, {
      unitId: UNIT,
      payrollPeriodId: period.id,
      employmentContractId: contractA.id,
      eventKind: PAYROLL_EVENT_KINDS.Earning,
      amount: '400.0000',
      componentLabel: 'TEST_CLOSE',
      description: 'Close path',
      idempotencyKey: `cls-${crypto.randomUUID()}`,
    });
    await expect(payroll.closePeriodAuthorized(actor, period.id, UNIT)).rejects.toMatchObject({
      code: PAYROLL_ERROR_CODES.PERIOD_NOT_CALCULATED,
    });
    await payroll.calculatePeriod(actor, period.id, UNIT);
    const closed = await payroll.closePeriodAuthorized(checker, period.id, UNIT);
    expect(closed.status).toBe('CLOSED');
    const concurrent = await Promise.allSettled([
      payroll.closePeriodAuthorized(checker, period.id, UNIT),
      payroll.closePeriodAuthorized(checker, period.id, UNIT),
    ]);
    expect(concurrent.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    await expect(
      payroll.recordEvent(actor, {
        unitId: UNIT,
        payrollPeriodId: period.id,
        employmentContractId: contractA.id,
        eventKind: PAYROLL_EVENT_KINDS.Earning,
        amount: '10.0000',
        componentLabel: 'TEST_AFTER_CLOSE',
        description: 'Closed',
        idempotencyKey: `after-${crypto.randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: PAYROLL_ERROR_CODES.PERIOD_CLOSED });
    await expect(payroll.calculatePeriod(actor, period.id, UNIT)).rejects.toMatchObject({
      code: PAYROLL_ERROR_CODES.PERIOD_CLOSED,
    });
    const reopened = await payroll.reopenPeriod(actor, period.id, UNIT);
    expect(reopened.status).toBe('OPEN');
    const extra = await payroll.recordEvent(actor, {
      unitId: UNIT,
      payrollPeriodId: period.id,
      employmentContractId: contractA.id,
      eventKind: PAYROLL_EVENT_KINDS.Deduction,
      amount: '40.0000',
      componentLabel: 'TEST_ADJUST',
      description: 'After reopen',
      idempotencyKey: `adj-${crypto.randomUUID()}`,
    });
    expect(extra.idempotent).toBe(false);
    expect(await countPayrollClosedEvents(pool, period.id)).toBe(0);
  });

  it('denies unauthorized payroll actions and writes close/calculate audit', async () => {
    const admin = await seedActor(true);
    const stranger = await seedActor(false);
    const { contractA, period } = await seedPeriod(admin);
    await expect(
      payroll.recordEvent(stranger, {
        unitId: UNIT,
        payrollPeriodId: period.id,
        employmentContractId: contractA.id,
        eventKind: PAYROLL_EVENT_KINDS.Earning,
        amount: '1.0000',
        componentLabel: 'TEST_DENIED',
        description: 'Denied',
        idempotencyKey: `deny-${crypto.randomUUID()}`,
      }),
    ).rejects.toBeInstanceOf(PayrollHttpException);
    await payroll.recordEvent(admin, {
      unitId: UNIT,
      payrollPeriodId: period.id,
      employmentContractId: contractA.id,
      eventKind: PAYROLL_EVENT_KINDS.Earning,
      amount: '12.0000',
      componentLabel: 'TEST_AUDIT',
      description: 'Audit',
      idempotencyKey: `aud-${crypto.randomUUID()}`,
    });
    await payroll.calculatePeriod(admin, period.id, UNIT);
    const checker = await seedActor(true);
    await enableCriticalSodFor(pool, matrices, [admin.identityId, checker.identityId]);
    await payroll.closePeriodAuthorized(checker, period.id, UNIT);
    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM audit.security_audit_events WHERE resource_id = $1`,
      [period.id],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining(['security:payroll:calculate', 'security:payroll:period-close']),
    );
  });
});

async function countRows(pool: Pool, qualifiedTable: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ${qualifiedTable}`,
  );
  return Number(result.rows[0]?.count ?? '0');
}

/**
 * Conta eventos de fechamento de UM período.
 *
 * `evt.domain_events` é trilha de auditoria APPEND-ONLY — o banco recusa DELETE, e
 * apagar auditoria para "limpar" teste seria violar uma invariante do produto. Por isso
 * a contagem é ESCOPADA ao período do teste: a asserção continua significando "este
 * fechamento não produziu evento", sem depender de o banco estar globalmente vazio.
 */
async function countPayrollClosedEvents(pool: Pool, payrollPeriodId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM evt.domain_events
     WHERE event_type::text = 'PAYROLL_CLOSED'
       AND aggregate_id = $1::uuid`,
    [payrollPeriodId],
  );
  return Number(result.rows[0]?.count ?? '0');
}
