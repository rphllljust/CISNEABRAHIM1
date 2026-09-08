import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { AgingAccessService } from '../../analytics/services/aging-access.service';
import { ProductivityAccessService } from '../../analytics/services/productivity-access.service';
import { resolveBusinessTimezone } from '../../analytics/domain/business-timezone';
import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';
import { ScopeEnforcementService } from '../../authorization/services/scope-enforcement.service';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { TERMINAL_SERVICE_ORDER_STATUSES } from '../../service-orders/domain/service-order.state-machine';
import { prefixScopeAlias as prefixAlias } from '../../analytics/repositories/aging-scope';
import type { ScopeSqlPredicate } from '../../authorization/services/scope-enforcement.service';
import {
  REPORT_POLICY,
  REPORT_TYPES,
  type ReportFilters,
  type ReportType,
} from '../domain/report-type';

export type ReportDataRow = Record<string, unknown>;

const TERMINAL_SQL = Array.from(TERMINAL_SERVICE_ORDER_STATUSES)
  .map((status) => `'${status}'`)
  .join(', ');

@Injectable()
export class ReportDataService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly authorizationRepository: AuthorizationRepository,
    private readonly scopeEnforcement: ScopeEnforcementService,
    private readonly productivityAccess: ProductivityAccessService,
    private readonly agingAccess: AgingAccessService,
  ) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_NOT_CONFIGURED');
    }
    return connection.pool;
  }

  async countRows(actor: IdentityAuthzContext, reportType: ReportType, filters: ReportFilters): Promise<number> {
    const scope = await this.scopeForReport(actor, reportType);
    if (!scope || scope.clause === 'FALSE') {
      return 0;
    }
    const { fromClause, whereClause, params } = this.buildTabularQuery(reportType, filters, scope);
    if (!fromClause) {
      const rows = await this.loadAggregateRows(actor, reportType, filters);
      return rows.length;
    }
    const result = await this.pool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ${fromClause} WHERE ${whereClause}`,
      params,
    );
    return Number.parseInt(result.rows[0]?.count ?? '0', 10);
  }

  async loadRows(
    actor: IdentityAuthzContext,
    reportType: ReportType,
    filters: ReportFilters,
    limit: number,
    offset: number,
  ): Promise<ReportDataRow[]> {
    const scope = await this.scopeForReport(actor, reportType);
    if (!scope || scope.clause === 'FALSE') {
      return [];
    }

    const { fromClause, selectClause, whereClause, orderBy, params } = this.buildTabularQuery(
      reportType,
      filters,
      scope,
    );

    if (!fromClause) {
      const rows = await this.loadAggregateRows(actor, reportType, filters);
      return rows.slice(offset, offset + limit);
    }

    const listParams = [...params, limit, offset];
    const limitIndex = params.length + 1;
    const offsetIndex = params.length + 2;
    const result = await this.pool().query<ReportDataRow>(
      `${selectClause}
       FROM ${fromClause}
       WHERE ${whereClause}
       ORDER BY ${orderBy}
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      listParams,
    );
    return result.rows;
  }

  async streamAllRows(
    actor: IdentityAuthzContext,
    reportType: ReportType,
    filters: ReportFilters,
    onBatch: (rows: ReportDataRow[]) => Promise<void>,
  ): Promise<number> {
    let offset = 0;
    let total = 0;
    while (total < REPORT_POLICY.maxRows) {
      const batch = await this.loadRows(actor, reportType, filters, REPORT_POLICY.batchSize, offset);
      if (batch.length === 0) {
        break;
      }
      await onBatch(batch);
      total += batch.length;
      offset += batch.length;
      if (batch.length < REPORT_POLICY.batchSize) {
        break;
      }
    }
    return total;
  }

  private async loadAggregateRows(
    actor: IdentityAuthzContext,
    reportType: ReportType,
    filters: ReportFilters,
  ): Promise<ReportDataRow[]> {
    if (reportType === REPORT_TYPES.OperationalProductivity) {
      const snapshot = await this.productivityAccess.getProductivitySnapshot(actor, {
        period: filters.period,
        from: filters.from,
        to: filters.to,
        unitId: filters.unitId,
      });
      const summary = snapshot.summary;
      return [
        { metric: 'completed', value: summary.completed, denominator: '' },
        {
          metric: 'on_time_rate',
          value: summary.onTimeRate.value,
          denominator: summary.onTimeRate.denominator,
        },
        {
          metric: 'avg_cycle_hours',
          value: summary.averageCycleTime.valueHours,
          denominator: summary.averageCycleTime.sampleSize,
        },
        {
          metric: 'rework_rate',
          value: summary.reworkRate.value,
          denominator: summary.reworkRate.denominator,
        },
      ];
    }

    if (reportType === REPORT_TYPES.FinancialAging) {
      const snapshot = await this.agingAccess.getAgingSnapshot(actor);
      const financial = snapshot.financial;
      return [
        {
          bucket: 'awaiting_preparation',
          count: financial.awaitingPreparation.count,
          amount: financial.awaitingPreparation.totalAmount,
        },
        {
          bucket: 'prepared',
          count: financial.prepared.count,
          amount: financial.prepared.totalAmount,
        },
        {
          bucket: 'awaiting_payment',
          count: financial.awaitingPayment.count,
          amount: financial.awaitingPayment.totalAmount,
        },
        {
          bucket: 'overdue_receivables',
          count: financial.overdueReceivables.count,
          amount: financial.overdueReceivables.totalAmount,
        },
      ];
    }

    return [];
  }

  private buildTabularQuery(reportType: ReportType, filters: ReportFilters, scope: ScopeSqlPredicate) {
    const filterParts: string[] = [scope.clause === 'TRUE' ? 'TRUE' : scope.clause];
    const params: unknown[] = [...scope.params];

    if (filters.from) {
      params.push(new Date(filters.from));
      filterParts.push(`created_at >= $${params.length}`);
    }
    if (filters.to) {
      params.push(new Date(filters.to));
      filterParts.push(`created_at < $${params.length}`);
    }
    if (filters.unitId) {
      params.push(filters.unitId);
      filterParts.push(`unit_id = $${params.length}`);
    }
    if (filters.clientId) {
      params.push(filters.clientId);
      filterParts.push(`client_id = $${params.length}::uuid`);
    }
    if (filters.serviceDefinitionId) {
      params.push(filters.serviceDefinitionId);
      filterParts.push(`service_definition_id = $${params.length}::uuid`);
    }
    if (filters.status) {
      params.push(filters.status);
      filterParts.push(`status = $${params.length}`);
    }

    const whereClause = filterParts.join(' AND ');

    switch (reportType) {
      case REPORT_TYPES.ServiceOrdersByPeriod:
      case REPORT_TYPES.ServiceOrdersByClient:
      case REPORT_TYPES.ServiceOrdersByService:
        return {
          fromClause: 'rpt.read_service_orders so',
          selectClause: `SELECT so.order_number AS "orderNumber",
                                so.unit_id AS "unitId",
                                COALESCE(so.client_snapshot->>'legalName', '') AS "clientName",
                                so.status::text AS status,
                                so.created_at AS "createdAt",
                                so.completed_at AS "completedAt",
                                COALESCE(so.service_snapshot->>'serviceCode', '') AS "serviceCode"`,
          whereClause,
          orderBy:
            reportType === REPORT_TYPES.ServiceOrdersByClient
              ? '"clientName" ASC, so.created_at DESC'
              : reportType === REPORT_TYPES.ServiceOrdersByService
                ? '"serviceCode" ASC, so.created_at DESC'
                : 'so.created_at DESC',
          params,
        };
      case REPORT_TYPES.ServiceOrdersOverdue:
        return {
          fromClause: `rpt.read_service_orders so
                       LEFT JOIN LATERAL (SELECT so.deadline_for(so.id) AS deadline) dl ON TRUE`,
          selectClause: `SELECT so.order_number AS "orderNumber",
                                so.unit_id AS "unitId",
                                so.status::text AS status,
                                dl.deadline AS deadline,
                                GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - dl.deadline)) / 86400))::int AS "delayDays"`,
          whereClause: `${whereClause} AND so.status NOT IN (${TERMINAL_SQL}) AND dl.deadline IS NOT NULL AND dl.deadline <= NOW()`,
          orderBy: '"delayDays" DESC',
          params,
        };
      case REPORT_TYPES.AssetUtilization:
        return {
          fromClause: `rpt.read_physical_assets a
                       LEFT JOIN rpt.read_resource_allocations ra ON ra.physical_asset_id = a.id AND ra.status = 'ACTIVE'
                       LEFT JOIN rpt.read_service_orders so ON so.id = ra.service_order_id`,
          selectClause: `SELECT a.asset_code AS "assetCode",
                                a.name AS "assetName",
                                a.unit_id AS "unitId",
                                a.allocation_status::text AS "allocationStatus",
                                COALESCE(so.order_number, '') AS "serviceOrderNumber"`,
          whereClause: whereClause.replace(/\bunit_id\b/g, 'a.unit_id'),
          orderBy: 'a.asset_code ASC',
          params,
        };
      case REPORT_TYPES.Measurements:
        return {
          fromClause: 'rpt.read_measurements m INNER JOIN rpt.read_service_orders so ON so.id = m.service_order_id',
          selectClause: `SELECT m.id::text AS "measurementId",
                                so.order_number AS "orderNumber",
                                m.status::text AS status,
                                m.unit_id AS "unitId",
                                m.submitted_at AS "submittedAt"`,
          whereClause: whereClause.replace(/\bunit_id\b/g, 'm.unit_id').replace(/\bclient_id\b/g, 'so.client_id'),
          orderBy: 'm.submitted_at DESC NULLS LAST',
          params,
        };
      case REPORT_TYPES.Billing:
        return {
          fromClause: 'rpt.read_billing_records br INNER JOIN rpt.read_service_orders so ON so.id = br.service_order_id',
          selectClause: `SELECT br.id::text AS "billingRecordId",
                                so.order_number AS "orderNumber",
                                br.client_legal_name_snapshot AS "clientName",
                                br.status::text AS status,
                                br.prepared_at AS "preparedAt"`,
          whereClause: whereClause.replace(/\bunit_id\b/g, 'br.unit_id').replace(/\bclient_id\b/g, 'br.client_id'),
          orderBy: 'br.prepared_at DESC NULLS LAST',
          params,
        };
      case REPORT_TYPES.Receipts:
        return {
          fromClause: 'rpt.read_billing_documents bd',
          selectClause: `SELECT bd.document_number AS "documentNumber",
                                bd.client_legal_name_snapshot AS "clientName",
                                bd.status::text AS status,
                                bd.due_date AS "dueDate",
                                bd.total_amount::text AS amount`,
          whereClause: whereClause.replace(/\bunit_id\b/g, 'bd.unit_id').replace(/\bclient_id\b/g, 'bd.client_id'),
          orderBy: 'bd.due_date ASC NULLS LAST',
          params,
        };
      default:
        return {
          fromClause: null,
          selectClause: '',
          whereClause: 'FALSE',
          orderBy: '1',
          params,
        };
    }
  }

  private async scopeForReport(
    actor: IdentityAuthzContext,
    reportType: ReportType,
  ): Promise<ScopeSqlPredicate | null> {
    switch (reportType) {
      case REPORT_TYPES.ServiceOrdersByPeriod:
      case REPORT_TYPES.ServiceOrdersByClient:
      case REPORT_TYPES.ServiceOrdersByService:
      case REPORT_TYPES.ServiceOrdersOverdue:
        return this.scopeFor(actor, AUTHZ_ACTIONS.ServiceOrdersServiceOrderList, AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder);
      case REPORT_TYPES.AssetUtilization:
        return this.scopeFor(actor, AUTHZ_ACTIONS.ResourcesAssetList, AUTHZ_RESOURCE_TYPES.ResourcesAsset);
      case REPORT_TYPES.Measurements:
        return prefixAlias(
          await this.scopeFor(
            actor,
            AUTHZ_ACTIONS.MeasurementsMeasurementRead,
            AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
            'so',
          ),
          'so',
        );
      case REPORT_TYPES.Billing:
        return prefixAlias(
          await this.scopeFor(
            actor,
            AUTHZ_ACTIONS.BillingBillingRecordRead,
            AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
            'br',
          ),
          'br',
        );
      case REPORT_TYPES.Receipts:
        return prefixAlias(
          await this.scopeFor(
            actor,
            AUTHZ_ACTIONS.BillingBillingRecordRead,
            AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
            'bd',
          ),
          'bd',
        );
      case REPORT_TYPES.OperationalProductivity:
      case REPORT_TYPES.FinancialAging:
        return { clause: 'TRUE', params: [] };
      default:
        return { clause: 'FALSE', params: [] };
    }
  }

  private async scopeFor(
    actor: IdentityAuthzContext,
    action: (typeof AUTHZ_ACTIONS)[keyof typeof AUTHZ_ACTIONS],
    resourceType: (typeof AUTHZ_RESOURCE_TYPES)[keyof typeof AUTHZ_RESOURCE_TYPES],
    alias?: 'asset' | 'so' | 'br' | 'bd',
  ): Promise<ScopeSqlPredicate> {
    const grants = await this.authorizationRepository.findActiveGrants(
      actor.identityId,
      action,
      resourceType,
    );
    if (grants.length === 0) {
      return { clause: 'FALSE', params: [] };
    }
    if (resourceType === AUTHZ_RESOURCE_TYPES.ResourcesAsset) {
      return this.scopeEnforcement.buildPhysicalAssetListFilter(grants);
    }
    const commercial = this.scopeEnforcement.buildServiceOrderListFilter(grants);
    if (!alias) {
      return commercial;
    }
    if (alias === 'asset') {
      return commercial;
    }
    return prefixAlias(commercial, alias === 'so' ? 'so' : alias);
  }

  resolveTimezone(): string {
    return resolveBusinessTimezone();
  }
}
