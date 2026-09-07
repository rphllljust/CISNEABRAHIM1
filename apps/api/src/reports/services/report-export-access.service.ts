import { Injectable } from '@nestjs/common';
import { SecurityAuditService } from '../../audit/services/security-audit.service';
import {
  SECURITY_AUDIT_ACTIONS,
  SECURITY_AUDIT_CLASSIFICATIONS,
  SECURITY_AUDIT_OUTCOMES,
  SECURITY_AUDIT_RESOURCE_TYPES,
} from '../../audit/types/security-audit.types';
import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { ObjectStorageService } from '../../documents/storage/object-storage.service';
import { BACKGROUND_JOB_KINDS } from '../../platform/background-jobs/domain/background-job-kind';
import { BackgroundJobEnqueueService } from '../../platform/background-jobs/services/background-job-enqueue.service';
import {
  REPORT_DEFINITIONS,
  REPORT_FORMATS,
  REPORT_POLICY,
  REPORT_TYPES,
  isReportType,
  type ReportContract,
  type ReportFilters,
  type ReportFormat,
  type ReportType,
} from '../domain/report-type';
import { REPORT_ERROR_CODES } from '../errors/report-error-codes';
import { ReportHttpException } from '../errors/report-http.exception';
import { ReportExportRepository } from '../repositories/report-export.repository';
import { ReportDataService } from './report-data.service';
import { ReportGenerationService } from './report-generation.service';

export type CreateReportExportInput = {
  reportType: string;
  format?: string;
  filters?: ReportFilters;
  correlationId?: string | null;
};

const EXPORT_STATUSES = ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'] as const;

@Injectable()
export class ReportExportAccessService {
  constructor(
    private readonly exports: ReportExportRepository,
    private readonly data: ReportDataService,
    private readonly generation: ReportGenerationService,
    private readonly enqueue: BackgroundJobEnqueueService,
    private readonly objectStorage: ObjectStorageService,
    private readonly audit: SecurityAuditService,
    private readonly authorizationRepository: AuthorizationRepository,
  ) {}

  async listCatalog(actor: IdentityAuthzContext) {
    const entries = await Promise.all(
      Object.values(REPORT_TYPES).map(async (reportType) => {
        if (!(await this.canAccessReportAsync(actor, reportType))) {
          return null;
        }
        return {
          reportType,
          label: REPORT_DEFINITIONS[reportType].label,
          formats: [REPORT_FORMATS.Csv],
          sensitive: REPORT_DEFINITIONS[reportType].sensitive,
          columns: REPORT_DEFINITIONS[reportType].columns.map((column) => column.header),
        };
      }),
    );
    return entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  }

  async preview(actor: IdentityAuthzContext, input: CreateReportExportInput) {
    const reportType = this.parseReportType(input.reportType);
    await this.assertAccess(actor, reportType);
    const contract = this.buildContract(actor, reportType, input.filters ?? {});
    const preview = await this.generation.buildPreview(actor, reportType, contract);
    return {
      contract: { ...contract, generatedAt: null },
      preview: preview.rows,
      total: preview.total,
    };
  }

  async createExport(actor: IdentityAuthzContext, input: CreateReportExportInput) {
    const reportType = this.parseReportType(input.reportType);
    const format = this.parseFormat(input.format);
    await this.assertAccess(actor, reportType);

    if (format !== REPORT_FORMATS.Csv) {
      throw new ReportHttpException(400, REPORT_ERROR_CODES.FORMAT_UNSUPPORTED, 'Format not supported yet.');
    }

    const contract = this.buildContract(actor, reportType, input.filters ?? {});
    const estimatedRows = await this.data.countRows(actor, reportType, contract.filters);

    const exportRow = await this.exports.createExport({
      reportType,
      format,
      contract,
      identityId: actor.identityId,
      sessionId: actor.sessionId,
      correlationId: input.correlationId ?? null,
    });

    if (estimatedRows <= REPORT_POLICY.syncRowThreshold) {
      await this.generation.generateExport(exportRow.id, actor);
      const completed = await this.exports.findById(exportRow.id);
      await this.recordAudit(actor, completed!, input.correlationId ?? null);
      return this.serializeExport(completed!);
    }

    const job = await this.enqueue.enqueue({
      jobKind: BACKGROUND_JOB_KINDS.ReportGeneration,
      idempotencyKey: `report-export:${exportRow.id}`,
      correlationId: input.correlationId ?? null,
      payload: {
        schemaVersion: 1,
        exportId: exportRow.id,
        identityId: actor.identityId,
        sessionId: actor.sessionId,
      },
    });
    await this.exports.attachBackgroundJob(exportRow.id, job.jobId);
    const pending = await this.exports.findById(exportRow.id);
    return this.serializeExport(pending!);
  }

