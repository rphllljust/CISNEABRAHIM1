import { Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DatabaseService } from '../../../infrastructure/database/database.service';
import {
  BACKGROUND_JOB_PAYLOAD_VERSION,
  BACKGROUND_JOB_STATUSES,
  type BackgroundJobFailureClass,
  type BackgroundJobKind,
} from '../domain/background-job-kind';
import type { BackgroundJobRow } from '../domain/job-handler.types';

export type EnqueueBackgroundJobInput = {
  jobKind: BackgroundJobKind;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  correlationId?: string | null;
  priority?: number;
  maxAttempts?: number;
  runAfter?: string;
};

export type EnqueueBackgroundJobResult =
  | { outcome: 'created'; jobId: string }
  | { outcome: 'duplicate'; jobId: string };

@Injectable()
export class BackgroundJobsRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(client?: PoolClient): Pool | PoolClient {
    if (client) {
      return client;
    }
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_NOT_CONFIGURED');
    }
    return connection.pool;
  }

  async enqueueJob(
    input: EnqueueBackgroundJobInput,
    client?: PoolClient,
  ): Promise<EnqueueBackgroundJobResult> {
    const db = this.pool(client);
    const existing = await db.query<Pick<BackgroundJobRow, 'id'>>(
      `SELECT id FROM plt.background_jobs WHERE idempotency_key = $1`,
      [input.idempotencyKey],
    );
    if (existing.rows[0]?.id) {
      return { outcome: 'duplicate', jobId: existing.rows[0].id };
    }

    const inserted = await db.query<Pick<BackgroundJobRow, 'id'>>(
      `INSERT INTO plt.background_jobs (
         job_kind,
         status,
         idempotency_key,
         payload_version,
         payload,
         priority,
         max_attempts,
         run_after,
         correlation_id
       )
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, COALESCE($8::timestamptz, NOW()), $9)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [
        input.jobKind,
        BACKGROUND_JOB_STATUSES.Pending,
        input.idempotencyKey,
        BACKGROUND_JOB_PAYLOAD_VERSION,
        JSON.stringify(input.payload),
        input.priority ?? 0,
        input.maxAttempts ?? 5,
        input.runAfter ?? null,
        input.correlationId ?? null,
      ],
    );

    if (inserted.rows[0]?.id) {
      return { outcome: 'created', jobId: inserted.rows[0].id };
    }

    const duplicate = await db.query<Pick<BackgroundJobRow, 'id'>>(
      `SELECT id FROM plt.background_jobs WHERE idempotency_key = $1`,
      [input.idempotencyKey],
    );
    if (!duplicate.rows[0]?.id) {
      throw new Error('BACKGROUND_JOB_ENQUEUE_FAILED');
    }
    return { outcome: 'duplicate', jobId: duplicate.rows[0].id };
  }

  async releaseExpiredLeases(client?: PoolClient): Promise<number> {
    const result = await this.pool(client).query(
      `UPDATE plt.background_jobs
       SET status = $1,
           lease_owner = NULL,
           lease_expires_at = NULL,
           updated_at = NOW()
       WHERE status = $2
         AND lease_expires_at IS NOT NULL
         AND lease_expires_at < NOW()`,
      [BACKGROUND_JOB_STATUSES.Pending, BACKGROUND_JOB_STATUSES.Running],
    );
    return result.rowCount ?? 0;
  }

  async claimJobs(
    workerId: string,
    limit: number,
    leaseDurationMs: number,
    client?: PoolClient,
  ): Promise<BackgroundJobRow[]> {
    const db = this.pool(client);
    await this.releaseExpiredLeases(client);

    const result = await db.query<BackgroundJobRow>(
      `WITH candidates AS (
         SELECT id
         FROM plt.background_jobs
         WHERE status = $1
           AND run_after <= NOW()
         ORDER BY priority DESC, created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $2
       )
       UPDATE plt.background_jobs AS jobs
       SET status = $3,
           lease_owner = $4,
           lease_expires_at = NOW() + ($5::int * interval '1 millisecond'),
           attempt_count = jobs.attempt_count + 1,
           started_at = COALESCE(jobs.started_at, NOW()),
           updated_at = NOW()
       FROM candidates
       WHERE jobs.id = candidates.id
       RETURNING jobs.*`,
      [
        BACKGROUND_JOB_STATUSES.Pending,
        limit,
        BACKGROUND_JOB_STATUSES.Running,
        workerId,
        leaseDurationMs,
      ],
    );
    return result.rows;
  }

  async markCompleted(jobId: string, client?: PoolClient): Promise<void> {
    await this.pool(client).query(
      `UPDATE plt.background_jobs
       SET status = $1,
           completed_at = NOW(),
           lease_owner = NULL,
           lease_expires_at = NULL,
           last_error = NULL,
           failure_class = NULL,
           updated_at = NOW()
       WHERE id = $2::uuid`,
      [BACKGROUND_JOB_STATUSES.Completed, jobId],
    );
  }

  async markFailedPermanent(
    jobId: string,
    errorMessage: string,
    failureClass: BackgroundJobFailureClass,
    client?: PoolClient,
  ): Promise<void> {
    await this.pool(client).query(
      `UPDATE plt.background_jobs
       SET status = $1,
           last_error = $2,
           failure_class = $3,
           lease_owner = NULL,
           lease_expires_at = NULL,
           updated_at = NOW()
       WHERE id = $4::uuid`,
      [BACKGROUND_JOB_STATUSES.Failed, errorMessage, failureClass, jobId],
    );
  }

  async scheduleRetry(
    jobId: string,
    errorMessage: string,
    failureClass: BackgroundJobFailureClass,
    runAfterIso: string,
    client?: PoolClient,
  ): Promise<void> {
    await this.pool(client).query(
      `UPDATE plt.background_jobs
       SET status = $1,
           run_after = $2::timestamptz,
           last_error = $3,
           failure_class = $4,
           lease_owner = NULL,
           lease_expires_at = NULL,
           updated_at = NOW()
       WHERE id = $5::uuid`,
      [BACKGROUND_JOB_STATUSES.Pending, runAfterIso, errorMessage, failureClass, jobId],
    );
  }

  async markDead(
    jobId: string,
    errorMessage: string,
    failureClass: BackgroundJobFailureClass,
    client?: PoolClient,
  ): Promise<void> {
    await this.pool(client).query(
      `UPDATE plt.background_jobs
       SET status = $1,
           last_error = $2,
           failure_class = $3,
           lease_owner = NULL,
           lease_expires_at = NULL,
           updated_at = NOW()
       WHERE id = $4::uuid`,
      [BACKGROUND_JOB_STATUSES.Dead, errorMessage, failureClass, jobId],
    );
  }

  async findByIdempotencyKey(idempotencyKey: string, client?: PoolClient): Promise<BackgroundJobRow | null> {
    const result = await this.pool(client).query<BackgroundJobRow>(
      `SELECT *
       FROM plt.background_jobs
       WHERE idempotency_key = $1`,
      [idempotencyKey],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Remove um job que ainda não começou (PENDING, sem lease). Usado para que um
   * cancelamento de export impeça processamento futuro "quando possível" —
   * jobs já reclamados (RUNNING/lease) não são apagados; nesse caso o gerador
   * re-checa o estado CANCELLED antes de finalizar.
   */
  async cancelPendingJob(jobId: string, client?: PoolClient): Promise<boolean> {
    const result = await this.pool(client).query(
      `DELETE FROM plt.background_jobs
       WHERE id = $1::uuid
         AND status = $2
         AND lease_owner IS NULL`,
      [jobId, BACKGROUND_JOB_STATUSES.Pending],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async countByStatus(status: string, client?: PoolClient): Promise<number> {
    const result = await this.pool(client).query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM plt.background_jobs WHERE status = $1`,
      [status],
    );
    return Number.parseInt(result.rows[0]?.count ?? '0', 10);
  }

  async countRunningWithLeaseOwner(leaseOwner: string, client?: PoolClient): Promise<number> {
    const result = await this.pool(client).query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM plt.background_jobs
       WHERE status = $1 AND lease_owner = $2`,
      [BACKGROUND_JOB_STATUSES.Running, leaseOwner],
    );
    return Number.parseInt(result.rows[0]?.count ?? '0', 10);
  }
}
