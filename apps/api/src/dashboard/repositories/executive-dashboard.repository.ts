import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { sumMoneyAmounts } from '../../platform/kernel/money-math';
import type { ScopeSqlPredicate } from '../../authorization/services/scope-enforcement.service';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { parseAgingBucketPolicyFromEnv } from '../../analytics/domain/aging-bucket.policy';
import { buildOverdueReceivableBucketsSql } from '../../finance/domain/receivable-aging-sql';
import type { ExecutiveChartRawData, ExecutiveFinancialAgingBucket } from '../domain/executive-dashboard';
import { prefixScopeAlias, remapScope } from '../../analytics/repositories/aging-scope';

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  PREPARED: 'Preparada',
  RELEASED: 'Liberada',
  IN_EXECUTION: 'Em execução',
  PAUSED: 'Pausada',
  COMPLETED: 'Concluída',
  CANCELLED: 'Cancelada',
};

@Injectable()
export class ExecutiveDashboardRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_NOT_CONFIGURED');
    }
    return connection.pool;
  }

  async loadChartData(input: {
    serviceOrderScope: ScopeSqlPredicate;
    billingDocumentScope: ScopeSqlPredicate | null;
    unitId?: string;
    fromInclusive: Date;
    toExclusive: Date;
    businessTimezone: string;
  }): Promise<ExecutiveChartRawData> {
    const [statusDistribution, throughputTrend, slaPoints, financial, overdueMeta] =
      await Promise.all([
        this.loadStatusDistribution(input.serviceOrderScope, input.unitId),
        this.loadThroughputTrend(input),
        this.loadSlaPoints(input),
        this.loadFinancialAging(input),
        this.loadOverdueMeta(input.serviceOrderScope, input.unitId),
      ]);

    return {
      statusDistribution,
      throughputTrend,
      slaPoints,
      financialAgingBuckets: financial.buckets,
      financialAgingAvailable: financial.available,
      overdueMaxDelayDays: overdueMeta.maxDelayDays,
      approachingDueCount: overdueMeta.approachingCount,
      overdueReceivablesCount: financial.overdueCount,
      overdueReceivablesAmount: financial.overdueAmount,
    };
  }

  private unitClause(params: unknown[], unitId: string | undefined, alias: string): string {
    if (!unitId) {
      return '';
    }
    params.push(unitId);
    return ` AND ${alias}.unit_id = $${params.length}`;
  }

  private async loadStatusDistribution(scope: ScopeSqlPredicate, unitId?: string) {
    const mapped = remapScope(prefixScopeAlias(scope, 'so'), 0);
    const params: unknown[] = [...mapped.params];
    const unit = this.unitClause(params, unitId, 'so');
    const result = await this.pool().query<{ status: string; count: number }>(
      `SELECT so.status, COUNT(*)::int AS count
       FROM rpt.read_service_orders so
       WHERE ${mapped.clause}${unit}
         AND so.status NOT IN ('CANCELLED')
       GROUP BY so.status
       ORDER BY count DESC, so.status ASC`,
      params,
    );
    return result.rows.map((row) => ({
      status: row.status,
      label: STATUS_LABELS[row.status] ?? row.status,
      count: row.count,
    }));
  }

  private async loadThroughputTrend(input: {
    serviceOrderScope: ScopeSqlPredicate;
    unitId?: string;
    fromInclusive: Date;
    toExclusive: Date;
    businessTimezone: string;
  }) {
    const mapped = remapScope(prefixScopeAlias(input.serviceOrderScope, 'so'), 0);
    const params: unknown[] = [...mapped.params];
    const unit = this.unitClause(params, input.unitId, 'so');
    params.push(input.businessTimezone, input.fromInclusive, input.toExclusive);
    const tzParam = `$${params.length - 2}`;
    const fromParam = `$${params.length - 1}`;
    const toParam = `$${params.length}`;

    const result = await this.pool().query<{ day: string; opened: number; completed: number }>(
      `WITH days AS (
         SELECT generate_series(
           date_trunc('day', ${fromParam}::timestamptz AT TIME ZONE ${tzParam}),
           date_trunc('day', (${toParam}::timestamptz - interval '1 second') AT TIME ZONE ${tzParam}),
           interval '1 day'
         )::date AS day
       ),
       opened AS (
         SELECT (so.created_at AT TIME ZONE ${tzParam})::date AS day, COUNT(*)::int AS count
         FROM rpt.read_service_orders so
         WHERE ${mapped.clause}${unit}
           AND so.created_at >= ${fromParam}
           AND so.created_at < ${toParam}
         GROUP BY 1
       ),
       completed AS (
         SELECT (so.completed_at AT TIME ZONE ${tzParam})::date AS day, COUNT(*)::int AS count
         FROM rpt.read_service_orders so
         WHERE ${mapped.clause}${unit}
           AND so.status = 'COMPLETED'
           AND so.completed_at >= ${fromParam}
           AND so.completed_at < ${toParam}
         GROUP BY 1
       )
       SELECT
         to_char(days.day, 'YYYY-MM-DD') AS day,
         COALESCE(opened.count, 0)::int AS opened,
         COALESCE(completed.count, 0)::int AS completed
       FROM days
       LEFT JOIN opened ON opened.day = days.day
       LEFT JOIN completed ON completed.day = days.day
       ORDER BY days.day ASC`,
      params,
    );

    return result.rows.map((row) => ({
      date: row.day,
      opened: row.opened,
      completed: row.completed,
    }));
  }

  private async loadSlaPoints(input: {
    serviceOrderScope: ScopeSqlPredicate;
    unitId?: string;
    fromInclusive: Date;
    toExclusive: Date;
    businessTimezone: string;
  }) {
    const mapped = remapScope(prefixScopeAlias(input.serviceOrderScope, 'so'), 0);
    const params: unknown[] = [...mapped.params];
    const unit = this.unitClause(params, input.unitId, 'so');
    params.push(input.businessTimezone, input.fromInclusive, input.toExclusive);
    const tzParam = `$${params.length - 2}`;
    const fromParam = `$${params.length - 1}`;
    const toParam = `$${params.length}`;

    const result = await this.pool().query<{
      period_label: string;
      on_time: number;
      overdue: number;
      eligible: number;
    }>(
      `WITH scoped_completed AS (
         SELECT
           so.completed_at,
           deadlines.deadline
         FROM rpt.read_service_orders so LEFT JOIN LATERAL (SELECT so.deadline_for(so.id) AS deadline) deadlines ON TRUE
         WHERE ${mapped.clause}${unit}
           AND so.status = 'COMPLETED'
           AND so.completed_at >= ${fromParam}
           AND so.completed_at < ${toParam}
       )
       SELECT
         to_char(date_trunc('week', completed_at AT TIME ZONE ${tzParam}), 'IYYY-"S"IW') AS period_label,
         COUNT(*) FILTER (
           WHERE deadline IS NOT NULL AND completed_at <= deadline
         )::int AS on_time,
         COUNT(*) FILTER (
           WHERE deadline IS NOT NULL AND completed_at > deadline
         )::int AS overdue,
         COUNT(*) FILTER (WHERE deadline IS NOT NULL)::int AS eligible
       FROM scoped_completed
       GROUP BY 1
       ORDER BY 1 ASC`,
      params,
    );

    return result.rows.map((row) => ({
      periodLabel: row.period_label,
      onTime: row.on_time,
      overdue: row.overdue,
      eligible: row.eligible,
      onTimeRate: row.eligible > 0 ? row.on_time / row.eligible : null,
    }));
  }

  private async loadFinancialAging(input: {
    billingDocumentScope: ScopeSqlPredicate | null;
    unitId?: string;
    businessTimezone: string;
  }) {
    const policy = parseAgingBucketPolicyFromEnv();
    if (!input.billingDocumentScope || policy.bands.length === 0) {
      return { available: false, buckets: [] as ExecutiveFinancialAgingBucket[], overdueCount: 0, overdueAmount: '0' };
    }

    const mapped = remapScope(input.billingDocumentScope, 0);
    const params: unknown[] = [...mapped.params];
    const unit = this.unitClause(params, input.unitId, 'bd');
    params.push(input.businessTimezone);
    const tzParam = `$${params.length}`;

    const result = await this.pool().query<{ days_overdue: number; count: number; total_amount: string }>(
      buildOverdueReceivableBucketsSql({
        scopeClause: mapped.clause,
        tzParam,
        extraClause: unit,
      }),
      params,
    );

    const buckets = policy.bands.map((band) => {
      const matching = result.rows.filter((row) => {
        if (band.maxDaysInclusive === null) {
          return row.days_overdue >= band.minDaysInclusive;
        }
        return row.days_overdue >= band.minDaysInclusive && row.days_overdue <= band.maxDaysInclusive;
      });
      const count = matching.reduce((sum, row) => sum + row.count, 0);
      const totalAmount = sumMoneyAmounts(matching.map((row) => row.total_amount));
      return {
        bandId: band.id,
        label: band.label,
        count,
        totalAmount,
      };
    });

    const overdueCount = result.rows.reduce((sum, row) => sum + row.count, 0);
    const overdueAmount = sumMoneyAmounts(result.rows.map((row) => row.total_amount));

    return { available: true, buckets, overdueCount, overdueAmount };
  }

  private async loadOverdueMeta(scope: ScopeSqlPredicate, unitId?: string) {
    const mapped = remapScope(prefixScopeAlias(scope, 'so'), 0);
    const params: unknown[] = [...mapped.params];
    const unit = this.unitClause(params, unitId, 'so');

    const overdue = await this.pool().query<{ max_delay_days: number | null }>(
      `SELECT MAX(
         FLOOR(EXTRACT(EPOCH FROM (NOW() - deadlines.deadline)) / 86400)
       )::int AS max_delay_days
       FROM rpt.read_service_orders so LEFT JOIN LATERAL (SELECT so.deadline_for(so.id) AS deadline) deadlines ON TRUE
       WHERE ${mapped.clause}${unit}
         AND so.status NOT IN ('COMPLETED', 'CANCELLED')
         AND deadlines.deadline <= NOW()`,
      params,
    );

    params.push(7);
    const thresholdParam = `$${params.length}`;

    const approaching = await this.pool().query<{ count: number }>(
      `SELECT COUNT(DISTINCT so.id)::int AS count
       FROM rpt.read_service_orders so LEFT JOIN LATERAL (SELECT so.deadline_for(so.id) AS deadline) deadlines ON TRUE
       WHERE ${mapped.clause}${unit}
         AND so.status NOT IN ('COMPLETED', 'CANCELLED')
         AND deadlines.deadline > NOW()
         AND deadlines.deadline <= NOW() + (${thresholdParam}::int * INTERVAL '1 day')`,
      params,
    );

    return {
      maxDelayDays: overdue.rows[0]?.max_delay_days ?? null,
      approachingCount: approaching.rows[0]?.count ?? 0,
    };
  }
}