  async getExport(actor: IdentityAuthzContext, exportId: string) {
    const exportRow = await this.exports.findByIdForActor(exportId, actor.identityId);
    if (!exportRow) {
      throw new ReportHttpException(404, REPORT_ERROR_CODES.NOT_FOUND, 'Report export not found.');
    }
    return this.serializeExport(exportRow);
  }

  async listExports(
    actor: IdentityAuthzContext,
    input: {
      page?: string | number;
      pageSize?: string | number;
      status?: string;
      reportType?: string;
    },
  ) {
    // Fail closed: somente atores que podem acessar ao menos um relatório
    // conseguem listar as exportações que eles próprios solicitaram.
    await this.assertAnyReportAccess(actor);

    const page = this.parsePage(input.page, 0);
    const pageSize = Math.min(this.parsePage(input.pageSize, 30), 100);
    const rawStatus = input.status?.trim();
    const status = rawStatus ? rawStatus.toUpperCase() : undefined;
    if (status && !(EXPORT_STATUSES as readonly string[]).includes(status)) {
      throw new ReportHttpException(400, REPORT_ERROR_CODES.INVALID_REQUEST, 'Invalid export status filter.');
    }
    const reportType = input.reportType?.trim() ? this.parseReportType(input.reportType) : undefined;

    const { rows, total } = await this.exports.listForActor({
      identityId: actor.identityId,
      page,
      pageSize,
      status,
      reportType,
    });
    return {
      items: rows.map((row) => this.serializeExport(row)),
      total,
      page,
      pageSize,
    };
  }

  async downloadExport(actor: IdentityAuthzContext, exportId: string) {
    const exportRow = await this.exports.findByIdForActor(exportId, actor.identityId);
    if (!exportRow) {
      throw new ReportHttpException(404, REPORT_ERROR_CODES.NOT_FOUND, 'Report export not found.');
    }
    if (exportRow.status !== 'COMPLETED' || !exportRow.storage_key) {
      throw new ReportHttpException(409, REPORT_ERROR_CODES.NOT_READY, 'Report export is not ready.');
    }

    const object = await this.objectStorage.getObject(exportRow.storage_key);
    if (!object) {
      throw new ReportHttpException(404, REPORT_ERROR_CODES.NOT_FOUND, 'Report artifact not found.');
    }

    await this.recordAudit(actor, exportRow, exportRow.correlation_id);

    return {
      buffer: object.buffer,
      mimeType: this.generation.resolveMimeType(exportRow.format),
      fileName: `${exportRow.report_type.toLowerCase()}-${exportRow.id}.csv`,
    };
  }

  async cancelExport(actor: IdentityAuthzContext, exportId: string) {
    const exportRow = await this.exports.findByIdForActor(exportId, actor.identityId);
    if (!exportRow) {
      throw new ReportHttpException(404, REPORT_ERROR_CODES.NOT_FOUND, 'Report export not found.');
    }
    if (exportRow.status === 'COMPLETED') {
      throw new ReportHttpException(409, REPORT_ERROR_CODES.INVALID_REQUEST, 'Completed export cannot be cancelled.');
    }
    await this.exports.markCancelled(exportId);
    return { id: exportId, status: 'CANCELLED' };
  }

  private buildContract(
    actor: IdentityAuthzContext,
    reportType: ReportType,
    filters: ReportFilters,
  ): ReportContract {
    const definition = REPORT_DEFINITIONS[reportType];
    return {
      name: definition.label,
      filters,
      columns: definition.columns.map((column) => column.header),
      sort: definition.defaultSort,
      timezone: this.data.resolveTimezone(),
      generatedAt: null,
      actor: { identityId: actor.identityId, sessionId: actor.sessionId },
      scope: { summary: 'scoped_by_existing_grants' },
    };
  }

  private serializeExport(exportRow: Awaited<ReturnType<ReportExportRepository['findById']>> & object) {
    return {
      id: exportRow.id,
      reportType: exportRow.report_type,
      format: exportRow.format,
      status: exportRow.status,
      contract: exportRow.contract,
      rowCount: exportRow.row_count,
      fileSizeBytes: exportRow.file_size_bytes ? Number(exportRow.file_size_bytes) : null,
      errorMessage: exportRow.error_message,
      createdAt: exportRow.created_at.toISOString(),
      completedAt: exportRow.completed_at?.toISOString() ?? null,
      downloadReady: exportRow.status === 'COMPLETED' && Boolean(exportRow.storage_key),
    };
  }

