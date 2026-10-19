import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import { CashFlowForecastAccessService } from '../services/cash-flow-forecast-access.service';

@Controller('finance/cash-forecast')
@UseGuards(JwtAuthGuard)
export class CashFlowForecastController {
  constructor(private readonly forecast: CashFlowForecastAccessService) {}

  /**
   * A validacao acontece DENTRO do service, nao aqui: o `project` envolve
   * validacao + autorizacao + consulta em um unico try/catch que traduz as
   * falhas de dominio em `FinanceHttpException`. Validar antes de chamar o
   * service deixava o `CashForecastError` e o `MoneyValidationError` escaparem
   * como excecao crua, e o filtro global `@Catch()` do SecurityModule os
   * reportava como 500 - um `unitId` ausente virava "erro interno do servidor".
   */
  @Get()
  project(
    @CurrentAuth() auth: AccessTokenClaims,
    @Query('unitId') unitId: string,
    @Query('currencyCode') currencyCode: string,
    @Query('asOf') asOf?: string,
    @Query('horizonEndsOn') horizonEndsOn?: string,
  ) {
    return this.forecast.project({ identityId: auth.sub, sessionId: auth.sid }, {
      unitId,
      currencyCode,
      asOf,
      horizonEndsOn,
    });
  }
}
