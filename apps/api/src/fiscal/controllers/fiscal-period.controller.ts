import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import {
  validateOpenFiscalPeriodInput,
  validateReopenFiscalPeriodInput,
} from '../domain/fiscal-period.validation';
import { FiscalPeriodAccessService } from '../services/fiscal-period-access.service';

@Controller('fiscal/periods')
@UseGuards(JwtAuthGuard)
export class FiscalPeriodController {
  constructor(private readonly periods: FiscalPeriodAccessService) {}

  /** Lista paginada por unidade; declarada antes de `:periodId` para nao ser capturada. */
  @Get()
  list(@CurrentAuth() auth: AccessTokenClaims, @Query() query: Record<string, unknown>) {
    return this.periods.listPeriods(
      { identityId: auth.sub, sessionId: auth.sid },
      query as { unitId: string } & Record<string, unknown>,
    );
  }

  @Post()
  @HttpCode(200)
  open(@CurrentAuth() auth: AccessTokenClaims, @Body() body: never) {
    return this.periods.open({ identityId: auth.sub, sessionId: auth.sid }, validateOpenFiscalPeriodInput(body));
  }

  @Get(':periodId')
  getById(@CurrentAuth() auth: AccessTokenClaims, @Param('periodId') periodId: string) {
    return this.periods.getById({ identityId: auth.sub, sessionId: auth.sid }, periodId);
  }

  @Post(':periodId/close')
  @HttpCode(200)
  close(@CurrentAuth() auth: AccessTokenClaims, @Param('periodId') periodId: string) {
    return this.periods.close({ identityId: auth.sub, sessionId: auth.sid }, periodId);
  }

  @Post(':periodId/reopen')
  @HttpCode(200)
  reopen(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('periodId') periodId: string,
    @Body() body: never,
  ) {
    return this.periods.reopen(
      { identityId: auth.sub, sessionId: auth.sid },
      periodId,
      validateReopenFiscalPeriodInput(body),
    );
  }
}