  private parseReportType(value: string): ReportType {
    if (!isReportType(value)) {
      throw new ReportHttpException(400, REPORT_ERROR_CODES.INVALID_REQUEST, 'Invalid report type.');
    }
    return value;
  }

  private parseFormat(value: string | undefined): ReportFormat {
    if (!value || value === REPORT_FORMATS.Csv) {
      return REPORT_FORMATS.Csv;
    }
    if (value === REPORT_FORMATS.Xlsx || value === REPORT_FORMATS.Pdf) {
      return value;
    }
    throw new ReportHttpException(400, REPORT_ERROR_CODES.INVALID_REQUEST, 'Invalid report format.');
  }

  private async assertAccess(actor: IdentityAuthzContext, reportType: ReportType): Promise<void> {
    if (!(await this.canAccessReportAsync(actor, reportType))) {
      throw new ReportHttpException(403, REPORT_ERROR_CODES.ACCESS_DENIED, 'Access denied.');
    }
  }

  private async assertAnyReportAccess(actor: IdentityAuthzContext): Promise<void> {
    for (const reportType of Object.values(REPORT_TYPES)) {
      if (await this.canAccessReportAsync(actor, reportType)) {
        return;
      }
    }
    throw new ReportHttpException(403, REPORT_ERROR_CODES.ACCESS_DENIED, 'Access denied.');
  }

  private parsePage(raw: string | number | undefined, fallback: number): number {
    if (raw === undefined || raw === null || raw === '') {
      return fallback;
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) {
      throw new ReportHttpException(400, REPORT_ERROR_CODES.INVALID_REQUEST, 'Invalid pagination value.');
    }
    return value;
  }

  private async canAccessReportAsync(actor: IdentityAuthzContext, reportType: ReportType): Promise<boolean> {
    const action = this.requiredAction(reportType);
    if (!action) {
      return false;
    }
    const grants = await this.authorizationRepository.findActiveGrants(
      actor.identityId,
      action,
      AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
    );
    if (reportType === REPORT_TYPES.AssetUtilization) {
      const assetGrants = await this.authorizationRepository.findActiveGrants(
        actor.identityId,
        AUTHZ_ACTIONS.ResourcesAssetList,
        AUTHZ_RESOURCE_TYPES.ResourcesAsset,
      );
      return assetGrants.length > 0;
    }
    if (
      reportType === REPORT_TYPES.OperationalProductivity ||
      reportType === REPORT_TYPES.FinancialAging
    ) {
      return grants.length > 0 || (await this.hasAnyOperationalGrant(actor));
    }
    return grants.length > 0;
  }

  private async hasAnyOperationalGrant(actor: IdentityAuthzContext): Promise<boolean> {
    const checks = await Promise.all([
      this.authorizationRepository.findActiveGrants(
        actor.identityId,
        AUTHZ_ACTIONS.ServiceOrdersServiceOrderList,
        AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      ),
      this.authorizationRepository.findActiveGrants(
        actor.identityId,
        AUTHZ_ACTIONS.BillingBillingRecordRead,
        AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      ),
    ]);
    return checks.some((grants) => grants.length > 0);
  }

  private requiredAction(reportType: ReportType) {
    switch (reportType) {
      case REPORT_TYPES.AssetUtilization:
        return AUTHZ_ACTIONS.ResourcesAssetList;
      default:
        return AUTHZ_ACTIONS.ServiceOrdersServiceOrderList;
    }
  }

  private async recordAudit(
    actor: IdentityAuthzContext,
    exportRow: NonNullable<Awaited<ReturnType<ReportExportRepository['findById']>>>,
    correlationId: string | null,
  ): Promise<void> {
    const definition = REPORT_DEFINITIONS[exportRow.report_type];
    await this.audit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.ReportsExportGenerate,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.ReportsExport,
      resourceId: exportRow.id,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      correlationId,
      classification: definition.sensitive
        ? SECURITY_AUDIT_CLASSIFICATIONS.Critical
        : SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata: {
        reportType: exportRow.report_type,
        format: exportRow.format,
        filters: exportRow.contract.filters,
        rowCount: exportRow.row_count,
      },
    });
  }
}
