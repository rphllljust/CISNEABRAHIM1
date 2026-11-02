import { Inject, Injectable } from '@nestjs/common';
import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';
import { toResourceContextFromAccounting } from '../../authorization/scope/scope-matcher';
import { assertPolicyAndGrantScope } from '../../authorization/services/domain-grant-authz.helper';
import { PolicyDecisionPointService } from '../../authorization/services/policy-decision-point.service';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { ENTERPRISE_CORE_PORT, type InventoryStockPort } from '../../platform/bounded-contexts/enterprise-core-ports';
import {
  MaterialBindingPersistenceError,
  MaterialInventoryBindingRepository,
} from '../repositories/material-inventory-binding.repository';
import { ServiceOrdersRepository } from '../repositories/service-orders.repository';
import { ServiceOrdersAccessAuthz } from './service-orders-access.authz';
import {
  serviceOrdersAccessDenied,
  serviceOrdersAccessNotFound,
  serviceOrdersIdempotencyKeyConflict,
  serviceOrdersInvalidState,
  serviceOrdersValidationFailed,
  serviceOrdersVersionConflict,
} from './service-orders-access.errors';
import { assertValidServiceOrderId } from './service-orders-input-resolution';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AuthorizeMaterialBindingInput = {
  actualId: string;
  inventoryItemId: string;
  warehouseId: string;
  rowVersion: number;
  idempotencyKey: string;
};

/**
 * Authorizes the identity of an Inventory material fact, NOT its stock movement.
 * OS EXECUTION_RECORD and Inventory MOVE must both pass their authoritative PDP
 * + active-grant scope checks. No inventory defaults, cost or accounting writes.
 */
@Injectable()
export class MaterialInventoryBindingService {
  constructor(
    private readonly serviceOrders: ServiceOrdersRepository,
    private readonly serviceOrdersAuthz: ServiceOrdersAccessAuthz,
    private readonly authorizationRepository: AuthorizationRepository,
    private readonly policyDecisionPoint: PolicyDecisionPointService,
    private readonly bindings: MaterialInventoryBindingRepository,
    @Inject(ENTERPRISE_CORE_PORT.InventoryStock)
    private readonly inventory: InventoryStockPort,
  ) {}

  /**
   * 2D/2E: Explicit business commands are distinct from authorization of the
   * binding. A fact NEVER creates OUT when it is merely recorded or bound.
   * The Inventory owner persists the OUT and its outbox in one transaction.
   */
  async consume(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    input: { actualId: string; rowVersion: number; idempotencyKey: string; reservationId?: string | null },
  ) {
    const binding = await this.requireActionableBinding(actor, serviceOrderId, input);
    if (input.reservationId && !UUID.test(input.reservationId)) throw serviceOrdersValidationFailed();
    const result = await this.inventory.postBoundMaterialActual({
      ...this.toInventorySnapshot(binding),
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      reservationId: input.reservationId ?? null,
    });
    return {
      actualId: binding.actual_id,
      inventoryItemId: binding.inventory_item_id,
      warehouseId: binding.warehouse_id,
      stockMovementId: result.movementId,
      stockPostingStatus: 'POSTED' as const,
      quantity: result.quantity,
      idempotent: result.idempotent,
      costingStatus: result.totalCost === null ? 'NOT_DECIDED' as const : 'VALUED' as const,
      totalCost: result.totalCost,
      // Accounting is owned by Inventory's economic outbox; not a fabricated journal.
      accountingStatus: result.totalCost === null ? 'NOT_APPLICABLE' as const : 'EVENT_PUBLISHED' as const,
    };
  }

  async reverseConsumption(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    input: { actualId: string; rowVersion: number; idempotencyKey: string; reason: string },
  ) {
    const binding = await this.requireActionableBinding(actor, serviceOrderId, input);
    if (typeof input.reason !== 'string' || input.reason.trim().length < 8) {
      throw serviceOrdersValidationFailed();
    }
    const result = await this.inventory.reverseBoundMaterialActual({
      ...this.toInventorySnapshot(binding),
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      reason: input.reason.trim(),
    });
    return {
      actualId: binding.actual_id,
      originalSourceId: binding.source_id,
      compensationMovementId: result.movementId,
      stockPostingStatus: 'REVERSED' as const,
      idempotent: result.idempotent,
      totalCost: result.totalCost,
      costingStatus: result.totalCost === null ? 'NOT_DECIDED' as const : 'VALUED' as const,
    };
  }

