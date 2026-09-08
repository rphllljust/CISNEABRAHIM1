import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ObjectStorageService } from '../../documents/storage/object-storage.service';
import { buildCsvLine } from '../domain/csv-export';
import {
  REPORT_DEFINITIONS,
  REPORT_FORMATS,
  REPORT_POLICY,
  type ReportContract,
  type ReportFormat,
  type ReportType,
} from '../domain/report-type';
import { ReportExportRepository } from '../repositories/report-export.repository';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { ReportDataService } from './report-data.service';

@Injectable()
export class ReportGenerationService {
  private readonly logger = new Logger(ReportGenerationService.name);

  constructor(
    private readonly exports: ReportExportRepository,
    private readonly data: ReportDataService,
    private readonly objectStorage: ObjectStorageService,
  ) {}

  async generateExport(exportId: string, actor: IdentityAuthzContext, signal?: AbortSignal): Promise<void> {
    const exportRow = await this.exports.findById(exportId);
    if (!exportRow) {
      throw new Error('REPORT_EXPORT_NOT_FOUND');
    }
    if (exportRow.status === 'CANCELLED') {
      return;
    }

    await this.exports.markRunning(exportId);
    // Cancelamento pode chegar entre o start e a leitura de estado: não processar.
    const started = await this.exports.findById(exportId);
    if (started?.status === 'CANCELLED') {
      return;
    }
    const definition = REPORT_DEFINITIONS[exportRow.report_type];
    const columnKeys = definition.columns.map((column) => column.key);
    const headers = definition.columns.map((column) => column.header);
    const chunks: string[] = [buildCsvLine(headers)];

    try {
      let rowCount = 0;
      await this.data.streamAllRows(
        actor,
        exportRow.report_type,
        exportRow.contract.filters,
        async (batch) => {
          if (signal?.aborted) {
            throw new Error('REPORT_EXPORT_CANCELLED');
          }
          for (const row of batch) {
            chunks.push(buildCsvLine(columnKeys.map((key) => row[key] ?? '')));
          }
          rowCount += batch.length;
        },
      );

      const csv = chunks.join('');
      const buffer = Buffer.from(csv, 'utf8');
      const storageKey = this.buildStorageKey(exportId, exportRow.report_type);
      await this.objectStorage.putObject({
        storageKey,
        buffer,
        mimeType: 'text/csv; charset=utf-8',
      });

      const generatedAt = new Date().toISOString();
      const contract: ReportContract = {
        ...exportRow.contract,
        generatedAt,
      };
      await this.exports.markCompleted({
        id: exportId,
        storageKey,
        rowCount,
        fileSizeBytes: buffer.byteLength,
        generatedAt,
        contract,
      });
      this.logger.log(`Report export ${exportId} completed rows=${rowCount}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown_error';
      if (message === 'REPORT_EXPORT_CANCELLED') {
        await this.exports.markCancelled(exportId);
        return;
      }
      await this.exports.markFailed(exportId, message);
      throw error;
    }
  }

  async buildPreview(
    actor: IdentityAuthzContext,
    reportType: ReportType,
    contract: ReportContract,
  ): Promise<{ rows: Record<string, unknown>[]; total: number }> {
    const rows = await this.data.loadRows(
      actor,
      reportType,
      contract.filters,
      REPORT_POLICY.previewLimit,
      0,
    );
    const total = await this.data.countRows(actor, reportType, contract.filters);
    return { rows, total };
  }

  buildStorageKey(exportId: string, reportType: ReportType): string {
    const hash = createHash('sha256').update(exportId).digest('hex').slice(0, 16);
    return `reports/${reportType.toLowerCase()}/${hash}.csv`;
  }

  resolveMimeType(format: ReportFormat): string {
    if (format === REPORT_FORMATS.Csv) {
      return 'text/csv; charset=utf-8';
    }
    if (format === REPORT_FORMATS.Xlsx) {
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }
    return 'application/pdf';
  }
}
