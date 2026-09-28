import { Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import { parseFinanceListQuery } from '../dto/finance-list.dto';
import {
  validateCancelPayableInput,
  validateCreateExpenseCategoryInput,
  validatePayPayableInput,
  validateReversePaymentInput,
} from '../domain/payable.validation';
import { PayablesAccessService } from '../services/payables-access.service';

@Controller('finance')
@UseGuards(JwtAuthGuard)
export class PayablesController {
  constructor(private readonly payablesAccess: PayablesAccessService) {}

  @Post('expense-categories')
  @HttpCode(200)
  createExpenseCategory(@CurrentAuth() auth: AccessTokenClaims, @Req() request: FastifyRequest) {
    return this.payablesAccess.createExpenseCategory(
      { identityId: auth.sub, sessionId: auth.sid },
      validateCreateExpenseCategoryInput(request.body as never),
    );
  }

  @Get('payables/aging')
  aging(@CurrentAuth() auth: AccessTokenClaims, @Query('asOf') asOf?: string) {
    return this.payablesAccess.aging(
      { identityId: auth.sub, sessionId: auth.sid },
      asOf ? new Date(asOf) : undefined,
    );
  }

  @Get('payables')
  list(@CurrentAuth() auth: AccessTokenClaims, @Query() query: Record<string, unknown>) {
    return this.payablesAccess.list(
      { identityId: auth.sub, sessionId: auth.sid },
      parseFinanceListQuery(query),
    );
  }

  @Post('payables')
  @HttpCode(200)
  open(@CurrentAuth() auth: AccessTokenClaims, @Req() request: FastifyRequest) {
    return this.payablesAccess.open(
      { identityId: auth.sub, sessionId: auth.sid },
      request.body as never,
    );
  }

  @Get('payables/:payableId')
  getById(@CurrentAuth() auth: AccessTokenClaims, @Param('payableId') payableId: string) {
    return this.payablesAccess.getById({ identityId: auth.sub, sessionId: auth.sid }, payableId);
  }

  @Post('payables/:payableId/payments')
  @HttpCode(200)
  pay(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('payableId') payableId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.payablesAccess.pay(
      { identityId: auth.sub, sessionId: auth.sid },
      payableId,
      validatePayPayableInput(request.body as never),
    );
  }

  @Post('payables/:payableId/payments/:paymentId/reverse')
  @HttpCode(200)
  reverse(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('payableId') payableId: string,
    @Param('paymentId') paymentId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.payablesAccess.reverse(
      { identityId: auth.sub, sessionId: auth.sid },
      payableId,
      paymentId,
      validateReversePaymentInput(request.body as never),
    );
  }

  @Post('payables/:payableId/cancel')
  @HttpCode(200)
  cancel(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('payableId') payableId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.payablesAccess.cancel(
      { identityId: auth.sub, sessionId: auth.sid },
      payableId,
      validateCancelPayableInput(request.body as never),
    );
  }
}
