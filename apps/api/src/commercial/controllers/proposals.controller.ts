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
  parseAcceptProposalInput,
  parseCancelProposalInput,
  parseCreateProposalInput,
  parseLinkProposalDocumentInput,
  parseListProposalsQuery,
  parseRejectProposalInput,
  parseRowVersionBody,
  parseUpdateProposalDraftInput,
  parseVersionNumberParam,
} from '../dto/proposals.dto';
import { COMMERCIAL_ERROR_CODES } from '../errors/commercial-error-codes';
import { CommercialHttpException } from '../errors/commercial-http.exception';
import { ProposalsAccessService } from '../services/proposals-access.service';

@Controller('commercial/proposals')
@UseGuards(JwtAuthGuard)
export class ProposalsController {
  constructor(private readonly proposalsAccess: ProposalsAccessService) {}

  @Post()
  @HttpCode(201)
  create(@CurrentAuth() auth: AccessTokenClaims, @Req() request: FastifyRequest) {
    try {
      const input = parseCreateProposalInput(request.body);
      return this.proposalsAccess.create({ identityId: auth.sub, sessionId: auth.sid }, input);
    } catch {
      throw new CommercialHttpException(
        400,
        COMMERCIAL_ERROR_CODES.VALIDATION_FAILED,
        'Invalid request body.',
      );
    }
  }

  @Get()
  list(@CurrentAuth() auth: AccessTokenClaims, @Query() query: Record<string, unknown>) {
    try {
      const parsed = parseListProposalsQuery(query);
      return this.proposalsAccess.list({ identityId: auth.sub, sessionId: auth.sid }, parsed);
    } catch {
      throw new CommercialHttpException(
        400,
        COMMERCIAL_ERROR_CODES.VALIDATION_FAILED,
        'Invalid query parameters.',
      );
    }
  }

  @Get(':proposalId')
  getById(@CurrentAuth() auth: AccessTokenClaims, @Param('proposalId') proposalId: string) {
    return this.proposalsAccess.getById({ identityId: auth.sub, sessionId: auth.sid }, proposalId);
  }

  @Get(':proposalId/versions')
  listVersions(@CurrentAuth() auth: AccessTokenClaims, @Param('proposalId') proposalId: string) {
    return this.proposalsAccess.listVersions(
      { identityId: auth.sub, sessionId: auth.sid },
      proposalId,
    );
  }

  @Get(':proposalId/versions/:versionNumber')
  getVersion(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('proposalId') proposalId: string,
    @Param('versionNumber') versionNumber: string,
  ) {
    return this.proposalsAccess.getVersion(
      { identityId: auth.sub, sessionId: auth.sid },
      proposalId,
      parseVersionNumberParam(versionNumber),
    );
  }

  @Patch(':proposalId/versions/:versionNumber')
  updateDraft(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('proposalId') proposalId: string,
    @Param('versionNumber') versionNumber: string,
    @Req() request: FastifyRequest,
  ) {
    try {
      const input = parseUpdateProposalDraftInput(request.body);
      return this.proposalsAccess.updateDraft(
        { identityId: auth.sub, sessionId: auth.sid },
        proposalId,
        parseVersionNumberParam(versionNumber),
        input,
      );
    } catch {
      throw new CommercialHttpException(
        400,
        COMMERCIAL_ERROR_CODES.VALIDATION_FAILED,
        'Invalid request body.',
      );
    }
  }

  @Post(':proposalId/versions')
  @HttpCode(201)
  createRevision(@CurrentAuth() auth: AccessTokenClaims, @Param('proposalId') proposalId: string) {
    return this.proposalsAccess.createRevision(
      { identityId: auth.sub, sessionId: auth.sid },
      proposalId,
    );
  }

  @Post(':proposalId/versions/:versionNumber/issue')
  @HttpCode(200)
  issue(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('proposalId') proposalId: string,
    @Param('versionNumber') versionNumber: string,
    @Req() request: FastifyRequest,
  ) {
    const body = parseRowVersionBody(request.body);
    return this.proposalsAccess.issue(
      { identityId: auth.sub, sessionId: auth.sid },
      proposalId,
      parseVersionNumberParam(versionNumber),
      body.rowVersion,
    );
  }

  @Post(':proposalId/versions/:versionNumber/accept')
  @HttpCode(200)
  accept(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('proposalId') proposalId: string,
    @Param('versionNumber') versionNumber: string,
    @Req() request: FastifyRequest,
  ) {
    try {
      const input = parseAcceptProposalInput(request.body);
      return this.proposalsAccess.accept(
        { identityId: auth.sub, sessionId: auth.sid },
        proposalId,
        parseVersionNumberParam(versionNumber),
        input,
      );
    } catch {
      throw new CommercialHttpException(
        400,
        COMMERCIAL_ERROR_CODES.VALIDATION_FAILED,
        'Invalid request body.',
      );
    }
  }

  @Post(':proposalId/versions/:versionNumber/reject')
  @HttpCode(200)
  reject(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('proposalId') proposalId: string,
    @Param('versionNumber') versionNumber: string,
    @Req() request: FastifyRequest,
  ) {
    try {
      const input = parseRejectProposalInput(request.body);
      return this.proposalsAccess.reject(
        { identityId: auth.sub, sessionId: auth.sid },
        proposalId,
        parseVersionNumberParam(versionNumber),
        input,
      );
    } catch {
      throw new CommercialHttpException(
        400,
        COMMERCIAL_ERROR_CODES.VALIDATION_FAILED,
        'Invalid request body.',
      );
    }
  }

  @Post(':proposalId/versions/:versionNumber/expire')
  @HttpCode(200)
  expire(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('proposalId') proposalId: string,
    @Param('versionNumber') versionNumber: string,
    @Req() request: FastifyRequest,
  ) {
    const body = parseRowVersionBody(request.body);
    return this.proposalsAccess.expire(
      { identityId: auth.sub, sessionId: auth.sid },
      proposalId,
      parseVersionNumberParam(versionNumber),
      body.rowVersion,
    );
  }

  @Post(':proposalId/versions/:versionNumber/cancel')
  @HttpCode(200)
  cancel(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('proposalId') proposalId: string,
    @Param('versionNumber') versionNumber: string,
    @Req() request: FastifyRequest,
  ) {
    try {
      const input = parseCancelProposalInput(request.body);
      return this.proposalsAccess.cancel(
        { identityId: auth.sub, sessionId: auth.sid },
        proposalId,
        parseVersionNumberParam(versionNumber),
        input,
      );
    } catch {
      throw new CommercialHttpException(
        400,
        COMMERCIAL_ERROR_CODES.VALIDATION_FAILED,
        'Invalid request body.',
      );
    }
  }

  @Post(':proposalId/versions/:versionNumber/documents')
  @HttpCode(201)
  linkDocument(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('proposalId') proposalId: string,
    @Param('versionNumber') versionNumber: string,
    @Req() request: FastifyRequest,
  ) {
    try {
      const input = parseLinkProposalDocumentInput(request.body);
      return this.proposalsAccess.linkDocument(
        { identityId: auth.sub, sessionId: auth.sid },
        proposalId,
        parseVersionNumberParam(versionNumber),
        input,
      );
    } catch {
      throw new CommercialHttpException(
        400,
        COMMERCIAL_ERROR_CODES.VALIDATION_FAILED,
        'Invalid request body.',
      );
    }
  }
}
