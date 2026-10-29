import { Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import { OperationalUnitDirectoryService } from '../services/operational-unit-directory.service';

/** Enterprise unit master. Business identity and policy scope are distinct. */
@Controller('organization/operational-units')
@UseGuards(JwtAuthGuard)
export class OperationalUnitDirectoryController {
  constructor(private readonly directory: OperationalUnitDirectoryService) {}

  @Get()
  list(@CurrentAuth() auth: AccessTokenClaims) {
    return this.directory.listAdminVisible({ identityId: auth.sub, sessionId: auth.sid });
  }

  @Get(':id/history')
  history(@CurrentAuth() auth: AccessTokenClaims, @Param('id') id: string) {
    return this.directory.getHistory({ identityId: auth.sub, sessionId: auth.sid }, id);
  }

  @Post()
  create(@CurrentAuth() auth: AccessTokenClaims, @Req() request: FastifyRequest) {
    return this.directory.create({ identityId: auth.sub, sessionId: auth.sid },
      request.body ?? {});
  }

  @Patch(':id')
  update(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('id') id: string,
    @Req() request: FastifyRequest,
  ) {
    return this.directory.update({ identityId: auth.sub, sessionId: auth.sid },
      id, request.body ?? {});
  }
}
