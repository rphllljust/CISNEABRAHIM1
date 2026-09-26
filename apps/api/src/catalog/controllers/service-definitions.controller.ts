import {
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import {
  parseCreateServiceDefinitionInput,
  parseCreateServiceDefinitionVersionInput,
  parseDeactivateServiceDefinitionInput,
  parseLineageTransitionInput,
  parseListServiceDefinitionsQuery,
  parseUpdateDraftServiceDefinitionInput,
  parseVersionNumberParam,
} from '../dto/service-catalog.dto';
import { ServiceCatalogAccessService } from '../services/service-catalog-access.service';

@Controller('catalog/service-definitions')
@UseGuards(JwtAuthGuard)
export class ServiceDefinitionsController {
  constructor(private readonly catalogAccess: ServiceCatalogAccessService) {}

  @Post()
  @HttpCode(201)
  create(@CurrentAuth() auth: AccessTokenClaims, @Req() request: FastifyRequest) {
    const input = parseCreateServiceDefinitionInput(request.body);
    return this.catalogAccess.create({ identityId: auth.sub, sessionId: auth.sid }, input);
  }

  @Get()
  list(@CurrentAuth() auth: AccessTokenClaims, @Query() query: Record<string, unknown>) {
    const parsed = parseListServiceDefinitionsQuery(query);
    return this.catalogAccess.listDefinitions({ identityId: auth.sub, sessionId: auth.sid }, parsed);
  }

  @Get('categories')
  listCategories(@CurrentAuth() auth: AccessTokenClaims) {
    return this.catalogAccess.listCategories({ identityId: auth.sub, sessionId: auth.sid });
  }

  @Get(':definitionId')
  getDefinition(@CurrentAuth() auth: AccessTokenClaims, @Param('definitionId') definitionId: string) {
    return this.catalogAccess.getDefinition({ identityId: auth.sub, sessionId: auth.sid }, definitionId);
  }

  @Post(':definitionId/deactivate')
  @HttpCode(200)
  deactivate(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('definitionId') definitionId: string,
    @Req() request: FastifyRequest,
  ) {
    const body = parseDeactivateServiceDefinitionInput(request.body);
    return this.catalogAccess.deactivate(
      { identityId: auth.sub, sessionId: auth.sid },
      definitionId,
      body.lineageVersion,
      body.reason,
    );
  }

  @Post(':definitionId/activate')
  @HttpCode(200)
  activate(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('definitionId') definitionId: string,
    @Req() request: FastifyRequest,
  ) {
    const body = parseLineageTransitionInput(request.body);
    return this.catalogAccess.activate(
      { identityId: auth.sub, sessionId: auth.sid },
      definitionId,
      body.lineageVersion,
    );
  }

  @Post(':definitionId/versions')
  @HttpCode(201)
  createVersion(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('definitionId') definitionId: string,
    @Req() request: FastifyRequest,
  ) {
    const input = parseCreateServiceDefinitionVersionInput(request.body);
    return this.catalogAccess.createVersion(
      { identityId: auth.sub, sessionId: auth.sid },
      definitionId,
      input,
    );
  }

  @Get(':definitionId/versions')
  listVersions(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('definitionId') definitionId: string,
  ) {
    return this.catalogAccess.listVersions({ identityId: auth.sub, sessionId: auth.sid }, definitionId);
  }

  @Get(':definitionId/versions/:versionNumber')
  getVersion(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('definitionId') definitionId: string,
    @Param('versionNumber') versionNumber: string,
  ) {
    return this.catalogAccess.getVersion(
      { identityId: auth.sub, sessionId: auth.sid },
      definitionId,
      parseVersionNumberParam(versionNumber),
    );
  }

  @Patch(':definitionId/versions/:versionNumber')
  updateDraft(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('definitionId') definitionId: string,
    @Param('versionNumber') versionNumber: string,
    @Req() request: FastifyRequest,
  ) {
    const input = parseUpdateDraftServiceDefinitionInput(request.body);
    return this.catalogAccess.updateDraft(
      { identityId: auth.sub, sessionId: auth.sid },
      definitionId,
      parseVersionNumberParam(versionNumber),
      input,
    );
  }

  @Post(':definitionId/versions/:versionNumber/publish')
  @HttpCode(200)
  publishVersion(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('definitionId') definitionId: string,
    @Param('versionNumber') versionNumber: string,
    @Req() request: FastifyRequest,
  ) {
    const body = parseLineageTransitionInput(request.body);
    return this.catalogAccess.publishVersion(
      { identityId: auth.sub, sessionId: auth.sid },
      definitionId,
      parseVersionNumberParam(versionNumber),
      body.lineageVersion,
    );
  }
}
