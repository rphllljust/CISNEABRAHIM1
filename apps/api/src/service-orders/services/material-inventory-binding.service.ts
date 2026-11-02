import { Injectable } from '@nestjs/common';
import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';
import { toResourceContextFromAccounting } from '../../authorization/scope/scope-matcher';
import { assertPolicyAndGrantScope } from '../../authorization/services/domain-grant-authz.helper';
import { PolicyDecisionPointService } from '../../authorization/services/policy-decision-point.service';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
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
  ) {}

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
