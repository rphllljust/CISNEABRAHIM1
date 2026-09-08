import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import type { ScopeSqlPredicate } from '../../authorization/services/scope-enforcement.service';
import { DatabaseService } from '../../infrastructure/database/database.service';
import type { ProductivityGroupBy } from '../domain/productivity-summary';
import { emptyProductivityRawAggregates, type ProductivityRawAggregates } from '../domain/productivity-summary';
import { prefixScopeAlias, remapScope } from './aging-scope';

export type ProductivityQueryContext = {
  fromInclusive: Date;
  toExclusive: Date;
  serviceOrderScope: ScopeSqlPredicate | null;
  measurementScope: ScopeSqlPredicate | null;
  resourceScope?: ScopeSqlPredicate | null;
  executionScope?: ScopeSqlPredicate | null;
  groupBy: ProductivityGroupBy;
  unitFilter?: string;
  archetypeFilter?: string;
};

export type ProductivityGroupedRaw = {
  groupKey: string;
  groupLabel: string;
  aggregates: ProductivityRawAggregates;
};

@Injectable()
export class ProductivityReadModelRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_NOT_CONFIGURED');
    }
    return connection.pool;
  }

  async loadProductivityAggregates(context: ProductivityQueryContext): Promise<{
    overall: ProductivityRawAggregates;
    groups: ProductivityGroupedRaw[];
  }> {
    if (!context.serviceOrderScope) {
      return { overall: emptyProductivityRawAggregates(), groups: [] };
    }

    const [serviceOrderRows, measurementRows] = await Promise.all([
      this.loadServiceOrderAggregates(context),
      context.measurementScope
        ? this.loadMeasurementAggregates(context)
        : Promise.resolve({ overall: emptyProductivityRawAggregates(), groups: [] as ProductivityGroupedRaw[] }),
    ]);

    const overall = mergeRaw(serviceOrderRows.overall, measurementRows.overall);
    const groups = mergeGroupedByKey(serviceOrderRows.groups, measurementRows.groups, context.groupBy);

    return { overall, groups };
  }

  async explainServiceOrderAggregateQuery(context: ProductivityQueryContext): Promise<string> {
    const { sql, params } = this.buildServiceOrderAggregateSql(context);
    const result = await this.pool().query<{ 'QUERY PLAN': string }>(`EXPLAIN ${sql}`, params);
    return result.rows.map((row) => row['QUERY PLAN']).join('\n');
  }

  private async loadServiceOrderAggregates(context: ProductivityQueryContext) {
    const { sql, params } = this.buildServiceOrderAggregateSql(context);
    const result = await this.pool().query<ServiceOrderAggregateRow>(sql, params);

    if (context.groupBy === 'none') {
      const row = result.rows[0];
      return {
        overall: row ? mapServiceOrderRow(row) : emptyProductivityRawAggregates(),
        groups: [] as ProductivityGroupedRaw[],
      };
    }

    const groups = result.rows.map((row) => ({
      groupKey: row.group_key ?? 'unknown',
      groupLabel: row.group_label ?? row.group_key ?? 'unknown',
      aggregates: mapServiceOrderRow(row),
    }));

    const overall = groups.reduce(
      (acc, group) => mergeRaw(acc, group.aggregates),
      emptyProductivityRawAggregates(),
    );

    return { overall, groups };
  }

  private buildServiceOrderAggregateSql(context: ProductivityQueryContext): {
    sql: string;
    params: unknown[];
  } {
    const mapped = remapScope(prefixScopeAlias(context.serviceOrderScope!, 'so'), 0);
    const params: unknown[] = [...mapped.params, context.fromInclusive, context.toExclusive];
    const fromParam = `$${params.length - 1}`;
    const toParam = `$${params.length}`;

    const filters: string[] = [mapped.clause];
    if (context.unitFilter) {
      params.push(context.unitFilter);
      filters.push(`so.unit_id = $${params.length}`);
    }
    if (context.archetypeFilter) {
      params.push(context.archetypeFilter);
      filters.push(`so.service_snapshot->>'archetype' = $${params.length}`);
    }
    const whereClause = filters.join(' AND ');

    // Scope aplicado ANTES da agregação por métrica: uma OS só contribui com
    // utilization quando o ator pode ler alocações no escopo dela, e com
    // evidence quando pode ler execução. Predicados referenciam alias proprio
    // (so_res/so_ev) para nao colidir com o alias 'so' da OS.
    const allowedFragment = (scope: ScopeSqlPredicate | null | undefined, alias: string): string => {
      if (!scope) {
        return 'TRUE';
      }
      const res = remapScope(prefixScopeAlias(scope, alias), params.length);
      params.push(...res.params);
      return `EXISTS (SELECT 1 FROM rpt.read_service_orders ${alias} WHERE ${alias}.id = so.id AND ${res.clause})`;
    };
    const allowResSql = allowedFragment(context.resourceScope, 'so_res');
    const allowEvSql = allowedFragment(context.executionScope, 'so_ev');

    const groupSelect =
      context.groupBy === 'unit'
        ? `so.unit_id AS group_key, so.unit_id AS group_label`
        : context.groupBy === 'archetype'
          ? `COALESCE(so.service_snapshot->>'archetype', 'UNKNOWN') AS group_key,
             COALESCE(so.service_snapshot->>'archetype', 'UNKNOWN') AS group_label`
          : `'all' AS group_key, 'all' AS group_label`;

    const groupByClause =
      context.groupBy === 'none' ? '' : `GROUP BY group_key, group_label`;

    const outerSelect =
      context.groupBy === 'none'
        ? `SELECT
        'all' AS group_key,
        'all' AS group_label,
        COUNT(*)::int AS completed,
        COUNT(*) FILTER (WHERE deadline IS NOT NULL)::int AS on_time_denominator,
        COUNT(*) FILTER (
          WHERE deadline IS NOT NULL AND completed_at <= deadline
        )::int AS on_time_numerator,
        COALESCE(
          SUM(
            EXTRACT(EPOCH FROM (completed_at - started_at)) / 3600.0
          ) FILTER (WHERE started_at IS NOT NULL),
          0
        )::float8 AS cycle_time_total_hours,
        COUNT(*) FILTER (WHERE started_at IS NOT NULL)::int AS cycle_time_sample_size,
        COALESCE(SUM(allocated_seconds) FILTER (WHERE allow_res), 0)::float8 AS utilization_numerator_seconds,
        COALESCE(SUM(planned_seconds) FILTER (WHERE allow_res), 0)::float8 AS utilization_denominator_seconds,
        COUNT(*) FILTER (WHERE evidence_complete IS TRUE AND allow_ev)::int AS evidence_numerator,
        COUNT(*) FILTER (WHERE allow_ev)::int AS evidence_denominator
      FROM scoped_completed`
        : `SELECT
        group_key,
        group_label,
        COUNT(*)::int AS completed,
        COUNT(*) FILTER (WHERE deadline IS NOT NULL)::int AS on_time_denominator,
        COUNT(*) FILTER (
          WHERE deadline IS NOT NULL AND completed_at <= deadline
        )::int AS on_time_numerator,
        COALESCE(
          SUM(
            EXTRACT(EPOCH FROM (completed_at - started_at)) / 3600.0
          ) FILTER (WHERE started_at IS NOT NULL),
          0
        )::float8 AS cycle_time_total_hours,
        COUNT(*) FILTER (WHERE started_at IS NOT NULL)::int AS cycle_time_sample_size,
        COALESCE(SUM(allocated_seconds) FILTER (WHERE allow_res), 0)::float8 AS utilization_numerator_seconds,
        COALESCE(SUM(planned_seconds) FILTER (WHERE allow_res), 0)::float8 AS utilization_denominator_seconds,
        COUNT(*) FILTER (WHERE evidence_complete IS TRUE AND allow_ev)::int AS evidence_numerator,
        COUNT(*) FILTER (WHERE allow_ev)::int AS evidence_denominator
      FROM scoped_completed
      ${groupByClause}`;

    const sql = `
      WITH scoped_completed AS (
        SELECT
          so.id,
          ${groupSelect},
          so.completed_at,
          so.started_at,
          so.service_snapshot,
          deadlines.deadline,
          planned.planned_seconds,
          allocated.allocated_seconds,
          evidence.evidence_complete,
          ${allowResSql} AS allow_res,
          ${allowEvSql} AS allow_ev
        FROM rpt.read_service_orders so LEFT JOIN LATERAL (SELECT so.deadline_for(so.id) AS deadline) deadlines ON TRUE
        LEFT JOIN LATERAL (
          SELECT COALESCE(
            SUM(
              EXTRACT(EPOCH FROM (pr.operational_end - pr.operational_start))
            ),
            0
          ) AS planned_seconds
          FROM rpt.read_planned_resources pr
          WHERE pr.service_order_id = so.id
            AND pr.status = 'PLANNED'
            AND pr.operational_start IS NOT NULL
            AND pr.operational_end IS NOT NULL
        ) planned ON TRUE
        LEFT JOIN LATERAL (
          SELECT COALESCE(
            SUM(
              EXTRACT(EPOCH FROM (ra.operational_end - ra.operational_start))
            ),
            0
          ) AS allocated_seconds
          FROM rpt.read_resource_allocations ra
          WHERE ra.service_order_id = so.id
            AND ra.operational_start IS NOT NULL
            AND ra.operational_end IS NOT NULL
        ) allocated ON TRUE
        LEFT JOIN LATERAL (
          SELECT NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(so.service_snapshot->'requirements'->'execution') req
            WHERE req->>'requirementLevel' = 'REQUIRED'
              AND req->>'evidenceKind' IS NOT NULL
              AND NOT (
                EXISTS (
                  SELECT 1
                  FROM rpt.read_execution_evidence ee
                  WHERE ee.service_order_id = so.id
                    AND ee.evidence_kind = req->>'evidenceKind'
                )
                OR EXISTS (
                  SELECT 1
                  FROM rpt.read_execution_entries ent
                  WHERE ent.service_order_id = so.id
                    AND ent.evidence_kind = req->>'evidenceKind'
                )
                OR EXISTS (
                  SELECT 1
                  FROM rpt.read_execution_entries ent
                  WHERE ent.service_order_id = so.id
                    AND (
                      (ent.entry_type = 'MILEAGE' AND req->>'evidenceKind' = 'MILEAGE')
                      OR (ent.entry_type = 'HOUR_METER' AND req->>'evidenceKind' = 'HOUR_METER')
                      OR (ent.entry_type = 'QUANTITY' AND req->>'evidenceKind' = 'QUANTITY')
                      OR (ent.entry_type = 'OBSERVATION' AND req->>'evidenceKind' = 'OBSERVATION')
                    )
                )
              )
          ) AS evidence_complete
        ) evidence ON TRUE
        WHERE ${whereClause}
          AND so.status = 'COMPLETED'
          AND so.completed_at >= ${fromParam}
          AND so.completed_at < ${toParam}
      )
      ${outerSelect}`;

    return { sql, params };
  }

  private async loadMeasurementAggregates(
    context: ProductivityQueryContext,
  ): Promise<{ overall: ProductivityRawAggregates; groups: ProductivityGroupedRaw[] }> {
    const mapped = remapScope(context.measurementScope!, 0);
    const params: unknown[] = [...mapped.params, context.fromInclusive, context.toExclusive];
    const fromParam = `$${params.length - 1}`;
    const toParam = `$${params.length}`;

    const filters: string[] = [mapped.clause];
    if (context.unitFilter) {
      params.push(context.unitFilter);
      filters.push(`so.unit_id = $${params.length}`);
    }
    if (context.archetypeFilter) {
      params.push(context.archetypeFilter);
      filters.push(`so.service_snapshot->>'archetype' = $${params.length}`);
    }

    const groupSelect =
      context.groupBy === 'unit'
        ? `so.unit_id AS group_key, so.unit_id AS group_label`
        : context.groupBy === 'archetype'
          ? `COALESCE(so.service_snapshot->>'archetype', 'UNKNOWN') AS group_key,
             COALESCE(so.service_snapshot->>'archetype', 'UNKNOWN') AS group_label`
          : `'all' AS group_key, 'all' AS group_label`;

    const groupByClause =
      context.groupBy === 'none' ? '' : `GROUP BY group_key, group_label`;

    const result = await this.pool().query<{
      group_key: string;
      group_label: string;
      approved: number;
      decided: number;
      rejected: number;
    }>(
      `SELECT
         ${groupSelect},
         COUNT(*) FILTER (WHERE m.status = 'APPROVED')::int AS approved,
         COUNT(*) FILTER (WHERE m.status IN ('APPROVED', 'REJECTED'))::int AS decided,
         COUNT(*) FILTER (WHERE m.status = 'REJECTED')::int AS rejected
       FROM rpt.read_measurements m
       INNER JOIN rpt.read_service_orders so ON so.id = m.service_order_id
       WHERE ${filters.join(' AND ')}
         AND m.decided_at IS NOT NULL
         AND m.decided_at >= ${fromParam}
         AND m.decided_at < ${toParam}
       ${groupByClause}`,
      params,
    );

    const groups =
      context.groupBy === 'none'
        ? []
        : result.rows.map((row) => ({
            groupKey: row.group_key,
            groupLabel: row.group_label,
            aggregates: mapMeasurementRow(row),
          }));

    const overall = result.rows.reduce(
      (acc, row) =>
        mergeRaw(acc, {
          ...emptyProductivityRawAggregates(),
          reworkNumerator: row.rejected,
          reworkDenominator: row.decided,
          measurementApproved: row.approved,
          measurementDecided: row.decided,
        }),
      emptyProductivityRawAggregates(),
    );

    return { overall, groups };
  }
}

