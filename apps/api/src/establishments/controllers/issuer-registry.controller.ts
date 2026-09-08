import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { IssuerHttpException } from '../errors/issuer-http.exception';
import { ISSUER_ERROR_CODES } from '../errors/issuer-http.exception';
import { IssuerRegistryService } from '../services/issuer-registry.service';
import type {
  CreateCertificateInput,
  CreateEstablishmentInput,
  CreateLegalEntityInput,
  CreateTaxRegistrationInput,
  StatusTransitionInput,
  UpdateCertificateInput,
  UpdateEstablishmentInput,
  UpdateLegalEntityInput,
  UpdateTaxRegistrationInput,
} from '../domain/legal-establishment.validation';

function assertBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new IssuerHttpException(
      HttpStatus.BAD_REQUEST,
      ISSUER_ERROR_CODES.VALIDATION_FAILED,
      'Invalid request body.',
    );
  }
  return body as Record<string, unknown>;
}

function parseTransition(body: unknown): StatusTransitionInput {
  const record = assertBody(body);
  return { version: record['version'] as number, reason: record['reason'] as string | undefined };
}

@Controller('issuer/legal-entities')
@UseGuards(JwtAuthGuard)
export class LegalEntitiesController {
  constructor(private readonly registry: IssuerRegistryService) {}

  @Post()
  @HttpCode(201)
  create(@CurrentAuth() auth: AccessTokenClaims, @Req() request: FastifyRequest) {
    const input = assertBody(request.body) as unknown as CreateLegalEntityInput;
    return this.registry.createLegalEntity({ identityId: auth.sub, sessionId: auth.sid }, input);
  }

  @Get()
  list(@CurrentAuth() auth: AccessTokenClaims) {
    return this.registry.listLegalEntities({ identityId: auth.sub, sessionId: auth.sid });
  }

  @Get(':legalEntityId')
  getById(@CurrentAuth() auth: AccessTokenClaims, @Param('legalEntityId') legalEntityId: string) {
    return this.registry.getLegalEntity({ identityId: auth.sub, sessionId: auth.sid }, legalEntityId);
  }

  @Get(':legalEntityId/history')
  history(@CurrentAuth() auth: AccessTokenClaims, @Param('legalEntityId') legalEntityId: string) {
    return this.registry.listLegalEntityHistory(
      { identityId: auth.sub, sessionId: auth.sid },
      legalEntityId,
    );
  }

  @Get(':legalEntityId/establishments')
  listEstablishments(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('legalEntityId') legalEntityId: string,
  ) {
    return this.registry.listEstablishments({ identityId: auth.sub, sessionId: auth.sid }, legalEntityId);
  }

  @Patch(':legalEntityId')
  update(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('legalEntityId') legalEntityId: string,
    @Req() request: FastifyRequest,
  ) {
    const input = assertBody(request.body) as unknown as UpdateLegalEntityInput;
    return this.registry.updateLegalEntity(
      { identityId: auth.sub, sessionId: auth.sid },
      legalEntityId,
      input,
    );
  }

  @Post(':legalEntityId/deactivate')
  @HttpCode(200)
  deactivate(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('legalEntityId') legalEntityId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.registry.setLegalEntityStatus(
      { identityId: auth.sub, sessionId: auth.sid },
      legalEntityId,
      parseTransition(request.body),
      'INACTIVE',
    );
  }

  @Post(':legalEntityId/activate')
  @HttpCode(200)
  activate(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('legalEntityId') legalEntityId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.registry.setLegalEntityStatus(
      { identityId: auth.sub, sessionId: auth.sid },
      legalEntityId,
      parseTransition(request.body),
      'ACTIVE',
    );
  }
}

@Controller('issuer/establishments')
@UseGuards(JwtAuthGuard)
export class EstablishmentsController {
  constructor(private readonly registry: IssuerRegistryService) {}

  @Post()
  @HttpCode(201)
  create(@CurrentAuth() auth: AccessTokenClaims, @Req() request: FastifyRequest) {
    const input = assertBody(request.body) as unknown as CreateEstablishmentInput;
    return this.registry.createEstablishment({ identityId: auth.sub, sessionId: auth.sid }, input);
  }

  @Get()
  listByLegalEntity(
    @CurrentAuth() auth: AccessTokenClaims,
    @Query('legalEntityId') legalEntityId: string,
  ) {
    return this.registry.listEstablishments(
      { identityId: auth.sub, sessionId: auth.sid },
      legalEntityId,
    );
  }

  @Get(':establishmentId')
  getById(@CurrentAuth() auth: AccessTokenClaims, @Param('establishmentId') establishmentId: string) {
    return this.registry.getEstablishment({ identityId: auth.sub, sessionId: auth.sid }, establishmentId);
  }

