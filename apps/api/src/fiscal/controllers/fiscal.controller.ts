import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import { validateCancelInput, validateCreateFiscalDocumentInput } from '../domain/fiscal-document.validation';
import { FiscalAccessService } from '../services/fiscal-access.service';

@Controller('fiscal/documents')
@UseGuards(JwtAuthGuard)
export class FiscalController {
  constructor(private readonly fiscalAccess: FiscalAccessService) {}

  /**
   * Lista paginada por unidade com filtros de situacao/periodo/origem. Rota declarada antes
   * de `:fiscalDocumentId` para nao ser capturada pelo parametro.
   */
  @Get()
  list(@CurrentAuth() auth: AccessTokenClaims, @Query() query: Record<string, unknown>) {
    return this.fiscalAccess.listDocuments(
      { identityId: auth.sub, sessionId: auth.sid },
      query as { unitId: string } & Record<string, unknown>,
    );
  }

  @Post()
  @HttpCode(200)
  createDraft(@CurrentAuth() auth: AccessTokenClaims, @Body() body: never) {
    return this.fiscalAccess.createDraft(
      { identityId: auth.sub, sessionId: auth.sid },
      validateCreateFiscalDocumentInput(body),
    );
  }

  @Put(':fiscalDocumentId/snapshots')
  replaceSnapshots(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('fiscalDocumentId') fiscalDocumentId: string,
    @Body() body: never,
  ) {
    return this.fiscalAccess.replaceSnapshots(
      { identityId: auth.sub, sessionId: auth.sid },
      fiscalDocumentId,
      body,
    );
  }

  @Post(':fiscalDocumentId/ready')
  @HttpCode(200)
  markReady(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('fiscalDocumentId') fiscalDocumentId: string,
    @Body() body: { rowVersion: number },
  ) {
    return this.fiscalAccess.markReady({ identityId: auth.sub, sessionId: auth.sid }, fiscalDocumentId, body);
  }

  @Post(':fiscalDocumentId/submit')
  @HttpCode(200)
  submit(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('fiscalDocumentId') fiscalDocumentId: string,
    @Body() body: { rowVersion: number },
  ) {
    return this.fiscalAccess.submit({ identityId: auth.sub, sessionId: auth.sid }, fiscalDocumentId, body);
  }

  @Post(':fiscalDocumentId/recover')
  @HttpCode(200)
  recover(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('fiscalDocumentId') fiscalDocumentId: string,
    @Body() body: { rowVersion: number },
  ) {
    return this.fiscalAccess.recover({ identityId: auth.sub, sessionId: auth.sid }, fiscalDocumentId, body);
  }

  @Post(':fiscalDocumentId/revise')
  @HttpCode(200)
  revise(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('fiscalDocumentId') fiscalDocumentId: string,
    @Body() body: { rowVersion: number },
  ) {
    return this.fiscalAccess.revise({ identityId: auth.sub, sessionId: auth.sid }, fiscalDocumentId, body);
  }

  @Post(':fiscalDocumentId/cancel')
  @HttpCode(200)
  cancel(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('fiscalDocumentId') fiscalDocumentId: string,
    @Body() body: never,
  ) {
    return this.fiscalAccess.cancel(
      { identityId: auth.sub, sessionId: auth.sid },
      fiscalDocumentId,
      validateCancelInput(body),
    );
  }

  @Get(':fiscalDocumentId')
  getDocument(@CurrentAuth() auth: AccessTokenClaims, @Param('fiscalDocumentId') fiscalDocumentId: string) {
    return this.fiscalAccess.getDocument({ identityId: auth.sub, sessionId: auth.sid }, fiscalDocumentId);
  }
}
