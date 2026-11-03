import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import { PersonWorkforceAllocationsService } from '../services/person-workforce-allocations.service';

/** Public, authorized Operations contract consumed by People 360. */
@Controller('people/:personId/service-order-allocations')
@UseGuards(JwtAuthGuard)
export class PersonWorkforceAllocationsController {
  constructor(private readonly relations: PersonWorkforceAllocationsService) {}

  @Get()
  listRecent(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('personId') personId: string,
  ) {
    return this.relations.listRecent(
      { identityId: auth.sub, sessionId: auth.sid },
      personId,
    );
  }
}
