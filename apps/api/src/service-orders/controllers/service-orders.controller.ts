import { Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import {
  parseCancelServiceOrderInput,
  parseCreateServiceOrderInput,
  parseListServiceOrdersQuery,
  parseReopenServiceOrderInput,
  parseRowVersionBody,
  parseUpdateServiceOrderInput,
} from '../dto/service-orders.dto';
import { SERVICE_ORDERS_ERROR_CODES } from '../errors/service-orders-error-codes';
import { ServiceOrdersHttpException } from '../errors/service-orders-http.exception';
import { ServiceOrdersAccessService } from '../services/service-orders-access.service';
import { resolveCorrelationId } from '../../infrastructure/http/correlation-id';

@Controller('service-orders')
@UseGuards(JwtAuthGuard)
export class ServiceOrdersController {
  constructor(private readonly serviceOrdersAccess: ServiceOrdersAccessService) {}

  @Post()
  @HttpCode(201)
  create(@CurrentAuth() auth: AccessTokenClaims, @Req() request: FastifyRequest) {
    try {
      const input = parseCreateServiceOrderInput(request.body);
      return this.serviceOrdersAccess.create(
        { identityId: auth.sub, sessionId: auth.sid },
        input,
        resolveCorrelationId(request),
      );
    } catch {
      throw new ServiceOrdersHttpException(
        400,
        SERVICE_ORDERS_ERROR_CODES.VALIDATION_FAILED,
        'Invalid request body.',
      );
    }
  }

  @Get()
  list(@CurrentAuth() auth: AccessTokenClaims, @Query() query: Record<string, unknown>) {
    try {
      const parsed = parseListServiceOrdersQuery(query);
      return this.serviceOrdersAccess.list({ identityId: auth.sub, sessionId: auth.sid }, parsed);
    } catch {
      throw new ServiceOrdersHttpException(
        400,
        SERVICE_ORDERS_ERROR_CODES.VALIDATION_FAILED,
        'Invalid query parameters.',
      );
    }
  }

  @Get(':serviceOrderId')
  getById(@CurrentAuth() auth: AccessTokenClaims, @Param('serviceOrderId') serviceOrderId: string) {
    return this.serviceOrdersAccess.getById(
      { identityId: auth.sub, sessionId: auth.sid },
      serviceOrderId,
    );
  }

  @Patch(':serviceOrderId')
  update(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('serviceOrderId') serviceOrderId: string,
    @Req() request: FastifyRequest,
  ) {
    try {
      const input = parseUpdateServiceOrderInput(request.body);
      return this.serviceOrdersAccess.update(
        { identityId: auth.sub, sessionId: auth.sid },
        serviceOrderId,
        input,
      );
    } catch {
      throw new ServiceOrdersHttpException(
        400,
        SERVICE_ORDERS_ERROR_CODES.VALIDATION_FAILED,
        'Invalid request body.',
      );
    }
  }

  @Post(':serviceOrderId/prepare')
  @HttpCode(200)
  prepare(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('serviceOrderId') serviceOrderId: string,
    @Req() request: FastifyRequest,
  ) {
    const body = parseRowVersionBody(request.body);
    return this.serviceOrdersAccess.prepare(
      { identityId: auth.sub, sessionId: auth.sid },
      serviceOrderId,
      body,
      resolveCorrelationId(request),
    );
  }

  @Post(':serviceOrderId/release')
  @HttpCode(200)
  release(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('serviceOrderId') serviceOrderId: string,
    @Req() request: FastifyRequest,
  ) {
    const body = parseRowVersionBody(request.body);
    return this.serviceOrdersAccess.release(
      { identityId: auth.sub, sessionId: auth.sid },
      serviceOrderId,
      body,
      resolveCorrelationId(request),
    );
  }

  @Post(':serviceOrderId/cancel')
  @HttpCode(200)
  cancel(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('serviceOrderId') serviceOrderId: string,
    @Req() request: FastifyRequest,
  ) {
    try {
      const input = parseCancelServiceOrderInput(request.body);
      return this.serviceOrdersAccess.cancel(
        { identityId: auth.sub, sessionId: auth.sid },
        serviceOrderId,
        input,
        resolveCorrelationId(request),
      );
    } catch {
      throw new ServiceOrdersHttpException(
        400,
        SERVICE_ORDERS_ERROR_CODES.VALIDATION_FAILED,
        'Invalid request body.',
      );
    }
  }

  @Post(':serviceOrderId/reopen')
  @HttpCode(200)
  reopen(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('serviceOrderId') serviceOrderId: string,
    @Req() request: FastifyRequest,
  ) {
    try {
      const input = parseReopenServiceOrderInput(request.body);
      return this.serviceOrdersAccess.reopen(
        { identityId: auth.sub, sessionId: auth.sid },
        serviceOrderId,
        input,
        resolveCorrelationId(request),
      );
    } catch {
      throw new ServiceOrdersHttpException(
        400,
        SERVICE_ORDERS_ERROR_CODES.VALIDATION_FAILED,
        'Invalid request body.',
      );
    }
  }
}