  /** Reconciliation for authorized work queues: no direct read of inv.*. */
  async reconcile(actor: IdentityAuthzContext, serviceOrderId: string, actualId: string) {
    const order = await this.serviceOrders.findById(serviceOrderId);
    if (!order) throw serviceOrdersAccessNotFound();
    await this.serviceOrdersAuthz.assertRecordAction(
      actor, AUTHZ_ACTIONS.ServiceOrdersExecutionRecord, order,
    );
    const binding = await this.bindings.findByActual(serviceOrderId, actualId);
    if (!binding) {
      return { actualId, stockPostingStatus: 'UNBOUND' as const, costingStatus: 'NOT_DECIDED' as const };
    }
    await this.assertInventoryGrant(actor, binding.inventory_item_id, binding.unit_id);
    const movements = await this.inventory.readBoundMaterialActual(this.toInventorySnapshot(binding));
    return {
      actualId: binding.actual_id,
      stockPostingStatus: movements.reversed ? 'REVERSED' as const :
        movements.posted ? 'POSTED' as const : 'NOT_POSTED' as const,
      stockMovementId: movements.posted?.movementId ?? null,
      reversalMovementId: movements.reversed?.movementId ?? null,
      costingStatus: movements.posted?.totalCost ? 'VALUED' as const : 'NOT_DECIDED' as const,
      totalCost: movements.posted?.totalCost ?? null,
    };
  }

  private toInventorySnapshot(binding: {
    actual_id: string; inventory_item_id: string; warehouse_id: string;
    unit_id: string; quantity: string; occurred_at: Date;
  }) {
    return {
      actualId: binding.actual_id,
      inventoryItemId: binding.inventory_item_id,
      warehouseId: binding.warehouse_id,
      unitId: binding.unit_id,
      quantity: binding.quantity,
      occurredOn: new Date(binding.occurred_at).toISOString().slice(0, 10),
    };
  }

  private async assertInventoryGrant(actor: IdentityAuthzContext, itemId: string, unitId: string) {
    await assertPolicyAndGrantScope(
      { authorizationRepository: this.authorizationRepository, policyDecisionPoint: this.policyDecisionPoint },
      {
        actor,
        action: AUTHZ_ACTIONS.InventoryMove,
        resourceType: AUTHZ_RESOURCE_TYPES.InventoryStock,
        context: toResourceContextFromAccounting({ id: itemId, unitId }),
        onDenied: serviceOrdersAccessDenied,
      },
    );
  }

  private async requireActionableBinding(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    input: { actualId: string; rowVersion: number; idempotencyKey: string },
  ) {
    assertValidServiceOrderId(serviceOrderId);
    if (!input || !UUID.test(input.actualId) || !Number.isSafeInteger(input.rowVersion) ||
      input.rowVersion < 0 || typeof input.idempotencyKey !== 'string' ||
      input.idempotencyKey.length < 1 || input.idempotencyKey.length > 128 ||
      input.idempotencyKey.trim() !== input.idempotencyKey) {
      throw serviceOrdersValidationFailed();
    }
    const order = await this.serviceOrders.findById(serviceOrderId);
    if (!order) throw serviceOrdersAccessNotFound();
    await this.serviceOrdersAuthz.assertRecordAction(
      actor, AUTHZ_ACTIONS.ServiceOrdersExecutionRecord, order,
    );
    if (order.status !== 'IN_EXECUTION') {
      throw serviceOrdersInvalidState('Stock consumption requires an order in execution.');
    }
    if (order.row_version !== input.rowVersion) throw serviceOrdersVersionConflict();
    const binding = await this.bindings.findByActual(serviceOrderId, input.actualId);
    if (!binding || binding.unit_id !== order.unit_id ||
      binding.source_id !== input.actualId || binding.source_kind !== 'SERVICE_ORDER_EXECUTION_ACTUAL') {
      throw serviceOrdersInvalidState('Material must be bound to an authorized exact SKU and warehouse.');
    }
    await this.assertInventoryGrant(actor, binding.inventory_item_id, binding.unit_id);
    return binding;
  }

