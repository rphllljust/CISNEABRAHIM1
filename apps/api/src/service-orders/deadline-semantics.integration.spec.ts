import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import {
  insertGrant,
  insertIdentity,
  truncateIdentityAndAuthorizationTables,
  truncateServiceOrderTables,
} from '@cisne/database';
import { applyAuthTestEnv } from '../auth/test/auth-test-env';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AgingAccessService } from '../analytics/services/aging-access.service';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { ExecutiveDashboardRepository } from '../dashboard/repositories/executive-dashboard.repository';
import { OperationalDashboardRepository } from '../dashboard/repositories/operational-dashboard.repository';
import { ExecutiveDashboardAccessService } from '../dashboard/services/executive-dashboard-access.service';
import { OperationalDashboardAccessService } from '../dashboard/services/operational-dashboard-access.service';
import { resolveApproachingDueDays } from './domain/deadline-semantics';

const UNIT = 'unit-deadline-kernel';
const hour = 3_600_000;

describe('DEADLINE SEMANTIC KERNEL — fronteira, timezone, status e reconciliação (PostgreSQL)', () => {
  let pool: Pool;
  let aging: AgingAccessService;
  let executive: ExecutiveDashboardAccessService;
  let actor: { identityId: string; sessionId: string };
  let seedNow = Date.now();
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for deadline kernel tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);

    const module: TestingModule = await Test.createTestingModule({
      imports: [DatabaseModule, AuthorizationModule, AnalyticsModule],
      providers: [
        OperationalDashboardRepository,
        ExecutiveDashboardRepository,
        OperationalDashboardAccessService,
        ExecutiveDashboardAccessService,
      ],
    }).compile();

    aging = module.get(AgingAccessService);
    executive = module.get(ExecutiveDashboardAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateServiceOrderTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);

    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const identity = await insertIdentity(pool, `deadline-${suffix}`);
    actor = { identityId: identity.identityId, sessionId: 'sid-deadline' };

    const grants: Array<[string, string]> = [
      [AUTHZ_ACTIONS.RequestsServiceRequestList, AUTHZ_RESOURCE_TYPES.RequestsServiceRequest],
      [AUTHZ_ACTIONS.ServiceOrdersServiceOrderList, AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder],
      [AUTHZ_ACTIONS.MeasurementsMeasurementRead, AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder],
      [AUTHZ_ACTIONS.BillingBillingRecordRead, AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder],
      [AUTHZ_ACTIONS.ServiceOrdersResourceAllocationRead, AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder],
      [AUTHZ_ACTIONS.ServiceOrdersExecutionRead, AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder],
      [AUTHZ_ACTIONS.DocumentsDocumentList, AUTHZ_RESOURCE_TYPES.DocumentsDocument],
    ];
    for (const [action, resourceType] of grants) {
      await insertGrant(pool, {
        identityId: actor.identityId,
        action,
        resourceType,
        scopeType: AUTHZ_SCOPES.Global,
        grantedByIdentityId: actor.identityId,
      });
    }

    seedNow = Date.now();
  }, 30_000);

  afterAll(async () => {
    await pool?.end();
  });

  async function seedOsWithWindow(input: {
    orderNumber: string;
    status: 'IN_EXECUTION' | 'COMPLETED';
    plannedStatus?: 'PLANNED' | 'REMOVED';
    windowEndOffsetMs?: number;
  }): Promise<string> {
    const now = new Date(seedNow);
    const startedAt = new Date(now.getTime() - 2 * hour).toISOString();
    const completedAt =
      input.status === 'COMPLETED' ? new Date(now.getTime() - 3 * hour).toISOString() : null;
    const result = await pool.query<{ id: string }>(
      `INSERT INTO so.service_orders (
         internal_code, order_number, unit_id, status, origin, service_snapshot,
         client_snapshot, started_at, completed_at, row_version,
         created_by_identity_id, updated_by_identity_id
       ) VALUES ($1, $2, $3, $4, 'AUTHORIZED_DIRECT', '{}'::jsonb, '{}'::jsonb, $5, $6, 1, $7, $7)
       RETURNING id`,
      [
        `SO-DL-${input.orderNumber}`,
        input.orderNumber,
        UNIT,
        input.status,
        startedAt,
        completedAt,
        actor.identityId,
      ],
    );
    const id = result.rows[0]?.id;
    if (!id) {
      throw new Error('SO insert failed');
    }
    const end = new Date(seedNow + (input.windowEndOffsetMs ?? 0));
    await pool.query(
      `INSERT INTO so.planned_resources (
         service_order_id, requirement_kind, resource_type_code, planned_quantity,
         operational_start, operational_end, status, row_version,
         created_by_identity_id, updated_by_identity_id
       ) VALUES ($1, 'PHYSICAL_RESOURCE', 'TRK', 1, $2, $3, $4, 1, $5, $5)`,
      [id, new Date(end.getTime() - hour), end, input.plannedStatus ?? 'PLANNED', actor.identityId],
    );
    return id;
  }

  async function groundTruth(): Promise<{ overdue: number; approaching: number }> {
    const result = await pool.query<{ overdue: string; approaching: string }>(
      `SELECT
         COUNT(*) FILTER (
           WHERE status NOT IN ('COMPLETED','CANCELLED')
             AND so.deadline_for(so.id) IS NOT NULL
             AND so.deadline_for(so.id) <= NOW()
         )::text AS overdue,
         COUNT(*) FILTER (
           WHERE status NOT IN ('COMPLETED','CANCELLED')
             AND so.deadline_for(so.id) IS NOT NULL
             AND so.deadline_for(so.id) > NOW()
             AND so.deadline_for(so.id) <= NOW() + ($1::int * interval '1 day')
         )::text AS approaching
       FROM rpt.read_service_orders so`,
      [resolveApproachingDueDays()],
    );
    return {
      overdue: Number.parseInt(result.rows[0]?.overdue ?? '0', 10),
      approaching: Number.parseInt(result.rows[0]?.approaching ?? '0', 10),
    };
  }

  it('função ignora janela REMOVED e respeita status terminal fora do vencido', async () => {
    // Janela passada marcada como REMOVED não gera deadline (vencido não conta).
    const removedId = await seedOsWithWindow({
      orderNumber: 'REMOVED-1',
      status: 'IN_EXECUTION',
      plannedStatus: 'REMOVED',
      windowEndOffsetMs: -1 * hour,
    });
    const removedDeadline = await pool.query<{ deadline: Date | null }>(
      'SELECT so.deadline_for($1) AS deadline',
      [removedId],
    );
    expect(removedDeadline.rows[0]?.deadline).toBeNull();

    // Vencido de verdade e terminal fora do calculo das superficies.
    const overdueId = await seedOsWithWindow({
      orderNumber: 'OVERDUE-1',
      status: 'IN_EXECUTION',
      windowEndOffsetMs: -1 * hour,
    });
    await seedOsWithWindow({ orderNumber: 'COMPLETED-1', status: 'COMPLETED', windowEndOffsetMs: -1 * hour });
    await seedOsWithWindow({ orderNumber: 'DONE-2', status: 'COMPLETED', windowEndOffsetMs: -2 * hour });

    const deadline = await pool.query<{ deadline: Date | null }>(
      'SELECT so.deadline_for($1) AS deadline',
      [overdueId],
    );
    expect(deadline.rows[0]?.deadline).not.toBeNull();
  });

  it('boundary < vs <=: passado conta como vencido, futuro (1 min) não; reconciliação aging == executive == SQL', async () => {
    await seedOsWithWindow({ orderNumber: 'PAST-1', status: 'IN_EXECUTION', windowEndOffsetMs: -60_000 });
    await seedOsWithWindow({ orderNumber: 'PAST-2', status: 'IN_EXECUTION', windowEndOffsetMs: -2 * hour });
    await seedOsWithWindow({ orderNumber: 'FUTURE-1', status: 'IN_EXECUTION', windowEndOffsetMs: 60_000 });
    await seedOsWithWindow({ orderNumber: 'FUTURE-2', status: 'IN_EXECUTION', windowEndOffsetMs: 2 * 24 * hour });
    // Aproximando (janela futura dentro do threshold) e terminais ignorados.
    await seedOsWithWindow({ orderNumber: 'APPROACHING-1', status: 'IN_EXECUTION', windowEndOffsetMs: 2 * hour });
    await seedOsWithWindow({ orderNumber: 'DONE-PAST', status: 'COMPLETED', windowEndOffsetMs: -1 * hour });
    await seedOsWithWindow({ orderNumber: 'DONE2-PAST', status: 'COMPLETED', windowEndOffsetMs: -2 * hour });

    const truth = await groundTruth();
    expect(truth.overdue).toBe(2); // somente PAST-1 e PAST-2 (<= NOW); FUTURE-1/2 e APPROACHING-1 fora
    // approaching: qualquer deadline futuro dentro de AGING_APPROACHING_DUE_DAYS (7) —
    // FUTURE-1 (+1min), APPROACHING-1 (+2h) e FUTURE-2 (+2d) => 3.
    expect(truth.approaching).toBe(3);

    const agingSnapshot = await aging.getAgingSnapshot(actor);
    expect(agingSnapshot.operational.overdueServiceOrders.count).toBe(truth.overdue);
    expect(agingSnapshot.operational.approachingDueServiceOrders.count).toBe(truth.approaching);

    const execSnapshot = await executive.getExecutiveSnapshot(actor, {});
    const overdueItem = execSnapshot.attention.find((item) => item.id === 'overdue-service-orders');
    const approachingItem = execSnapshot.attention.find((item) => item.id === 'approaching-due-service-orders');
    expect(overdueItem?.count ?? 0).toBe(truth.overdue);
    expect(approachingItem?.count ?? 0).toBe(truth.approaching);
  });

  it('timezone da sessão não altera o deadline (instante absoluto) nem a reconciliação', async () => {
    const id = await seedOsWithWindow({ orderNumber: 'TZ-1', status: 'IN_EXECUTION', windowEndOffsetMs: -hour });
    await pool.query(`SET TIME ZONE 'UTC'`);
    const inUtc = await pool.query<{ e: string }>(
      `SELECT EXTRACT(EPOCH FROM so.deadline_for($1))::text AS e`,
      [id],
    );
    await pool.query(`SET TIME ZONE 'America/Sao_Paulo'`);
    const inSaoPaulo = await pool.query<{ e: string }>(
      `SELECT EXTRACT(EPOCH FROM so.deadline_for($1))::text AS e`,
      [id],
    );
    expect(inUtc.rows[0]?.e).toBe(inSaoPaulo.rows[0]?.e);

    const truth = await groundTruth();
    expect(truth.overdue).toBe(1);
  });

  it('reconciliação final: todas as superfícies concordam no mesmo dataset', async () => {
    await seedOsWithWindow({ orderNumber: 'R-OVER-1', status: 'IN_EXECUTION', windowEndOffsetMs: -2 * hour });
    await seedOsWithWindow({ orderNumber: 'R-OVER-2', status: 'IN_EXECUTION', windowEndOffsetMs: -4 * hour });
    await seedOsWithWindow({ orderNumber: 'R-APPROACH', status: 'IN_EXECUTION', windowEndOffsetMs: 6 * hour });
    await seedOsWithWindow({ orderNumber: 'R-FUTURE', status: 'IN_EXECUTION', windowEndOffsetMs: 10 * 24 * hour });
    await seedOsWithWindow({ orderNumber: 'R-REMOVED', status: 'IN_EXECUTION', plannedStatus: 'REMOVED', windowEndOffsetMs: -hour });

    const truth = await groundTruth();
    const agingSnapshot = await aging.getAgingSnapshot(actor);
    const execSnapshot = await executive.getExecutiveSnapshot(actor, {});

    expect(truth.overdue).toBe(2);
    expect(agingSnapshot.operational.overdueServiceOrders.count).toBe(2);
    expect(execSnapshot.attention.find((item) => item.id === 'overdue-service-orders')?.count).toBe(2);
    expect(truth.approaching).toBe(1);
    expect(agingSnapshot.operational.approachingDueServiceOrders.count).toBe(1);
    expect(execSnapshot.attention.find((item) => item.id === 'approaching-due-service-orders')?.count).toBe(1);
  });
});
