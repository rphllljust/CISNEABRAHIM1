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
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AgingAccessService } from '../analytics/services/aging-access.service';
import { toBusinessCalendarDate } from '../analytics/domain/business-timezone';
import { AuditModule } from '../audit/audit.module';
import { applyAuthTestEnv } from '../auth/test/auth-test-env';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import { DocumentsModule } from '../documents/documents.module';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { compareMoneyAmounts } from '../platform/kernel/money-math';
import { BackgroundJobsModule } from '../platform/background-jobs/background-jobs.module';
import { bindFinancialChain, type BoundFinancialChain } from '../finance/testing/financial-chain.fixture';
import { REPORT_TYPES } from './domain/report-type';
import { ReportsModule } from './reports.module';
import { ReportDataService } from './services/report-data.service';

/**
 * PASSO 6 — fonte de dados do relatorio FinancialAging.
 * Auditoria: FinancialAging nao tem SQL tabular (buildTabularQuery -> default); as linhas
 * vem de AgingAccessService.getAgingSnapshot (Analytics), que apos a correcao FIN-SEM-001 le
 * fin.receivables + fin.settlements POSTED (awaitingPayment/overdueReceivables). Este spec
 * trava essa regressao: relatorio == snapshot Analytics == posicao financeira canonica;
 * pagamento reduz valor; documento sem recebivel nao gera linha; escopo de unidade respeitado.
 * Dinheiro somente string numeric.
 */

const TZ = 'America/Porto_Velho';

