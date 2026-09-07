import { Controller, Delete, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CurrentAuth } from '../../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AccessTokenClaims } from '../../auth/services/token.service';
import { ReportExportAccessService } from '../services/report-export-access.service';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportExportController {
  constructor(private readonly accessService: ReportExportAccessService) {}

  @Get('catalog')
  listCatalog(@CurrentAuth() auth: AccessTokenClaims) {
    return this.accessService.listCatalog({ identityId: auth.sub, sessionId: auth.sid });
  }

  @Get('exports/preview')
  preview(
    @CurrentAuth() auth: AccessTokenClaims,
    @Query('reportType') reportType: string,
    @Query('period') period?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('unitId') unitId?: string,
    @Query('clientId') clientId?: string,
    @Query('serviceDefinitionId') serviceDefinitionId?: string,
    @Query('status') status?: string,
  ) {
    return this.accessService.preview(
      { identityId: auth.sub, sessionId: auth.sid },
      { reportType, filters: { period, from, to, unitId, clientId, serviceDefinitionId, status } },
    );
  }

  @Post('exports')
  createExport(
    @CurrentAuth() auth: AccessTokenClaims,
    @Query('reportType') reportType: string,
    @Query('format') format?: string,
    @Query('period') period?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('unitId') unitId?: string,
    @Query('clientId') clientId?: string,
    @Query('serviceDefinitionId') serviceDefinitionId?: string,
    @Query('status') status?: string,
  ) {
    return this.accessService.createExport(
      { identityId: auth.sub, sessionId: auth.sid },
      {
        reportType,
        format,
        filters: { period, from, to, unitId, clientId, serviceDefinitionId, status },
        correlationId: null,
      },
    );
  }

  @Get('exports')
  listExports(
    @CurrentAuth() auth: AccessTokenClaims,
    @Query('page') page = '0',
    @Query('pageSize') pageSize = '30',
    @Query('status') status?: string,
    @Query('reportType') reportType?: string,
  ) {
    return this.accessService.listExports(
      { identityId: auth.sub, sessionId: auth.sid },
      { page, pageSize, status, reportType },
    );
  }

  @Get('exports/:exportId')
  getExport(@CurrentAuth() auth: AccessTokenClaims, @Param('exportId') exportId: string) {
    return this.accessService.getExport({ identityId: auth.sub, sessionId: auth.sid }, exportId);
  }

  @Get('exports/:exportId/download')
  async downloadExport(
    @CurrentAuth() auth: AccessTokenClaims,
    @Param('exportId') exportId: string,
    @Res() reply: FastifyReply,
  ) {
    const file = await this.accessService.downloadExport(
      { identityId: auth.sub, sessionId: auth.sid },
      exportId,
    );
    void reply
      .header('Content-Type', file.mimeType)
      .header('Content-Disposition', `attachment; filename="${file.fileName}"`)
      .send(file.buffer);
  }

  @Delete('exports/:exportId')
  cancelExport(@CurrentAuth() auth: AccessTokenClaims, @Param('exportId') exportId: string) {
    return this.accessService.cancelExport({ identityId: auth.sub, sessionId: auth.sid }, exportId);
  }
}
