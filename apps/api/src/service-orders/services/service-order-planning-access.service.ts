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
import { ResourceCompatibilityError, assertResourceTypeMatchesRequirement, assertLaborTypeInServiceRequirements } from '../domain/resource-compatibility';
import {
  assertIntervalWithinParent,
  assertPlannedOperationalWindow,
  isHalfOpenIntervalValid,
  PLANNED_RESOURCE_KINDS,
  resolvePlannedOperationalWindow,
  SERVICE_ORDER_PLANNING_ALLOWED_STATUSES,
} from '../domain/resource-planning';
import {
  assertRentalContractedPeriodPresent,
  isRentalServiceOrder,
} from '../domain/rental-operations';
import {
  assertTransportRoutePresent,
  assertTransportScheduledWindowPresent,
  isTransportServiceOrder,
} from '../domain/transport-operations';
import type {
  AllocateResourceInput,
  PlanResourceInput,
  ReallocateResourceInput,
  RemoveAllocationInput,
  RemovePlannedResourceInput,
  UpdatePlannedResourceInput,
} from '../dto/resource-planning.dto';
import { ResourcePlanningRepository } from '../repositories/resource-planning.repository';
import { ServiceOrdersRepository } from '../repositories/service-orders.repository';
import type { ServiceOrderRow } from '../repositories/service-orders.repository.types';
import {
  toPlannedResourceResponse,
  toResourceAllocationDetailResponse,
  toResourceAllocationResponse,
  type PlannedResourceResponse,
  type ResourceAllocationDetailResponse,
  type ResourceAllocationResponse,
} from '../serializers/resource-planning-response.serializer';
import type { ServiceOrderServiceSnapshot } from '../domain/service-order-snapshot';
import { ServiceOrdersAccessAuthz } from './service-orders-access.authz';
import {
  mapResourceCompatibilityError,
  serviceOrdersAccessNotFound,
  serviceOrdersAllocationConflict,
  serviceOrdersAllocationNotFound,
  serviceOrdersAllocationOutsideWindow,
  serviceOrdersAssetInactive,
  serviceOrdersAssetNotFound,
  serviceOrdersInvalidState,
  serviceOrdersLaborAllocationNotSupported,
  serviceOrdersPlannedResourceNotFound,
  serviceOrdersResourceTypeMismatch,
  serviceOrdersValidationFailed,
  serviceOrdersVersionConflict,
} from './service-orders-access.errors';
import { assertValidServiceOrderId } from './service-orders-input-resolution';

function readServiceOrderArchetypeSnapshot(
  snapshot: Record<string, unknown>,
): Pick<ServiceOrderServiceSnapshot, 'archetype'> {
  return {
    archetype: typeof snapshot['archetype'] === 'string' ? snapshot['archetype'] : '',
  };
}

@Injectable()
export class ServiceOrderPlanningAccessService {
  constructor(
    private readonly serviceOrdersRepository: ServiceOrdersRepository,
    private readonly planningRepository: ResourcePlanningRepository,
    private readonly authz: ServiceOrdersAccessAuthz,
    private readonly securityAudit: SecurityAuditService,
  ) {}

  async listPlannedResources(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
  ): Promise<PlannedResourceResponse[]> {
    await this.requireServiceOrder(actor, serviceOrderId, AUTHZ_ACTIONS.ServiceOrdersPlannedResourceRead);
    const rows = await this.planningRepository.listPlannedResources(serviceOrderId);
    return rows.map(toPlannedResourceResponse);
  }

  async listAllocations(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
  ): Promise<ResourceAllocationResponse[]> {
    await this.requireServiceOrder(actor, serviceOrderId, AUTHZ_ACTIONS.ServiceOrdersResourceAllocationRead);
    const rows = await this.planningRepository.listAllocations(serviceOrderId);
    return rows.map(toResourceAllocationResponse);
  }

