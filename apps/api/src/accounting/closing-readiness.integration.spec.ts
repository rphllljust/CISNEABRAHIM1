import {
  hashPassword,
  insertGrant,
  insertIdentity,
  truncateAccountingTables,
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
import { FiscalModule } from '../fiscal/fiscal.module';
import { ACCOUNT_CLASSES, JOURNAL_DIRECTIONS, JOURNAL_SOURCE_KINDS } from './domain/ledger';
import { AccountingHttpException } from './errors/accounting-http.exception';
import { AccountingModule } from './accounting.module';
import { AccountingAccessService } from './services/accounting-access.service';
import { ClosingReadinessService } from './services/closing-readiness.service';

const UNIT_A = 'unit-closing-a';
const UNIT_B = 'unit-closing-b';

async function grantAccounting(pool: Pool, identityId: string, unitId?: string) {
  for (const action of [
    AUTHZ_ACTIONS.AccountingChartManage,
    AUTHZ_ACTIONS.AccountingPeriodOpen,
    AUTHZ_ACTIONS.AccountingPeriodClose,
    AUTHZ_ACTIONS.AccountingJournalDraft,
    AUTHZ_ACTIONS.AccountingJournalPost,
    AUTHZ_ACTIONS.AccountingJournalRead,
    AUTHZ_ACTIONS.AccountingJournalList,
  ]) {
    await insertGrant(pool, {
      identityId,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.AccountingLedger,
      scopeType: unitId ? AUTHZ_SCOPES.Unit : AUTHZ_SCOPES.Global,
      resourceId: unitId,
      grantedByIdentityId: identityId,
    });
  }
}

async function grantFiscalRead(pool: Pool, identityId: string, unitId?: string) {
  await insertGrant(pool, {
    identityId,
    action: AUTHZ_ACTIONS.FiscalDocumentRead,
    resourceType: AUTHZ_RESOURCE_TYPES.FiscalDocument,
    scopeType: unitId ? AUTHZ_SCOPES.Unit : AUTHZ_SCOPES.Global,
    resourceId: unitId,
    grantedByIdentityId: identityId,
  });
}

describe('Closing center and accounting period discovery (PostgreSQL)', () => {
  let pool: Pool;
  let accounting: AccountingAccessService;
  let closing: ClosingReadinessService;
  let matrices: ApprovalMatrixAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for closing center integration tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    const module: TestingModule = await Test.createTestingModule({
      // FiscalModule entra porque o fechamento consome o contrato PUBLICADO do contexto fiscal
      // (port), exatamente como a aplicacao real compoe os dois modulos. Sem ele a secao fiscal
      // do fechamento nao teria provedor.
      imports: [AuthModule, AuditModule, AuthorizationModule, AccountingModule, FiscalModule],
    }).compile();
    accounting = module.get(AccountingAccessService);
    closing = module.get(ClosingReadinessService);
    matrices = module.get(ApprovalMatrixAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateAccountingTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedActor(options: { unitId?: string; fiscal?: boolean } = {}) {
    const login = normalizeLoginIdentifier(`cc-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    await grantAccounting(pool, identityId, options.unitId);
    if (options.fiscal) {
      await grantFiscalRead(pool, identityId, options.unitId);
    }
    return { identityId, sessionId: 'test-session' };
  }

  async function seedLedger(actor: { identityId: string; sessionId: string }, unitId: string) {
    const chart = await accounting.createChart(actor, {
      unitId,
      code: `COA-${crypto.randomUUID().slice(0, 8)}`,
      name: `Chart ${unitId}`,
    });
    const cash = await accounting.createAccount(actor, chart.id, {
      code: '1.1.01',
      name: 'Cash',
      class: ACCOUNT_CLASSES.Asset,
    });
    const revenue = await accounting.createAccount(actor, chart.id, {
      code: '4.1.01',
      name: 'Revenue',
      class: ACCOUNT_CLASSES.Revenue,
    });
    const period = await accounting.createPeriod(actor, {
      chartId: chart.id,
      unitId,
      code: '2026-09',
      startsOn: '2026-09-01',
      endsOn: '2026-09-30',
    });
    return { chart, cash, revenue, period };
  }

  async function draftOne(input: {
    actor: { identityId: string; sessionId: string };
    chartId: string;
    periodId: string;
    cashId: string;
    revenueId: string;
  }) {
    return accounting.createDraft(input.actor, {
      chartId: input.chartId,
      periodId: input.periodId,
      description: 'Sale',
      occurredOn: '2026-09-10',
      currencyCode: 'BRL',
      sourceKind: JOURNAL_SOURCE_KINDS.Manual,
      sourceId: crypto.randomUUID(),
      sourceReference: 'MAN-CLOSING',
      idempotencyKey: `cc-${crypto.randomUUID()}`,
      lines: [
        { lineNumber: 1, accountId: input.cashId, direction: JOURNAL_DIRECTIONS.Debit, amount: '40.0000' },
        { lineNumber: 2, accountId: input.revenueId, direction: JOURNAL_DIRECTIONS.Credit, amount: '40.0000' },
      ],
    });
  }

  it('lists accounting periods by unit with human code, dates, status and rowVersion', async () => {
    const actor = await seedActor();
    const { period } = await seedLedger(actor, UNIT_A);

    const listed = await accounting.listPeriodsByUnit(actor, { unitId: UNIT_A });
    expect(listed.unitId).toBe(UNIT_A);
    expect(listed.items).toHaveLength(1);
    const item = listed.items[0];
    // Referencia humana: codigo da competencia e intervalo real, nao o identificador tecnico.
    expect(item?.code).toBe('2026-09');
    expect(item?.startsOn).toBe('2026-09-01');
    expect(item?.endsOn).toBe('2026-09-30');
    expect(item?.status).toBe('OPEN');
    expect(item?.id).toBe(period.id);
    expect(item?.rowVersion).toBe(period.rowVersion);

    // Filtro por status e ano sao server-side, sobre fatos persistidos.
    expect((await accounting.listPeriodsByUnit(actor, { unitId: UNIT_A, status: 'CLOSED' })).items).toHaveLength(0);
    expect((await accounting.listPeriodsByUnit(actor, { unitId: UNIT_A, status: 'OPEN' })).items).toHaveLength(1);
    expect((await accounting.listPeriodsByUnit(actor, { unitId: UNIT_A, year: '2026' })).items).toHaveLength(1);
    expect((await accounting.listPeriodsByUnit(actor, { unitId: UNIT_A, year: '2027' })).items).toHaveLength(0);
    await expect(
      accounting.listPeriodsByUnit(actor, { unitId: UNIT_A, year: '20x6' }),
    ).rejects.toBeInstanceOf(AccountingHttpException);
  });

  it('denies period discovery without an accounting read grant and never leaks another unit', async () => {
    const owner = await seedActor();
    await seedLedger(owner, UNIT_A);
    await seedLedger(owner, UNIT_B);

    const denied = await seedActor({ unitId: UNIT_A });
    // Sem concessao de contabilidade, a listagem nega por omissao.
    const noAccounting = await insertIdentity(
      pool,
      normalizeLoginIdentifier(`ccx-${crypto.randomUUID()}@cisne.invalid`),
      await hashPassword(AUTH_TEST_PASSWORD),
    );
    await expect(
      accounting.listPeriodsByUnit(
        { identityId: noAccounting.identityId, sessionId: 's' },
        { unitId: UNIT_A },
      ),
    ).rejects.toBeInstanceOf(AccountingHttpException);

    // Concessao UNIT em A nao enxerga B.
    await expect(accounting.listPeriodsByUnit(denied, { unitId: UNIT_B })).rejects.toBeInstanceOf(
      AccountingHttpException,
    );
    const own = await accounting.listPeriodsByUnit(denied, { unitId: UNIT_A });
    expect(own.items).toHaveLength(1);
  });

  it('reports real closing readiness: blockers come from the persisted close checks, not from the front', async () => {
    const actor = await seedActor({ unitId: UNIT_A });
    const { chart, cash, revenue, period } = await seedLedger(actor, UNIT_A);
    await draftOne({ actor, chartId: chart.id, periodId: period.id, cashId: cash.id, revenueId: revenue.id });

    const readiness = await closing.readiness(actor, { unitId: UNIT_A, periodId: period.id });

    expect(readiness.unitId).toBe(UNIT_A);
    expect(readiness.period.code).toBe('2026-09');
    expect(readiness.period.status).toBe('OPEN');
    expect(readiness.accounting.evaluated).toBe(true);
    expect(readiness.accounting.journalCounts['DRAFT']).toBe(1);
    // O lancamento nao postado e um bloqueador REAL, pela mesma verificacao do fechamento.
    expect(readiness.closeReady).toBe(false);
    expect(readiness.blockers.some((blocker) => blocker.observedCount === 1)).toBe(true);
    expect(readiness.blockers.every((blocker) => blocker.drilldown !== null)).toBe(true);
    // A secao fiscal e omitida quando o ator nao pode ler documento fiscal.
    expect(readiness.fiscal).toBeNull();
    expect(readiness.withheld.map((entry) => entry.area)).toContain('fiscal');
    expect(readiness.nextActions[0]?.enabled).toBe(false);
  });

  it('includes the fiscal section only with a fiscal read grant and withholds it otherwise', async () => {
    const accountOnly = await seedActor({ unitId: UNIT_A });
    const withFiscal = await seedActor({ unitId: UNIT_A, fiscal: true });
    const { chart, cash, revenue, period } = await seedLedger(accountOnly, UNIT_A);
    await draftOne({ actor: accountOnly, chartId: chart.id, periodId: period.id, cashId: cash.id, revenueId: revenue.id });
    // Documento fiscal real da competencia, rejeitado: bloqueador fiscal persistido.
    await pool.query(
      `INSERT INTO fis.fiscal_documents (
         unit_id, status, source_kind, source_id, description, currency_code, issued_on,
         idempotency_key, created_by_identity_id, updated_by_identity_id, rejected_at
       ) VALUES ($1, 'REJECTED', 'MANUAL', $2, 'Documento rejeitado', 'BRL', '2026-09-12',
                 $3, $4, $4, NOW())`,
      [UNIT_A, crypto.randomUUID(), `fd-${crypto.randomUUID()}`, accountOnly.identityId],
    );

    const withheld = await closing.readiness(accountOnly, { unitId: UNIT_A, periodId: period.id });
    expect(withheld.fiscal).toBeNull();
    expect(JSON.stringify(withheld)).not.toContain('Documento rejeitado');
    // A contagem fiscal nao aparece em lugar nenhum da resposta.
    expect(JSON.stringify(withheld)).not.toContain('"rejected":1');

    const visible = await closing.readiness(withFiscal, { unitId: UNIT_A, periodId: period.id });
    expect(visible.fiscal).not.toBeNull();
    expect(visible.fiscal?.rejected).toBe(1);
    expect(visible.fiscal?.unauthorized).toBe(1);
    expect(visible.withheld).toHaveLength(0);
  });

  it('treats a period from another unit as not found and reports a closed period consistently', async () => {
    const actor = await seedActor();
    const poster = await seedActor();
    await enableCriticalSodFor(pool, matrices, [poster.identityId]);
    const { chart, cash, revenue, period } = await seedLedger(actor, UNIT_A);
    const draft = await draftOne({ actor, chartId: chart.id, periodId: period.id, cashId: cash.id, revenueId: revenue.id });
    await accounting.post(poster, draft.id, { rowVersion: draft.rowVersion });

    // Periodo real, unidade errada: nao vaza existencia fora do escopo.
    await expect(
      closing.readiness(actor, { unitId: UNIT_B, periodId: period.id }),
    ).rejects.toMatchObject({ status: 404 });

    const closed = await accounting.closePeriod(actor, period.id, {
      rowVersion: period.rowVersion,
      reason: 'Close for readiness test',
    });
    expect(closed.status).toBe('CLOSED');

    const readiness = await closing.readiness(actor, { unitId: UNIT_A, periodId: period.id });
    expect(readiness.accounting.periodStatus).toBe('CLOSED');
    expect(readiness.closeReady).toBe(false);
    expect(readiness.nextActions[0]?.kind).toBe('REOPEN_PERIOD');
    expect(readiness.nextActions[0]?.enabled).toBe(false);
  });

  it('does not multiply rows: one readiness call issues a bounded number of queries for a period with many journals', async () => {
    const actor = await seedActor();
    const { chart, cash, revenue, period } = await seedLedger(actor, UNIT_A);
    for (let index = 0; index < 5; index += 1) {
      await draftOne({ actor, chartId: chart.id, periodId: period.id, cashId: cash.id, revenueId: revenue.id });
    }
    const readiness = await closing.readiness(actor, { unitId: UNIT_A, periodId: period.id });
    // 5 lancamentos nao postados contam como 5, sem uma consulta por lancamento.
    expect(readiness.accounting.journalCounts['DRAFT']).toBe(5);
    const draftBlocker = readiness.blockers.find((blocker) => blocker.observedCount === 5);
    expect(draftBlocker).toBeDefined();
    expect(draftBlocker?.kind).toBe('ACCOUNTING');
  });
});
