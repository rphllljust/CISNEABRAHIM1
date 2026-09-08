import {
  insertGrant,
  insertIdentity,
  insertScopeRef,
  truncateBillingTables,
  truncateClientTables,
  truncateFinanceTables,
  truncateIdentityAndAuthorizationTables,
  truncateServiceOrderTables,
} from '@cisne/database';
import { Test, TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AgingAccessService } from '../analytics/services/aging-access.service';
import { prefixScopeAlias } from '../analytics/repositories/aging-scope';
import { toBusinessCalendarDate } from '../analytics/domain/business-timezone';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AuthorizationRepository } from '../authorization/repositories/authorization.repository';
import { ScopeEnforcementService } from '../authorization/services/scope-enforcement.service';
import type { ScopeSqlPredicate } from '../authorization/services/scope-enforcement.service';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import { ExecutiveDashboardRepository } from '../dashboard/repositories/executive-dashboard.repository';
import { applyAuthTestEnv } from '../auth/test/auth-test-env';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { compareMoneyAmounts } from '../platform/kernel/money-math';
import { AgingReadModelRepository } from '../analytics/repositories/aging-read-model.repository';
import {
  buildAwaitingReceivableAggregateSql,
  buildOverdueReceivableAggregateSql,
} from './domain/receivable-aging-sql';
import { bindFinancialChain, type BoundFinancialChain } from './testing/financial-chain.fixture';

/**
 * STEP 4 — reconciliacao Finance = Analytics = Executive no MESMO dataset persistido
 * (cadeia real billing -> receivable -> settlements, sem mock).
 *
 * Oracle independente (SQL direto sobre fin.receivables + fin.settlements, sem importar
 * os builders sob teste) evita tautologia: se uma superficie voltar a contar
 * billing_documents FINALIZED (bug historico), o numero diverge do oracle e falha.
 *
 * Semantica: vencido = saldo > 0 e due_date < hoje (estrito, FIN-SEM-001);
 * a vencer (awaitingPayment) = OPEN/PARTIALLY_PAID (saldo > 0 e due_date >= hoje).
 * Dinheiro somente como string numeric (nunca TS number).
 */

const TZ = 'America/Porto_Velho';

function expectMoneyEq(actual: string | null | undefined, expected: string): void {
  expect(actual).not.toBeNull();
  expect(compareMoneyAmounts(actual ?? '', expected)).toBe(0);
}

