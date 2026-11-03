import { Inject, Injectable, Optional } from '@nestjs/common';
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
import { ENTERPRISE_CORE_PORT, type InventoryStockPort, type BoundMaterialActualStockInput, type BoundMaterialStockResult, type ProcurementReceiptEvidencePort } from '../../platform/bounded-contexts/enterprise-core-ports';
import { assertUuid } from '../../platform/kernel/uuid';
import { isPositiveMoneyAmount } from '../../platform/kernel/money-math';
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
  normalizeQuantity,
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
import type { PersistMovementInput, StockMovementRow } from '../repositories/inventory.repository.types';
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
    @Optional() @Inject(ENTERPRISE_CORE_PORT.ProcurementReceiptEvidence)
    private readonly receiptEvidence?: ProcurementReceiptEvidencePort,
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
        // F1.2 — replay idempotente não reposta: o fato econômico já foi publicado na
        // primeira execução. Ver `postAllMovements` para o raciocínio completo.
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
      await this.postAllMovements(actor, movements);
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

  /**
   * #193 / 2D-2F: domain-specific inventory port, not the generic port with IN/1 defaults.
   * One deterministic movement command per immutable actual; replays must match
   * the complete persisted origin, SKU, warehouse, unit and quantity.
   * InventoryRepository owns the stock position lock and economic outbox atomically.
   */
  /**
   * #193 / 2F-a: explicit, dual-authorized receipt-line -> SKU/warehouse fact.
   * Does NOT post stock, valuation or GL. Procurement owns the receipt evidence.
   */
  async bindReceiptProvenance(
    actor: IdentityAuthzContext,
    input: {
      receiptLineId: string;
      inventoryItemId: string;
      warehouseId: string;
      unitId: string;
      allocatedQuantity: string;
      idempotencyKey: string;
    },
  ) {
    try {
      if (!this.receiptEvidence) throw new InventoryError('INVENTORY_NOT_FOUND');
      assertUuid(input.receiptLineId, 'receiptLineId');
      assertUuid(input.inventoryItemId, 'inventoryItemId');
      assertUuid(input.warehouseId, 'warehouseId');
      if (typeof input.unitId !== 'string' || !input.unitId.trim() ||
          typeof input.idempotencyKey !== 'string' ||
          input.idempotencyKey.length < 1 || input.idempotencyKey.length > 128 ||
          input.idempotencyKey.trim() !== input.idempotencyKey ||
          !isPositiveMoneyAmount(String(input.allocatedQuantity))) {
        throw new InventoryError('INVENTORY_VALIDATION_FAILED');
      }
      await this.authz.assertInventoryAction(actor, AUTHZ_ACTIONS.InventoryMove, {
        id: input.inventoryItemId,
        unitId: input.unitId,
      });
      const source = await this.receiptEvidence.readPostedLine({
        actorIdentityId: actor.identityId,
        actorSessionId: actor.sessionId,
        receiptLineId: input.receiptLineId,
      });
      if (!source || source.unitId !== input.unitId) {
        throw new InventoryError('INVENTORY_NOT_FOUND');
      }
      // Maker-checker: the receipt actor cannot certify their own SKU mapping.
      if (source.receivedByIdentityId === actor.identityId) {
        throw inventoryAccessDenied();
      }
      const result = await this.repository.recordReceiptProvenance({
        receiptLineId: source.receiptLineId,
        inventoryItemId: input.inventoryItemId,
        warehouseId: input.warehouseId,
        unitId: source.unitId,
        allocatedQuantity: normalizeQuantity(String(input.allocatedQuantity)),
        receivedQuantity: normalizeQuantity(source.receivedQuantity),
        actorIdentityId: actor.identityId,
        idempotencyKey: input.idempotencyKey,
      });
      if (!result.idempotent) {
        await this.audit(actor, SECURITY_AUDIT_ACTIONS.InventoryMove, input.inventoryItemId, {
          command: 'RECEIPT_PROVENANCE_ONLY',
          provenanceId: result.id,
          receiptLineId: result.receiptLineId,
          warehouseId: result.warehouseId,
          allocatedQuantity: result.allocatedQuantity,
          stockMovementCreated: false,
          valuationCreated: false,
        });
      }
      return result;
    } catch (error) {
      throw mapInventoryDomainError(error);
    }
  }

  async postBoundMaterialActual(input: BoundMaterialActualStockInput): Promise<BoundMaterialStockResult> {
    this.assertBoundActualInput(input);
    const key = materialCommandKey(input.actualId);
    const alreadyReversed = await this.repository.findMovementsByCommand(input.unitId, materialReversalKey(input.actualId));
    if (alreadyReversed.length > 0) throw new InventoryError('INVENTORY_INVALID_MOVEMENT_TYPE');
    const prior = await this.repository.findMovementsByCommand(input.unitId, key);
    if (prior.length > 0) {
      if (prior.length !== 1) throw new InventoryError('INVENTORY_VALIDATION_FAILED');
      this.assertBoundMovement(prior[0]!, input);
    }
    const result = await this.postStock(
      { identityId: input.actorIdentityId, sessionId: input.actorSessionId },
      {
        unitId: input.unitId,
        warehouseId: input.warehouseId,
        inventoryItemId: input.inventoryItemId,
        movementType: STOCK_MOVEMENT_TYPES.Out,
        quantity: input.quantity,
        occurredOn: input.occurredOn,
        description: `Material consumption from execution actual ${input.actualId}`,
        idempotencyKey: key,
        sourceKind: 'SERVICE_ORDER_EXECUTION_ACTUAL',
        sourceId: input.actualId,
        reservationId: input.reservationId ?? null,
        // No invented unit cost: Inventory keeps costing undecided without
        // an authoritative published business rule and cost evidence.
      },
    );
    if (result.movements.length !== 1) throw new InventoryError('INVENTORY_VALIDATION_FAILED');
    const persisted = await this.repository.findMovementsByCommand(input.unitId, key);
    if (persisted.length !== 1) throw new InventoryError('INVENTORY_VALIDATION_FAILED');
    this.assertBoundMovement(persisted[0]!, input);
    if (persisted[0]!.reservation_id !== (input.reservationId ?? null)) {
      throw new InventoryError('INVENTORY_VALIDATION_FAILED');
    }
    return boundMaterialResult(persisted[0]!, result.idempotent);
  }

  async reverseBoundMaterialActual(
    input: BoundMaterialActualStockInput & { reason: string },
  ): Promise<BoundMaterialStockResult> {
    this.assertBoundActualInput(input);
    if (typeof input.reason !== 'string' || input.reason.trim().length < 8) {
      throw new InventoryError('INVENTORY_VALIDATION_FAILED');
    }
    const original = await this.repository.findMovementsByCommand(input.unitId, materialCommandKey(input.actualId));
    if (original.length !== 1) throw new InventoryError('INVENTORY_NOT_FOUND');
    this.assertBoundMovement(original[0]!, input);
    const result = await this.reverse(
      { identityId: input.actorIdentityId, sessionId: input.actorSessionId },
      materialCommandKey(input.actualId),
      input.unitId,
      materialReversalKey(input.actualId),
      input.reason.trim(),
    );
    const reversed = await this.repository.findMovementsByCommand(input.unitId, materialReversalKey(input.actualId));
    if (result.movements.length !== 1 || reversed.length !== 1 ||
      reversed[0]!.reversal_of_movement_id !== original[0]!.id ||
      reversed[0]!.description !== `Reversal of ${original[0]!.id}: ${input.reason.trim()}` ||
      reversed[0]!.movement_type !== STOCK_MOVEMENT_TYPES.In) {
      throw new InventoryError('INVENTORY_VALIDATION_FAILED');
    }
    await this.audit(
      { identityId: input.actorIdentityId, sessionId: input.actorSessionId },
      SECURITY_AUDIT_ACTIONS.InventoryMove,
      original[0]!.inventory_item_id,
      { command: 'REVERSE_OS_MATERIAL', actualId: input.actualId, originalMovementId: original[0]!.id, reason: input.reason.trim() },
    );
    return boundMaterialResult(reversed[0]!, result.idempotent);
  }

  async readBoundMaterialActual(
    input: Omit<BoundMaterialActualStockInput, 'actorIdentityId' | 'actorSessionId' | 'occurredOn' | 'reservationId'>,
  ): Promise<{ posted: BoundMaterialStockResult | null; reversed: BoundMaterialStockResult | null }> {
    const [result] = await this.readBoundMaterialActuals([input]);
    if (!result) throw new InventoryError('INVENTORY_VALIDATION_FAILED');
    return { posted: result.posted, reversed: result.reversed };
  }

  /**
   * A bounded, owner-authoritative reconciliation read for Work Inbox. Both
   * command keys are read in ONE Inventory query; the consumer never joins inv.*.
   * Every returned movement is checked against the immutable SO binding.
   */
  async readBoundMaterialActuals(
    inputs: Array<Omit<BoundMaterialActualStockInput,
      'actorIdentityId' | 'actorSessionId' | 'occurredOn' | 'reservationId'>>,
  ): Promise<Array<{ actualId: string; posted: BoundMaterialStockResult | null; reversed: BoundMaterialStockResult | null }>> {
    if (inputs.length > 500) throw new InventoryError('INVENTORY_VALIDATION_FAILED');
    const seen = new Set<string>();
    for (const input of inputs) {
      assertUuid(input.actualId, 'actualId');
      assertUuid(input.inventoryItemId, 'inventoryItemId');
      assertUuid(input.warehouseId, 'warehouseId');
      if (!input.unitId || normalizeQuantity(input.quantity) !== input.quantity ||
          seen.has(input.actualId)) throw new InventoryError('INVENTORY_VALIDATION_FAILED');
      seen.add(input.actualId);
    }
    if (inputs.length === 0) return [];
    const rows = await this.repository.findMaterialMovementsByCommands(
      [...new Set(inputs.map((input) => input.unitId))],
      inputs.flatMap((input) => [materialCommandKey(input.actualId), materialReversalKey(input.actualId)]),
    );
    const byCommand = new Map<string, StockMovementRow[]>();
    for (const row of rows) {
      const key = `${row.unit_id}:${row.command_idempotency_key}`;
      const group = byCommand.get(key) ?? [];
      group.push(row);
      byCommand.set(key, group);
    }
    return inputs.map((input) => {
      const orig = byCommand.get(`${input.unitId}:${materialCommandKey(input.actualId)}`) ?? [];
      const undo = byCommand.get(`${input.unitId}:${materialReversalKey(input.actualId)}`) ?? [];
      if (orig.length > 1 || undo.length > 1) throw new InventoryError('INVENTORY_VALIDATION_FAILED');
      if (orig[0]) this.assertBoundMovement(orig[0], input);
      if (undo[0] && (!orig[0] ||
          undo[0].reversal_of_movement_id !== orig[0].id ||
          undo[0].movement_type !== STOCK_MOVEMENT_TYPES.In)) {
        throw new InventoryError('INVENTORY_VALIDATION_FAILED');
      }
      return {
        actualId: input.actualId,
        posted: orig[0] ? boundMaterialResult(orig[0], true) : null,
        reversed: undo[0] ? boundMaterialResult(undo[0], true) : null,
      };
    });
  }

  private assertBoundActualInput(input: BoundMaterialActualStockInput): void {
    assertUuid(input.actualId, 'actualId');
    assertUuid(input.actorIdentityId, 'actorIdentityId');
    assertUuid(input.inventoryItemId, 'inventoryItemId');
    assertUuid(input.warehouseId, 'warehouseId');
    if (!input.actorSessionId || !input.unitId ||
        !/^\d{4}-\d{2}-\d{2}$/.test(input.occurredOn) ||
        normalizeQuantity(input.quantity) !== input.quantity) {
      throw new InventoryError('INVENTORY_VALIDATION_FAILED');
    }
  }

  private assertBoundMovement(
    row: StockMovementRow,
    input: Pick<BoundMaterialActualStockInput,
      'actualId' | 'inventoryItemId' | 'warehouseId' | 'unitId' | 'quantity'>,
  ): void {
    if (row.source_kind !== 'SERVICE_ORDER_EXECUTION_ACTUAL' ||
      row.source_id !== input.actualId ||
      row.unit_id !== input.unitId ||
      row.warehouse_id !== input.warehouseId ||
      row.inventory_item_id !== input.inventoryItemId ||
      row.movement_type !== STOCK_MOVEMENT_TYPES.Out ||
      normalizeQuantity(row.quantity) !== normalizeQuantity(input.quantity)) {
      throw new InventoryError('INVENTORY_VALIDATION_FAILED');
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
    reason?: string,
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
        /*
         * F1.2 — REPLAY IDEMPOTENTE NÃO REPOSTA.
         *
         * A movimentação (e o seu fato econômico) já foi publicada na primeira execução.
         * Chamar `postPostedMovement` aqui era o segundo caminho para o mesmo journal —
         * e fazia um replay perfeitamente válido falhar com erro de posting, escondendo
         * a causa atrás de `INVENTORY_VALIDATION_FAILED`. O estado contábil já é
         * observável pela Central de Contabilidade; repetir o comando não é repetir o
         * posting.
         */
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
                description: reason ? `Reversal of ${original.id}: ${reason}` : `Reversal of ${original.id}`,
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
      await this.postAllMovements(actor, reversed);
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

  /**
   * F1.1 — posting de N movimentações com falha PROPAGADA.
   *
   * Substitui `tryPostPostedMovements`, que engolia a falha de cada linha. Aqui a
   * primeira falha interrompe e sobe: não existe mais "movimentei 3 de 5 e o
   * estoque ficou sem journal em 2 sem ninguém saber".
   *
   * A idempotência continua garantida pelo ACCOUNTING (`posting_requests` único por
   * evento/fonte), então repetir a chamada após falha parcial NÃO duplica journal.
   */
  /**
   * F1.2 — SEM POSTING SÍNCRONO AQUI.
   *
   * Antes, este método percorria as movimentações e chamava
   * `accountingIntegration.postPostedMovement` para CADA uma. Três consequências
   * ruins, todas medidas:
   *
   *  1. DUPLICIDADE — `postMovements` já publica o fato econômico na MESMA transação
   *     da movimentação. Contabilizar de novo aqui era um segundo caminho para o
   *     mesmo journal, e a única coisa que impedia o journal duplicado era a
   *     idempotência do ACCOUNTING — proteção acidental, não desenho.
   *  2. ACOPLAMENTO SÍNCRONO — a falha do posting (por exemplo, nenhuma regra
   *     publicada) subia e abortava a movimentação de estoque INTEIRA, mesmo com o
   *     estoque já corretamente movimentado. O defeito aparecia como
   *     `INVENTORY_VALIDATION_FAILED`, escondendo `ACCOUNTING_RULE_NOT_CONFIGURED`.
   *  3. ORDEM ERRADA — o posting rodava depois do COMMIT. Se o processo caísse nesse
   *     intervalo, o estoque estava movimentado e o journal não existia.
   *
   * O contrato da F1.2 é: a ORIGEM publica o FATO; a CONTROLADORIA decide o posting.
   * A publicação já ocorreu em `postMovements`; quem contabiliza é o consumidor da
   * outbox, de forma retentável e observável.
   *
   * Nada é "engolido": a falha de posting fica registrada em `evt.outbox_events`
   * (`status = FAILED`, `last_error`) e aparece na Central de Contabilidade com o
   * comando de reprocessar. O operador vê e resolve; o estoque não fica travado.
   */
  private async postAllMovements(
    actor: IdentityAuthzContext,
    movements: StockMovementRow[],
  ): Promise<void> {
    // Sem posting síncrono: o fato já foi publicado transacionalmente por
    // `repository.postMovements`. `actor` permanece na assinatura porque a publicação
    // do fato exige autor — ele viaja no payload do evento econômico.
    void actor;
    void movements;
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
        // Reservation consumption is currently all-or-nothing. Until a partial
        // consumption contract exists, never release the unconsumed remainder.
        if (validated.movementType !== STOCK_MOVEMENT_TYPES.Out) {
          throw new InventoryError('INVENTORY_INVALID_MOVEMENT_TYPE');
        }
        const reservation = await this.repository.findReservationByIdInside(
          client,
          validated.reservationId,
        );
        if (
          !reservation ||
          reservation.status !== RESERVATION_STATUSES.Active ||
          reservation.unit_id !== validated.unitId ||
          reservation.warehouse_id !== validated.warehouseId ||
          reservation.inventory_item_id !== validated.inventoryItemId
        ) {
          throw new InventoryError('INVENTORY_NOT_FOUND');
        }
        if (normalizeQuantity(reservation.quantity) !== validated.quantity) {
          throw new InventoryError('INVENTORY_INVALID_QUANTITY');
        }
        // Remove exactly this reservation from the position calculation, not
        // an arbitrary reservation with the same quantity.
        const remaining = [...loaded.activeReservationQuantities];
        const reservedIndex = remaining.findIndex(
          (quantity) => normalizeQuantity(quantity) === validated.quantity,
        );
        if (reservedIndex === -1) {
          throw new InventoryError('INVENTORY_NOT_FOUND');
        }
        remaining.splice(reservedIndex, 1);
        reservationQuantities = remaining;
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


function materialCommandKey(actualId: string): string {
  return `os-material-out:${actualId}`;
}

function materialReversalKey(actualId: string): string {
  return `os-material-reversal:${actualId}`;
}

function boundMaterialResult(row: StockMovementRow, idempotent: boolean): BoundMaterialStockResult {
  return {
    movementId: row.id,
    idempotent,
    quantity: row.quantity,
    unitCost: row.unit_cost,
    totalCost: row.total_cost,
    costingRuleVersionId: row.costing_rule_version_id,
  };
}
