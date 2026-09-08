import { Injectable } from '@nestjs/common';
import { ProductivityReadModelRepository } from '../../analytics/repositories/productivity-read-model.repository';
import {
  PRODUCTIVITY_PERIOD_PRESETS,
  ProductivityPeriodValidationError,
  resolveProductivityPeriod,
} from '../../analytics/domain/productivity-period';
import { resolveBusinessTimezone } from '../../analytics/domain/business-timezone';
import { maskProductivityRawAggregatesForCapabilities } from '../../analytics/domain/productivity-masking';
import { PRODUCTIVITY_GROUP_BY } from '../../analytics/domain/productivity-summary';
import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';
import { ScopeEnforcementService } from '../../authorization/services/scope-enforcement.service';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { prefixScopeAlias } from '../../analytics/repositories/aging-scope';
import { DASHBOARD_ERROR_CODES } from '../errors/dashboard-error-codes';
import { DashboardHttpException } from '../errors/dashboard-http.exception';
import { ExecutiveDashboardRepository } from '../repositories/executive-dashboard.repository';
import { OperationalDashboardRepository } from '../repositories/operational-dashboard.repository';
import { buildExecutiveDashboardSnapshot } from '../serializers/executive-dashboard-response.serializer';
import type { DashboardVisibility } from '../domain/operational-dashboard';
import { OperationalDashboardAccessService } from './operational-dashboard-access.service';

export type ExecutiveDashboardQuery = {
  period?: string;
  from?: string;
  to?: string;
  unitId?: string;
};

@Injectable()
export class ExecutiveDashboardAccessService {
  constructor(
    private readonly operationalAccess: OperationalDashboardAccessService,
    private readonly operationalRepository: OperationalDashboardRepository,
    private readonly executiveRepository: ExecutiveDashboardRepository,
    private readonly productivityRepository: ProductivityReadModelRepository,
    private readonly authorizationRepository: AuthorizationRepository,
    private readonly scopeEnforcement: ScopeEnforcementService,
  ) {}

  async getExecutiveSnapshot(actor: IdentityAuthzContext, query: ExecutiveDashboardQuery) {
    const visibility = await this.operationalAccess.requireVisibility(actor);

    const businessTimezone = resolveBusinessTimezone();
    const periodPreset = parsePeriod(query.period);
    let period;
    try {
      period = resolveProductivityPeriod({
        preset: periodPreset,
        customFrom: query.from,
        customTo: query.to,
        businessTimezone,
      });
    } catch (error) {
      if (error instanceof ProductivityPeriodValidationError) {
        throw new DashboardHttpException(400, DASHBOARD_ERROR_CODES.ACCESS_DENIED, 'Invalid period.');
      }
      throw error;
    }

    const serviceOrderScope = visibility.serviceOrders
      ? await this.scopeFor(actor, AUTHZ_ACTIONS.ServiceOrdersServiceOrderList)
      : null;
    const billingDocumentScope = visibility.billing
      ? await this.scopeFor(actor, AUTHZ_ACTIONS.BillingBillingRecordRead, 'bd')
      : null;

    // Capabilities que governam métricas de produtividade por fonte de dados.
    const resourcesGranted = visibility.resources;
    const executionGranted = await this.hasGrant(
      actor,
      AUTHZ_ACTIONS.ServiceOrdersExecutionRead,
      AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
    );

    const scopes = await this.buildOperationalScopes(actor, visibility);
    const unitId = query.unitId?.trim() || undefined;
    const operationalCounts = await this.operationalRepository.countOperationalMetrics(
      visibility,
      scopes,
      unitId,
    );

    const [chartData, productivityResult] = await Promise.all([
      serviceOrderScope
        ? this.executiveRepository.loadChartData({
            serviceOrderScope,
            billingDocumentScope,
            unitId,
            fromInclusive: period.fromInclusive,
            toExclusive: period.toExclusive,
            businessTimezone,
          })
        : Promise.resolve({
            statusDistribution: [],
            throughputTrend: [],
            slaPoints: [],
            financialAgingBuckets: [],
            financialAgingAvailable: false,
            overdueMaxDelayDays: null,
            approachingDueCount: 0,
            overdueReceivablesCount: 0,
            overdueReceivablesAmount: '0',
          }),
      visibility.serviceOrders
        ? this.productivityRepository.loadProductivityAggregates({
            fromInclusive: period.fromInclusive,
            toExclusive: period.toExclusive,
            serviceOrderScope,
            measurementScope: visibility.measurements
              ? await this.scopeFor(actor, AUTHZ_ACTIONS.MeasurementsMeasurementRead, 'so')
              : null,
            resourceScope: resourcesGranted
              ? await this.scopeFor(actor, AUTHZ_ACTIONS.ServiceOrdersResourceAllocationRead)
              : null,
            executionScope: executionGranted
              ? await this.scopeFor(actor, AUTHZ_ACTIONS.ServiceOrdersExecutionRead)
              : null,
            groupBy: PRODUCTIVITY_GROUP_BY.None,
            unitFilter: unitId,
          })
        : Promise.resolve({ overall: null, groups: [] }),
    ]);

    const productivityRaw =
      productivityResult.overall === null
        ? null
        : maskProductivityRawAggregatesForCapabilities(productivityResult.overall, {
            serviceOrders: visibility.serviceOrders,
            measurements: visibility.measurements,
            resources: resourcesGranted,
            execution: executionGranted,
          });

    return buildExecutiveDashboardSnapshot({
      generatedAt: new Date().toISOString(),
      businessTimezone,
      period: {
        preset: period.preset,
        from: period.labelFrom,
        to: period.labelTo,
      },
      visibility: {
        ...visibility,
        productivity: visibility.serviceOrders,
        financialAging: visibility.billing,
      },
      operationalCounts,
      chartData,
      productivityRaw,
    });
  }

