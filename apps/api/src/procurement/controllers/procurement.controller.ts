import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import {
  parseListPurchaseRequestsQuery,
  parseListSupplierPurchaseOrdersQuery,
} from '../dto/procurement-list.dto';
import type {
  CreatePurchaseRequestInput,
  IssueSupplierPurchaseOrderInput,
  ReceiveSupplierPurchaseOrderInput,
  VersionedProcurementInput,
} from '../domain/procurement.validation';
import { ProcurementAccessService } from '../services/procurement-access.service';

@Controller('procurement')
@UseGuards(JwtAuthGuard)
export class ProcurementController {
  constructor(private readonly procurement: ProcurementAccessService) {}

  @Post('requests')
  @HttpCode(201)
  createRequest(@CurrentAuth() auth: AccessTokenClaims, @Body() body: CreatePurchaseRequestInput) {
    return this.procurement.createRequest({ identityId: auth.sub, sessionId: auth.sid }, body);
  }

  @Get('requests')
  listRequests(@CurrentAuth() auth: AccessTokenClaims, @Query() query: Record<string, unknown>) {
    const parsed = parseListPurchaseRequestsQuery(query);
    return this.procurement.listRequests({ identityId: auth.sub, sessionId: auth.sid }, parsed);
  }

  @Get('orders')
  listOrders(@CurrentAuth() auth: AccessTokenClaims, @Query() query: Record<string, unknown>) {
    const parsed = parseListSupplierPurchaseOrdersQuery(query);
    return this.procurement.listOrders({ identityId: auth.sub, sessionId: auth.sid }, parsed);
  }

  @Get('requests/:requestId')
  getRequest(@CurrentAuth() auth: AccessTokenClaims, @Param('requestId') requestId: string) {
    return this.procurement.getRequest({ identityId: auth.sub, sessionId: auth.sid }, requestId);
  }

  @Post('requests/:requestId/submit')
  submit(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('requestId') requestId: string,
    @Body() body: VersionedProcurementInput,
  ) {
    return this.procurement.submitRequest({ identityId: auth.sub, sessionId: auth.sid }, requestId, body);
  }

  @Post('requests/:requestId/approve')
  approve(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('requestId') requestId: string,
    @Body() body: VersionedProcurementInput,
  ) {
    return this.procurement.approveRequest({ identityId: auth.sub, sessionId: auth.sid }, requestId, body);
  }

  @Post('requests/:requestId/reject')
  reject(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('requestId') requestId: string,
    @Body() body: VersionedProcurementInput,
  ) {
    return this.procurement.rejectRequest({ identityId: auth.sub, sessionId: auth.sid }, requestId, body);
  }

  @Post('requests/:requestId/cancel')
  cancelRequest(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('requestId') requestId: string,
    @Body() body: VersionedProcurementInput,
  ) {
    return this.procurement.cancelRequest({ identityId: auth.sub, sessionId: auth.sid }, requestId, body);
  }

  @Post('requests/:requestId/issue-order')
  issueOrder(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('requestId') requestId: string,
    @Body() body: IssueSupplierPurchaseOrderInput,
  ) {
    return this.procurement.issueOrder({ identityId: auth.sub, sessionId: auth.sid }, requestId, body);
  }

  @Get('orders/:orderId')
  getOrder(@CurrentAuth() auth: AccessTokenClaims, @Param('orderId') orderId: string) {
    return this.procurement.getOrder({ identityId: auth.sub, sessionId: auth.sid }, orderId);
  }

  @Post('orders/:orderId/receive')
  receive(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('orderId') orderId: string,
    @Body() body: ReceiveSupplierPurchaseOrderInput,
  ) {
    return this.procurement.receiveOrder({ identityId: auth.sub, sessionId: auth.sid }, orderId, body);
  }

  @Post('orders/:orderId/cancel')
  cancelOrder(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('orderId') orderId: string,
    @Body() body: VersionedProcurementInput,
  ) {
    return this.procurement.cancelOrder({ identityId: auth.sub, sessionId: auth.sid }, orderId, body);
  }
}
