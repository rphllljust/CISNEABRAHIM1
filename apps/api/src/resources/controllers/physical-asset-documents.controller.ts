import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import { documentsInvalidInput } from '../../documents/services/documents-access.errors';
import { PhysicalAssetDocumentsService } from '../services/physical-asset-documents.service';

@Controller('resources/physical-assets/:assetId/documents')
@UseGuards(JwtAuthGuard)
export class PhysicalAssetDocumentsController {
  constructor(private readonly links: PhysicalAssetDocumentsService) {}

  @Get()
  list(@CurrentAuth() auth: AccessTokenClaims, @Param('assetId') assetId: string) {
    return this.links.list({ identityId: auth.sub, sessionId: auth.sid }, assetId);
  }

  @Post()
  @HttpCode(200)
  attach(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('assetId') assetId: string,
    @Body() body: unknown,
  ) {
    const id = body && typeof body === 'object' && 'documentId' in body
      ? (body as { documentId: unknown }).documentId : null;
    if (typeof id !== 'string' || !id.trim()) throw documentsInvalidInput('documentId is required');
    return this.links.attach({ identityId: auth.sub, sessionId: auth.sid }, assetId, id);
  }
}
