import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import type { ScopeSqlPredicate } from '../../authorization/services/scope-enforcement.service';
import { DatabaseService } from '../../infrastructure/database/database.service';
import type { ProfitabilityServiceOrderRaw } from '../domain/operational-profitability-summary';
import { remapScope } from './aging-scope';

export type OperationalProfitabilityQueryContext = {
  fromInclusive: Date;
  toExclusive: Date;
  serviceOrderScope: ScopeSqlPredicate;
  includeRevenue: boolean;
  includeCosts: boolean;
  serviceOrderId?: string;
  clientId?: string;
  contractReference?: string;
  unitFilter?: string;
  serviceTypeFilter?: string;
};

@Injectable()
export class OperationalProfitabilityReadModelRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_NOT_CONFIGURED');
    }
    return connection.pool;
  }

  async loadServiceOrderProfitabilityRows(
    context: OperationalProfitabilityQueryContext,
  ): Promise<ProfitabilityServiceOrderRaw[]> {
    const mapped = remapScope(context.serviceOrderScope, 0);
    const params: unknown[] = [...mapped.params, context.fromInclusive, context.toExclusive];
    const fromParam = `$${params.length - 1}`;
    const toParam = `$${params.length}`;

    const filters: string[] = [mapped.clause];
    if (context.unitFilter) {
      params.push(context.unitFilter);
      filters.push(`ord.unit_id = $${params.length}`);
    }
    if (context.serviceTypeFilter) {
      params.push(context.serviceTypeFilter);
      filters.push(`ord.service_snapshot->>'archetype' = $${params.length}`);
    }
    if (context.serviceOrderId) {
      params.push(context.serviceOrderId);
      filters.push(`ord.id = $${params.length}`);
    }
    if (context.clientId) {
      params.push(context.clientId);
      filters.push(`ord.client_id = $${params.length}`);
    }
    if (context.contractReference) {
      params.push(context.contractReference);
      filters.push(`ord.contract_reference = $${params.length}`);
    }

    const revenueCte = context.includeRevenue
      ? `revenue_by_so AS (
          SELECT
            m.service_order_id,
            SUM(mi.line_amount)::text AS operational_revenue,
            COUNT(mi.id)::int AS revenue_line_count
          FROM rpt.read_measurements m
          INNER JOIN rpt.read_measurement_items mi ON mi.measurement_id = m.id
          WHERE m.service_order_id IN (SELECT id FROM scoped_orders)
            AND m.status = 'APPROVED'::msr.measurement_status
            AND m.decided_at >= ${fromParam}
            AND m.decided_at < ${toParam}
          GROUP BY m.service_order_id
        )`
      : `revenue_by_so AS (
          SELECT NULL::uuid AS service_order_id, NULL::text AS operational_revenue, 0::int AS revenue_line_count
          WHERE FALSE
        )`;

    const costCte = context.includeCosts
      ? `cost_by_so AS (
          SELECT
            oc.service_order_id,
            CASE WHEN COUNT(DISTINCT oc.currency_code) = 1
              THEN SUM(oc.amount)::text ELSE NULL::text END AS realized_cost,
            COUNT(oc.id)::int AS cost_entry_count,
            MIN(oc.currency_code) AS currency_code,
            (COUNT(DISTINCT oc.currency_code) > 1) AS currency_ambiguous
          FROM rpt.read_operational_cost_entries oc
          WHERE oc.service_order_id IN (SELECT id FROM scoped_orders)
            AND oc.cost_kind = 'ACTUAL'::so.operational_cost_kind
            AND oc.recorded_at >= ${fromParam}
            AND oc.recorded_at < ${toParam}
          GROUP BY oc.service_order_id
        )`
      : `cost_by_so AS (
          SELECT NULL::uuid AS service_order_id, NULL::text AS realized_cost, 0::int AS cost_entry_count, 'BRL'::bpchar AS currency_code, FALSE AS currency_ambiguous
          WHERE FALSE
        )`;

    const sql = `
      WITH scoped_orders AS (
        SELECT ord.id, ord.internal_code, ord.client_id, ord.contract_reference, ord.service_snapshot
        FROM rpt.read_service_orders ord
        WHERE ${filters.join(' AND ')}
      ),
      ${revenueCte},
      ${costCte}
      SELECT
        ord.id::text AS service_order_id,
        ord.internal_code AS service_order_code,
        ord.client_id::text AS client_id,
        ord.contract_reference,
        ord.service_snapshot->>'archetype' AS service_type,
        r.operational_revenue,
        c.realized_cost,
        COALESCE(r.revenue_line_count, 0)::int AS revenue_line_count,
        COALESCE(c.cost_entry_count, 0)::int AS cost_entry_count,
        COALESCE(c.currency_code, 'BRL') AS currency_code,
        COALESCE(c.currency_ambiguous, FALSE) AS currency_ambiguous
      FROM scoped_orders ord
      LEFT JOIN revenue_by_so r ON r.service_order_id = ord.id
      LEFT JOIN cost_by_so c ON c.service_order_id = ord.id
      WHERE r.service_order_id IS NOT NULL OR c.service_order_id IS NOT NULL
      ORDER BY ord.internal_code ASC, ord.id ASC`;

    const result = await this.pool().query<{
      service_order_id: string;
      service_order_code: string | null;
      client_id: string | null;
      contract_reference: string | null;
      service_type: string | null;
      operational_revenue: string | null;
      realized_cost: string | null;
      revenue_line_count: number;
      cost_entry_count: number;
      currency_code: string;
      currency_ambiguous: boolean;
    }>(sql, params);

    return result.rows.map((row) => ({
      serviceOrderId: row.service_order_id,
      serviceOrderCode: row.service_order_code,
      clientId: row.client_id,
      contractReference: row.contract_reference,
      serviceType: row.service_type,
      operationalRevenue: row.operational_revenue,
      realizedCost: row.realized_cost,
      revenueLineCount: row.revenue_line_count,
      costEntryCount: row.cost_entry_count,
      currencyCode: row.currency_code,
      currencyAmbiguous: row.currency_ambiguous,
    }));
  }
}
