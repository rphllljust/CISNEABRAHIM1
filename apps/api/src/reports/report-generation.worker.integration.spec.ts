import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import {
  insertGrant,
  insertIdentity,
  truncateIdentityAndAuthorizationTables,
  truncateServiceOrderTables,
} from '@cisne/database';
import { applyAuthTestEnv } from '../auth/test/auth-test-env';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { BACKGROUND_JOB_KINDS, BACKGROUND_JOB_STATUSES } from '../platform/background-jobs/domain/background-job-kind';
import { BackgroundJobsModule } from '../platform/background-jobs/background-jobs.module';
import { BackgroundJobsRepository } from '../platform/background-jobs/repositories/background-jobs.repository';
import { BackgroundJobHandlerRegistry } from '../platform/background-jobs/services/background-job-handler.registry';
import { BackgroundWorkerService } from '../platform/background-jobs/services/background-worker.service';
import { REPORT_TYPES, type ReportContract } from './domain/report-type';
import { ReportsModule } from './reports.module';
import { ReportsWorkerBootstrap } from './reports-worker.bootstrap';
import { ReportExportRepository } from './repositories/report-export.repository';
import { ReportExportAccessService } from './services/report-export-access.service';

const UNIT = 'unit-report-worker';
const ASYNC_EXPORT_ROW_COUNT = 505; // > syncRowThreshold (500) -> enfileira REPORT_GENERATION