  async bind(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    input: AuthorizeMaterialBindingInput,
  ) {
    assertValidServiceOrderId(serviceOrderId);
    if (
      !input ||
      !UUID.test(input.actualId) ||
      !UUID.test(input.inventoryItemId) ||
      !UUID.test(input.warehouseId) ||
      !Number.isSafeInteger(input.rowVersion) ||
      input.rowVersion < 0 ||
      typeof input.idempotencyKey !== 'string' ||
      input.idempotencyKey.length < 1 ||
      input.idempotencyKey.length > 128 ||
      input.idempotencyKey.trim() !== input.idempotencyKey
    ) {
      throw serviceOrdersValidationFailed();
    }

    const order = await this.serviceOrders.findById(serviceOrderId);
    if (!order) throw serviceOrdersAccessNotFound();
    await this.serviceOrdersAuthz.assertRecordAction(
      actor, AUTHZ_ACTIONS.ServiceOrdersExecutionRecord, order,
    );
    // This is the same Inventory MOVE PDP/grant scope contract used by
    // InventoryAccessAuthz, not a Service Orders-only permission shortcut.
    await assertPolicyAndGrantScope(
      { authorizationRepository: this.authorizationRepository, policyDecisionPoint: this.policyDecisionPoint },
      {
        actor,
        action: AUTHZ_ACTIONS.InventoryMove,
        resourceType: AUTHZ_RESOURCE_TYPES.InventoryStock,
        context: toResourceContextFromAccounting({ id: input.inventoryItemId, unitId: order.unit_id }),
        onDenied: serviceOrdersAccessDenied,
      },
    );

    try {
      const result = await this.bindings.bind({
        serviceOrderId,
        actualId: input.actualId,
        inventoryItemId: input.inventoryItemId,
        warehouseId: input.warehouseId,
        unitId: order.unit_id,
        actorIdentityId: actor.identityId,
        rowVersion: input.rowVersion,
        idempotencyKey: input.idempotencyKey,
      });
      const row = result.row;
      return {
        id: row.id,
        serviceOrderId: row.service_order_id,
        actualId: row.actual_id,
        unitId: row.unit_id,
        inventoryItemId: row.inventory_item_id,
        warehouseId: row.warehouse_id,
        quantity: row.quantity,
        unitOfMeasure: row.unit_of_measure,
        sourceKind: row.source_kind,
        sourceId: row.source_id,
        authorizedByIdentityId: row.authorized_by_identity_id,
        authorizedAt: new Date(row.authorized_at).toISOString(),
        occurredAt: new Date(row.occurred_at).toISOString(),
        idempotent: result.idempotent,
        stockMovementId: null,
        stockPostingStatus: 'NOT_POSTED' as const,
        costingStatus: 'NOT_DECIDED' as const,
      };
    } catch (error) {
      if (!(error instanceof MaterialBindingPersistenceError)) throw error;
      switch (error.reason) {
        case 'NOT_FOUND':
          throw serviceOrdersAccessNotFound();
        case 'VERSION_CONFLICT':
          throw serviceOrdersVersionConflict();
        case 'IDEMPOTENCY_CONFLICT':
          throw serviceOrdersIdempotencyKeyConflict();
        case 'INVALID_STATE':
          throw serviceOrdersInvalidState('Material binding requires an order in execution.');
        case 'INVALID_FACT':
          throw serviceOrdersInvalidState('Material binding requires an exact positive MATERIAL_QUANTITY actual with at most four decimal places.');
        case 'INVALID_REFERENCE':
          throw serviceOrdersInvalidState('Material binding references do not belong to the same operational unit or do not exist.');
      }
    }
  }
}
