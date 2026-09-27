import { Injectable } from '@nestjs/common';
import {
  SECURITY_AUDIT_ACTIONS,
  SECURITY_AUDIT_CLASSIFICATIONS,
  SECURITY_AUDIT_OUTCOMES,
  SECURITY_AUDIT_RESOURCE_TYPES,
} from '../../audit/types/security-audit.types';
import { SecurityAuditService } from '../../audit/services/security-audit.service';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import type { InventoryStockPort } from '../../platform/bounded-contexts/enterprise-core-ports';
import { assertUuid } from '../../platform/kernel/uuid';
import {
  applyExplicitCosting,
  originForMovement,
  reconcileExplicitCosts,
} from '../domain/costing';
import {
  validateCreateCostingRuleInput,
  validateCreateCostingRuleVersionInput,
  validateCostingRuleId,
  validatePublishCostingRuleVersionInput,
  type CreateCostingRuleInput,
  type CreateCostingRuleVersionInput,
  type PublishCostingRuleVersionInput,
} from '../domain/costing.validation';
import {
  ADJUSTMENT_EFFECTS,
  COSTING_METHOD_STATUSES,
  RESERVATION_STATUSES,
  STOCK_MOVEMENT_TYPES,
  TRANSFER_LEGS,
  InventoryError,
  assertCostingNotInvented,
  assertCostingUndecided,
  assertNegativeStockUnauthorized,
  assertSufficientStock,
  deriveStockPosition,
  reconcileOnHand,
  signedQuantityForMovement,
} from '../domain/inventory';
import {
  validateCreateInventoryItemInput,
  validateCreateWarehouseInput,
  validatePostStockMovementInput,
  validateReserveStockInput,
  type CreateInventoryItemInput,
  type CreateWarehouseInput,
  type PostStockMovementInput,
  type ReserveStockInput,
} from '../domain/inventory.validation';
import { InventoryRepository } from '../repositories/inventory.repository';
import type { PersistMovementInput } from '../repositories/inventory.repository.types';
import {
  toBalanceResponse,
  toCostingRuleResponse,
  toCostingRuleVersionResponse,
  toInventoryItemResponse,
  toReservationResponse,
  toStockMovementResponse,
  toStockMovementSummaryResponse,
  toStockReservationSummaryResponse,
  toWarehouseResponse,
  type CostingRuleResponse,
  type CostingRuleVersionResponse,
  type InventoryItemListResponse,
  type InventoryItemResponse,
  type PostMovementResponse,
  type StockBalanceResponse,
  type StockMovementListResponse,
  type StockReservationListResponse,
  type StockReservationResponse,
  type WarehouseListResponse,
  type WarehouseResponse,
} from '../serializers/inventory-response.serializer';
import type { InventoryListQuery } from '../dto/inventory-list.dto';
import { InventoryAccessAuthz } from './inventory-access.authz';
import { inventoryAccessDenied, mapInventoryDomainError } from './inventory-access.errors';
import { InventoryAccountingIntegrationService } from './inventory-accounting-integration.service';

@Injectable()
export class InventoryAccessService implements InventoryStockPort {
  constructor(
    private readonly repository: InventoryRepository,
    private readonly authz: InventoryAccessAuthz,
    private readonly authorizationRepository: AuthorizationRepository,
    private readonly securityAudit: SecurityAuditService,
    private readonly accountingIntegration: InventoryAccountingIntegrationService,
  ) {}

