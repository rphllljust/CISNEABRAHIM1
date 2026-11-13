import { Controller, Get, HttpCode, Param, Post, Req, UseFilters, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { FinanceValidationFilter } from '../errors/finance-validation.filter';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import {
  validatePostTreasuryMovementInput,
  validateReverseTreasuryInput,
} from '../domain/treasury.validation';
import { TreasuryAccessService } from '../services/treasury-access.service';

@Controller('finance/treasury')
@UseFilters(FinanceValidationFilter)
@UseGuards(JwtAuthGuard)
export class TreasuryController {
  constructor(private readonly treasuryAccess: TreasuryAccessService) {}

  @Get('accounts')
  list(@CurrentAuth() auth: AccessTokenClaims) {
    return this.treasuryAccess.list({ identityId: auth.sub, sessionId: auth.sid });
  }

  @Post('accounts')
  @HttpCode(200)
  open(@CurrentAuth() auth: AccessTokenClaims, @Req() request: FastifyRequest) {
    return this.treasuryAccess.openAccount(
      { identityId: auth.sub, sessionId: auth.sid },
      request.body as never,
    );
  }

  @Get('accounts/:accountId')
  getById(@CurrentAuth() auth: AccessTokenClaims, @Param('accountId') accountId: string) {
    return this.treasuryAccess.getById({ identityId: auth.sub, sessionId: auth.sid }, accountId);
  }

  @Get('accounts/:accountId/reconciliation')
  reconcile(@CurrentAuth() auth: AccessTokenClaims, @Param('accountId') accountId: string) {
    return this.treasuryAccess.reconcile({ identityId: auth.sub, sessionId: auth.sid }, accountId);
  }

  @Post('accounts/:accountId/movements')
  @HttpCode(200)
  postMovement(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('accountId') accountId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.treasuryAccess.postMovement(
      { identityId: auth.sub, sessionId: auth.sid },
      accountId,
      validatePostTreasuryMovementInput(request.body as never),
    );
  }

  @Post('transfers')
  @HttpCode(200)
  transfer(@CurrentAuth() auth: AccessTokenClaims, @Req() request: FastifyRequest) {
    return this.treasuryAccess.transfer(
      { identityId: auth.sub, sessionId: auth.sid },
      request.body as never,
    );
  }

  @Post('transfers/:transferId/reverse')
  @HttpCode(200)
  reverseTransfer(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('transferId') transferId: string,
    @Req() request: FastifyRequest,
  ) {
    const body = request.body as ReverseBody;
    return this.treasuryAccess.reverseTransfer(
      { identityId: auth.sub, sessionId: auth.sid },
      transferId,
      {
        ...validateReverseTreasuryInput(body),
        rowVersionTo: body.rowVersionTo,
      },
    );
  }

  @Post('movements/:transactionId/reverse')
  @HttpCode(200)
  reverseMovement(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('transactionId') transactionId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.treasuryAccess.reverseMovement(
      { identityId: auth.sub, sessionId: auth.sid },
      transactionId,
      validateReverseTreasuryInput(request.body as never),
    );
  }
}

type ReverseBody = {
  rowVersion: number;
  rowVersionTo: number;
  idempotencyKey: string;
  reference: string;
  reason: string;
  amount?: string;
};