  @Get(':establishmentId/history')
  history(@CurrentAuth() auth: AccessTokenClaims, @Param('establishmentId') establishmentId: string) {
    return this.registry.listEstablishmentHistory(
      { identityId: auth.sub, sessionId: auth.sid },
      establishmentId,
    );
  }

  @Patch(':establishmentId')
  update(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('establishmentId') establishmentId: string,
    @Req() request: FastifyRequest,
  ) {
    const input = assertBody(request.body) as unknown as UpdateEstablishmentInput;
    return this.registry.updateEstablishment(
      { identityId: auth.sub, sessionId: auth.sid },
      establishmentId,
      input,
    );
  }

  @Post(':establishmentId/deactivate')
  @HttpCode(200)
  deactivate(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('establishmentId') establishmentId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.registry.setEstablishmentStatus(
      { identityId: auth.sub, sessionId: auth.sid },
      establishmentId,
      parseTransition(request.body),
      'INACTIVE',
    );
  }

  @Post(':establishmentId/activate')
  @HttpCode(200)
  activate(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('establishmentId') establishmentId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.registry.setEstablishmentStatus(
      { identityId: auth.sub, sessionId: auth.sid },
      establishmentId,
      parseTransition(request.body),
      'ACTIVE',
    );
  }

  // Tax registrations

  @Post(':establishmentId/tax-registrations')
  @HttpCode(201)
  createTaxRegistration(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('establishmentId') establishmentId: string,
    @Req() request: FastifyRequest,
  ) {
    const body = assertBody(request.body);
    const input = { ...(body as unknown as CreateTaxRegistrationInput), establishmentId };
    return this.registry.createTaxRegistration({ identityId: auth.sub, sessionId: auth.sid }, input);
  }

  @Get(':establishmentId/tax-registrations')
  listTaxRegistrations(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('establishmentId') establishmentId: string,
  ) {
    return this.registry.listTaxRegistrations(
      { identityId: auth.sub, sessionId: auth.sid },
      establishmentId,
    );
  }

  // Certificates

  @Post(':establishmentId/certificates')
  @HttpCode(201)
  createCertificate(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('establishmentId') establishmentId: string,
    @Req() request: FastifyRequest,
  ) {
    const body = assertBody(request.body);
    const input = { ...(body as unknown as CreateCertificateInput), establishmentId };
    return this.registry.createCertificate({ identityId: auth.sub, sessionId: auth.sid }, input);
  }

  @Get(':establishmentId/certificates')
  listCertificates(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('establishmentId') establishmentId: string,
  ) {
    return this.registry.listCertificates(
      { identityId: auth.sub, sessionId: auth.sid },
      establishmentId,
    );
  }
}

@Controller('issuer/tax-registrations')
@UseGuards(JwtAuthGuard)
export class TaxRegistrationsController {
  constructor(private readonly registry: IssuerRegistryService) {}

  @Patch(':taxRegistrationId')
  update(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('taxRegistrationId') taxRegistrationId: string,
    @Req() request: FastifyRequest,
  ) {
    const input = assertBody(request.body) as unknown as UpdateTaxRegistrationInput;
    return this.registry.updateTaxRegistration(
      { identityId: auth.sub, sessionId: auth.sid },
      taxRegistrationId,
      input,
    );
  }

  @Get(':taxRegistrationId/history')
  history(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('taxRegistrationId') taxRegistrationId: string,
  ) {
    return this.registry.listTaxRegistrationHistory(
      { identityId: auth.sub, sessionId: auth.sid },
      taxRegistrationId,
    );
  }

  @Post(':taxRegistrationId/deactivate')
  @HttpCode(200)
  deactivate(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('taxRegistrationId') taxRegistrationId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.registry.setTaxRegistrationStatus(
      { identityId: auth.sub, sessionId: auth.sid },
      taxRegistrationId,
      parseTransition(request.body),
      'INACTIVE',
    );
  }

  @Post(':taxRegistrationId/activate')
  @HttpCode(200)
  activate(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('taxRegistrationId') taxRegistrationId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.registry.setTaxRegistrationStatus(
      { identityId: auth.sub, sessionId: auth.sid },
      taxRegistrationId,
      parseTransition(request.body),
      'ACTIVE',
    );
  }
}

@Controller('issuer/certificates')
@UseGuards(JwtAuthGuard)
export class CertificatesController {
  constructor(private readonly registry: IssuerRegistryService) {}

  @Patch(':certificateId')
  update(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('certificateId') certificateId: string,
    @Req() request: FastifyRequest,
  ) {
    const input = assertBody(request.body) as unknown as UpdateCertificateInput;
    return this.registry.updateCertificate({ identityId: auth.sub, sessionId: auth.sid }, certificateId, input);
  }
}
