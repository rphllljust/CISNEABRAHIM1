import { Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import { parseFinanceListQuery } from '../dto/finance-list.dto';
import {
  validateCancelReceivableInput,
  validateReverseSettlementInput,
  validateSettleReceivableInput,
} from '../domain/receivable.validation';
import { ReceivablesAccessService } from '../services/receivables-access.service';

@Controller('finance/receivables')
@UseGuards(JwtAuthGuard)
export class ReceivablesController {
  constructor(private readonly receivablesAccess: ReceivablesAccessService) {}

  @Get()
  list(@CurrentAuth() auth: AccessTokenClaims, @Query() query: Record<string, unknown>) {
    return this.receivablesAccess.list(
      { identityId: auth.sub, sessionId: auth.sid },
      parseFinanceListQuery(query),
    );
  }

  @Get(':receivableId')
  getById(@CurrentAuth() auth: AccessTokenClaims, @Param('receivableId') receivableId: string) {
    return this.receivablesAccess.getById({ identityId: auth.sub, sessionId: auth.sid }, receivableId);
  }

  @Post(':receivableId/settlements')
  @HttpCode(200)
  settle(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('receivableId') receivableId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.receivablesAccess.settle(
      { identityId: auth.sub, sessionId: auth.sid },
      receivableId,
      validateSettleReceivableInput(request.body as never),
    );
  }

  @Post(':receivableId/settlements/:settlementId/reverse')
  @HttpCode(200)
  reverseSettlement(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('receivableId') receivableId: string,
    @Param('settlementId') settlementId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.receivablesAccess.reverseSettlement(
      { identityId: auth.sub, sessionId: auth.sid },
      receivableId,
      settlementId,
      validateReverseSettlementInput(request.body as never),
    );
  }

  @Post(':receivableId/cancel')
  @HttpCode(200)
  cancel(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('receivableId') receivableId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.receivablesAccess.cancel(
      { identityId: auth.sub, sessionId: auth.sid },
      receivableId,
      validateCancelReceivableInput(request.body as never),
    );
  }
}