function relDate(offsetDays: number): string {
  const base = new Date(`${toBusinessCalendarDate(new Date(), TZ)}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + offsetDays);
  return base.toISOString().slice(0, 10);
}

describe('REPORTS FinancialAging data source = posicao financeira canonica (PostgreSQL real)', () => {
  let pool: Pool;
  let moduleRef: TestingModule;
  let data: ReportDataService;
  let aging: AgingAccessService;
  let chain: BoundFinancialChain;
  let actorId: string;
  let sessionId: string;
  let storageRoot: string;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required');
    }
    applyAuthTestEnv(testDatabaseUrl);
    storageRoot = await mkdtemp(join(tmpdir(), 'cisne-finaging-report-'));
    process.env['OBJECT_STORAGE_ROOT'] = storageRoot;
    process.env['OBJECT_STORAGE_PROVIDER'] = 'filesystem';
    moduleRef = await Test.createTestingModule({
      imports: [
        DatabaseModule,
        AuthorizationModule,
        AnalyticsModule,
        AuditModule,
        DocumentsModule,
        BackgroundJobsModule,
        ReportsModule,
      ],
    }).compile();
    data = moduleRef.get(ReportDataService);
    aging = moduleRef.get(AgingAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateFinanceTables(pool);
    await truncateBillingTables(pool);
    await truncateServiceOrderTables(pool);
    await truncateClientTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const identity = await insertIdentity(pool, `finrep-${suffix}`);
    actorId = identity.identityId;
    sessionId = `sid-finrep-${suffix}`;
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

  afterAll(async () => {
    delete process.env['OBJECT_STORAGE_ROOT'];
    delete process.env['OBJECT_STORAGE_PROVIDER'];
    if (pool) {
      await truncateFinanceTables(pool);
      await truncateBillingTables(pool);
      await truncateServiceOrderTables(pool);
      await truncateClientTables(pool);
      await truncateIdentityAndAuthorizationTables(pool);
    }
    await pool?.end();
    await rm(storageRoot, { recursive: true, force: true });
    await moduleRef?.close();
  });

  async function reportRow(bucket: string): Promise<{ count: number; amount: string | null } | undefined> {
    const rows = await data.loadRows(
      { identityId: actorId, sessionId },
      REPORT_TYPES.FinancialAging,
      {},
      20,
      0,
    );
    const row = rows.find((item) => item['bucket'] === bucket);
    if (!row) {
      return undefined;
    }
    return { count: row['count'] as number, amount: (row['amount'] as string | null) ?? null };
  }

  it('FinancialAging vem da posicao canonica: pagamento reduz valor; doc sem recebivel ausente; countRows coerente', async () => {
    // vencido parcial: saldo residual 1000 - 300 = 700
    await chain.chain({ unit: 'fa-overdue', principal: '1000.0000', dueDate: relDate(-4), settlements: ['300.0000'] });
    // a vencer aberto
    await chain.chain({ unit: 'fa-open', principal: '500.0000', dueDate: relDate(6) });
    // documento CANCELLED sem recebivel: nao pode gerar aging de recebivel
    const clientId = await chain.newClient('fa-doc-only');
    const soId = await chain.newServiceOrder('fa-doc-only');
    const mId = await chain.newMeasurement(soId, 'fa-doc-only');
    const brId = await chain.billingRecord(soId, clientId, 'fa-doc-only', '500.0000');
    await chain.billingDocument(brId, soId, mId, clientId, 'fa-doc-only', '500.0000', relDate(-10));

    const overdue = await reportRow('overdue_receivables');
    expect(overdue?.count).toBe(1);
    expect(overdue?.amount).not.toBeNull();
    expect(compareMoneyAmounts(overdue!.amount!, '700.0000')).toBe(0); // 1000 - 300 (POSTED)
    const awaiting = await reportRow('awaiting_payment');
    expect(awaiting?.count).toBe(1);
    expect(awaiting?.amount).not.toBeNull();
    expect(compareMoneyAmounts(awaiting!.amount!, '500.0000')).toBe(0);

    // Igual ao snapshot Analytics (mesma fonte; nenhum billing_documents FINALIZED contado).
    const snap = await aging.getAgingSnapshot({ identityId: actorId, sessionId });
    expect(snap.financial.overdueReceivables.count).toBe(overdue?.count);
    expect(compareMoneyAmounts(snap.financial.overdueReceivables.totalAmount ?? '', overdue!.amount!)).toBe(0);
    expect(snap.financial.awaitingPayment.count).toBe(awaiting?.count);
    expect(compareMoneyAmounts(snap.financial.awaitingPayment.totalAmount ?? '', awaiting!.amount!)).toBe(0);

    const total = await data.countRows(
      { identityId: actorId, sessionId },
      REPORT_TYPES.FinancialAging,
      {},
    );
    expect(total).toBe(4); // buckets fixos (awaiting_preparation, prepared, awaiting_payment, overdue_receivables)
  });

  it('FinancialAging respeita escopo de unidade do ator (mesma regra do snapshot Analytics)', async () => {
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: 'fa-unit-a' });
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: 'fa-unit-b' });
    await chain.chain({ unit: 'fa-unit-a', principal: '100.0000', dueDate: relDate(-6) });
    await chain.chain({ unit: 'fa-unit-b', principal: '200.0000', dueDate: relDate(-6) });

    const unitIdentity = await insertIdentity(pool, `finrep-unit-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`);
    await insertGrant(pool, {
      identityId: unitIdentity.identityId,
      action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderList,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Unit,
      resourceId: 'fa-unit-a',
      grantedByIdentityId: unitIdentity.identityId,
    });
    await insertGrant(pool, {
      identityId: unitIdentity.identityId,
      action: AUTHZ_ACTIONS.BillingBillingRecordRead,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Unit,
      resourceId: 'fa-unit-a',
      grantedByIdentityId: unitIdentity.identityId,
    });

    const rows = await data.loadRows(
      { identityId: unitIdentity.identityId, sessionId },
      REPORT_TYPES.FinancialAging,
      {},
      20,
      0,
    );
    const overdue = rows.find((item) => item['bucket'] === 'overdue_receivables');
    expect(overdue?.['count']).toBe(1);
    expect(compareMoneyAmounts((overdue?.['amount'] as string) ?? '', '100.0000')).toBe(0);
  });
});
