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
import { AuthorizationModule } from '../authorization/authorization.module';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { ExecutiveDashboardAccessService } from '../dashboard/services/executive-dashboard-access.service';
import { ExecutiveDashboardRepository } from '../dashboard/repositories/executive-dashboard.repository';
import { OperationalDashboardAccessService } from '../dashboard/services/operational-dashboard-access.service';
import { OperationalDashboardRepository } from '../dashboard/repositories/operational-dashboard.repository';
import { TERMINAL_SERVICE_ORDER_STATUSES } from './domain/service-order.state-machine';
import { DRILL_DESTINATIONS } from '../platform/analytics/filter-drill-contract';

/**
 * FILTER + DRILL CONTRACT — igualdade comprovada (PostgreSQL real):
 * metrica de contagem do BI (service_orders.overdue_count, atencao do executive)
 * == populacao da lista de destino filtrada pelo MESMO kernel canonico
 * (so.deadline_for <= NOW, status nao-terminal). 'overdue' e filtro derivado;
 * lista revalida escopo (URL nao e boundary).
 */

const UNIT = 'unit-drill-contract';
const hour = 3_600_000;

const TERMINAL_SQL = Array.from(TERMINAL_SERVICE_ORDER_STATUSES)
  .map((status) => `'${status}'`)
  .join(', ');

describe('FILTER + DRILL CONTRACT — igualdade BI == lista filtrada (PostgreSQL real)', () => {
  let pool: Pool;
  let moduleRef: TestingModule;
  let executive: ExecutiveDashboardAccessService;
  let actor: { identityId: string; sessionId: string };
  let seedNow = Date.now();

  beforeAll(async () => {
    const url = process.env['TEST_DATABASE_URL'];
    if (!url) {
      throw new Error('TEST_DATABASE_URL is required');
    }
    applyAuthTestEnv(url);
    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, AuthorizationModule, AnalyticsModule],
      providers: [
        OperationalDashboardRepository,
        ExecutiveDashboardRepository,
        OperationalDashboardAccessService,
        ExecutiveDashboardAccessService,
      ],
    }).compile();
    executive = moduleRef.get(ExecutiveDashboardAccessService);
    pool = new Pool({ connectionString: url });
  });

  beforeEach(async () => {
    await truncateServiceOrderTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const identity = await insertIdentity(pool, `drill-${suffix}`);
    actor = { identityId: identity.identityId, sessionId: `sid-drill-${suffix}` };
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
    await moduleRef?.close();
  });

  async function seedOsWithWindow(input: {
    orderNumber: string;
    status: 'IN_EXECUTION' | 'COMPLETED' | 'CANCELLED';
    windowEndOffsetMs?: number;
  }): Promise<void> {
    const now = new Date(seedNow);
    const cancelClause = input.status === 'CANCELLED' ? ', cancellation_reason' : '';
    const cancelValue = input.status === 'CANCELLED' ? ', $8' : '';
    const params: unknown[] = [
      `SO-D-${input.orderNumber}`,
      input.orderNumber,
      UNIT,
      input.status,
      new Date(now.getTime() - 2 * hour).toISOString(),
      input.status === 'COMPLETED' ? new Date(now.getTime() - 3 * hour).toISOString() : null,
      actor.identityId,
    ];
    if (input.status === 'CANCELLED') {
      params.push('cancelado em teste');
    }
    const result = await pool.query<{ id: string }>(
      `INSERT INTO so.service_orders (
         internal_code, order_number, unit_id, status, origin, service_snapshot,
         client_snapshot, started_at, completed_at, row_version,
         created_by_identity_id, updated_by_identity_id${cancelClause}
       ) VALUES ($1, $2, $3, $4, 'AUTHORIZED_DIRECT', '{}'::jsonb, '{}'::jsonb,
                 $5, $6, 1, $7, $7${cancelValue}) RETURNING id`,
      params,
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
       ) VALUES ($1, 'PHYSICAL_RESOURCE', 'TRK', 1, $2, $3, 'PLANNED', 1, $4, $4)`,
      [id, new Date(end.getTime() - hour), end, actor.identityId],
    );
  }

  /** Populacao da lista de destino (drill 'overdue') = kernel canonico, escopo unit. */
  async function drillOverduePopulationCount(): Promise<number> {
    const result = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM rpt.read_service_orders so
       WHERE so.unit_id = $1
         AND so.status NOT IN (${TERMINAL_SQL})
         AND so.deadline_for(so.id) IS NOT NULL
         AND so.deadline_for(so.id) <= NOW()`,
      [UNIT],
    );
    return result.rows[0]?.count ?? 0;
  }

  it('grafico -> lista: BI agregado (atencao) == populacao da lista filtrada (drill overdue)', async () => {
    // 1 vencida (IN_EXECUTION, janela no passado)
    await seedOsWithWindow({ orderNumber: 'VEN-1', status: 'IN_EXECUTION', windowEndOffsetMs: -2 * hour });
    // 1 concluida terminal com janela passada (excluida: nao-terminal e requisito)
    await seedOsWithWindow({ orderNumber: 'FIN-1', status: 'COMPLETED', windowEndOffsetMs: -5 * hour });
    // 1 cancelada terminal (excluida)
    await seedOsWithWindow({ orderNumber: 'CAN-1', status: 'CANCELLED', windowEndOffsetMs: -4 * hour });
    // 1 no futuro (nao vencida, fora do drill)
    await seedOsWithWindow({ orderNumber: 'FUT-1', status: 'IN_EXECUTION', windowEndOffsetMs: 3 * 24 * hour });

    const snapshot = await executive.getExecutiveSnapshot(actor, {});
    const attention = snapshot.attention.find((item: { id: string }) => item.id === 'overdue-service-orders');
    const biCount = attention?.count ?? 0;

    const drillCount = await drillOverduePopulationCount();

    expect(biCount).toBe(1);
    expect(drillCount).toBe(1);
    expect(biCount).toBe(drillCount); // DRILL COUNT MISMATCHES: 0
    expect(attention?.href).toBe('/app/service-orders?filter=overdue');
    expect(attention?.href).toBe(
      `${DRILL_DESTINATIONS.find((destination) => destination.attentionId === 'overdue-service-orders')!.route}?filter=${DRILL_DESTINATIONS.find((destination) => destination.attentionId === 'overdue-service-orders')!.filterParam}`,
    );
  });

  it('zero resultados: BI nao fabrica atencao e lista retorna 0 (igualdade no zero real)', async () => {
    await seedOsWithWindow({ orderNumber: 'FUT-2', status: 'IN_EXECUTION', windowEndOffsetMs: 5 * 24 * hour });

    const snapshot = await executive.getExecutiveSnapshot(actor, {});
    const attention = snapshot.attention.find((item: { id: string }) => item.id === 'overdue-service-orders');
    const drillCount = await drillOverduePopulationCount();

    expect(attention).toBeUndefined();
    expect(drillCount).toBe(0);
  });
});