  /**
   * Listagens operacionais do estoque. A autorização é a mesma classe das demais ações do recurso
   * `InventoryStock`, com concessão de lista própria: sem ela nada é listado, e a tela deixa de
   * exigir que o operador digite identificadores de depósito, item, movimento ou reserva.
   */
  async listWarehouses(
    actor: IdentityAuthzContext,
    query: InventoryListQuery,
  ): Promise<WarehouseListResponse> {
    await this.assertInventoryList(actor, AUTHZ_ACTIONS.InventoryWarehouseList, query.unitId);
    const whereParts: string[] = [];
    const params: unknown[] = [];
    if (query.status) {
      whereParts.push(`status = $${params.length + 1}::inv.warehouse_status`);
      params.push(query.status);
    }
    if (query.unitId) {
      whereParts.push(`unit_id = $${params.length + 1}`);
      params.push(query.unitId);
    }
    if (query.q) {
      whereParts.push(`(code ILIKE $${params.length + 1} OR name ILIKE $${params.length + 1})`);
      params.push(`%${query.q}%`);
    }
    const whereClause = whereParts.length > 0 ? whereParts.join(' AND ') : 'TRUE';

    const rows = await this.repository.listWarehousePage({
      whereClause,
      params,
      limit: query.limit,
      offset: query.offset,
    });
    const total =
      query.offset === 0 && rows.length < query.limit
        ? rows.length
        : await this.repository.countWarehouseList(whereClause, params);

    return {
      items: rows.map(toWarehouseResponse),
      limit: query.limit,
      offset: query.offset,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async listItems(
    actor: IdentityAuthzContext,
    query: InventoryListQuery,
  ): Promise<InventoryItemListResponse> {
    await this.assertInventoryList(actor, AUTHZ_ACTIONS.InventoryItemList, query.unitId);
    const whereParts: string[] = [];
    const params: unknown[] = [];
    if (query.status) {
      whereParts.push(`status = $${params.length + 1}::inv.inventory_item_status`);
      params.push(query.status);
    }
    if (query.unitId) {
      whereParts.push(`unit_id = $${params.length + 1}`);
      params.push(query.unitId);
    }
    if (query.q) {
      whereParts.push(`(sku ILIKE $${params.length + 1} OR name ILIKE $${params.length + 1})`);
      params.push(`%${query.q}%`);
    }
    const whereClause = whereParts.length > 0 ? whereParts.join(' AND ') : 'TRUE';

    const rows = await this.repository.listItemPage({
      whereClause,
      params,
      limit: query.limit,
      offset: query.offset,
    });
    const total =
      query.offset === 0 && rows.length < query.limit
        ? rows.length
        : await this.repository.countItemList(whereClause, params);

    return {
      items: rows.map(toInventoryItemResponse),
      limit: query.limit,
      offset: query.offset,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async listMovements(
    actor: IdentityAuthzContext,
    query: InventoryListQuery,
  ): Promise<StockMovementListResponse> {
    await this.assertInventoryList(actor, AUTHZ_ACTIONS.InventoryMovementList, undefined);
    const whereParts: string[] = [];
    const params: unknown[] = [];
    if (query.warehouseId) {
      whereParts.push(`m.warehouse_id = $${params.length + 1}::uuid`);
      params.push(query.warehouseId);
    }
    if (query.inventoryItemId) {
      whereParts.push(`m.inventory_item_id = $${params.length + 1}::uuid`);
      params.push(query.inventoryItemId);
    }
    if (query.movementType) {
      whereParts.push(`m.movement_type = $${params.length + 1}::inv.stock_movement_type`);
      params.push(query.movementType);
    }
    if (query.q) {
      whereParts.push(
        `(m.description ILIKE $${params.length + 1} OR w.code ILIKE $${params.length + 1} OR w.name ILIKE $${params.length + 1} OR i.sku ILIKE $${params.length + 1} OR i.name ILIKE $${params.length + 1})`,
      );
      params.push(`%${query.q}%`);
    }
    const whereClause = whereParts.length > 0 ? whereParts.join(' AND ') : 'TRUE';

    const rows = await this.repository.listMovementPage({
      whereClause,
      params,
      limit: query.limit,
      offset: query.offset,
    });
    const total =
      query.offset === 0 && rows.length < query.limit
        ? rows.length
        : await this.repository.countMovementList(whereClause, params);

    return {
      items: rows.map(toStockMovementSummaryResponse),
      limit: query.limit,
      offset: query.offset,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async listReservations(
    actor: IdentityAuthzContext,
    query: InventoryListQuery,
  ): Promise<StockReservationListResponse> {
    await this.assertInventoryList(actor, AUTHZ_ACTIONS.InventoryReservationList, undefined);
    const whereParts: string[] = [];
    const params: unknown[] = [];
    if (query.status) {
      whereParts.push(`r.status = $${params.length + 1}::inv.reservation_status`);
      params.push(query.status);
    }
    if (query.warehouseId) {
      whereParts.push(`r.warehouse_id = $${params.length + 1}::uuid`);
      params.push(query.warehouseId);
    }
    if (query.inventoryItemId) {
      whereParts.push(`r.inventory_item_id = $${params.length + 1}::uuid`);
      params.push(query.inventoryItemId);
    }
    if (query.q) {
      whereParts.push(
        `(w.code ILIKE $${params.length + 1} OR w.name ILIKE $${params.length + 1} OR i.sku ILIKE $${params.length + 1} OR i.name ILIKE $${params.length + 1})`,
      );
      params.push(`%${query.q}%`);
    }
    const whereClause = whereParts.length > 0 ? whereParts.join(' AND ') : 'TRUE';

    const rows = await this.repository.listReservationPage({
      whereClause,
      params,
      limit: query.limit,
      offset: query.offset,
    });
    const total =
      query.offset === 0 && rows.length < query.limit
        ? rows.length
        : await this.repository.countReservationList(whereClause, params);

    return {
      items: rows.map(toStockReservationSummaryResponse),
      limit: query.limit,
      offset: query.offset,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  /**
   * Concessão de lista do estoque. A âncora de unidade é opcional: a listagem global do módulo não
   * inventa unidade, e o filtro de escopo continua sendo aplicado pelo PDP nas ações de escrita.
   */
  private async assertInventoryList(
    actor: IdentityAuthzContext,
    action: (typeof AUTHZ_ACTIONS)[keyof typeof AUTHZ_ACTIONS],
    unitId: string | undefined,
  ): Promise<void> {
    const grants = await this.authorizationRepository.findActiveGrants(
      actor.identityId,
      action,
      AUTHZ_RESOURCE_TYPES.InventoryStock,
    );
    if (grants.length === 0) {
      throw mapInventoryDomainError(inventoryAccessDenied());
    }
    if (unitId) {
      await this.authz.assertInventoryAction(actor, action, { id: actor.identityId, unitId });
    }
  }

  async createWarehouse(
    actor: IdentityAuthzContext,
    input: CreateWarehouseInput,
  ): Promise<WarehouseResponse> {
    try {
      const validated = validateCreateWarehouseInput(input);
      await this.authz.assertInventoryAction(actor, AUTHZ_ACTIONS.InventoryWarehouseManage, {
        id: actor.identityId,
        unitId: validated.unitId,
      });
      const row = await this.repository.createWarehouse({
        ...validated,
        actorIdentityId: actor.identityId,
      });
      return toWarehouseResponse(row);
    } catch (error) {
      throw mapInventoryDomainError(error);
    }
  }

  async createItem(
    actor: IdentityAuthzContext,
    input: CreateInventoryItemInput,
  ): Promise<InventoryItemResponse> {
    try {
      const validated = validateCreateInventoryItemInput(input);
      await this.authz.assertInventoryAction(actor, AUTHZ_ACTIONS.InventoryItemManage, {
        id: actor.identityId,
        unitId: validated.unitId,
      });
      const row = await this.repository.createItem({
        unitId: validated.unitId,
        sku: validated.sku,
        name: validated.name,
        allowsNegativeStock: validated.allowsNegativeStock === true,
        actorIdentityId: actor.identityId,
      });
      assertCostingUndecided(row.costing_method_status);
      return toInventoryItemResponse(row);
    } catch (error) {
      throw mapInventoryDomainError(error);
    }
  }

  async postStock(
    actor: IdentityAuthzContext,
    input: PostStockMovementInput,
  ): Promise<PostMovementResponse> {
    try {
      const validated = validatePostStockMovementInput(input);
      await this.authz.assertInventoryAction(actor, AUTHZ_ACTIONS.InventoryMove, {
        id: validated.inventoryItemId,
        unitId: validated.unitId,
      });
      const existing = await this.repository.findMovementsByCommand(
        validated.unitId,
        validated.idempotencyKey,
      );
      if (existing.length > 0) {
        await this.accountingIntegration.tryPostPostedMovements(actor, existing);
        const balance = await this.repository.getBalance(
          validated.warehouseId,
          validated.inventoryItemId,
        );
        return {
          movements: existing.map(toStockMovementResponse),
          balance: toBalanceResponse(balance),
          idempotent: true,
        };
      }
      const item = await this.requireItem(validated.inventoryItemId);
      const warehouse = await this.requireWarehouse(validated.warehouseId);
      if (item.unit_id !== validated.unitId || warehouse.unit_id !== validated.unitId) {
        throw new InventoryError('INVENTORY_NOT_FOUND');
      }
      const movements = await this.persistPosted(actor, item, validated);
      await this.accountingIntegration.tryPostPostedMovements(actor, movements);
      await this.audit(actor, SECURITY_AUDIT_ACTIONS.InventoryMove, item.id, {
        movementType: validated.movementType,
        commandKey: validated.idempotencyKey,
      });
      const balance = await this.repository.getBalance(validated.warehouseId, validated.inventoryItemId);
      return {
        movements: movements.map(toStockMovementResponse),
        balance: toBalanceResponse(balance),
        idempotent: false,
      };
    } catch (error) {
      throw mapInventoryDomainError(error);
    }
  }

  async postMovementFromPort(input: {
    inventoryItemId: string;
    warehouseId: string;
    unitId: string;
    movementType?: string;
    quantity?: string;
    idempotencyKey?: string;
    actorIdentityId?: string;
    destinationWarehouseId?: string;
    occurredOn?: string;
    description?: string;
  }): Promise<{ movementIds: string[]; idempotent: boolean }> {
    const result = await this.postStock(
      { identityId: input.actorIdentityId ?? input.inventoryItemId, sessionId: 'port' },
      {
        unitId: input.unitId,
        warehouseId: input.warehouseId,
        inventoryItemId: input.inventoryItemId,
        movementType: input.movementType ?? STOCK_MOVEMENT_TYPES.In,
        quantity: input.quantity ?? '1.0000',
        occurredOn: input.occurredOn ?? '2026-09-01',
        description: input.description ?? 'Port inventory movement',
        idempotencyKey: input.idempotencyKey ?? `port-${input.inventoryItemId}`,
        destinationWarehouseId: input.destinationWarehouseId,
      },
    );
    return {
      movementIds: result.movements.map((movement) => movement.id),
      idempotent: result.idempotent,
    };
  }

  async reserve(
    actor: IdentityAuthzContext,
    input: ReserveStockInput,
  ): Promise<StockReservationResponse> {
    try {
      const validated = validateReserveStockInput(input);
      await this.authz.assertInventoryAction(actor, AUTHZ_ACTIONS.InventoryReserve, {
        id: validated.inventoryItemId,
        unitId: validated.unitId,
      });
      const existing = await this.repository.findReservationByIdempotency(
        validated.unitId,
        validated.idempotencyKey,
      );
      if (existing) {
        return toReservationResponse(existing);
      }
      const item = await this.requireItem(validated.inventoryItemId);
      const reservation = await this.repository.withLockedPositions(
        [{ warehouseId: validated.warehouseId, inventoryItemId: validated.inventoryItemId }],
        async (client) => {
          const loaded = await this.repository.loadPositionInside(
            client,
            validated.warehouseId,
            validated.inventoryItemId,
          );
          const position = deriveStockPosition(loaded);
          assertSufficientStock({
            available: position.available,
            quantity: validated.quantity,
            allowsNegativeStock: item.allows_negative_stock,
          });
          return this.repository.insertReservation(client, {
            ...validated,
            actorIdentityId: actor.identityId,
          });
        },
      );
      return toReservationResponse(reservation);
    } catch (error) {
      throw mapInventoryDomainError(error);
    }
  }

  async releaseReservation(
    actor: IdentityAuthzContext,
    reservationId: string,
  ): Promise<StockReservationResponse> {
    assertUuid(reservationId, 'reservationId');
    try {
      const current = await this.repository.findReservationById(reservationId);
      if (!current) {
        throw new InventoryError('INVENTORY_NOT_FOUND');
      }
      await this.authz.assertInventoryAction(actor, AUTHZ_ACTIONS.InventoryReserve, {
        id: current.inventory_item_id,
        unitId: current.unit_id,
      });
      if (current.status !== RESERVATION_STATUSES.Active) {
        return toReservationResponse(current);
      }
      return toReservationResponse(
        await this.repository.releaseReservation({
          reservationId,
          actorIdentityId: actor.identityId,
        }),
      );
    } catch (error) {
      throw mapInventoryDomainError(error);
    }
  }

  async reverse(
    actor: IdentityAuthzContext,
    commandIdempotencyKey: string,
    unitId: string,
    reversalKey: string,
  ): Promise<PostMovementResponse> {
    try {
      await this.authz.assertInventoryAction(actor, AUTHZ_ACTIONS.InventoryMove, {
        id: actor.identityId,
        unitId,
      });
      const originals = await this.repository.findMovementsByCommand(unitId, commandIdempotencyKey);
      if (originals.length === 0) {
        throw new InventoryError('INVENTORY_NOT_FOUND');
      }
      const existing = await this.repository.findMovementsByCommand(unitId, reversalKey);
      if (existing.length > 0) {
        await this.accountingIntegration.tryPostPostedMovements(actor, existing);
        const first = originals[0];
        const balance = await this.repository.getBalance(first!.warehouse_id, first!.inventory_item_id);
        return {
          movements: existing.map(toStockMovementResponse),
          balance: toBalanceResponse(balance),
          idempotent: true,
        };
      }
      const item = await this.requireItem(originals[0]!.inventory_item_id);
      const reversed = await this.repository.withLockedPositions(
        originals.map((row) => ({
          warehouseId: row.warehouse_id,
          inventoryItemId: row.inventory_item_id,
        })),
        async (client) => {
          const rows = [];
          for (const original of originals) {
            const opposite = oppositeMovement(original);
            rows.push(
              await this.repository.insertMovement(client, {
                unitId: original.unit_id,
                warehouseId: original.warehouse_id,
                inventoryItemId: original.inventory_item_id,
                movementType: opposite.movementType,
                quantity: original.quantity,
                signedQuantity: signedQuantityForMovement(opposite),
                counterpartWarehouseId: original.counterpart_warehouse_id,
                transferGroupId: original.transfer_group_id
                  ? original.transfer_group_id
                  : null,
                transferLeg: opposite.transferLeg ?? null,
                adjustmentEffect: opposite.adjustmentEffect ?? null,
                reversalOfMovementId: original.id,
                commandIdempotencyKey: reversalKey,
                idempotencyKey: `${reversalKey}:${original.id}`,
                occurredOn: original.occurred_on.slice(0, 10),
                description: `Reversal of ${original.id}`,
                actorIdentityId: actor.identityId,
                unitCost: original.unit_cost,
                totalCost: original.total_cost,
                costingRuleVersionId: original.costing_rule_version_id,
                originKind: originForMovement({
                  movementType: opposite.movementType,
                  reversalOfMovementId: original.id,
                }),
              }),
            );
          }
          if (!item.allows_negative_stock) {
            const loaded = await this.repository.loadPositionInside(
              client,
              originals[0]!.warehouse_id,
              originals[0]!.inventory_item_id,
            );
            assertNegativeStockUnauthorized(deriveStockPosition(loaded).onHand);
          }
          return rows;
        },
      );
      await this.accountingIntegration.tryPostPostedMovements(actor, reversed);
      const balance = await this.repository.getBalance(
        originals[0]!.warehouse_id,
        originals[0]!.inventory_item_id,
      );
      return {
        movements: reversed.map(toStockMovementResponse),
        balance: toBalanceResponse(balance),
        idempotent: false,
      };
    } catch (error) {
      throw mapInventoryDomainError(error);
    }
  }

  async getBalance(
    actor: IdentityAuthzContext,
    warehouseId: string,
    inventoryItemId: string,
  ): Promise<StockBalanceResponse> {
    assertUuid(warehouseId, 'warehouseId');
    assertUuid(inventoryItemId, 'inventoryItemId');
    try {
      const item = await this.requireItem(inventoryItemId);
      await this.authz.assertInventoryAction(actor, AUTHZ_ACTIONS.InventoryRead, {
        id: item.id,
        unitId: item.unit_id,
      });
      return toBalanceResponse(await this.repository.getBalance(warehouseId, inventoryItemId));
    } catch (error) {
      throw mapInventoryDomainError(error);
    }
  }

  async reconcile(
    actor: IdentityAuthzContext,
    warehouseId: string,
    inventoryItemId: string,
  ): Promise<{ matches: boolean; onHand: string; derivedOnHand: string }> {
    assertUuid(warehouseId, 'warehouseId');
    assertUuid(inventoryItemId, 'inventoryItemId');
    try {
      const item = await this.requireItem(inventoryItemId);
      await this.authz.assertInventoryAction(actor, AUTHZ_ACTIONS.InventoryRead, {
        id: item.id,
        unitId: item.unit_id,
      });
      const signed = await this.repository.listPostedSignedQuantities(warehouseId, inventoryItemId);
      const balance = await this.repository.getBalance(warehouseId, inventoryItemId);
      const derived = deriveStockPosition({
        postedSignedQuantities: signed,
        activeReservationQuantities: [],
      });
      return {
        matches: reconcileOnHand(signed, balance.on_hand),
        onHand: balance.on_hand,
        derivedOnHand: derived.onHand,
      };
    } catch (error) {
      throw mapInventoryDomainError(error);
    }
  }

  valueStock(): never {
    return assertCostingNotInvented();
  }

  async createCostingRule(
    actor: IdentityAuthzContext,
    input: CreateCostingRuleInput,
  ): Promise<CostingRuleResponse> {
    try {
      const validated = validateCreateCostingRuleInput(input);
      await this.authz.assertInventoryAction(actor, AUTHZ_ACTIONS.InventoryCostingRuleManage, {
        id: actor.identityId,
        unitId: validated.unitId,
      });
      const row = await this.repository.createCostingRule({
        ...validated,
        actorIdentityId: actor.identityId,
      });
      return toCostingRuleResponse(row);
    } catch (error) {
      throw mapInventoryDomainError(error);
    }
  }

  async createCostingRuleVersion(
    actor: IdentityAuthzContext,
    costingRuleId: string,
    input: CreateCostingRuleVersionInput,
  ): Promise<CostingRuleVersionResponse> {
    validateCostingRuleId(costingRuleId);
    try {
      const rule = await this.requireCostingRule(costingRuleId);
      await this.authz.assertInventoryAction(actor, AUTHZ_ACTIONS.InventoryCostingRuleManage, {
        id: rule.id,
        unitId: rule.unit_id,
      });
      const validated = validateCreateCostingRuleVersionInput(input);
      const row = await this.repository.createDraftCostingVersion({
        costingRuleId,
        method: validated.method,
        requiredContext: validated.requiredContext,
        effectiveFrom: validated.effectiveFrom,
        effectiveTo: validated.effectiveTo,
        sourceReference: validated.sourceReference,
        actorIdentityId: actor.identityId,
      });
      return toCostingRuleVersionResponse(row);
    } catch (error) {
      throw mapInventoryDomainError(error);
    }
  }

  async publishCostingRuleVersion(
    actor: IdentityAuthzContext,
    versionId: string,
    input: PublishCostingRuleVersionInput,
  ): Promise<CostingRuleVersionResponse> {
    assertUuid(versionId, 'versionId');
    try {
      const version = await this.requireCostingVersion(versionId);
      const rule = await this.requireCostingRule(version.costing_rule_id);
      await this.authz.assertInventoryAction(actor, AUTHZ_ACTIONS.InventoryCostingRulePublish, {
        id: rule.id,
        unitId: rule.unit_id,
      });
      const validated = validatePublishCostingRuleVersionInput(input);
      const published = await this.repository.publishCostingVersion({
        versionId,
        rowVersion: validated.rowVersion,
        actorIdentityId: actor.identityId,
      });
      await this.audit(actor, SECURITY_AUDIT_ACTIONS.InventoryCostingRulePublish, published.id, {
        costingRuleId: published.costing_rule_id,
        versionNumber: published.version_number,
      });
      return toCostingRuleVersionResponse(published);
    } catch (error) {
      throw mapInventoryDomainError(error);
    }
  }

  async getCostingRule(actor: IdentityAuthzContext, costingRuleId: string): Promise<CostingRuleResponse> {
    validateCostingRuleId(costingRuleId);
    try {
      const rule = await this.requireCostingRule(costingRuleId);
      await this.authz.assertInventoryAction(actor, AUTHZ_ACTIONS.InventoryRead, {
        id: rule.id,
        unitId: rule.unit_id,
      });
      return toCostingRuleResponse(rule);
    } catch (error) {
      throw mapInventoryDomainError(error);
    }
  }

  async reconcileCost(
    actor: IdentityAuthzContext,
    warehouseId: string,
    inventoryItemId: string,
  ): Promise<{ matches: boolean; movementCount: number }> {
    assertUuid(warehouseId, 'warehouseId');
    assertUuid(inventoryItemId, 'inventoryItemId');
    try {
      const item = await this.requireItem(inventoryItemId);
      await this.authz.assertInventoryAction(actor, AUTHZ_ACTIONS.InventoryRead, {
        id: item.id,
        unitId: item.unit_id,
      });
      const movements = await this.repository.listPostedMovements(warehouseId, inventoryItemId);
      return {
        matches: reconcileExplicitCosts(
          movements.map((movement) => ({
            quantity: movement.quantity,
            unitCost: movement.unit_cost,
            totalCost: movement.total_cost,
          })),
        ),
        movementCount: movements.length,
      };
    } catch (error) {
      throw mapInventoryDomainError(error);
    }
  }

  async postMovement(input: {
    inventoryItemId: string;
    warehouseId: string;
    unitId: string;
  }): Promise<void> {
    await this.postMovementFromPort(input);
  }

  private async persistPosted(
    actor: IdentityAuthzContext,
    item: { id: string; allows_negative_stock: boolean },
    validated: PostStockMovementInput,
  ) {
    const destinationId = validated.destinationWarehouseId ?? null;
    if (validated.movementType === STOCK_MOVEMENT_TYPES.Transfer) {
      if (!destinationId || destinationId === validated.warehouseId) {
        throw new InventoryError('INVENTORY_INVALID_TRANSFER');
      }
      await this.requireWarehouse(destinationId);
    }
    const positions = [{ warehouseId: validated.warehouseId, inventoryItemId: validated.inventoryItemId }];
    if (destinationId) {
      positions.push({ warehouseId: destinationId, inventoryItemId: validated.inventoryItemId });
    }
    const costing = await this.resolveCosting(validated);
    return this.repository.withLockedPositions(positions, async (client) => {
      const loaded = await this.repository.loadPositionInside(
        client,
        validated.warehouseId,
        validated.inventoryItemId,
      );
      let reservationQuantities = loaded.activeReservationQuantities;
      if (validated.reservationId) {
        const reservation = await this.repository.findReservationById(validated.reservationId);
        if (
          !reservation ||
          reservation.status !== RESERVATION_STATUSES.Active ||
          reservation.warehouse_id !== validated.warehouseId ||
          reservation.inventory_item_id !== validated.inventoryItemId
        ) {
          throw new InventoryError('INVENTORY_NOT_FOUND');
        }
        reservationQuantities = reservationQuantities.filter(
          (quantity, index) =>
            !(index === reservationQuantities.indexOf(reservation.quantity) && quantity === reservation.quantity),
        );
        await this.repository.consumeReservation(client, reservation.id, actor.identityId);
      }
      const position = deriveStockPosition({
        postedSignedQuantities: loaded.postedSignedQuantities,
        activeReservationQuantities: reservationQuantities,
      });
      const decreases =
        validated.movementType === STOCK_MOVEMENT_TYPES.Out ||
        validated.movementType === STOCK_MOVEMENT_TYPES.Transfer ||
        (validated.movementType === STOCK_MOVEMENT_TYPES.Adjustment &&
          validated.adjustmentEffect === ADJUSTMENT_EFFECTS.Decrease);
      if (decreases) {
        assertSufficientStock({
          available: position.available,
          quantity: validated.quantity,
          allowsNegativeStock: item.allows_negative_stock,
        });
      }
      const rows = [];
      if (validated.movementType === STOCK_MOVEMENT_TYPES.Transfer && destinationId) {
        const transferGroupId = crypto.randomUUID();
        rows.push(
          await this.repository.insertMovement(
            client,
            movementInput(validated, actor.identityId, costing, {
              warehouseId: validated.warehouseId,
              counterpartWarehouseId: destinationId,
              transferGroupId,
              transferLeg: TRANSFER_LEGS.Origin,
              idempotencyKey: `${validated.idempotencyKey}:ORIGIN`,
            }),
          ),
        );
        rows.push(
          await this.repository.insertMovement(
            client,
            movementInput(validated, actor.identityId, costing, {
              warehouseId: destinationId,
              counterpartWarehouseId: validated.warehouseId,
              transferGroupId,
              transferLeg: TRANSFER_LEGS.Destination,
              idempotencyKey: `${validated.idempotencyKey}:DESTINATION`,
            }),
          ),
        );
      } else {
        rows.push(
          await this.repository.insertMovement(
            client,
            movementInput(validated, actor.identityId, costing, {
              warehouseId: validated.warehouseId,
              idempotencyKey: validated.idempotencyKey,
            }),
          ),
        );
      }
      if (!item.allows_negative_stock) {
        const after = await this.repository.loadPositionInside(
          client,
          validated.warehouseId,
          validated.inventoryItemId,
        );
        assertNegativeStockUnauthorized(deriveStockPosition(after).onHand);
      }
      return rows;
    });
  }

  private async requireItem(id: string) {
    const row = await this.repository.findItemById(id);
    if (!row) {
      throw new InventoryError('INVENTORY_NOT_FOUND');
    }
    return row;
  }

  private async resolveCosting(validated: PostStockMovementInput) {
    const published = await this.repository.findPublishedCostingVersion(
      validated.unitId,
      validated.occurredOn,
    );
    return applyExplicitCosting({
      method: published?.method ?? COSTING_METHOD_STATUSES.Undecided,
      quantity: validated.quantity,
      unitCost: validated.unitCost,
      costingRuleVersionId: published?.id ?? null,
    });
  }

  private async requireCostingRule(id: string) {
    const row = await this.repository.findCostingRuleById(id);
    if (!row) {
      throw new InventoryError('INVENTORY_COSTING_RULE_NOT_CONFIGURED');
    }
    return row;
  }

  private async requireCostingVersion(id: string) {
    const row = await this.repository.findCostingVersionById(id);
    if (!row) {
      throw new InventoryError('INVENTORY_COSTING_RULE_NOT_CONFIGURED');
    }
    return row;
  }

  private async requireWarehouse(id: string) {
    const row = await this.repository.findWarehouseById(id);
    if (!row) {
      throw new InventoryError('INVENTORY_NOT_FOUND');
    }
    return row;
  }

  private async audit(
    actor: IdentityAuthzContext,
    action: (typeof SECURITY_AUDIT_ACTIONS)[keyof typeof SECURITY_AUDIT_ACTIONS],
    resourceId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.InventoryStock,
      resourceId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata,
    });
  }
}

function movementInput(
  validated: PostStockMovementInput,
  actorIdentityId: string,
  costing: { unitCost: string | null; totalCost: string | null; costingRuleVersionId: string | null },
  extra: {
    warehouseId: string;
    counterpartWarehouseId?: string | null;
    transferGroupId?: string | null;
    transferLeg?: string | null;
    idempotencyKey: string;
  },
): PersistMovementInput {
  const signed = signedQuantityForMovement({
    movementType: validated.movementType,
    quantity: validated.quantity,
    transferLeg: extra.transferLeg,
    adjustmentEffect: validated.adjustmentEffect,
  });
  return {
    unitId: validated.unitId,
    warehouseId: extra.warehouseId,
    inventoryItemId: validated.inventoryItemId,
    movementType: validated.movementType,
    quantity: validated.quantity,
    signedQuantity: signed,
    counterpartWarehouseId: extra.counterpartWarehouseId ?? null,
    transferGroupId: extra.transferGroupId ?? null,
    transferLeg: extra.transferLeg ?? null,
    adjustmentEffect: validated.adjustmentEffect ?? null,
    reservationId: validated.reservationId ?? null,
    commandIdempotencyKey: validated.idempotencyKey,
    idempotencyKey: extra.idempotencyKey,
    sourceKind: validated.sourceKind ?? null,
    sourceId: validated.sourceId ?? null,
    occurredOn: validated.occurredOn,
    description: validated.description,
    actorIdentityId,
    unitCost: costing.unitCost,
    totalCost: costing.totalCost,
    costingRuleVersionId: costing.costingRuleVersionId,
    originKind: originForMovement({ movementType: validated.movementType }),
  };
}

function oppositeMovement(original: {
  movement_type: string;
  transfer_leg: string | null;
  adjustment_effect: string | null;
  quantity: string;
}) {
  if (original.movement_type === STOCK_MOVEMENT_TYPES.In) {
    return { movementType: STOCK_MOVEMENT_TYPES.Out, quantity: original.quantity };
  }
  if (original.movement_type === STOCK_MOVEMENT_TYPES.Out) {
    return { movementType: STOCK_MOVEMENT_TYPES.In, quantity: original.quantity };
  }
  if (original.movement_type === STOCK_MOVEMENT_TYPES.Transfer) {
    return {
      movementType: STOCK_MOVEMENT_TYPES.Transfer,
      quantity: original.quantity,
      transferLeg:
        original.transfer_leg === TRANSFER_LEGS.Origin ? TRANSFER_LEGS.Destination : TRANSFER_LEGS.Origin,
    };
  }
  return {
    movementType: STOCK_MOVEMENT_TYPES.Adjustment,
    quantity: original.quantity,
    adjustmentEffect:
      original.adjustment_effect === ADJUSTMENT_EFFECTS.Increase
        ? ADJUSTMENT_EFFECTS.Decrease
        : ADJUSTMENT_EFFECTS.Increase,
  };
}

