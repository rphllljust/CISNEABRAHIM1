import {
  insertGrant,
  insertIdentity,
  insertScopeRef,
  truncateIdentityAndAuthorizationTables,
  truncateServiceOrderTables,
  truncateServiceRequestTables,
} from '@cisne/database';
import { Test, TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyAuthTestEnv } from '../auth/test/auth-test-env';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { ProductivityReadModelRepository } from '../analytics/repositories/productivity-read-model.repository';
import { ExecutiveDashboardRepository } from './repositories/executive-dashboard.repository';
import { OperationalDashboardRepository } from './repositories/operational-dashboard.repository';
import { ExecutiveDashboardAccessService } from './services/executive-dashboard-access.service';
import { OperationalDashboardAccessService } from './services/operational-dashboard-access.service';

const UNIT_A = 'unit-dash-exec-a';
const UNIT_B = 'unit-dash-exec-b';

describe('Executive dashboard authorization integration', () => {
  let pool: Pool;
  let access: ExecutiveDashboardAccessService;
  let identityOwner: string;
  let identityEmployee: string;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for executive dashboard tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);

    const module: TestingModule = await Test.createTestingModule({
      imports: [DatabaseModule, AuthorizationModule],
      providers: [
        OperationalDashboardRepository,
        ExecutiveDashboardRepository,
        ProductivityReadModelRepository,
        OperationalDashboardAccessService,
        ExecutiveDashboardAccessService,
      ],
    }).compile();

    access = module.get(ExecutiveDashboardAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateServiceOrderTables(pool);
    await truncateServiceRequestTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: UNIT_A });
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: UNIT_B });

    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const ownerLogin = `exec-owner-${suffix}`;
    const employeeLogin = `exec-employee-${suffix}`;
    const owner = await insertIdentity(pool, ownerLogin);
    const employee = await insertIdentity(pool, employeeLogin);
    identityOwner = owner.identityId;
    identityEmployee = employee.identityId;

    // OWNER_ADMIN: leitura global em todas as capacidades do dashboard.
    await insertGrant(pool, {
      identityId: identityOwner,
      action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderList,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: identityOwner,
    });
    await insertGrant(pool, {
      identityId: identityOwner,
      action: AUTHZ_ACTIONS.MeasurementsMeasurementRead,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: identityOwner,
    });
    await insertGrant(pool, {
      identityId: identityOwner,
      action: AUTHZ_ACTIONS.ServiceOrdersResourceAllocationRead,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: identityOwner,
    });
    await insertGrant(pool, {
      identityId: identityOwner,
      action: AUTHZ_ACTIONS.ServiceOrdersExecutionRead,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: identityOwner,
    });
    await insertGrant(pool, {
      identityId: identityOwner,
      action: AUTHZ_ACTIONS.BillingBillingRecordRead,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: identityOwner,
    });
    await insertGrant(pool, {
      identityId: identityOwner,
      action: AUTHZ_ACTIONS.DocumentsDocumentList,
      resourceType: AUTHZ_RESOURCE_TYPES.DocumentsDocument,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: identityOwner,
    });
    await insertGrant(pool, {
      identityId: identityOwner,
      action: AUTHZ_ACTIONS.RequestsServiceRequestList,
      resourceType: AUTHZ_RESOURCE_TYPES.RequestsServiceRequest,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: identityOwner,
    });

    // EMPLOYEE: somente listagem de OS na unidade A (sem measurements/resources/execution).
    await insertGrant(pool, {
      identityId: identityEmployee,
      action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderList,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Unit,
      resourceId: UNIT_A,
      grantedByIdentityId: identityEmployee,
    });

    const now = Date.now();
    const hour = 3_600_000;
    // OS A: concluída há 2h, com prazo planejado ainda futuro (on-time) e 2h de janela.
    const osA = await insertCompletedServiceOrder(pool, {
      orderNumber: `EXEC-A-${suffix}`,
      unitId: UNIT_A,
      actorId: identityOwner,
      startedAt: new Date(now - 4 * hour).toISOString(),
      completedAt: new Date(now - 2 * hour).toISOString(),
      plannedStart: new Date(now - 3 * hour).toISOString(),
      plannedEnd: new Date(now - 1 * hour).toISOString(),
    });
    // OS B: mesmo formato na unidade B (fora do escopo do EMPLOYEE).
    const _osB = await insertCompletedServiceOrder(pool, {
      orderNumber: `EXEC-B-${suffix}`,
      unitId: UNIT_B,
      actorId: identityOwner,
      startedAt: new Date(now - 4 * hour).toISOString(),
      completedAt: new Date(now - 2 * hour).toISOString(),
      plannedStart: new Date(now - 3 * hour).toISOString(),
      plannedEnd: new Date(now - 1 * hour).toISOString(),
    });

    await insertMeasurement(pool, {
      serviceOrderId: osA,
      unitId: UNIT_A,
      actorId: identityOwner,
      status: 'REJECTED',
      decidedAt: new Date(now - hour).toISOString(),
    });
    await insertMeasurement(pool, {
      serviceOrderId: osA,
      unitId: UNIT_A,
      actorId: identityOwner,
      status: 'APPROVED',
      decidedAt: new Date(now - hour).toISOString(),
    });

    // Evidência de execução apenas na OS A.
    await pool.query(
      `INSERT INTO so.execution_evidence (service_order_id, evidence_kind, actor_identity_id)
       VALUES ($1, 'OBSERVATION', $2)`,
      [osA, identityOwner],
    );
  }, 30_000);

  afterAll(async () => {
    await pool?.end();
  });

  it('OWNER_ADMIN vê todas as métricas no escopo global e respeita unitId em todas as séries', async () => {
    const all = await access.getExecutiveSnapshot(
      { identityId: identityOwner, sessionId: 's-owner' },
      {},
    );
    expect(all.visibility.serviceOrders).toBe(true);
    expect(all.visibility.measurements).toBe(true);
    expect(all.visibility.resources).toBe(true);
    expect(all.productivity?.completed).toBe(2);
    expect(all.productivity?.utilization.available).toBe(true);
    expect(all.productivity?.utilization.denominator).toBeGreaterThan(0);
    expect(all.productivity?.evidenceCompleteness.available).toBe(true);
    expect(all.productivity?.reworkRate.available).toBe(true);
    expect(all.productivity?.measurementAcceptance.available).toBe(true);
    expect(all.productivity?.onTimeRate.available).toBe(true);
    const statusTotal = all.charts.serviceOrdersByStatus.items.reduce((s, item) => s + item.count, 0);
    expect(statusTotal).toBe(2);

    const onlyA = await access.getExecutiveSnapshot(
      { identityId: identityOwner, sessionId: 's-owner' },
      { unitId: UNIT_A },
    );
    expect(onlyA.productivity?.completed).toBe(1);
    const statusTotalA = onlyA.charts.serviceOrdersByStatus.items.reduce((s, item) => s + item.count, 0);
    expect(statusTotalA).toBe(1);

    const onlyB = await access.getExecutiveSnapshot(
      { identityId: identityOwner, sessionId: 's-owner' },
      { unitId: UNIT_B },
    );
    expect(onlyB.productivity?.completed).toBe(1);

    const unknown = await access.getExecutiveSnapshot(
      { identityId: identityOwner, sessionId: 's-owner' },
      { unitId: 'unit-que-nao-existe' },
    );
    expect(unknown.productivity?.completed).toBe(0);
  });

  it('EMPLOYEE sem grants de recursos/medição/execução não infere essas métricas (masking)', async () => {
    const snapshot = await access.getExecutiveSnapshot(
      { identityId: identityEmployee, sessionId: 's-emp' },
      {},
    );
    expect(snapshot.visibility.serviceOrders).toBe(true);
    expect(snapshot.visibility.measurements).toBe(false);
    expect(snapshot.visibility.resources).toBe(false);
    expect(snapshot.productivity?.completed).toBe(1); // somente unidade A
    expect(snapshot.productivity?.utilization.available).toBe(false);
    expect(snapshot.productivity?.utilization.numerator).toBe(0);
    expect(snapshot.productivity?.utilization.denominator).toBe(0);
    expect(snapshot.productivity?.evidenceCompleteness.available).toBe(false);
    expect(snapshot.productivity?.evidenceCompleteness.denominator).toBe(0);
    expect(snapshot.productivity?.reworkRate.available).toBe(false);
    expect(snapshot.productivity?.measurementAcceptance.available).toBe(false);
    // KPIs de OS (mesmo domínio da lista de OS autorizada) continuam honestos.
    expect(snapshot.productivity?.onTimeRate.available).toBe(true);

    const filteredB = await access.getExecutiveSnapshot(
      { identityId: identityEmployee, sessionId: 's-emp' },
      { unitId: UNIT_B },
    );
    expect(filteredB.productivity?.completed).toBe(0); // escopo impede qualquer número de B
    expect(filteredB.charts.serviceOrdersByStatus.items).toHaveLength(0);
  });

  it('grant com escopo errado não agrega dados fora do escopo (scope antes da agregação)', async () => {
    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const identity = (await insertIdentity(pool, `exec-wrong-scope-${suffix}`)).identityId;
    await insertGrant(pool, {
      identityId: identity,
      action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderList,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Unit,
      resourceId: UNIT_A,
      grantedByIdentityId: identity,
    });
    // Recursos/execução/medição concedidos apenas na unidade B (escopo errado).
    for (const action of [
      AUTHZ_ACTIONS.ServiceOrdersResourceAllocationRead,
      AUTHZ_ACTIONS.ServiceOrdersExecutionRead,
      AUTHZ_ACTIONS.MeasurementsMeasurementRead,
    ]) {
      await insertGrant(pool, {
        identityId: identity,
        action,
        resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
        scopeType: AUTHZ_SCOPES.Unit,
        resourceId: UNIT_B,
        grantedByIdentityId: identity,
      });
    }

    const snapshot = await access.getExecutiveSnapshot(
      { identityId: identity, sessionId: 's-wrong' },
      {},
    );
    expect(snapshot.productivity?.completed).toBe(1); // somente A
    // Existe grant de recurso, mas o escopo B não intersecta com o escopo A:
    // a agregação de utilization/evidence precisa ser 0 — nada de B vaza.
    expect(snapshot.productivity?.utilization.available).toBe(false);
    expect(snapshot.productivity?.utilization.denominator).toBe(0);
    expect(snapshot.productivity?.evidenceCompleteness.available).toBe(false);
    expect(snapshot.productivity?.evidenceCompleteness.denominator).toBe(0);
  });

  it('agregação cross-scope: métricas de produtividade respeitam o escopo de cada capability', async () => {
    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const identity = (await insertIdentity(pool, `exec-cross-${suffix}`)).identityId;
    await insertGrant(pool, {
      identityId: identity,
      action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderList,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: identity,
    });
    for (const action of [
      AUTHZ_ACTIONS.ServiceOrdersResourceAllocationRead,
      AUTHZ_ACTIONS.ServiceOrdersExecutionRead,
      AUTHZ_ACTIONS.MeasurementsMeasurementRead,
    ]) {
      await insertGrant(pool, {
        identityId: identity,
        action,
        resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
        scopeType: AUTHZ_SCOPES.Unit,
        resourceId: UNIT_A,
        grantedByIdentityId: identity,
      });
    }

    const snapshot = await access.getExecutiveSnapshot(
      { identityId: identity, sessionId: 's-cross' },
      {},
    );
    expect(snapshot.productivity?.completed).toBe(2); // SO list global enxerga as duas OS
    // utilization: janela planejada de 2h (7200s) apenas da OS A (escopo de recurso).
    expect(snapshot.productivity?.utilization.denominator).toBe(7200);
    expect(snapshot.productivity?.utilization.numerator).toBe(0);
    // evidence: apenas a OS A (escopo de execução) e com evidência presente.
    expect(snapshot.productivity?.evidenceCompleteness.denominator).toBe(1);
    expect(snapshot.productivity?.evidenceCompleteness.numerator).toBe(1);
    // rework/aceite: apenas medições da OS A (1 aprovada + 1 rejeitada).
    expect(snapshot.productivity?.reworkRate.denominator).toBe(2);
    expect(snapshot.productivity?.reworkRate.numerator).toBe(1);
    expect(snapshot.productivity?.measurementAcceptance.numerator).toBe(1);
  });

  it('negado sem nenhum grant operacional (fail closed)', async () => {
    const outsider = (await insertIdentity(pool, `exec-outsider-${crypto.randomUUID()}`)).identityId;
    await expect(
      access.getExecutiveSnapshot({ identityId: outsider, sessionId: 's-x' }, {}),
    ).rejects.toMatchObject({ code: 'DASHBOARD_ACCESS_DENIED' });
  });
});

