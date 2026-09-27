import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import {
  validateCreateCostingRuleInput,
  validateCreateCostingRuleVersionInput,
  validatePublishCostingRuleVersionInput,
} from '../domain/costing.validation';
import {
  validateCreateInventoryItemInput,
  validateCreateWarehouseInput,
  validatePostStockMovementInput,
  validateReserveStockInput,
} from '../domain/inventory.validation';
import { InventoryAccessService } from '../services/inventory-access.service';
import { parseInventoryListQuery } from '../dto/inventory-list.dto';

@Controller('inventory')
@UseGuards(JwtAuthGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryAccessService) {}

  @Get('warehouses')
  listWarehouses(@CurrentAuth() auth: AccessTokenClaims, @Query() query: Record<string, unknown>) {
    return this.inventory.listWarehouses(
      { identityId: auth.sub, sessionId: auth.sid },
      parseInventoryListQuery(query),
    );
  }

  @Get('items')
  listItems(@CurrentAuth() auth: AccessTokenClaims, @Query() query: Record<string, unknown>) {
    return this.inventory.listItems(
      { identityId: auth.sub, sessionId: auth.sid },
      parseInventoryListQuery(query),
    );
  }

  @Get('movements')
  listMovements(@CurrentAuth() auth: AccessTokenClaims, @Query() query: Record<string, unknown>) {
    return this.inventory.listMovements(
      { identityId: auth.sub, sessionId: auth.sid },
      parseInventoryListQuery(query),
    );
  }

  @Get('reservations')
  listReservations(@CurrentAuth() auth: AccessTokenClaims, @Query() query: Record<string, unknown>) {
    return this.inventory.listReservations(
      { identityId: auth.sub, sessionId: auth.sid },
      parseInventoryListQuery(query),
    );
  }

  @Post('warehouses')
  @HttpCode(200)
  createWarehouse(@CurrentAuth() auth: AccessTokenClaims, @Body() body: never) {
    return this.inventory.createWarehouse(
      { identityId: auth.sub, sessionId: auth.sid },
      validateCreateWarehouseInput(body),
    );
  }

  @Post('items')
  @HttpCode(200)
  createItem(@CurrentAuth() auth: AccessTokenClaims, @Body() body: never) {
    return this.inventory.createItem(
      { identityId: auth.sub, sessionId: auth.sid },
      validateCreateInventoryItemInput(body),
    );
  }

  @Post('movements')
  @HttpCode(200)
  postStock(@CurrentAuth() auth: AccessTokenClaims, @Body() body: never) {
    return this.inventory.postStock(
      { identityId: auth.sub, sessionId: auth.sid },
      validatePostStockMovementInput(body),
    );
  }

  @Post('reservations')
  @HttpCode(200)
  reserve(@CurrentAuth() auth: AccessTokenClaims, @Body() body: never) {
    return this.inventory.reserve(
      { identityId: auth.sub, sessionId: auth.sid },
      validateReserveStockInput(body),
    );
  }

  @Post('reservations/:reservationId/release')
  @HttpCode(200)
  release(@CurrentAuth() auth: AccessTokenClaims, @Param('reservationId') reservationId: string) {
    return this.inventory.releaseReservation(
      { identityId: auth.sub, sessionId: auth.sid },
      reservationId,
    );
  }

  @Post('movements/reverse')
  @HttpCode(200)
  reverse(
    @CurrentAuth() auth: AccessTokenClaims,
    @Body() body: { unitId: string; commandIdempotencyKey: string; reversalKey: string },
  ) {
    return this.inventory.reverse(
      { identityId: auth.sub, sessionId: auth.sid },
      body.commandIdempotencyKey,
      body.unitId,
      body.reversalKey,
    );
  }

  @Get('balances/:warehouseId/:inventoryItemId')
  getBalance(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('warehouseId') warehouseId: string,
    @Param('inventoryItemId') inventoryItemId: string,
  ) {
    return this.inventory.getBalance(
      { identityId: auth.sub, sessionId: auth.sid },
      warehouseId,
      inventoryItemId,
    );
  }

  @Post('costing-rules')
  @HttpCode(200)
  createCostingRule(@CurrentAuth() auth: AccessTokenClaims, @Body() body: never) {
    return this.inventory.createCostingRule(
      { identityId: auth.sub, sessionId: auth.sid },
      validateCreateCostingRuleInput(body),
    );
  }

  @Post('costing-rules/:costingRuleId/versions')
  @HttpCode(200)
  createCostingRuleVersion(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('costingRuleId') costingRuleId: string,
    @Body() body: never,
  ) {
    return this.inventory.createCostingRuleVersion(
      { identityId: auth.sub, sessionId: auth.sid },
      costingRuleId,
      validateCreateCostingRuleVersionInput(body),
    );
  }

  @Post('costing-versions/:versionId/publish')
  @HttpCode(200)
  publishCostingRuleVersion(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('versionId') versionId: string,
    @Body() body: never,
  ) {
    return this.inventory.publishCostingRuleVersion(
      { identityId: auth.sub, sessionId: auth.sid },
      versionId,
      validatePublishCostingRuleVersionInput(body),
    );
  }

  @Get('costing-rules/:costingRuleId')
  getCostingRule(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('costingRuleId') costingRuleId: string,
  ) {
    return this.inventory.getCostingRule(
      { identityId: auth.sub, sessionId: auth.sid },
      costingRuleId,
    );
  }

  @Get('cost-reconcile/:warehouseId/:inventoryItemId')
  reconcileCost(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('warehouseId') warehouseId: string,
    @Param('inventoryItemId') inventoryItemId: string,
  ) {
    return this.inventory.reconcileCost(
      { identityId: auth.sub, sessionId: auth.sid },
      warehouseId,
      inventoryItemId,
    );
  }

  @Get('reconcile/:warehouseId/:inventoryItemId')
  reconcile(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('warehouseId') warehouseId: string,
    @Param('inventoryItemId') inventoryItemId: string,
    @Query() _query: never,
  ) {
    return this.inventory.reconcile(
      { identityId: auth.sub, sessionId: auth.sid },
      warehouseId,
      inventoryItemId,
    );
  }
}