/** Data civil (YYYY-MM-DD) de hoje + offset na janela de negocios. */
function relDate(offsetDays: number): string {
  const base = new Date(`${toBusinessCalendarDate(new Date(), TZ)}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + offsetDays);
  return base.toISOString().slice(0, 10);
}

async function scopeFromGrants(
  authorization: AuthorizationRepository,
  scopeEnforcement: ScopeEnforcementService,
  identityId: string,
  action: (typeof AUTHZ_ACTIONS)[keyof typeof AUTHZ_ACTIONS],
  alias?: 'so' | 'bd',
): Promise<ScopeSqlPredicate> {
  const grants = await authorization.findActiveGrants(identityId, action, AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder);
  const predicate = scopeEnforcement.buildServiceOrderListFilter(grants);
  return alias ? prefixScopeAlias(predicate, alias) : predicate;
}

describe('FINANCIAL aging reconciliation Finance = Analytics = Executive (PostgreSQL real)', () => {
  let pool: Pool;
  let moduleRef: TestingModule;
  let aging: AgingAccessService;
  let executive: ExecutiveDashboardRepository;
  let authorization: AuthorizationRepository;
  let scopeEnforcement: ScopeEnforcementService;
  let chain: BoundFinancialChain;
  let actorId: string;
  let sessionId: string;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required');
    }
    applyAuthTestEnv(testDatabaseUrl);
    process.env['AGING_BUCKET_BANDS'] = '0-30,31-60,61-90,90-*'; // exec so expoe buckets quando policy configurada
    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, AuthorizationModule],
      providers: [AgingReadModelRepository, AgingAccessService, ExecutiveDashboardRepository],
    }).compile();
    aging = moduleRef.get(AgingAccessService);
    executive = moduleRef.get(ExecutiveDashboardRepository);
    authorization = moduleRef.get(AuthorizationRepository);
    scopeEnforcement = moduleRef.get(ScopeEnforcementService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  afterAll(async () => {
    delete process.env['AGING_BUCKET_BANDS'];
    if (pool) {
      // Remove residuos do proprio processo para nao contaminar outras suites na mesma base.
      await truncateFinanceTables(pool);
      await truncateBillingTables(pool);
      await truncateServiceOrderTables(pool);
      await truncateClientTables(pool);
      await truncateIdentityAndAuthorizationTables(pool);
    }
    await pool?.end();
    await moduleRef?.close();
  });

  beforeEach(async () => {
    await truncateFinanceTables(pool);
    await truncateBillingTables(pool);
    await truncateServiceOrderTables(pool);
    await truncateClientTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const identity = await insertIdentity(pool, `recfin-${suffix}`);
    actorId = identity.identityId;
    sessionId = `sid-recfin-${suffix}`;
    await insertGrant(pool, {
      identityId: actorId,
      action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderList,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: actorId,
    });
    await insertGrant(pool, {
      identityId: actorId,
      action: AUTHZ_ACTIONS.BillingBillingRecordRead,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: actorId,
    });
    chain = bindFinancialChain(pool, actorId, suffix);
  }, 60_000);

  async function oracleOverdueAndAwaiting(unit: string | null): Promise<{
    overdueCount: number;
    overdueAmount: string;
    awaitingCount: number;
    awaitingAmount: string;
  }> {
    const today = toBusinessCalendarDate(new Date(), TZ);
    const result = await pool.query<{
      overdue_count: number;
      overdue_amount: string;
      awaiting_count: number;
      awaiting_amount: string;
    }>(
      `WITH pos AS (
         SELECT r.unit_id, r.due_date,
                r.principal - COALESCE(
                  (SELECT SUM(s.amount)
                   FROM fin.settlements s
                   WHERE s.receivable_id = r.id AND s.status = 'POSTED'),
                  0
                ) AS remaining
         FROM fin.receivables r
         WHERE r.lifecycle = 'ACTIVE'
           AND ($1::text IS NULL OR r.unit_id = $1)
       )
       SELECT COUNT(*) FILTER (
                WHERE remaining > 0 AND due_date < '${today}'::date
              )::int AS overdue_count,
              COALESCE(SUM(remaining) FILTER (
                WHERE remaining > 0 AND due_date < '${today}'::date
              ), 0)::text AS overdue_amount,
              COUNT(*) FILTER (
                WHERE remaining > 0 AND due_date >= '${today}'::date
              )::int AS awaiting_count,
              COALESCE(SUM(remaining) FILTER (
                WHERE remaining > 0 AND due_date >= '${today}'::date
              ), 0)::text AS awaiting_amount
       FROM pos`,
      [unit],
    );
    return {
      overdueCount: result.rows[0]!.overdue_count,
      overdueAmount: result.rows[0]!.overdue_amount,
      awaitingCount: result.rows[0]!.awaiting_count,
      awaitingAmount: result.rows[0]!.awaiting_amount,
    };
  }

  async function financeAggregates() {
    const [overdue, awaiting] = await Promise.all([
      pool.query<{ count: number; total_amount: string }>(
        buildOverdueReceivableAggregateSql({ scopeClause: 'TRUE', tzParam: '$1' }),
        [TZ],
      ),
      pool.query<{ count: number; total_amount: string }>(
        buildAwaitingReceivableAggregateSql({ scopeClause: 'TRUE', tzParam: '$1' }),
        [TZ],
      ),
    ]);
    return {
      overdueCount: overdue.rows[0]?.count ?? 0,
      overdueAmount: overdue.rows[0]?.total_amount ?? null,
      awaitingCount: awaiting.rows[0]?.count ?? 0,
      awaitingAmount: awaiting.rows[0]?.total_amount ?? null,
    };
  }

  async function executiveFinancial(unitActorId: string | null) {
    const serviceOrderScope = await scopeFromGrants(
      authorization,
      scopeEnforcement,
      unitActorId ?? actorId,
      AUTHZ_ACTIONS.ServiceOrdersServiceOrderList,
    );
    const billingDocumentScope = await scopeFromGrants(
      authorization,
      scopeEnforcement,
      unitActorId ?? actorId,
      AUTHZ_ACTIONS.BillingBillingRecordRead,
      'bd',
    );
    const chart = await executive.loadChartData({
      serviceOrderScope,
      billingDocumentScope,
      unitId: undefined,
      fromInclusive: new Date(Date.now() - 60 * 86_400_000),
      toExclusive: new Date(Date.now() + 60 * 86_400_000),
      businessTimezone: TZ,
    });
    return {
      count: chart.overdueReceivablesCount,
      amount: chart.overdueReceivablesAmount,
      available: chart.financialAgingAvailable,
    };
  }

  it('reconcilia Finance = Analytics = Executive no mesmo dataset (vencido e a vencer, pagamentos, estorno, cancelado, pago, doc sem recebivel)', async () => {
    // a vencer (awaiting): OPEN + PARTIALLY_PAID
    await chain.chain({ unit: 'rec-open', principal: '1000.0000', dueDate: relDate(10) });
    await chain.chain({ unit: 'rec-partial', principal: '1000.0000', dueDate: relDate(10), settlements: ['400.0000'] });
    await chain.chain({ unit: 'rec-multi', principal: '1000.0000', dueDate: relDate(2), settlements: ['200.0000', '300.0000'] });
    // vencido (saldo residual > 0)
    await chain.chain({ unit: 'rec-overdue', principal: '1200.0000', dueDate: relDate(-3) });
    await chain.chain({ unit: 'rec-overdue-part', principal: '800.0000', dueDate: relDate(-3), settlements: ['200.0000'] });
    const reversal = await chain.chain({ unit: 'rec-reversal', principal: '600.0000', dueDate: relDate(-2), settlements: ['600.0000'] });
    await chain.removeSettlements(reversal); // estorno: volta a vencido integral
    // excluidos: pago integral e cancelado
    await chain.chain({ unit: 'rec-paid', principal: '500.0000', dueDate: relDate(-5), settlements: ['500.0000'] });
    await chain.chain({ unit: 'rec-cancelled', principal: '700.0000', dueDate: relDate(-10), lifecycle: 'CANCELLED' });
    // documento sem recebivel: nunca entra na posicao
    const clientId = await chain.newClient('rec-doc-only');
    const soId = await chain.newServiceOrder('rec-doc-only');
    const mId = await chain.newMeasurement(soId, 'rec-doc-only');
    const brId = await chain.billingRecord(soId, clientId, 'rec-doc-only', '500.0000');
    await chain.billingDocument(brId, soId, mId, clientId, 'rec-doc-only', '500.0000', relDate(-14));
    expect(await chain.positionsCountForUnit('rec-doc-only')).toBe(0);

    const oracle = await oracleOverdueAndAwaiting(null);
    expect(oracle.overdueCount).toBe(3); // overdue + overdue-part + reversal
    expectMoneyEq(oracle.overdueAmount, '2400.0000');
    expect(oracle.awaitingCount).toBe(3); // open + partial + multi
    expectMoneyEq(oracle.awaitingAmount, '2100.0000');

    // Finance (builders canonicos)
    const finance = await financeAggregates();
    expect(finance.overdueCount).toBe(oracle.overdueCount);
    expectMoneyEq(finance.overdueAmount, oracle.overdueAmount);
    expect(finance.awaitingCount).toBe(oracle.awaitingCount);
    expectMoneyEq(finance.awaitingAmount, oracle.awaitingAmount);

    // Analytics (AgingAccessService.getAgingSnapshot)
    const snap = await aging.getAgingSnapshot({ identityId: actorId, sessionId });
    expect(snap.financial.overdueReceivables.count).toBe(oracle.overdueCount);
    expectMoneyEq(snap.financial.overdueReceivables.totalAmount, oracle.overdueAmount);
    expect(snap.financial.awaitingPayment.count).toBe(oracle.awaitingCount);
    expectMoneyEq(snap.financial.awaitingPayment.totalAmount, oracle.awaitingAmount);

    // Executive (ExecutiveDashboardRepository.loadChartData)
    const exec = await executiveFinancial(null);
    expect(exec.available).toBe(true);
    expect(exec.count).toBe(oracle.overdueCount);
    expectMoneyEq(exec.amount, oracle.overdueAmount);
  });

  it('isola por escopo de unidade em Analytics e Executive (sem vazar outra unidade)', async () => {
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: 'rec-unit-a' });
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: 'rec-unit-b' });
    await chain.chain({ unit: 'rec-unit-a', principal: '100.0000', dueDate: relDate(-6) });
    await chain.chain({ unit: 'rec-unit-b', principal: '200.0000', dueDate: relDate(-6) });

    const oracleGlobal = await oracleOverdueAndAwaiting(null);
    expect(oracleGlobal.overdueCount).toBe(2);
    expectMoneyEq(oracleGlobal.overdueAmount, '300.0000');
    const oracleA = await oracleOverdueAndAwaiting('rec-unit-a');
    expect(oracleA.overdueCount).toBe(1);
    expectMoneyEq(oracleA.overdueAmount, '100.0000');

    // Ator com escopo UNIT A nao ve a unidade B
    const unitIdentity = await insertIdentity(pool, `recfin-unit-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`);
    await insertGrant(pool, {
      identityId: unitIdentity.identityId,
      action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderList,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Unit,
      resourceId: 'rec-unit-a',
      grantedByIdentityId: unitIdentity.identityId,
    });
    await insertGrant(pool, {
      identityId: unitIdentity.identityId,
      action: AUTHZ_ACTIONS.BillingBillingRecordRead,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Unit,
      resourceId: 'rec-unit-a',
      grantedByIdentityId: unitIdentity.identityId,
    });

    const snapA = await aging.getAgingSnapshot({ identityId: unitIdentity.identityId, sessionId });
    expect(snapA.financial.overdueReceivables.count).toBe(oracleA.overdueCount);
    expectMoneyEq(snapA.financial.overdueReceivables.totalAmount, oracleA.overdueAmount);
    expect(snapA.financial.awaitingPayment.count).toBe(0);
    expect(snapA.financial.awaitingPayment.totalAmount).toBeNull();

    const execA = await executiveFinancial(unitIdentity.identityId);
    expect(execA.available).toBe(true);
    expect(execA.count).toBe(oracleA.overdueCount);
    expectMoneyEq(execA.amount, oracleA.overdueAmount);

    const execGlobal = await executiveFinancial(null);
    expect(execGlobal.count).toBe(oracleGlobal.overdueCount);
    expectMoneyEq(execGlobal.amount, oracleGlobal.overdueAmount);
  });
});