async function insertCompletedServiceOrder(
  pool: Pool,
  input: {
    orderNumber: string;
    unitId: string;
    actorId: string;
    startedAt: string;
    completedAt: string;
    plannedStart: string;
    plannedEnd: string;
  },
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO so.service_orders (
       internal_code, order_number, unit_id, status, origin,
       service_snapshot, started_at, completed_at, row_version,
       created_by_identity_id, updated_by_identity_id
     ) VALUES ($1, $2, $3, 'COMPLETED', 'AUTHORIZED_DIRECT', $4::jsonb, $5, $6, 1, $7, $7)
     RETURNING id`,
    [
      `SO-${input.orderNumber}`,
      input.orderNumber,
      input.unitId,
      JSON.stringify({
        requirements: {
          execution: [
            { requirementType: 'OBSERVATION', requirementLevel: 'REQUIRED', evidenceKind: 'OBSERVATION' },
          ],
        },
      }),
      input.startedAt,
      input.completedAt,
      input.actorId,
    ],
  );
  const serviceOrderId = result.rows[0]?.id;
  if (!serviceOrderId) {
    throw new Error('SO insert failed');
  }

  await pool.query(
    `INSERT INTO so.planned_resources (
       service_order_id, requirement_kind, resource_type_code, planned_quantity,
       operational_start, operational_end, status, row_version,
       created_by_identity_id, updated_by_identity_id
     ) VALUES ($1, 'PHYSICAL_RESOURCE', 'TRK', 1, $2, $3, 'PLANNED', 1, $4, $4)`,
    [serviceOrderId, input.plannedStart, input.plannedEnd, input.actorId],
  );

  return serviceOrderId;
}

async function insertMeasurement(
  pool: Pool,
  input: {
    serviceOrderId: string;
    unitId: string;
    actorId: string;
    status: 'APPROVED' | 'REJECTED';
    decidedAt: string;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO msr.measurements (
       service_order_id, unit_id, status, decided_at, row_version,
       created_by_identity_id, updated_by_identity_id
     ) VALUES ($1, $2, $3, $4, 1, $5, $5)`,
    [input.serviceOrderId, input.unitId, input.status, input.decidedAt, input.actorId],
  );
}
