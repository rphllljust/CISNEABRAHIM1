import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import type { ScopeSqlPredicate } from '../../authorization/services/scope-enforcement.service';
import type { DashboardVisibility } from '../domain/operational-dashboard';

export type OperationalDashboardCounts = {
  pendingServiceRequests: number;
  ordersAwaitingRelease: number;
  ordersAwaitingConfirmation: number;
  ordersInProgress: number;
  overdueServiceOrders: number;
  resourcesInUse: number;
  pendingMeasurements: number;
  pendingBilling: number;
  divergences: number;
  pendingDocuments: number;
};

export type OperationalDashboardScopeFilters = {
  serviceRequestScope: ScopeSqlPredicate | null;
  serviceOrderScope: ScopeSqlPredicate | null;
  measurementScope: ScopeSqlPredicate | null;
  billingScope: ScopeSqlPredicate | null;
  documentScope: ScopeSqlPredicate | null;
  resourceScope: ScopeSqlPredicate | null;
};

function remapScope(scope: ScopeSqlPredicate, paramOffset: number): { clause: string; params: unknown[] } {
  const clause = scope.clause.replace(/\$(\d+)/g, (_, index) => `$${paramOffset + Number(index)}`);
  return { clause, params: scope.params };
}

/** Anexa ` AND <alias>.unit_id = $N` quando um filtro de unidade foi pedido. */
function unitClause(params: unknown[], unitId: string | undefined, alias: string): string {
  if (!unitId) {
    return '';
  }
  params.push(unitId);
  return ` AND ${alias}.unit_id = $${params.length}`;
}