  async planResource(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    input: PlanResourceInput,
  ): Promise<PlannedResourceResponse> {
    const order = await this.requirePlanningOrder(
      actor,
      serviceOrderId,
      AUTHZ_ACTIONS.ServiceOrdersPlannedResourcePlan,
    );
    this.validatePlanInput(order, input);

    if (
      isRentalServiceOrder(readServiceOrderArchetypeSnapshot(order.service_snapshot)) &&
      input.requirementKind === PLANNED_RESOURCE_KINDS.PhysicalResource
    ) {
      try {
        assertRentalContractedPeriodPresent({
          operationalStart: input.operationalStart ?? null,
          operationalEnd: input.operationalEnd ?? null,
        });
      } catch (error) {
        if (error instanceof Error && error.message === 'RENTAL_CONTRACTED_PERIOD_REQUIRED') {
          throw serviceOrdersValidationFailed();
        }
        throw error;
      }
    }

    if (
      isTransportServiceOrder(readServiceOrderArchetypeSnapshot(order.service_snapshot)) &&
      input.requirementKind === PLANNED_RESOURCE_KINDS.PhysicalResource
    ) {
      try {
        assertTransportRoutePresent(order.location);
        assertTransportScheduledWindowPresent({
          operationalStart: input.operationalStart ?? null,
          operationalEnd: input.operationalEnd ?? null,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          ['TRANSPORT_ROUTE_REQUIRED', 'TRANSPORT_SCHEDULED_WINDOW_REQUIRED'].includes(error.message)
        ) {
          throw serviceOrdersValidationFailed();
        }
        throw error;
      }
    }

    const created = await this.planningRepository.createPlannedResource({
      serviceOrderId,
      requirementKind: input.requirementKind,
      resourceTypeCode:
        input.requirementKind === PLANNED_RESOURCE_KINDS.PhysicalResource ? input.resourceTypeCode : null,
      laborTypeCode: input.requirementKind === PLANNED_RESOURCE_KINDS.Labor ? input.laborTypeCode : null,
      plannedQuantity: input.plannedQuantity,
      operationalStart: input.operationalStart ?? null,
      operationalEnd: input.operationalEnd ?? null,
      notes: input.notes ?? null,
      actorIdentityId: actor.identityId,
    });

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.ServiceOrdersPlannedResourcePlan,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      resourceId: serviceOrderId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata: { plannedResourceId: created.id, requirementKind: input.requirementKind },
    });

