import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import { ComplianceAccessService } from '../services/compliance-access.service';

@Controller('analytics/compliance')
@UseGuards(JwtAuthGuard)
export class ComplianceController {
  constructor(private readonly complianceAccessService: ComplianceAccessService) {}

  @Get()
  getCompliance(
    @CurrentAuth() auth: AccessTokenClaims,
    @Query('unitId') unitId: string,
    @Query('period') period?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.complianceAccessService.getComplianceSnapshot(
      { identityId: auth.sub, sessionId: auth.sid },
      { unitId, period, from, to },
    );
  }
}