type ServiceOrderAggregateRow = {
  group_key: string | null;
  group_label: string | null;
  completed: number;
  on_time_denominator: number;
  on_time_numerator: number;
  cycle_time_total_hours: number | null;
  cycle_time_sample_size: number;
  utilization_numerator_seconds: number;
  utilization_denominator_seconds: number;
  evidence_numerator: number;
  evidence_denominator: number;
};

function mapServiceOrderRow(row: ServiceOrderAggregateRow): ProductivityRawAggregates {
  return {
    completed: row.completed,
    onTimeNumerator: row.on_time_numerator,
    onTimeDenominator: row.on_time_denominator,
    cycleTimeTotalHours: row.cycle_time_sample_size > 0 ? row.cycle_time_total_hours : null,
    cycleTimeSampleSize: row.cycle_time_sample_size,
    reworkNumerator: 0,
    reworkDenominator: 0,
    utilizationNumeratorSeconds: row.utilization_numerator_seconds,
    utilizationDenominatorSeconds: row.utilization_denominator_seconds,
    evidenceNumerator: row.evidence_numerator,
    evidenceDenominator: row.evidence_denominator,
    measurementApproved: 0,
    measurementDecided: 0,
  };
}

function mergeRaw(left: ProductivityRawAggregates, right: ProductivityRawAggregates): ProductivityRawAggregates {
  const cycleTimeTotal =
    left.cycleTimeTotalHours !== null || right.cycleTimeTotalHours !== null
      ? (left.cycleTimeTotalHours ?? 0) + (right.cycleTimeTotalHours ?? 0)
      : null;

  return {
    completed: left.completed + right.completed,
    onTimeNumerator: left.onTimeNumerator + right.onTimeNumerator,
    onTimeDenominator: left.onTimeDenominator + right.onTimeDenominator,
    cycleTimeTotalHours: cycleTimeTotal,
    cycleTimeSampleSize: left.cycleTimeSampleSize + right.cycleTimeSampleSize,
    reworkNumerator: left.reworkNumerator + right.reworkNumerator,
    reworkDenominator: left.reworkDenominator + right.reworkDenominator,
    utilizationNumeratorSeconds: left.utilizationNumeratorSeconds + right.utilizationNumeratorSeconds,
    utilizationDenominatorSeconds:
      left.utilizationDenominatorSeconds + right.utilizationDenominatorSeconds,
    evidenceNumerator: left.evidenceNumerator + right.evidenceNumerator,
    evidenceDenominator: left.evidenceDenominator + right.evidenceDenominator,
    measurementApproved: left.measurementApproved + right.measurementApproved,
    measurementDecided: left.measurementDecided + right.measurementDecided,
  };
}

function mapMeasurementRow(row: {
  approved: number;
  decided: number;
  rejected: number;
}): ProductivityRawAggregates {
  return {
    ...emptyProductivityRawAggregates(),
    reworkNumerator: row.rejected,
    reworkDenominator: row.decided,
    measurementApproved: row.approved,
    measurementDecided: row.decided,
  };
}

function mergeGroupedByKey(
  serviceOrderGroups: ProductivityGroupedRaw[],
  measurementGroups: ProductivityGroupedRaw[],
  groupBy: ProductivityGroupBy,
): ProductivityGroupedRaw[] {
  if (groupBy === 'none') {
    return [];
  }

  const measurementByKey = new Map(
    measurementGroups.map((group) => [group.groupKey, group.aggregates]),
  );

  return serviceOrderGroups.map((group) => ({
    ...group,
    aggregates: mergeRaw(
      group.aggregates,
      measurementByKey.get(group.groupKey) ?? emptyProductivityRawAggregates(),
    ),
  }));
}