  private async hasGrant(
    actor: IdentityAuthzContext,
    action: (typeof AUTHZ_ACTIONS)[keyof typeof AUTHZ_ACTIONS],
    resourceType: (typeof AUTHZ_RESOURCE_TYPES)[keyof typeof AUTHZ_RESOURCE_TYPES],
  ): Promise<boolean> {
    const grants = await this.authorizationRepository.findActiveGrants(
      actor.identityId,
      action,
      resourceType,
    );
    return grants.length > 0;
  }

  private async buildOperationalScopes(actor: IdentityAuthzContext, visibility: DashboardVisibility) {
    return {
      serviceRequestScope: visibility.serviceRequests
        ? await this.scopeFor(
            actor,
            AUTHZ_ACTIONS.RequestsServiceRequestList,
            undefined,
            AUTHZ_RESOURCE_TYPES.RequestsServiceRequest,
          )
        : null,
      serviceOrderScope: visibility.serviceOrders
        ? await this.scopeFor(actor, AUTHZ_ACTIONS.ServiceOrdersServiceOrderList)
        : null,
      measurementScope: visibility.measurements
        ? await this.scopeFor(actor, AUTHZ_ACTIONS.MeasurementsMeasurementRead, 'so')
        : null,
      billingScope: visibility.billing
        ? await this.scopeFor(actor, AUTHZ_ACTIONS.BillingBillingRecordRead, 'br')
        : null,
      documentScope: visibility.documents
        ? await this.scopeFor(actor, AUTHZ_ACTIONS.DocumentsDocumentList, 'd')
        : null,
      resourceScope: visibility.resources
        ? await this.scopeFor(actor, AUTHZ_ACTIONS.ServiceOrdersResourceAllocationRead, 'so')
        : null,
    };
  }

  private async scopeFor(
    actor: IdentityAuthzContext,
    action: (typeof AUTHZ_ACTIONS)[keyof typeof AUTHZ_ACTIONS],
    alias?: 'so' | 'bd' | 'br' | 'd' | 'sr',
    resourceType: (typeof AUTHZ_RESOURCE_TYPES)[keyof typeof AUTHZ_RESOURCE_TYPES] = AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
  ) {
    const grants = await this.authorizationRepository.findActiveGrants(actor.identityId, action, resourceType);
    const predicate =
      resourceType === AUTHZ_RESOURCE_TYPES.RequestsServiceRequest
        ? this.scopeEnforcement.buildServiceRequestListFilter(grants)
        : resourceType === AUTHZ_RESOURCE_TYPES.DocumentsDocument
          ? this.scopeEnforcement.buildDocumentListFilter(grants)
          : this.scopeEnforcement.buildServiceOrderListFilter(grants);
    return alias ? prefixScopeAlias(predicate, alias) : predicate;
  }
}

function parsePeriod(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (normalized === PRODUCTIVITY_PERIOD_PRESETS.Week) {
    return PRODUCTIVITY_PERIOD_PRESETS.Week;
  }
  if (normalized === PRODUCTIVITY_PERIOD_PRESETS.Month) {
    return PRODUCTIVITY_PERIOD_PRESETS.Month;
  }
  if (normalized === PRODUCTIVITY_PERIOD_PRESETS.Custom) {
    return PRODUCTIVITY_PERIOD_PRESETS.Custom;
  }
  if (normalized === PRODUCTIVITY_PERIOD_PRESETS.Today) {
    return PRODUCTIVITY_PERIOD_PRESETS.Today;
  }
  return PRODUCTIVITY_PERIOD_PRESETS.Week;
}
