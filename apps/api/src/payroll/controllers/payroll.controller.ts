import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import {
  validateCreateEmploymentContractInput,
  validateOpenPayrollPeriodInput,
  validateRecordPayrollEventInput,
} from '../domain/payroll.validation';
import { PayrollAccessService } from '../services/payroll-access.service';

@Controller('payroll')
@UseGuards(JwtAuthGuard)
export class PayrollController {
  constructor(private readonly payroll: PayrollAccessService) {}

  @Post('contracts')
  @HttpCode(200)
  createContract(@CurrentAuth() auth: AccessTokenClaims, @Body() body: never) {
    return this.payroll.createContract(
      { identityId: auth.sub, sessionId: auth.sid },
      validateCreateEmploymentContractInput(body),
    );
  }

  @Get('periods')
  listPeriods(@CurrentAuth() auth: AccessTokenClaims, @Query() query: Record<string, unknown>) {
    return this.payroll.listPeriods({ identityId: auth.sub, sessionId: auth.sid }, query);
  }

  @Post('periods')
  @HttpCode(200)
  openPeriod(@CurrentAuth() auth: AccessTokenClaims, @Body() body: never) {
    return this.payroll.openPeriod(
      { identityId: auth.sub, sessionId: auth.sid },
      validateOpenPayrollPeriodInput(body),
    );
  }

  @Post('events')
  @HttpCode(200)
  recordEvent(@CurrentAuth() auth: AccessTokenClaims, @Body() body: never) {
    return this.payroll.recordEvent(
      { identityId: auth.sub, sessionId: auth.sid },
      validateRecordPayrollEventInput(body),
    );
  }

  @Post('periods/:periodId/calculate')
  @HttpCode(200)
  calculate(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('periodId') periodId: string,
    @Body() body: { unitId: string },
  ) {
    return this.payroll.calculatePeriod(
      { identityId: auth.sub, sessionId: auth.sid },
      periodId,
      body.unitId,
    );
  }

  @Post('periods/:periodId/close')
  @HttpCode(200)
  close(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('periodId') periodId: string,
    @Body() body: { unitId: string },
  ) {
    return this.payroll.closePeriodAuthorized(
      { identityId: auth.sub, sessionId: auth.sid },
      periodId,
      body.unitId,
    );
  }

  @Post('periods/:periodId/reopen')
  @HttpCode(200)
  reopen(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('periodId') periodId: string,
    @Body() body: { unitId: string },
  ) {
    return this.payroll.reopenPeriod(
      { identityId: auth.sub, sessionId: auth.sid },
      periodId,
      body.unitId,
    );
  }

  @Get('periods/:periodId')
  getPeriod(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('periodId') periodId: string,
    @Query('unitId') unitId: string,
  ) {
    return this.payroll.getPeriod({ identityId: auth.sub, sessionId: auth.sid }, periodId, unitId);
  }

  @Get('periods/:periodId/results')
  listResults(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('periodId') periodId: string,
    @Query('unitId') unitId: string,
  ) {
    return this.payroll.listResults({ identityId: auth.sub, sessionId: auth.sid }, periodId, unitId);
  }
}
