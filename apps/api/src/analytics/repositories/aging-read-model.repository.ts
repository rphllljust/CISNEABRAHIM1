import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { sumMoneyAmounts } from '../../platform/kernel/money-math';
import type { ScopeSqlPredicate } from '../../authorization/services/scope-enforcement.service';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { buildAwaitingReceivableAggregateSql, buildOverdueReceivableAggregateSql } from '../../finance/domain/receivable-aging-sql';
import { TERMINAL_SERVICE_ORDER_STATUSES } from '../../service-orders/domain/service-order.state-machine';
import type { AgingVisibility } from '../domain/aging-snapshot';
import { prefixScopeAlias, remapScope, type AgingScopeFilters } from './aging-scope';

export type AgingAggregateRow = {
  count: number;
  maxAgeDays: number | null;
};

export type AgingAmountAggregateRow = {
  count: number;
  totalAmount: string | null;
  maxAgeDays: number | null;
  maxDaysUntilDue: number | null;
  maxDaysOverdue: number | null;
};

export type AgingReadModelCounts = {
  pendingServiceRequests: AgingAggregateRow;
  overdueServiceOrders: AgingAggregateRow;
  approachingDueServiceOrders: AgingAggregateRow;
  serviceOrdersInDraft: AgingAggregateRow;
  serviceOrdersAwaitingRelease: AgingAggregateRow;
  serviceOrdersAwaitingStart: AgingAggregateRow;
  serviceOrdersInExecution: AgingAggregateRow;
  serviceOrdersPaused: AgingAggregateRow;
  agingMeasurements: AgingAggregateRow;
  awaitingBilling: AgingAggregateRow;
  awaitingPreparation: AgingAmountAggregateRow;
  prepared: AgingAmountAggregateRow;
  awaitingPayment: AgingAmountAggregateRow;
  overdueReceivables: AgingAmountAggregateRow;
};

const TERMINAL_SERVICE_ORDER_SQL = Array.from(TERMINAL_SERVICE_ORDER_STATUSES)
  .map((status) => `'${status}'`)
  .join(', ');