    return toPlannedResourceResponse(created);
  }

  async updatePlannedResource(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    plannedResourceId: string,
    input: UpdatePlannedResourceInput,
  ): Promise<PlannedResourceResponse> {
    await this.requirePlanningOrder(actor, serviceOrderId, AUTHZ_ACTIONS.ServiceOrdersPlannedResourceUpdate);
    if (input.plannedQuantity && Number(input.plannedQuantity) <= 0) {
      throw serviceOrdersValidationFailed();
    }

    const current = await this.planningRepository.findPlannedResourceById(plannedResourceId, serviceOrderId);
    if (!current) {
      throw serviceOrdersPlannedResourceNotFound();
    }

    try {
      const nextWindow = resolvePlannedOperationalWindow(current, input);
      assertPlannedOperationalWindow(nextWindow.start, nextWindow.end);
    } catch (error) {
      if (error instanceof Error && ['PLANNED_WINDOW_INCOMPLETE', 'PLANNED_WINDOW_INVALID'].includes(error.message)) {
        throw serviceOrdersValidationFailed();
      }
      throw error;
    }

    const updated = await this.planningRepository.updatePlannedResource({
      plannedResourceId,
      serviceOrderId,
      rowVersion: input.rowVersion,
      plannedQuantity: input.plannedQuantity,
      operationalStart: input.operationalStart,
      operationalEnd: input.operationalEnd,
      notes: input.notes,
      actorIdentityId: actor.identityId,
    });
    if (updated === 'VERSION_CONFLICT') {
      throw serviceOrdersVersionConflict('Resource was modified by another request.');
    }
    if (updated === 'ALLOCATION_OUTSIDE_WINDOW') {
      throw serviceOrdersAllocationOutsideWindow();
    }
    if (updated === 'VALIDATION_FAILED') {
      throw serviceOrdersValidationFailed();
    }
    if (updated === 'INVALID_STATE') {
      throw serviceOrdersInvalidState('Operation is not allowed in the current state.');
    }
    return toPlannedResourceResponse(updated);
  }

  async removePlannedResource(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    plannedResourceId: string,
    input: RemovePlannedResourceInput,
  ): Promise<PlannedResourceResponse> {
    await this.requirePlanningOrder(actor, serviceOrderId, AUTHZ_ACTIONS.ServiceOrdersPlannedResourceRemove);

    const removed = await this.planningRepository.removePlannedResource({
      plannedResourceId,
      serviceOrderId,
      rowVersion: input.rowVersion,
      actorIdentityId: actor.identityId,
    });
    if (removed === 'VERSION_CONFLICT') {
      throw serviceOrdersVersionConflict('Resource was modified by another request.');
    }
    if (removed === 'INVALID_STATE') {
      throw serviceOrdersInvalidState('Operation is not allowed in the current state.');
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.ServiceOrdersPlannedResourceRemove,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      resourceId: serviceOrderId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata: { plannedResourceId },
    });

    return toPlannedResourceResponse(removed);
  }

  async allocateResource(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    input: AllocateResourceInput,
  ): Promise<ResourceAllocationDetailResponse> {
    const order = await this.requirePlanningOrder(actor, serviceOrderId, AUTHZ_ACTIONS.ServiceOrdersResourceAllocate);

    const planned = await this.planningRepository.findPlannedResourceById(input.plannedResourceId, serviceOrderId);
    if (!planned) {
      throw serviceOrdersPlannedResourceNotFound();
    }
    if (
      planned.requirement_kind !== PLANNED_RESOURCE_KINDS.PhysicalResource &&
      planned.requirement_kind !== PLANNED_RESOURCE_KINDS.Labor
    ) {
      throw serviceOrdersPlannedResourceNotFound();
    }
    const allocationResourceCode =
      planned.requirement_kind === PLANNED_RESOURCE_KINDS.PhysicalResource
        ? planned.resource_type_code
        : planned.labor_type_code;
    if (!allocationResourceCode) {
      throw serviceOrdersInvalidState('Operation is not allowed in the current state.');
    }
    if (planned.requirement_kind === PLANNED_RESOURCE_KINDS.PhysicalResource && !input.physicalAssetId) {
      throw serviceOrdersValidationFailed();
    }
    if (planned.requirement_kind === PLANNED_RESOURCE_KINDS.Labor && !input.workforceMemberId) {
      throw serviceOrdersValidationFailed();
    }

    if (isRentalServiceOrder(readServiceOrderArchetypeSnapshot(order.service_snapshot))) {
      try {
        assertRentalContractedPeriodPresent({
          operationalStart: planned.operational_start,
          operationalEnd: planned.operational_end,
        });
      } catch (error) {
        if (error instanceof Error && error.message === 'RENTAL_CONTRACTED_PERIOD_REQUIRED') {
          throw serviceOrdersValidationFailed();
        }
        throw error;
      }
    }

    if (isTransportServiceOrder(readServiceOrderArchetypeSnapshot(order.service_snapshot))) {
      try {
        assertTransportRoutePresent(order.location);
        assertTransportScheduledWindowPresent({
          operationalStart: planned.operational_start,
          operationalEnd: planned.operational_end,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          ['TRANSPORT_ROUTE_REQUIRED', 'TRANSPORT_SCHEDULED_WINDOW_REQUIRED'].includes(error.message)
        ) {
          throw serviceOrdersValidationFailed();
        }
        throw error;
      }
    }

    const start = new Date(input.operationalStart);
    const end = new Date(input.operationalEnd);
    if (!isHalfOpenIntervalValid(start, end)) {
      throw serviceOrdersValidationFailed();
    }
    try {
      assertIntervalWithinParent(
        start,
        end,
        planned.operational_start ? new Date(planned.operational_start) : null,
        planned.operational_end ? new Date(planned.operational_end) : null,
      );
      if (planned.requirement_kind === PLANNED_RESOURCE_KINDS.Labor) {
        assertLaborTypeInServiceRequirements(order.service_snapshot, allocationResourceCode);
      } else {
        assertResourceTypeMatchesRequirement(
          order.service_snapshot,
          allocationResourceCode,
          allocationResourceCode,
        );
      }
    } catch (error) {
      if (error instanceof ResourceCompatibilityError) {
        throw mapResourceCompatibilityError(error);
      }
      if (error instanceof Error && error.message === 'ALLOCATION_OUTSIDE_PLANNED_WINDOW') {
        throw serviceOrdersAllocationOutsideWindow();
      }
      throw error;
    }

    const result = await this.planningRepository.allocateResource({
      serviceOrderId,
      plannedResourceId: input.plannedResourceId,
      physicalAssetId: input.physicalAssetId ?? null,
      workforceMemberId: input.workforceMemberId ?? null,
      resourceTypeCode: allocationResourceCode,
      operationalStart: input.operationalStart,
      operationalEnd: input.operationalEnd,
      actorIdentityId: actor.identityId,
    });

    return this.mapAllocationResult(actor, serviceOrderId, result);
  }

  async reallocateResource(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    allocationId: string,
    input: ReallocateResourceInput,
  ): Promise<ResourceAllocationDetailResponse> {
    const order = await this.requirePlanningOrder(
      actor,
      serviceOrderId,
      AUTHZ_ACTIONS.ServiceOrdersResourceReallocate,
    );
    const current = await this.planningRepository.findAllocationById(allocationId, serviceOrderId);
    if (!current) {
      throw serviceOrdersAllocationNotFound();
    }
    if (current.workforce_member_id) {
      throw serviceOrdersLaborAllocationNotSupported();
    }

    const start = new Date(input.operationalStart);
    const end = new Date(input.operationalEnd);
    if (!isHalfOpenIntervalValid(start, end)) {
      throw serviceOrdersValidationFailed();
    }
    const planned = current.planned_resource_id
      ? await this.planningRepository.findPlannedResourceById(current.planned_resource_id, serviceOrderId)
      : null;
    try {
      assertIntervalWithinParent(
        start,
        end,
        planned?.operational_start ? new Date(planned.operational_start) : null,
        planned?.operational_end ? new Date(planned.operational_end) : null,
      );
      assertResourceTypeMatchesRequirement(
        order.service_snapshot,
        current.resource_type_code,
        current.resource_type_code,
      );
    } catch (error) {
      if (error instanceof ResourceCompatibilityError) {
        throw mapResourceCompatibilityError(error);
      }
      if (error instanceof Error && error.message === 'ALLOCATION_OUTSIDE_PLANNED_WINDOW') {
        throw serviceOrdersAllocationOutsideWindow();
      }
      throw error;
    }

    const result = await this.planningRepository.reallocateResource({
      serviceOrderId,
      allocationId,
      rowVersion: input.rowVersion,
      newPhysicalAssetId: input.physicalAssetId,
      resourceTypeCode: current.resource_type_code,
      operationalStart: input.operationalStart,
      operationalEnd: input.operationalEnd,
      actorIdentityId: actor.identityId,
    });

    return this.mapAllocationResult(actor, serviceOrderId, result, {
      auditAction: SECURITY_AUDIT_ACTIONS.ServiceOrdersResourceReallocate,
      metadata: { fromAllocationId: allocationId },
    });
  }

  async removeAllocation(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    allocationId: string,
    input: RemoveAllocationInput,
  ): Promise<ResourceAllocationDetailResponse> {
    await this.requirePlanningOrder(
      actor,
      serviceOrderId,
      AUTHZ_ACTIONS.ServiceOrdersResourceRemoveAllocation,
    );

    const removed = await this.planningRepository.removeAllocation({
      serviceOrderId,
      allocationId,
      rowVersion: input.rowVersion,
      actorIdentityId: actor.identityId,
    });
    if (removed === 'VERSION_CONFLICT') {
      throw serviceOrdersVersionConflict('Resource was modified by another request.');
    }
    if (removed === 'INVALID_STATE') {
      throw serviceOrdersInvalidState('Operation is not allowed in the current state.');
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.ServiceOrdersResourceRemoveAllocation,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      resourceId: serviceOrderId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata: { allocationId },
    });

    const history = await this.planningRepository.listAllocationHistory(allocationId);
    return toResourceAllocationDetailResponse(removed, history);
  }

  private validatePlanInput(order: ServiceOrderRow, input: PlanResourceInput): void {
    if (input.operationalStart && input.operationalEnd) {
      const start = new Date(input.operationalStart);
      const end = new Date(input.operationalEnd);
      if (!isHalfOpenIntervalValid(start, end)) {
        throw serviceOrdersValidationFailed();
      }
    } else if (input.operationalStart || input.operationalEnd) {
      throw serviceOrdersValidationFailed();
    }

    if (input.requirementKind === PLANNED_RESOURCE_KINDS.PhysicalResource) {
      if (!input.resourceTypeCode) {
        throw serviceOrdersValidationFailed();
      }
      try {
        assertResourceTypeMatchesRequirement(
          order.service_snapshot,
          input.resourceTypeCode,
          input.resourceTypeCode,
        );
      } catch (error) {
        if (error instanceof ResourceCompatibilityError) {
          throw mapResourceCompatibilityError(error);
        }
        throw error;
      }
      return;
    }

    if (!input.laborTypeCode) {
      throw serviceOrdersValidationFailed();
    }
    try {
      assertLaborTypeInServiceRequirements(order.service_snapshot, input.laborTypeCode);
    } catch (error) {
      if (error instanceof ResourceCompatibilityError) {
        throw mapResourceCompatibilityError(error);
      }
      throw error;
    }
  }

  private async mapAllocationResult(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    result: Awaited<ReturnType<ResourcePlanningRepository['allocateResource']>>,
    options?: {
      auditAction?: (typeof SECURITY_AUDIT_ACTIONS)[keyof typeof SECURITY_AUDIT_ACTIONS];
      metadata?: Record<string, unknown>;
    },
  ): Promise<ResourceAllocationDetailResponse> {
    switch (result.outcome) {
      case 'allocated': {
        await this.securityAudit.record({
          actorIdentityId: actor.identityId,
          actorSessionId: actor.sessionId,
          action: options?.auditAction ?? SECURITY_AUDIT_ACTIONS.ServiceOrdersResourceAllocate,
          resourceType: SECURITY_AUDIT_RESOURCE_TYPES.ServiceOrdersServiceOrder,
          resourceId: serviceOrderId,
          outcome: SECURITY_AUDIT_OUTCOMES.Success,
          classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
          metadata: {
            allocationId: result.allocation.id,
            physicalAssetId: result.allocation.physical_asset_id,
            ...options?.metadata,
          },
        });
        const history = await this.planningRepository.listAllocationHistory(result.allocation.id);
        return toResourceAllocationDetailResponse(result.allocation, history);
      }
      case 'version_conflict':
        throw serviceOrdersVersionConflict('Resource was modified by another request.');
      case 'asset_not_found':
        throw serviceOrdersAssetNotFound();
      case 'asset_inactive':
        throw serviceOrdersAssetInactive();
      case 'allocation_conflict':
        throw serviceOrdersAllocationConflict();
      case 'planned_not_found':
        throw serviceOrdersPlannedResourceNotFound();
      case 'invalid_state':
        throw serviceOrdersResourceTypeMismatch();
      default:
        throw serviceOrdersInvalidState('Operation is not allowed in the current state.');
    }
  }

  private async requirePlanningOrder(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    action: AuthzAction,
  ): Promise<ServiceOrderRow> {
    const row = await this.requireServiceOrder(actor, serviceOrderId, action);
    if (!SERVICE_ORDER_PLANNING_ALLOWED_STATUSES.has(row.status)) {
      throw serviceOrdersInvalidState('Operation is not allowed in the current state.');
    }
    return row;
  }

  private async requireServiceOrder(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    action: AuthzAction,
  ): Promise<ServiceOrderRow> {
    assertValidServiceOrderId(serviceOrderId);
    const row = await this.serviceOrdersRepository.findById(serviceOrderId);
    if (!row) {
      throw serviceOrdersAccessNotFound();
    }
    await this.authz.assertRecordAction(actor, action, row);
    return row;
  }
}