describe('REPORT_GENERATION worker wiring (PostgreSQL integration)', () => {
  let pool: Pool;
  let moduleRef: TestingModule;
  let worker: BackgroundWorkerService;
  let registry: BackgroundJobHandlerRegistry;
  let jobsRepo: BackgroundJobsRepository;
  let exportRepo: ReportExportRepository;
  let access: ReportExportAccessService;
  let actor: { identityId: string; sessionId: string };
  let storageRoot: string;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for report worker tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    process.env['WORKER_ENABLED'] = 'true';
    process.env['WORKER_ID'] = 'report-worker-test';
    process.env['WORKER_CONCURRENCY'] = '2';
    process.env['WORKER_POLL_INTERVAL_MS'] = '20';
    process.env['WORKER_JOB_TIMEOUT_MS'] = '15000';
    process.env['WORKER_LEASE_DURATION_MS'] = '5000';
    process.env['WORKER_DEFAULT_MAX_ATTEMPTS'] = '3';
    process.env['WORKER_BACKOFF_BASE_MS'] = '10';
    process.env['WORKER_BACKOFF_MAX_MS'] = '100';
    storageRoot = await mkdtemp(join(tmpdir(), 'cisne-report-worker-'));
    process.env['OBJECT_STORAGE_ROOT'] = storageRoot;
    process.env['OBJECT_STORAGE_PROVIDER'] = 'filesystem';

    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, AuthorizationModule, BackgroundJobsModule, ReportsModule],
    }).compile();
    // Em teste, o lifecycle do Nest (que exige adapter HTTP no DocumentsModule)
    // não roda; o bootstrap real do reports é exercitado explicitamente, igual à
    // ordem do app (onModuleInit registra o handler REPORT_GENERATION).
    moduleRef.get(ReportsWorkerBootstrap).onModuleInit();

    worker = moduleRef.get(BackgroundWorkerService);
    registry = moduleRef.get(BackgroundJobHandlerRegistry);
    jobsRepo = moduleRef.get(BackgroundJobsRepository);
    exportRepo = moduleRef.get(ReportExportRepository);
    access = moduleRef.get(ReportExportAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE plt.background_jobs RESTART IDENTITY CASCADE');
    await pool.query('DELETE FROM rpt.report_exports');
    await truncateServiceOrderTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);

    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const identity = await insertIdentity(pool, `report-worker-${suffix}`);
    actor = { identityId: identity.identityId, sessionId: 'sid-report-worker' };
    await insertGrant(pool, {
      identityId: actor.identityId,
      action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderList,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: actor.identityId,
    });
  }, 30_000);

  afterAll(async () => {
    await moduleRef?.close();
    await pool?.end();
    await rm(storageRoot, { recursive: true, force: true });
  });

  it('registra o handler REPORT_GENERATION no registry do worker (fiação)', () => {
    expect(registry.get(BACKGROUND_JOB_KINDS.ReportGeneration)).toBeDefined();
  });

  it('export >500 linhas: PENDING -> RUNNING (processing) -> COMPLETED pelo worker', async () => {
    await insertServiceOrderRows(pool, ASYNC_EXPORT_ROW_COUNT, actor.identityId);

    const created = await access.createExport(actor, {
      reportType: REPORT_TYPES.ServiceOrdersByPeriod,
      format: 'CSV',
      filters: {},
    });
    expect(created.status).toBe('PENDING');

    const jobKey = `report-export:${created.id}`;
    const queued = await jobsRepo.findByIdempotencyKey(jobKey);
    expect(queued?.status).toBe(BACKGROUND_JOB_STATUSES.Pending);

    // Claim manual para observar PROCESSING (RUNNING) de forma determinística.
    const claimed = await jobsRepo.claimJobs('report-worker-test', 1, 2_000);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.id).toBe(queued?.id);
    const running = await jobsRepo.findByIdempotencyKey(jobKey);
    expect(running?.status).toBe(BACKGROUND_JOB_STATUSES.Running);

    // Handler registrado (fiação) executa e o worker marca COMPLETED.
    const handler = registry.get(BACKGROUND_JOB_KINDS.ReportGeneration);
    expect(handler).toBeDefined();
    await handler!.handle({
      jobId: running!.id,
      jobKind: BACKGROUND_JOB_KINDS.ReportGeneration,
      payload: running!.payload,
      attemptCount: running!.attempt_count,
      correlationId: running!.correlation_id,
      signal: new AbortController().signal,
    });
    await jobsRepo.markCompleted(running!.id);

    const done = await jobsRepo.findByIdempotencyKey(jobKey);
    expect(done?.status).toBe(BACKGROUND_JOB_STATUSES.Completed);
    expect(done?.last_error).toBeNull();

    const stored = await exportRepo.findById(created.id);
    expect(stored?.status).toBe('COMPLETED');
    expect(stored?.row_count).toBe(ASYNC_EXPORT_ROW_COUNT);
    expect(stored?.storage_key).not.toBeNull();
    expect(done?.failure_class).toBeNull();
  }, 60_000);

  it('worker restart: lease expirado de RUNNING volta a PENDING e o job completa', async () => {
    const exportRow = await exportRepo.createExport({
      reportType: REPORT_TYPES.ServiceOrdersByPeriod,
      format: 'CSV',
      contract: minimalContract(actor.identityId, actor.sessionId),
      identityId: actor.identityId,
      sessionId: actor.sessionId,
      correlationId: null,
    });
    const key = `report-export:${exportRow.id}`;
    const enqueued = await jobsRepo.enqueueJob({
      jobKind: BACKGROUND_JOB_KINDS.ReportGeneration,
      idempotencyKey: key,
      payload: { schemaVersion: 1, exportId: exportRow.id, identityId: actor.identityId, sessionId: actor.sessionId },
      maxAttempts: 3,
    });

    const claimed = await jobsRepo.claimJobs('crashed-worker', 1, 1);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.id).toBe(enqueued.jobId);

    await pool.query(
      `UPDATE plt.background_jobs SET lease_expires_at = NOW() - interval '1 second' WHERE id = $1::uuid`,
      [enqueued.jobId],
    );
    await jobsRepo.releaseExpiredLeases();
    const recovered = await jobsRepo.findByIdempotencyKey(key);
    expect(recovered?.status).toBe(BACKGROUND_JOB_STATUSES.Pending);

    await worker.runOnce();
    const done = await jobsRepo.findByIdempotencyKey(key);
    expect(done?.status).toBe(BACKGROUND_JOB_STATUSES.Completed);
    const stored = await exportRepo.findById(exportRow.id);
    expect(stored?.status).toBe('COMPLETED');
  }, 60_000);

  it('job duplicado (mesma idempotency_key) não gera segunda linha', async () => {
    const exportRow = await exportRepo.createExport({
      reportType: REPORT_TYPES.ServiceOrdersByPeriod,
      format: 'CSV',
      contract: minimalContract(actor.identityId, actor.sessionId),
      identityId: actor.identityId,
      sessionId: actor.sessionId,
      correlationId: null,
    });
    const key = `report-export:${exportRow.id}`;
    const first = await jobsRepo.enqueueJob({
      jobKind: BACKGROUND_JOB_KINDS.ReportGeneration,
      idempotencyKey: key,
      payload: { schemaVersion: 1, exportId: exportRow.id, identityId: actor.identityId, sessionId: actor.sessionId },
    });
    const second = await jobsRepo.enqueueJob({
      jobKind: BACKGROUND_JOB_KINDS.ReportGeneration,
      idempotencyKey: key,
      payload: { schemaVersion: 1, exportId: exportRow.id, identityId: actor.identityId, sessionId: actor.sessionId },
    });
    expect(first.outcome).toBe('created');
    expect(second.outcome).toBe('duplicate');
    expect(second.jobId).toBe(first.jobId);

    const count = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM plt.background_jobs WHERE idempotency_key = $1`,
      [key],
    );
    expect(count.rows[0]?.count).toBe('1');
  });

  it('falha transiente -> retry -> sucesso (export recriada entre tentativas)', async () => {
    const exportRow = await exportRepo.createExport({
      reportType: REPORT_TYPES.ServiceOrdersByPeriod,
      format: 'CSV',
      contract: minimalContract(actor.identityId, actor.sessionId),
      identityId: actor.identityId,
      sessionId: actor.sessionId,
      correlationId: null,
    });
    const key = `report-export:${exportRow.id}`;
    await jobsRepo.enqueueJob({
      jobKind: BACKGROUND_JOB_KINDS.ReportGeneration,
      idempotencyKey: key,
      payload: { schemaVersion: 1, exportId: exportRow.id, identityId: actor.identityId, sessionId: actor.sessionId },
      maxAttempts: 3,
    });

    // Simula perda da export antes da 1a tentativa -> REPORT_EXPORT_NOT_FOUND (transiente).
    await pool.query('DELETE FROM rpt.report_exports WHERE id = $1::uuid', [exportRow.id]);
    await worker.runOnce();

    const stored = await jobsRepo.findByIdempotencyKey(key);
    expect(stored?.status).toBe(BACKGROUND_JOB_STATUSES.Pending);
    expect(stored?.attempt_count).toBe(1);
    expect(stored?.last_error).toContain('REPORT_EXPORT_NOT_FOUND');
    // Recria a export (contrato válido) e libera o retry.
    await pool.query(
      `INSERT INTO rpt.report_exports (
         id, report_type, format, status, contract,
         requested_by_identity_id, requested_session_id
       ) VALUES ($1, $2, 'CSV', 'PENDING', $3::jsonb, $4, $5)`,
      [
        exportRow.id,
        REPORT_TYPES.ServiceOrdersByPeriod,
        JSON.stringify(minimalContract(actor.identityId, actor.sessionId)),
        actor.identityId,
        actor.sessionId,
      ],
    );
    await pool.query(
      `UPDATE plt.background_jobs SET run_after = NOW() - interval '1 second' WHERE idempotency_key = $1`,
      [key],
    );
    await worker.runOnce();

    const done = await jobsRepo.findByIdempotencyKey(key);
    expect(done?.status).toBe(BACKGROUND_JOB_STATUSES.Completed);
    expect(done?.attempt_count).toBe(2);
    const exportAfterRetry = await exportRepo.findById(exportRow.id);
    expect(exportAfterRetry?.status).toBe('COMPLETED');
  }, 60_000);

  it('cancelExport remove job pendente e impede processamento futuro', async () => {
    await insertServiceOrderRows(pool, ASYNC_EXPORT_ROW_COUNT, actor.identityId);
    const created = await access.createExport(actor, {
      reportType: REPORT_TYPES.ServiceOrdersByPeriod,
      format: 'CSV',
      filters: {},
    });
    expect(created.status).toBe('PENDING');
    const jobKey = `report-export:${created.id}`;
    const queued = await jobsRepo.findByIdempotencyKey(jobKey);
    expect(queued).not.toBeNull();

    const cancelled = await access.cancelExport(actor, created.id);
    expect(cancelled.status).toBe('CANCELLED');

    // Job pendente foi removido -> o worker não tem o que processar.
    expect(await jobsRepo.findByIdempotencyKey(jobKey)).toBeNull();
    await worker.runOnce();

    const stored = await exportRepo.findById(created.id);
    expect(stored?.status).toBe('CANCELLED');
    expect(stored?.storage_key).toBeNull();

    const noHandler = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM plt.background_jobs
       WHERE job_kind = $1 AND (last_error LIKE 'NO_HANDLER%' OR status = 'FAILED')`,
      [BACKGROUND_JOB_KINDS.ReportGeneration],
    );
    expect(noHandler.rows[0]?.count).toBe('0');
  }, 60_000);
});

