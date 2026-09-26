import { Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import { BillingAccessService } from '../services/billing-access.service';

@Controller('service-orders/:serviceOrderId/billing-records')
@UseGuards(JwtAuthGuard)
export class BillingController {
  constructor(private readonly billingAccess: BillingAccessService) {}

  @Get()
  getByServiceOrder(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('serviceOrderId') serviceOrderId: string,
  ) {
    return this.billingAccess.getByServiceOrder(
      { identityId: auth.sub, sessionId: auth.sid },
      serviceOrderId,
    );
  }

  @Post()
  @HttpCode(201)
  prepare(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('serviceOrderId') serviceOrderId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.billingAccess.prepare(
      { identityId: auth.sub, sessionId: auth.sid },
      serviceOrderId,
      request.body as never,
    );
  }

  @Get(':billingRecordId')
  getById(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('serviceOrderId') serviceOrderId: string,
    @Param('billingRecordId') billingRecordId: string,
  ) {
    return this.billingAccess.getById(
      { identityId: auth.sub, sessionId: auth.sid },
      serviceOrderId,
      billingRecordId,
    );
  }

  @Post(':billingRecordId/void')
  @HttpCode(200)
  voidRecord(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('serviceOrderId') serviceOrderId: string,
    @Param('billingRecordId') billingRecordId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.billingAccess.voidRecord(
      { identityId: auth.sub, sessionId: auth.sid },
      serviceOrderId,
      billingRecordId,
      request.body as never,
    );
  }
}
