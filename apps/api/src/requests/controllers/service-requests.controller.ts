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
  parseApproveServiceRequestInput,
  parseCancelServiceRequestInput,
  parseCreateServiceRequestInput,
  parseLinkServiceRequestDocumentInput,
  parseListServiceRequestsQuery,
  parseRejectServiceRequestInput,
  parseRowVersionBody,
  parseServiceRequestSummaryQuery,
  parseUpdateServiceRequestDraftInput,
} from '../dto/service-requests.dto';
import { REQUESTS_ERROR_CODES } from '../errors/requests-error-codes';
import { RequestsHttpException } from '../errors/requests-http.exception';
import { ServiceRequestsAccessService } from '../services/service-requests-access.service';

@Controller('requests/service-requests')
@UseGuards(JwtAuthGuard)
export class ServiceRequestsController {
  constructor(private readonly serviceRequestsAccess: ServiceRequestsAccessService) {}

  @Post()
  @HttpCode(201)
  create(@CurrentAuth() auth: AccessTokenClaims, @Req() request: FastifyRequest) {
    try {
      const input = parseCreateServiceRequestInput(request.body);
      return this.serviceRequestsAccess.create({ identityId: auth.sub, sessionId: auth.sid }, input);
    } catch {
      throw new RequestsHttpException(
        400,
        REQUESTS_ERROR_CODES.VALIDATION_FAILED,
        'Invalid request body.',
      );
    }
  }

  @Get()
  list(@CurrentAuth() auth: AccessTokenClaims, @Query() query: Record<string, unknown>) {
    try {
      const parsed = parseListServiceRequestsQuery(query);
      return this.serviceRequestsAccess.list({ identityId: auth.sub, sessionId: auth.sid }, parsed);
    } catch {
      throw new RequestsHttpException(
        400,
        REQUESTS_ERROR_CODES.VALIDATION_FAILED,
        'Invalid query parameters.',
      );
    }
  }

  @Get('operational-units')
  listOperationalUnits(@CurrentAuth() auth: AccessTokenClaims) {
    return this.serviceRequestsAccess.listOperationalUnits({
      identityId: auth.sub,
      sessionId: auth.sid,
    });
  }

  @Post('operational-units')
  @HttpCode(201)
  registerOperationalUnit(@CurrentAuth() auth: AccessTokenClaims, @Req() request: FastifyRequest) {
    const body = request.body as { refId?: string } | null;
    return this.serviceRequestsAccess.registerOperationalUnit(
      { identityId: auth.sub, sessionId: auth.sid },
      body?.refId ?? '',
    );
  }

  @Get('summary')
  summary(@CurrentAuth() auth: AccessTokenClaims, @Query() query: Record<string, unknown>) {
    const parsed = parseServiceRequestSummaryQuery(query);
    return this.serviceRequestsAccess.summary({ identityId: auth.sub, sessionId: auth.sid }, parsed);
  }

  @Get(':serviceRequestId')
  getById(@CurrentAuth() auth: AccessTokenClaims, @Param('serviceRequestId') serviceRequestId: string) {
    return this.serviceRequestsAccess.getById(
      { identityId: auth.sub, sessionId: auth.sid },
      serviceRequestId,
    );
  }

  @Patch(':serviceRequestId')
  updateDraft(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('serviceRequestId') serviceRequestId: string,
    @Req() request: FastifyRequest,
  ) {
    try {
      const input = parseUpdateServiceRequestDraftInput(request.body);
      return this.serviceRequestsAccess.updateDraft(
        { identityId: auth.sub, sessionId: auth.sid },
        serviceRequestId,
        input,
      );
    } catch {
      throw new RequestsHttpException(
        400,
        REQUESTS_ERROR_CODES.VALIDATION_FAILED,
        'Invalid request body.',
      );
    }
  }

  @Post(':serviceRequestId/submit')
  @HttpCode(200)
  submit(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('serviceRequestId') serviceRequestId: string,
    @Req() request: FastifyRequest,
  ) {
    const body = parseRowVersionBody(request.body);
    return this.serviceRequestsAccess.submit(
      { identityId: auth.sub, sessionId: auth.sid },
      serviceRequestId,
      body,
    );
  }

  @Post(':serviceRequestId/review')
  @HttpCode(200)
  startReview(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('serviceRequestId') serviceRequestId: string,
    @Req() request: FastifyRequest,
  ) {
    const body = parseRowVersionBody(request.body);
    return this.serviceRequestsAccess.startReview(
      { identityId: auth.sub, sessionId: auth.sid },
      serviceRequestId,
      body,
    );
  }

  @Post(':serviceRequestId/approve')
  @HttpCode(200)
  approve(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('serviceRequestId') serviceRequestId: string,
    @Req() request: FastifyRequest,
  ) {
    try {
      const input = parseApproveServiceRequestInput(request.body);
      return this.serviceRequestsAccess.approve(
        { identityId: auth.sub, sessionId: auth.sid },
        serviceRequestId,
        input,
      );
    } catch {
      throw new RequestsHttpException(
        400,
        REQUESTS_ERROR_CODES.VALIDATION_FAILED,
        'Invalid request body.',
      );
    }
  }

  @Post(':serviceRequestId/reject')
  @HttpCode(200)
  reject(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('serviceRequestId') serviceRequestId: string,
    @Req() request: FastifyRequest,
  ) {
    try {
      const input = parseRejectServiceRequestInput(request.body);
      return this.serviceRequestsAccess.reject(
        { identityId: auth.sub, sessionId: auth.sid },
        serviceRequestId,
        input,
      );
    } catch {
      throw new RequestsHttpException(
        400,
        REQUESTS_ERROR_CODES.VALIDATION_FAILED,
        'Invalid request body.',
      );
    }
  }

  @Post(':serviceRequestId/cancel')
  @HttpCode(200)
  cancel(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('serviceRequestId') serviceRequestId: string,
    @Req() request: FastifyRequest,
  ) {
    try {
      const input = parseCancelServiceRequestInput(request.body);
      return this.serviceRequestsAccess.cancel(
        { identityId: auth.sub, sessionId: auth.sid },
        serviceRequestId,
        input,
      );
    } catch {
      throw new RequestsHttpException(
        400,
        REQUESTS_ERROR_CODES.VALIDATION_FAILED,
        'Invalid request body.',
      );
    }
  }

  @Post(':serviceRequestId/convert')
  @HttpCode(200)
  convert(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('serviceRequestId') serviceRequestId: string,
    @Req() request: FastifyRequest,
  ) {
    const body = parseRowVersionBody(request.body);
    return this.serviceRequestsAccess.convert(
      { identityId: auth.sub, sessionId: auth.sid },
      serviceRequestId,
      body,
    );
  }

  @Post(':serviceRequestId/documents')
  @HttpCode(201)
  linkDocument(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('serviceRequestId') serviceRequestId: string,
    @Req() request: FastifyRequest,
  ) {
    try {
      const input = parseLinkServiceRequestDocumentInput(request.body);
      return this.serviceRequestsAccess.linkDocument(
        { identityId: auth.sub, sessionId: auth.sid },
        serviceRequestId,
        input,
      );
    } catch {
      throw new RequestsHttpException(
        400,
        REQUESTS_ERROR_CODES.VALIDATION_FAILED,
        'Invalid request body.',
      );
    }
  }
}
