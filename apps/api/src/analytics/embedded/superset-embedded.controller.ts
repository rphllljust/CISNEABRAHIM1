import { Body, Controller, Get, Header, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import { SupersetEmbeddedService } from './superset-embedded.service';

type GuestTokenRequest = { dashboardKey?: unknown; unitId?: unknown };

@Controller('analytics/embedded')
@UseGuards(JwtAuthGuard)
export class SupersetEmbeddedController {
  constructor(private readonly superset: SupersetEmbeddedService) {}

  @Get('catalog')
  @Header('Cache-Control', 'private, no-store')
  listCatalog(@CurrentAuth() auth: AccessTokenClaims, @Query('unitId') unitId: string) {
    return this.superset.listDashboardCatalog(
      { identityId: auth.sub, sessionId: auth.sid },
      unitId,
    );
  }

  @Post('guest-token')
  @Header('Cache-Control', 'private, no-store')
  @Header('Pragma', 'no-cache')
  issueGuestToken(@CurrentAuth() auth: AccessTokenClaims, @Body() input: GuestTokenRequest) {
    return this.superset.issueGuestToken(
      { identityId: auth.sub, sessionId: auth.sid },
      input?.dashboardKey,
      input?.unitId,
    );
  }
}
