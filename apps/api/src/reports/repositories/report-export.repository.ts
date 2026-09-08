import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import type { ReportContract, ReportFormat, ReportType } from '../domain/report-type';

export type ReportExportRow = {
  id: string;
  report_type: ReportType;
  format: ReportFormat;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  contract: ReportContract;
  background_job_id: string | null;
  storage_key: string | null;
  row_count: number | null;
  file_size_bytes: string | null;
  error_message: string | null;
  requested_by_identity_id: string;
  requested_session_id: string | null;
  correlation_id: string | null;
  created_at: Date;
  completed_at: Date | null;
};

@Injectable()
export class ReportExportRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_NOT_CONFIGURED');
    }
    return connection.pool;
  }

  async createExport(input: {
    reportType: ReportType;
    format: ReportFormat;
    contract: ReportContract;
    identityId: string;
    sessionId: string;
    correlationId: string | null;
    backgroundJobId?: string | null;
  }): Promise<ReportExportRow> {
    const result = await this.pool().query<ReportExportRow>(
      `INSERT INTO rpt.report_exports (
         report_type, format, contract, requested_by_identity_id,
         requested_session_id, correlation_id, background_job_id
       ) VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)
       RETURNING *`,
      [
        input.reportType,
        input.format,
        JSON.stringify(input.contract),
        input.identityId,
        input.sessionId,
        input.correlationId,
        input.backgroundJobId ?? null,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('REPORT_EXPORT_INSERT_FAILED');
    }
    return row;
  }

  async findById(id: string): Promise<ReportExportRow | null> {
    const result = await this.pool().query<ReportExportRow>(
      `SELECT * FROM rpt.report_exports WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findByIdForActor(id: string, identityId: string): Promise<ReportExportRow | null> {
    const result = await this.pool().query<ReportExportRow>(
      `SELECT * FROM rpt.report_exports WHERE id = $1 AND requested_by_identity_id = $2`,
      [id, identityId],
    );
    return result.rows[0] ?? null;
  }

  async listForActor(input: {
    identityId: string;
    page: number;
    pageSize: number;
    status?: string;
    reportType?: string;
  }): Promise<{ rows: ReportExportRow[]; total: number }> {
    const conditions = ['requested_by_identity_id = $1'];
    const params: unknown[] = [input.identityId];
    let index = 1;
    if (input.status) {
      index += 1;
      conditions.push(`status = $${index}`);
      params.push(input.status);
    }
    if (input.reportType) {
      index += 1;
      conditions.push(`report_type = $${index}`);
      params.push(input.reportType);
    }
    const where = conditions.join(' AND ');

    const filterParams = params.slice();
    params.push(input.pageSize, input.page * input.pageSize);
    index += 2;

    const rows = await this.pool().query<ReportExportRow>(
      `SELECT * FROM rpt.report_exports
       WHERE ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${index - 1} OFFSET $${index}`,
      params,
    );
    const count = await this.pool().query<{ total: number }>(
      `SELECT count(*)::int AS total FROM rpt.report_exports WHERE ${where}`,
      filterParams,
    );
    return { rows: rows.rows, total: count.rows[0]?.total ?? 0 };
  }

  async markRunning(id: string): Promise<void> {
    await this.pool().query(
      `UPDATE rpt.report_exports SET status = 'RUNNING' WHERE id = $1 AND status IN ('PENDING', 'RUNNING', 'FAILED')`,
      [id],
    );
  }

  async markCompleted(input: {
    id: string;
    storageKey: string;
    rowCount: number;
    fileSizeBytes: number;
    generatedAt: string;
    contract: ReportContract;
  }): Promise<void> {
    // Guarda por estado: um export cancelado (CANCELLED) durante a geração nunca
    // é sobrescrito para COMPLETED.
    await this.pool().query(
      `UPDATE rpt.report_exports
       SET status = 'COMPLETED',
           storage_key = $2,
           row_count = $3,
           file_size_bytes = $4,
           contract = $5::jsonb,
           completed_at = $6::timestamptz
       WHERE id = $1 AND status = 'RUNNING'`,
      [
        input.id,
        input.storageKey,
        input.rowCount,
        input.fileSizeBytes,
        JSON.stringify(input.contract),
        input.generatedAt,
      ],
    );
  }

  async markFailed(id: string, errorMessage: string): Promise<void> {
    await this.pool().query(
      `UPDATE rpt.report_exports
       SET status = 'FAILED', error_message = $2, completed_at = NOW()
       WHERE id = $1 AND status NOT IN ('CANCELLED', 'COMPLETED')`,
      [id, errorMessage.slice(0, 2000)],
    );
  }

  async markCancelled(id: string): Promise<void> {
    await this.pool().query(
      `UPDATE rpt.report_exports SET status = 'CANCELLED', completed_at = NOW() WHERE id = $1`,
      [id],
    );
  }

  async attachBackgroundJob(id: string, backgroundJobId: string): Promise<void> {
    await this.pool().query(`UPDATE rpt.report_exports SET background_job_id = $2 WHERE id = $1`, [
      id,
      backgroundJobId,
    ]);
  }
}
