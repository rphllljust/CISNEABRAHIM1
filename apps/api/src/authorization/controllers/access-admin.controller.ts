import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import { AuthorizationGuard } from '../guards/authorization.guard';
import { RequireAuthz } from '../decorators/require-authz.decorator';
import { AUTHZ_ACTIONS } from '../types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../types/authz-resources';
import { AccessAdminService } from '../services/access-admin.service';
import { SodExceptionService } from '../services/sod-exception.service';
import {
  parseAssignAccessRoleInput,
  parseCreateAccessRoleInput,
  parseUpdateAccessRoleInput,
} from '../dto/access-admin.dto';

@Controller('authz/access-admin')
export class AccessAdminController {
  constructor(
    private readonly accessAdmin: AccessAdminService,
    private readonly sodExceptions: SodExceptionService,
  ) {}

  @Get('catalog')
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @RequireAuthz({
    action: AUTHZ_ACTIONS.AccessAdminRead,
    resourceType: AUTHZ_RESOURCE_TYPES.AccessAdmin,
  })
  catalog(@CurrentAuth() auth: AccessTokenClaims) {
    return this.accessAdmin.catalog({ identityId: auth.sub, sessionId: auth.sid });
  }

  @Get('roles')
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @RequireAuthz({
    action: AUTHZ_ACTIONS.AccessAdminRead,
    resourceType: AUTHZ_RESOURCE_TYPES.AccessAdmin,
  })
  listRoles(@CurrentAuth() auth: AccessTokenClaims) {
    return this.accessAdmin.listRoles({ identityId: auth.sub, sessionId: auth.sid });
  }

  @Get('roles/:code')
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @RequireAuthz({
    action: AUTHZ_ACTIONS.AccessAdminRead,
    resourceType: AUTHZ_RESOURCE_TYPES.AccessAdmin,
  })
  getRole(@CurrentAuth() auth: AccessTokenClaims, @Param('code') code: string) {
    return this.accessAdmin.getRole({ identityId: auth.sub, sessionId: auth.sid }, code);
  }

  @Post('roles')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @RequireAuthz({
    action: AUTHZ_ACTIONS.AccessAdminManage,
    resourceType: AUTHZ_RESOURCE_TYPES.AccessAdmin,
  })
  createRole(@CurrentAuth() auth: AccessTokenClaims, @Req() request: FastifyRequest) {
    const command = parseCreateAccessRoleInput(request.body);
    return this.accessAdmin.createRole({ identityId: auth.sub, sessionId: auth.sid }, command);
  }

  @Put('roles/:code')
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @RequireAuthz({
    action: AUTHZ_ACTIONS.AccessAdminManage,
    resourceType: AUTHZ_RESOURCE_TYPES.AccessAdmin,
  })
  updateRole(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('code') code: string,
    @Req() request: FastifyRequest,
  ) {
    const command = parseUpdateAccessRoleInput(request.body);
    return this.accessAdmin.updateRole({ identityId: auth.sub, sessionId: auth.sid }, code, command);
  }

  @Get('assignments')
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @RequireAuthz({
    action: AUTHZ_ACTIONS.AccessAdminRead,
    resourceType: AUTHZ_RESOURCE_TYPES.AccessAdmin,
  })
  listAssignments(
    @CurrentAuth() auth: AccessTokenClaims,
    @Query('identityId') identityId?: string,
  ) {
    return this.accessAdmin.listAssignments(
      { identityId: auth.sub, sessionId: auth.sid },
      identityId,
    );
  }

  @Get('grants')
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @RequireAuthz({
    action: AUTHZ_ACTIONS.AccessAdminRead,
    resourceType: AUTHZ_RESOURCE_TYPES.AccessAdmin,
  })
  listGrants(
    @CurrentAuth() auth: AccessTokenClaims,
    @Query('identityId') identityId?: string,
    @Query('includeRevoked') includeRevoked?: string,
  ) {
    return this.accessAdmin.listGrants(
      { identityId: auth.sub, sessionId: auth.sid },
      identityId,
      includeRevoked === 'true',
    );
  }

  @Get('identities')
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @RequireAuthz({
    action: AUTHZ_ACTIONS.AccessAdminRead,
    resourceType: AUTHZ_RESOURCE_TYPES.AccessAdmin,
  })
  listIdentities(
    @CurrentAuth() auth: AccessTokenClaims,
    @Query('query') query?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.accessAdmin.listIdentities(
      { identityId: auth.sub, sessionId: auth.sid },
      { query, status, limit: limit ? Number(limit) : undefined },
    );
  }

