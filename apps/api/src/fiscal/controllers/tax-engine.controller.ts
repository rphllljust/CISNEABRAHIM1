import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import {
  validateCalculateTaxInput,
  validateCreateTaxRuleInput,
  validateCreateTaxRuleVersionInput,
} from '../domain/tax-engine.validation';
import { TaxEngineAccessService } from '../services/tax-engine-access.service';

@Controller('fiscal/tax')
@UseGuards(JwtAuthGuard)
export class TaxEngineController {
  constructor(private readonly taxEngine: TaxEngineAccessService) {}

  /** Lista paginada de regras com a versao publicada vigente (unidade obrigatoria). */
  @Get('rules')
  listRules(@CurrentAuth() auth: AccessTokenClaims, @Query() query: Record<string, unknown>) {
    return this.taxEngine.listRules(
      { identityId: auth.sub, sessionId: auth.sid },
      query as { unitId: string } & Record<string, unknown>,
    );
  }

  @Post('rules')
  @HttpCode(200)
  createRule(@CurrentAuth() auth: AccessTokenClaims, @Body() body: never) {
    return this.taxEngine.createRule(
      { identityId: auth.sub, sessionId: auth.sid },
      validateCreateTaxRuleInput(body),
    );
  }

  @Post('rules/:taxRuleId/versions')
  @HttpCode(200)
  createVersion(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('taxRuleId') taxRuleId: string,
    @Body() body: never,
  ) {
    return this.taxEngine.createVersion(
      { identityId: auth.sub, sessionId: auth.sid },
      taxRuleId,
      validateCreateTaxRuleVersionInput(body),
    );
  }

  @Post('versions/:versionId/publish')
  @HttpCode(200)
  publishVersion(@CurrentAuth() auth: AccessTokenClaims, @Param('versionId') versionId: string) {
    return this.taxEngine.publishVersion({ identityId: auth.sub, sessionId: auth.sid }, versionId);
  }

  @Get('rules/:taxRuleId')
  getRule(@CurrentAuth() auth: AccessTokenClaims, @Param('taxRuleId') taxRuleId: string) {
    return this.taxEngine.getRule({ identityId: auth.sub, sessionId: auth.sid }, taxRuleId);
  }

  @Post('calculations')
  @HttpCode(200)
  calculate(@CurrentAuth() auth: AccessTokenClaims, @Body() body: never) {
    return this.taxEngine.calculate(
      { identityId: auth.sub, sessionId: auth.sid },
      validateCalculateTaxInput(body),
    );
  }

  @Get('calculations')
  listCalculations(@CurrentAuth() auth: AccessTokenClaims, @Query() query: Record<string, unknown>) {
    return this.taxEngine.listCalculations(
      { identityId: auth.sub, sessionId: auth.sid },
      query as { unitId: string; limit?: unknown; offset?: unknown; q?: string },
    );
  }

  @Get('calculations/:calculationId')
  getCalculation(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('calculationId') calculationId: string,
  ) {
    return this.taxEngine.getCalculation(
      { identityId: auth.sub, sessionId: auth.sid },
      calculationId,
    );
  }

  @Post('calculations/:calculationId/reproduce')
  @HttpCode(200)
  reproduce(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('calculationId') calculationId: string,
  ) {
    return this.taxEngine.reproduce({ identityId: auth.sub, sessionId: auth.sid }, calculationId);
  }
}
