import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import {
  validateAdjustTaxAssessmentInput,
  validateCancelTaxAssessmentInput,
  validateCreateTaxAssessmentInput,
  validateFinalizePayableInput,
} from '../domain/tax-assessment.validation';
import { TaxAssessmentAccessService } from '../services/tax-assessment-access.service';

@Controller('fiscal/tax/assessments')
@UseGuards(JwtAuthGuard)
export class TaxAssessmentController {
  constructor(private readonly assessments: TaxAssessmentAccessService) {}

  /** Lista paginada por unidade; declarada antes de `:assessmentId` para nao ser capturada. */
  @Get()
  list(@CurrentAuth() auth: AccessTokenClaims, @Query() query: Record<string, unknown>) {
    return this.assessments.list(
      { identityId: auth.sub, sessionId: auth.sid },
      query as { unitId: string } & Record<string, unknown>,
    );
  }

  @Post()
  @HttpCode(200)
  create(@CurrentAuth() auth: AccessTokenClaims, @Body() body: never) {
    return this.assessments.create(
      { identityId: auth.sub, sessionId: auth.sid },
      validateCreateTaxAssessmentInput(body),
    );
  }

  @Get(':assessmentId')
  getById(@CurrentAuth() auth: AccessTokenClaims, @Param('assessmentId') assessmentId: string) {
    return this.assessments.getById({ identityId: auth.sub, sessionId: auth.sid }, assessmentId);
  }

  @Post(':assessmentId/finalize')
  @HttpCode(200)
  finalize(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('assessmentId') assessmentId: string,
    @Body() body: never,
  ) {
    return this.assessments.finalize(
      { identityId: auth.sub, sessionId: auth.sid },
      assessmentId,
      validateFinalizePayableInput(body),
    );
  }

  @Post(':assessmentId/adjust')
  @HttpCode(200)
  adjust(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('assessmentId') assessmentId: string,
    @Body() body: never,
  ) {
    return this.assessments.adjust(
      { identityId: auth.sub, sessionId: auth.sid },
      assessmentId,
      validateAdjustTaxAssessmentInput(body),
    );
  }

  @Post(':assessmentId/cancel')
  @HttpCode(200)
  cancel(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('assessmentId') assessmentId: string,
    @Body() body: never,
  ) {
    return this.assessments.cancel(
      { identityId: auth.sub, sessionId: auth.sid },
      assessmentId,
      validateCancelTaxAssessmentInput(body),
    );
  }
}