  @Get('approval-matrices')
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @RequireAuthz({
    action: AUTHZ_ACTIONS.AccessAdminRead,
    resourceType: AUTHZ_RESOURCE_TYPES.AccessAdmin,
  })
  approvalMatrices(@CurrentAuth() auth: AccessTokenClaims) {
    return this.accessAdmin.approvalMatrices({ identityId: auth.sub, sessionId: auth.sid });
  }

  @Get('approval-matrices/:matrixId/rules')
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @RequireAuthz({
    action: AUTHZ_ACTIONS.AccessAdminRead,
    resourceType: AUTHZ_RESOURCE_TYPES.AccessAdmin,
  })
  approvalMatrixRules(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('matrixId') matrixId: string,
    @Query('versionStatus') versionStatus?: string,
  ) {
    const status = versionStatus === 'DRAFT' ? 'DRAFT' : 'PUBLISHED';
    return this.accessAdmin.approvalMatrixRules(
      { identityId: auth.sub, sessionId: auth.sid },
      matrixId,
      status,
    );
  }

  @Get('approval-role-assignments')
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @RequireAuthz({
    action: AUTHZ_ACTIONS.AccessAdminRead,
    resourceType: AUTHZ_RESOURCE_TYPES.AccessAdmin,
  })
  approvalRoleAssignments(
    @CurrentAuth() auth: AccessTokenClaims,
    @Query('identityId') identityId?: string,
  ) {
    return this.accessAdmin.approvalRoleAssignments(
      { identityId: auth.sub, sessionId: auth.sid },
      identityId,
    );
  }

  @Post('assignments')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @RequireAuthz({
    action: AUTHZ_ACTIONS.AccessAdminManage,
    resourceType: AUTHZ_RESOURCE_TYPES.AccessAdmin,
  })
  assignRole(@CurrentAuth() auth: AccessTokenClaims, @Req() request: FastifyRequest) {
    const command = parseAssignAccessRoleInput(request.body);
    return this.accessAdmin.assignRole({ identityId: auth.sub, sessionId: auth.sid }, command);
  }

  @Post('assignments/:assignmentId/revoke')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @RequireAuthz({
    action: AUTHZ_ACTIONS.AccessAdminManage,
    resourceType: AUTHZ_RESOURCE_TYPES.AccessAdmin,
  })
  revokeAssignment(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('assignmentId') assignmentId: string,
  ) {
    return this.accessAdmin.revokeAssignment(
      { identityId: auth.sub, sessionId: auth.sid },
      assignmentId,
    );
  }

  @Get('sod-conflicts')
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @RequireAuthz({
    action: AUTHZ_ACTIONS.AccessAdminRead,
    resourceType: AUTHZ_RESOURCE_TYPES.AccessAdmin,
  })
  sodConflicts(@CurrentAuth() auth: AccessTokenClaims) {
    return this.accessAdmin.sodConflicts({ identityId: auth.sub, sessionId: auth.sid });
  }
  @Get('sod-exceptions')
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @RequireAuthz({ action: AUTHZ_ACTIONS.AccessAdminRead, resourceType: AUTHZ_RESOURCE_TYPES.AccessAdmin })
  listSodExceptions(@CurrentAuth() auth: AccessTokenClaims) {
    return this.sodExceptions.list({ identityId: auth.sub, sessionId: auth.sid });
  }

  @Post('sod-exceptions')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @RequireAuthz({ action: AUTHZ_ACTIONS.AccessAdminManage, resourceType: AUTHZ_RESOURCE_TYPES.AccessAdmin })
  requestSodException(@CurrentAuth() auth: AccessTokenClaims, @Req() request: FastifyRequest) {
    return this.sodExceptions.request({ identityId: auth.sub, sessionId: auth.sid }, request.body);
  }

  @Post('sod-exceptions/:exceptionId/approve')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @RequireAuthz({ action: AUTHZ_ACTIONS.AccessAdminManage, resourceType: AUTHZ_RESOURCE_TYPES.AccessAdmin })
  approveSodException(@CurrentAuth() auth: AccessTokenClaims, @Param('exceptionId') id: string) {
    return this.sodExceptions.approve({ identityId: auth.sub, sessionId: auth.sid }, id);
  }

  @Post('sod-exceptions/:exceptionId/revoke')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @RequireAuthz({ action: AUTHZ_ACTIONS.AccessAdminManage, resourceType: AUTHZ_RESOURCE_TYPES.AccessAdmin })
  revokeSodException(@CurrentAuth() auth: AccessTokenClaims, @Param('exceptionId') id: string) {
    return this.sodExceptions.revoke({ identityId: auth.sub, sessionId: auth.sid }, id);
  }

}
