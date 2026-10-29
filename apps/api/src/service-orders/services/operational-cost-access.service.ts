import { Injectable } from '@nestjs/common';
import {
  SECURITY_AUDIT_ACTIONS,
  SECURITY_AUDIT_CLASSIFICATIONS,
  SECURITY_AUDIT_OUTCOMES,
  SECURITY_AUDIT_RESOURCE_TYPES,
} from '../../audit/types/security-audit.types';
import { SecurityAuditService } from '../../audit/services/security-audit.service';
import type { AuthzAction } from '../../authorization/types/authz-actions';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import {
  assertOperationalCostRecordableState,
  OperationalCostError,
} from '../domain/operational-cost';
import { buildOperationalMarginSummary } from '../domain/operational-margin';
import type { ApprovedMeasurementRevenueEvidence } from '../domain/approved-measurement-revenue';
import { ApprovedMeasurementRevenueReader } from '../../measurements/application/approved-measurement-revenue.reader';
import type { RecordOperationalCostInput } from '../domain/operational-cost.validation';
import { OperationalCostRepository } from '../repositories/operational-cost.repository';
import type { OperationalCostEntryRow } from '../repositories/operational-cost.repository.types';
import { ServiceOrdersRepository } from '../repositories/service-orders.repository';
import type { ServiceOrderRow } from '../repositories/service-orders.repository.types';
import {
  toOperationalCostBundleResponse,
  toOperationalCostRecordResponse,
  type OperationalCostBundleResponse,
} from '../serializers/operational-cost-response.serializer';
import { ServiceOrdersAccessAuthz } from './service-orders-access.authz';
import {
  mapOperationalCostError,
  serviceOrdersAccessNotFound,
  serviceOrdersIdempotencyKeyConflict,
  serviceOrdersVersionConflict,
} from './service-orders-access.errors';
import { assertValidServiceOrderId } from './service-orders-input-resolution';

@Injectable()
export class OperationalCostAccessService {
  constructor(
    private readonly serviceOrdersRepository: ServiceOrdersRepository,
    private readonly operationalCostRepository: OperationalCostRepository,
    private readonly approvedMeasurementRevenueReader: ApprovedMeasurementRevenueReader,
    private readonly authz: ServiceOrdersAccessAuthz,
    private readonly securityAudit: SecurityAuditService,
  ) {}

  async listByServiceOrder(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
  ): Promise<OperationalCostBundleResponse> {
    const order = await this.requireServiceOrder(
      actor,
      serviceOrderId,
      AUTHZ_ACTIONS.ServiceOrdersOperationalCostRead,
    );
    const [entries, revenue] = await Promise.all([
      this.operationalCostRepository.listByServiceOrder(serviceOrderId),
      this.approvedMeasurementRevenueReader.readForServiceOrder(serviceOrderId),
    ]);
    return toOperationalCostBundleResponse(
      serviceOrderId,
      order.row_version,
      entries,
      this.buildSummary(entries, revenue),
    );
  }

  async recordCost(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    input: RecordOperationalCostInput,
  ) {
    assertValidServiceOrderId(serviceOrderId);
    const order = await this.requireServiceOrder(
      actor,
      serviceOrderId,
      AUTHZ_ACTIONS.ServiceOrdersOperationalCostRecord,
    );
    try {
      assertOperationalCostRecordableState(order.status, input.costKind);
    } catch (error) {
      if (error instanceof OperationalCostError) {
        throw mapOperationalCostError(error);
      }
      throw error;
    }

    const result = await this.operationalCostRepository.recordCost({
      serviceOrderId,
      origin: input.origin,
      sourceExecutionEntryId: input.sourceExecutionEntryId ?? null,
      category: input.category,
      costKind: input.costKind,
      description: input.description ?? null,
      amount: input.amount,
      currencyCode: input.currencyCode ?? 'BRL',
      quantityValue: input.quantityValue ?? null,
      quantityUnitCode: input.quantityUnitCode ?? null,
      originContext: input.originContext ?? {},
      actorIdentityId: actor.identityId,
      idempotencyKey: input.idempotencyKey ?? null,
      rowVersion: input.rowVersion,
    });

    if (result.outcome === 'version_conflict') {
      throw serviceOrdersVersionConflict();
    }
    if (result.outcome === 'execution_entry_not_found') {
      throw mapOperationalCostError(new OperationalCostError('EXECUTION_ENTRY_NOT_FOUND'));
    }
    if (result.outcome === 'duplicate_cost_entry') {
      throw mapOperationalCostError(new OperationalCostError('DUPLICATE_COST_ENTRY'));
    }
    if (result.outcome === 'idempotency_key_conflict') {
      throw serviceOrdersIdempotencyKeyConflict();
    }
    if (result.outcome === 'invalid_state') {
      throw mapOperationalCostError(new OperationalCostError('INVALID_STATE'));
    }

    const entry = result.outcome === 'success' ? result.entry : result.payload.entry;
    const rowVersion = result.outcome === 'success' ? result.rowVersion : order.row_version;

    await this.audit(actor, serviceOrderId, entry);
    return toOperationalCostRecordResponse(entry, rowVersion);
  }

  private buildSummary(entries: OperationalCostEntryRow[], revenue: ApprovedMeasurementRevenueEvidence) {
    const summary = buildOperationalMarginSummary({
      revenue: revenue.amount,
      currencyCode: revenue.currencyCode ?? entries[0]?.currency_code ?? 'BRL',
      lines: entries.map((entry) => ({
        id: entry.id,
        category: entry.category,
        costKind: entry.cost_kind,
        origin: entry.origin,
        amount: entry.amount,
        currencyCode: entry.currency_code,
        sourceExecutionEntryId: entry.source_execution_entry_id,
      })),
    });
    const currencyOrAmountFailure = revenue.issue === 'UNVERIFIED_CURRENCY'
      ? 'REVENUE_CURRENCY_UNVERIFIED'
      : revenue.issue === 'MISSING_AMOUNT'
        ? 'APPROVED_MEASUREMENT_AMOUNT_INCOMPLETE'
        : null;
    return currencyOrAmountFailure
      ? { ...summary, blockingReasons: [...summary.blockingReasons, currencyOrAmountFailure] }
      : summary;
  }

  private async requireServiceOrder(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    action: AuthzAction,
  ): Promise<ServiceOrderRow> {
    assertValidServiceOrderId(serviceOrderId);
    const order = await this.serviceOrdersRepository.findById(serviceOrderId);
    if (!order) {
      throw serviceOrdersAccessNotFound();
    }
    await this.authz.assertRecordAction(actor, action, order);
    return order;
  }

  private async audit(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    entry: OperationalCostEntryRow,
  ): Promise<void> {
    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.ServiceOrdersOperationalCostRecord,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      resourceId: serviceOrderId,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      metadata: {
        operationalCostEntryId: entry.id,
        category: entry.category,
        costKind: entry.cost_kind,
        origin: entry.origin,
        amount: entry.amount,
      },
    });
  }
}