function minimalContract(identityId: string, sessionId: string): ReportContract {
  return {
    name: 'OS por período',
    filters: {},
    columns: [],
    sort: { field: 'createdAt', direction: 'DESC' },
    timezone: 'America/Porto_Velho',
    generatedAt: null,
    actor: { identityId, sessionId },
    scope: { summary: 'scoped_by_existing_grants' },
  };
}

async function insertServiceOrderRows(pool: Pool, count: number, actorId: string): Promise<void> {
  const CHUNK = 100;
  for (let offset = 0; offset < count; offset += CHUNK) {
    const rows: unknown[] = [];
    const values: string[] = [];
    for (let index = 0; index < CHUNK; index += 1) {
      const n = offset + index;
      if (n >= count) {
        break;
      }
      const base = rows.length;
      rows.push(`SO-WRK-${n}`, `WRK-${n}`, UNIT, 'PREPARED', actorId, actorId);
      values.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, 'AUTHORIZED_DIRECT', '{}'::jsonb, '{}'::jsonb, 1, $${base + 5}, $${base + 6})`,
      );
    }
    await pool.query(
      `INSERT INTO so.service_orders (
         internal_code, order_number, unit_id, status, origin, service_snapshot,
         client_snapshot, row_version, created_by_identity_id, updated_by_identity_id
       ) VALUES ${values.join(', ')}`,
      rows,
    );
  }
}