@Injectable()
export class AgingReadModelRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_NOT_CONFIGURED');
    }
    return connection.pool;
  }

  async loadAgingCounts(
    visibility: AgingVisibility,
    scopes: AgingScopeFilters,
    options: { approachingDueThresholdDays: number; businessTimezone: string },
  ): Promise<AgingReadModelCounts> {
    const operationalResults = await Promise.all([
      visibility.serviceRequests && scopes.serviceRequestScope
        ? this.countPendingServiceRequests(scopes.serviceRequestScope)
        : Promise.resolve(emptyAggregate()),
      visibility.serviceOrders && scopes.serviceOrderScope
        ? this.countOverdueServiceOrders(scopes.serviceOrderScope)
        : Promise.resolve(emptyAggregate()),
      visibility.serviceOrders && scopes.serviceOrderScope
        ? this.countApproachingDueServiceOrders(scopes.serviceOrderScope, options.approachingDueThresholdDays)
        : Promise.resolve(emptyAggregate()),
      visibility.serviceOrders && scopes.serviceOrderScope
        ? this.countServiceOrdersByStage(scopes.serviceOrderScope, 'DRAFT', 'created_at')
        : Promise.resolve(emptyAggregate()),
      visibility.serviceOrders && scopes.serviceOrderScope
        ? this.countServiceOrdersByStage(scopes.serviceOrderScope, 'PREPARED', 'prepared_at')
        : Promise.resolve(emptyAggregate()),
      visibility.serviceOrders && scopes.serviceOrderScope
        ? this.countServiceOrdersByStage(scopes.serviceOrderScope, 'RELEASED', 'released_at')
        : Promise.resolve(emptyAggregate()),
      visibility.serviceOrders && scopes.serviceOrderScope
        ? this.countServiceOrdersByStage(scopes.serviceOrderScope, 'IN_EXECUTION', 'started_at')
        : Promise.resolve(emptyAggregate()),
      visibility.serviceOrders && scopes.serviceOrderScope
        ? this.countServiceOrdersByStage(scopes.serviceOrderScope, 'PAUSED', 'paused_at')
        : Promise.resolve(emptyAggregate()),
      visibility.measurements && scopes.measurementScope
        ? this.countAgingMeasurements(scopes.measurementScope)
        : Promise.resolve(emptyAggregate()),
      visibility.serviceOrders && scopes.serviceOrderScope
        ? this.countAwaitingBilling(scopes.serviceOrderScope)
        : Promise.resolve(emptyAggregate()),
    ]);

    const financialResults = await Promise.all([
      visibility.billing && scopes.serviceOrderScope
        ? this.countFinancialAwaitingPreparation(scopes.serviceOrderScope)
        : Promise.resolve(emptyAmountAggregate()),
      visibility.billing && scopes.billingRecordScope
        ? this.countFinancialPrepared(scopes.billingRecordScope)
        : Promise.resolve(emptyAmountAggregate()),
      visibility.billing && scopes.billingDocumentScope
        ? this.countFinancialAwaitingPayment(scopes.billingDocumentScope, options.businessTimezone)
        : Promise.resolve(emptyAmountAggregate()),
      visibility.billing && scopes.billingDocumentScope
        ? this.countFinancialOverdue(scopes.billingDocumentScope, options.businessTimezone)
        : Promise.resolve(emptyAmountAggregate()),
    ]);

    return {
      pendingServiceRequests: operationalResults[0] ?? emptyAggregate(),
      overdueServiceOrders: operationalResults[1] ?? emptyAggregate(),
      approachingDueServiceOrders: operationalResults[2] ?? emptyAggregate(),
      serviceOrdersInDraft: operationalResults[3] ?? emptyAggregate(),
      serviceOrdersAwaitingRelease: operationalResults[4] ?? emptyAggregate(),
      serviceOrdersAwaitingStart: operationalResults[5] ?? emptyAggregate(),
      serviceOrdersInExecution: operationalResults[6] ?? emptyAggregate(),
      serviceOrdersPaused: operationalResults[7] ?? emptyAggregate(),
      agingMeasurements: operationalResults[8] ?? emptyAggregate(),
      awaitingBilling: operationalResults[9] ?? emptyAggregate(),
      awaitingPreparation: financialResults[0] ?? emptyAmountAggregate(),
      prepared: financialResults[1] ?? emptyAmountAggregate(),
      awaitingPayment: financialResults[2] ?? emptyAmountAggregate(),
      overdueReceivables: financialResults[3] ?? emptyAmountAggregate(),
    };
  }

  async explainCriticalQuery(scopes: AgingScopeFilters): Promise<string> {
    if (!scopes.serviceOrderScope) {
      return 'SKIPPED_NO_SCOPE';
    }
    const mapped = remapScope(prefixScopeAlias(scopes.serviceOrderScope, 'so'), 0);
    const sql = `EXPLAIN ${this.overdueServiceOrdersSql(mapped.clause)}`;
    const result = await this.pool().query<{ 'QUERY PLAN': string }>(sql, mapped.params);
    return result.rows.map((row) => row['QUERY PLAN']).join('\n');
  }

  private overdueServiceOrdersSql(scopeClause: string): string {
    return `SELECT COUNT(DISTINCT so.id)::int AS count,
              MAX(
                FLOOR(
                  EXTRACT(EPOCH FROM (NOW() - deadlines.deadline)) / 86400
                )
              )::int AS max_age_days
       FROM rpt.read_service_orders so LEFT JOIN LATERAL (SELECT so.deadline_for(so.id) AS deadline) deadlines ON TRUE
       WHERE ${scopeClause}
         AND so.status NOT IN (${TERMINAL_SERVICE_ORDER_SQL})
         AND deadlines.deadline <= NOW()`;
  }

  private async countOverdueServiceOrders(scope: ScopeSqlPredicate): Promise<AgingAggregateRow> {
    const mapped = remapScope(prefixScopeAlias(scope, 'so'), 0);
    const result = await this.pool().query<{ count: number; max_age_days: number | null }>(
      this.overdueServiceOrdersSql(mapped.clause),
      mapped.params,
    );
    return toAggregate(result.rows[0]);
  }

  private async countApproachingDueServiceOrders(
    scope: ScopeSqlPredicate,
    thresholdDays: number,
  ): Promise<AgingAggregateRow> {
    const mapped = remapScope(prefixScopeAlias(scope, 'so'), 0);
    const params = [...mapped.params, thresholdDays];
    const thresholdParam = `$${params.length}`;
    const result = await this.pool().query<{ count: number; max_age_days: number | null }>(
      `SELECT COUNT(DISTINCT so.id)::int AS count,
              NULL::int AS max_age_days
       FROM rpt.read_service_orders so LEFT JOIN LATERAL (SELECT so.deadline_for(so.id) AS deadline) deadlines ON TRUE
       WHERE ${mapped.clause}
         AND so.status NOT IN (${TERMINAL_SERVICE_ORDER_SQL})
         AND deadlines.deadline > NOW()
         AND deadlines.deadline <= NOW() + (${thresholdParam}::int * INTERVAL '1 day')`,
      params,
    );
    return toAggregate(result.rows[0]);
  }

  private async countServiceOrdersByStage(
    scope: ScopeSqlPredicate,
    status: string,
    anchorColumn: string,
  ): Promise<AgingAggregateRow> {
    const mapped = remapScope(prefixScopeAlias(scope, 'so'), 0);
    const params = [...mapped.params, status];
    const statusParam = `$${params.length}`;
    const result = await this.pool().query<{ count: number; max_age_days: number | null }>(
      `SELECT COUNT(*)::int AS count,
              MAX(
                FLOOR(
                  EXTRACT(
                    EPOCH FROM (
                      NOW() - COALESCE(so.${anchorColumn}, so.updated_at, so.created_at)
                    )
                  ) / 86400
                )
              )::int AS max_age_days
       FROM rpt.read_service_orders so
       WHERE ${mapped.clause}
         AND so.status = ${statusParam}`,
      params,
    );
    return toAggregate(result.rows[0]);
  }

  private async countPendingServiceRequests(scope: ScopeSqlPredicate): Promise<AgingAggregateRow> {
    const mapped = remapScope(scope, 0);
    const result = await this.pool().query<{ count: number; max_age_days: number | null }>(
      `SELECT COUNT(*)::int AS count,
              MAX(
                FLOOR(
                  EXTRACT(
                    EPOCH FROM (
                      NOW() - COALESCE(
                        CASE
                          WHEN sr.status = 'UNDER_REVIEW' THEN sr.review_started_at
                          WHEN sr.status = 'SUBMITTED' THEN sr.submitted_at
                          ELSE sr.created_at
                        END,
                        sr.created_at
                      )
                    )
                  ) / 86400
                )
              )::int AS max_age_days
       FROM rpt.read_service_requests sr
       WHERE ${mapped.clause}
         AND sr.status IN ('SUBMITTED', 'UNDER_REVIEW')`,
      mapped.params,
    );
    return toAggregate(result.rows[0]);
  }

  private async countAgingMeasurements(scope: ScopeSqlPredicate): Promise<AgingAggregateRow> {
    const mapped = remapScope(scope, 0);
    const result = await this.pool().query<{ count: number; max_age_days: number | null }>(
      `SELECT COUNT(*)::int AS count,
              MAX(
                FLOOR(
                  EXTRACT(
                    EPOCH FROM (
                      NOW() - COALESCE(
                        CASE
                          WHEN m.status = 'UNDER_REVIEW' THEN m.review_started_at
                          ELSE m.submitted_at
                        END,
                        m.created_at
                      )
                    )
                  ) / 86400
                )
              )::int AS max_age_days
       FROM rpt.read_measurements m
       INNER JOIN rpt.read_service_orders so ON so.id = m.service_order_id
       WHERE ${mapped.clause}
         AND m.status IN ('SUBMITTED', 'UNDER_REVIEW')`,
      mapped.params,
    );
    return toAggregate(result.rows[0]);
  }

  private async countAwaitingBilling(scope: ScopeSqlPredicate): Promise<AgingAggregateRow> {
    const mapped = remapScope(prefixScopeAlias(scope, 'so'), 0);
    const result = await this.pool().query<{ count: number; max_age_days: number | null }>(
      `SELECT COUNT(*)::int AS count,
              MAX(
                FLOOR(EXTRACT(EPOCH FROM (NOW() - so.completed_at)) / 86400)
              )::int AS max_age_days
       FROM rpt.read_service_orders so
       WHERE ${mapped.clause}
         AND so.status = 'COMPLETED'
         AND NOT EXISTS (
           SELECT 1
           FROM rpt.read_billing_records br
           WHERE br.service_order_id = so.id
             AND br.status = 'PREPARED'
         )`,
      mapped.params,
    );
    return toAggregate(result.rows[0]);
  }

  private async countFinancialAwaitingPreparation(
    serviceOrderScope: ScopeSqlPredicate | null,
  ): Promise<AgingAmountAggregateRow> {
    if (!serviceOrderScope) {
      return emptyAmountAggregate();
    }
    const mapped = remapScope(prefixScopeAlias(serviceOrderScope, 'so'), 0);
    const result = await this.pool().query<{
      count: number;
      max_age_days: number | null;
    }>(
      `SELECT COUNT(*)::int AS count,
              MAX(
                FLOOR(EXTRACT(EPOCH FROM (NOW() - so.completed_at)) / 86400)
              )::int AS max_age_days
       FROM rpt.read_service_orders so
       WHERE ${mapped.clause}
         AND so.status = 'COMPLETED'
         AND NOT EXISTS (
           SELECT 1
           FROM rpt.read_billing_records br
           WHERE br.service_order_id = so.id
             AND br.status = 'PREPARED'
         )`,
      mapped.params,
    );
    return {
      count: result.rows[0]?.count ?? 0,
      // SEM dado de valor: sem totalAmount (NO_DATA) — nunca '0' fictício.
      totalAmount: null,
      maxAgeDays: result.rows[0]?.max_age_days ?? null,
      maxDaysUntilDue: null,
      maxDaysOverdue: null,
    };
  }

  private async countFinancialPrepared(scope: ScopeSqlPredicate): Promise<AgingAmountAggregateRow> {
    const mapped = remapScope(scope, 0);
    const result = await this.pool().query<{
      count: number;
      total_amount: string | null;
      max_age_days: number | null;
    }>(
      `SELECT COUNT(*)::int AS count,
              COALESCE(SUM(br.total_amount), 0)::text AS total_amount,
              MAX(
                FLOOR(EXTRACT(EPOCH FROM (NOW() - br.prepared_at)) / 86400)
              )::int AS max_age_days
       FROM rpt.read_billing_records br
       WHERE ${mapped.clause}
         AND br.status = 'PREPARED'
         AND NOT EXISTS (
           SELECT 1
           FROM rpt.read_billing_documents bd
           WHERE bd.billing_record_id = br.id
             AND bd.status = 'FINALIZED'
         )`,
      mapped.params,
    );
    return toAmountAggregate(result.rows[0]);
  }

  private async countFinancialAwaitingPayment(
    scope: ScopeSqlPredicate,
    businessTimezone: string,
  ): Promise<AgingAmountAggregateRow> {
    const mapped = remapScope(scope, 0);
    const params = [...mapped.params, businessTimezone];
    const tzParam = `$${params.length}`;
    // Posicao financeira real a vencer (FIN-SEM-001): recebiveis OPEN/PARTIALLY_PAID
    // por saldo residual (principal - settlements POSTED) — nunca billing_documents.
    const sql = buildAwaitingReceivableAggregateSql({ scopeClause: mapped.clause, tzParam });
    const result = await this.pool().query<{
      count: number;
      total_amount: string | null;
      max_days_until_due: number | null;
    }>(sql, params);
    const row = result.rows[0];
    const count = row?.count ?? 0;
    return {
      count,
      totalAmount: count > 0 ? normalizeAmount(row?.total_amount) : null,
      maxAgeDays: null,
      maxDaysUntilDue: row?.max_days_until_due ?? null,
      maxDaysOverdue: null,
    };
  }

  private async countFinancialOverdue(
    scope: ScopeSqlPredicate,
    businessTimezone: string,
  ): Promise<AgingAmountAggregateRow> {
    const mapped = remapScope(scope, 0);
    const params = [...mapped.params, businessTimezone];
    const tzParam = `$${params.length}`;
    const sql = buildOverdueReceivableAggregateSql({ scopeClause: mapped.clause, tzParam });
    const result = await this.pool().query<{
      count: number;
      total_amount: string | null;
      max_days_overdue: number | null;
    }>(sql, params);
    const row = result.rows[0];
    const count = row?.count ?? 0;
    return {
      count,
      // Sem recebível vencido: sem dado de valor (NO_DATA), nunca '0' fabricado.
      totalAmount: count > 0 ? normalizeAmount(row?.total_amount) : null,
      maxAgeDays: null,
      maxDaysUntilDue: null,
      maxDaysOverdue: row?.max_days_overdue ?? null,
    };
  }
}

function emptyAggregate(): AgingAggregateRow {
  return { count: 0, maxAgeDays: null };
}

function emptyAmountAggregate(): AgingAmountAggregateRow {
  return {
    count: 0,
    totalAmount: null,
    maxAgeDays: null,
    maxDaysUntilDue: null,
    maxDaysOverdue: null,
  };
}

function toAggregate(row: { count: number; max_age_days: number | null } | undefined): AgingAggregateRow {
  return {
    count: row?.count ?? 0,
    maxAgeDays: row?.max_age_days ?? null,
  };
}

function toAmountAggregate(
  row:
    | {
        count: number;
        total_amount: string | null;
        max_age_days: number | null;
        max_days_until_due?: number | null;
        max_days_overdue?: number | null;
      }
    | undefined,
): AgingAmountAggregateRow {
  return {
    count: row?.count ?? 0,
    totalAmount: normalizeAmount(row?.total_amount),
    maxAgeDays: row?.max_age_days ?? null,
    maxDaysUntilDue: row?.max_days_until_due ?? null,
    maxDaysOverdue: row?.max_days_overdue ?? null,
  };
}

function normalizeAmount(value: string | null | undefined): string {
  if (!value) {
    return '0';
  }
  return sumMoneyAmounts([value]);
}