@Injectable()
export class OperationalDashboardRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_NOT_CONFIGURED');
    }
    return connection.pool;
  }

  async countOperationalMetrics(
    visibility: DashboardVisibility,
    scopes: OperationalDashboardScopeFilters,
    unitId?: string,
  ): Promise<OperationalDashboardCounts> {
    const tasks: Array<Promise<number>> = [];

    tasks.push(
      visibility.serviceRequests && scopes.serviceRequestScope
        ? (() => {
            const mapped = remapScope(scopes.serviceRequestScope, 0);
            const params: unknown[] = [...mapped.params];
            const u = unitClause(params, unitId, 'sr');
            return this.countScoped(
              `SELECT COUNT(*)::text AS count
               FROM rpt.read_service_requests sr
               WHERE ${mapped.clause}${u}
                 AND sr.status IN ('SUBMITTED', 'UNDER_REVIEW')`,
              params,
            );
          })()
        : Promise.resolve(0),
    );

    tasks.push(
      visibility.serviceOrders && scopes.serviceOrderScope
        ? (() => {
            const mapped = remapScope(scopes.serviceOrderScope, 0);
            const params: unknown[] = [...mapped.params];
            const u = unitClause(params, unitId, 'so');
            return this.countScoped(
              `SELECT COUNT(*)::text AS count
               FROM rpt.read_service_orders so
               WHERE ${mapped.clause}${u}
                 AND so.status = 'PREPARED'`,
              params,
            );
          })()
        : Promise.resolve(0),
    );

    tasks.push(
      visibility.serviceOrders && scopes.serviceOrderScope
        ? (() => {
            const mapped = remapScope(scopes.serviceOrderScope, 0);
            const params: unknown[] = [...mapped.params];
            const u = unitClause(params, unitId, 'so');
            return this.countScoped(
              `SELECT COUNT(*)::text AS count
               FROM rpt.read_service_orders so
               WHERE ${mapped.clause}${u}
                 AND so.status = 'RELEASED'`,
              params,
            );
          })()
        : Promise.resolve(0),
    );

    tasks.push(
      visibility.serviceOrders && scopes.serviceOrderScope
        ? (() => {
            const mapped = remapScope(scopes.serviceOrderScope, 0);
            const params: unknown[] = [...mapped.params];
            const u = unitClause(params, unitId, 'so');
            return this.countScoped(
              `SELECT COUNT(*)::text AS count
               FROM rpt.read_service_orders so
               WHERE ${mapped.clause}${u}
                 AND so.status IN ('IN_EXECUTION', 'PAUSED')`,
              params,
            );
          })()
        : Promise.resolve(0),
    );

    tasks.push(
      visibility.serviceOrders && scopes.serviceOrderScope
        ? (() => {
            const mapped = remapScope(scopes.serviceOrderScope, 0);
            const params: unknown[] = [...mapped.params];
            const u = unitClause(params, unitId, 'so');
            return this.countScoped(
              `SELECT COUNT(DISTINCT so.id)::text AS count
               FROM rpt.read_service_orders so
               WHERE ${mapped.clause}${u}
                 AND so.status IN ('RELEASED', 'IN_EXECUTION', 'PAUSED')
                 AND (
                   EXISTS (
                     SELECT 1
                     FROM rpt.read_planned_resources pr
                     WHERE pr.service_order_id = so.id
                       AND pr.status = 'PLANNED'
                       AND pr.operational_end IS NOT NULL
                       AND pr.operational_end < NOW()
                   )
                   OR EXISTS (
                     SELECT 1
                     FROM rpt.read_resource_allocations ra
                     WHERE ra.service_order_id = so.id
                       AND ra.status = 'ACTIVE'
                       AND ra.operational_end < NOW()
                   )
                 )`,
              params,
            );
          })()
        : Promise.resolve(0),
    );

    tasks.push(
      visibility.resources && scopes.resourceScope
        ? (() => {
            const mapped = remapScope(scopes.resourceScope, 0);
            const params: unknown[] = [...mapped.params];
            const u = unitClause(params, unitId, 'so');
            return this.countScoped(
              `SELECT COUNT(*)::text AS count
               FROM rpt.read_resource_allocations ra
               INNER JOIN rpt.read_service_orders so ON so.id = ra.service_order_id
               WHERE ra.status = 'ACTIVE'
                 AND ${mapped.clause}${u}`,
              params,
            );
          })()
        : Promise.resolve(0),
    );

    tasks.push(
      visibility.measurements && scopes.measurementScope
        ? (() => {
            const mapped = remapScope(scopes.measurementScope, 0);
            const params: unknown[] = [...mapped.params];
            const u = unitClause(params, unitId, 'so');
            return this.countScoped(
              `SELECT COUNT(*)::text AS count
               FROM rpt.read_measurements m
               INNER JOIN rpt.read_service_orders so ON so.id = m.service_order_id
               WHERE m.status IN ('SUBMITTED', 'UNDER_REVIEW')
                 AND ${mapped.clause}${u}`,
              params,
            );
          })()
        : Promise.resolve(0),
    );

    tasks.push(
      visibility.billing && scopes.serviceOrderScope
        ? (() => {
            const mapped = remapScope(scopes.serviceOrderScope, 0);
            const params: unknown[] = [...mapped.params];
            const u = unitClause(params, unitId, 'so');
            return this.countScoped(
              `SELECT COUNT(DISTINCT so.id)::text AS count
               FROM rpt.read_service_orders so
               LEFT JOIN rpt.read_billing_records br ON br.service_order_id = so.id AND br.status = 'PREPARED'
               LEFT JOIN rpt.read_billing_documents bd ON bd.billing_record_id = br.id AND bd.status = 'FINALIZED'
               WHERE so.status = 'COMPLETED'
                 AND ${mapped.clause}${u}
                 AND (br.id IS NULL OR bd.id IS NULL)`,
              params,
            );
          })()
        : Promise.resolve(0),
    );

    tasks.push(this.countDivergences(visibility, scopes, unitId));

    tasks.push(
      visibility.documents && scopes.documentScope
        ? (() => {
            const mapped = remapScope(scopes.documentScope, 0);
            const params: unknown[] = [...mapped.params];
            const u = unitClause(params, unitId, 'd');
            return this.countScoped(
              `SELECT COUNT(*)::text AS count
               FROM rpt.read_documents d
               WHERE d.status = 'ACTIVE'
                 AND (d.current_version_number IS NULL OR d.current_version_number < 1)
                 AND ${mapped.clause}${u}`,
              params,
            );
          })()
        : Promise.resolve(0),
    );

    const results = await Promise.all(tasks);

    return {
      pendingServiceRequests: results[0] ?? 0,
      ordersAwaitingRelease: results[1] ?? 0,
      ordersAwaitingConfirmation: results[2] ?? 0,
      ordersInProgress: results[3] ?? 0,
      overdueServiceOrders: results[4] ?? 0,
      resourcesInUse: results[5] ?? 0,
      pendingMeasurements: results[6] ?? 0,
      pendingBilling: results[7] ?? 0,
      divergences: results[8] ?? 0,
      pendingDocuments: results[9] ?? 0,
    };
  }

  private async countDivergences(
    visibility: DashboardVisibility,
    scopes: OperationalDashboardScopeFilters,
    unitId?: string,
  ): Promise<number> {
    const tasks: Promise<number>[] = [];

    if (visibility.measurements && scopes.measurementScope) {
      const mapped = remapScope(scopes.measurementScope, 0);
      const params: unknown[] = [...mapped.params];
      const u = unitClause(params, unitId, 'so');
      tasks.push(
        this.countScoped(
          `SELECT COUNT(*)::text AS count
           FROM rpt.read_measurements m
           INNER JOIN rpt.read_service_orders so ON so.id = m.service_order_id
           WHERE m.status = 'REJECTED' AND ${mapped.clause}${u}`,
          params,
        ),
      );
    }

    if (visibility.billing && scopes.billingScope) {
      const mapped = remapScope(scopes.billingScope, 0);
      const params: unknown[] = [...mapped.params];
      const u = unitClause(params, unitId, 'br');
      tasks.push(
        this.countScoped(
          `SELECT COUNT(*)::text AS count
           FROM rpt.read_billing_records br
           WHERE br.status = 'VOIDED' AND ${mapped.clause}${u}`,
          params,
        ),
      );
    }

    if (tasks.length === 0) {
      return 0;
    }

    const counts = await Promise.all(tasks);
    return counts.reduce((sum, value) => sum + value, 0);
  }

  private async countScoped(sql: string, params: unknown[]): Promise<number> {
    const result = await this.pool().query<{ count: string }>(sql, params);
    return Number.parseInt(result.rows[0]?.count ?? '0', 10);
  }
}
