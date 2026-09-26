import {
  truncateBackgroundJobTables,
  truncateDomainEventTables,
  truncateIntegrationInboxTables,
  truncateOutboxTables,
} from '@cisne/database';
import { Test, TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyAuthTestEnv } from '../../auth/test/auth-test-env';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { MetricsRegistryService } from '../metrics/metrics-registry.service';
import { PlatformMetricsCollectorService } from './platform-metrics-collector.service';

/**
 * Regressao de contrato do coletor de metricas de PLATAFORMA contra PostgreSQL real.
 *
 * Motivo comprovado: o mesmo padrao de defeito ja derrubou `GET /observability/metrics` em HML
 * (500 por literal de enum invalido em metrica de negocio). O coletor de plataforma alimenta
 * diretamente os alertas tecnicos (OUTBOX_BACKLOG, ERP_FAILURES, TRACKING_FAILURES,
 * NOTIFICATION_FAILURES, WORKER_STALLED), entao um literal/coluna fora do vocabulario publicado
 * aqui nao pode ser descoberto so em smoke de ambiente: precisa falhar no gate.
 *
 * Este teste prova duas coisas contra o banco migrado de verdade:
 *   1) o vocabulario de status que o SQL do coletor usa existe no tipo publicado da coluna;
 *   2) as contagens devolvidas casam com o ground truth medido por SQL independente.
 */
describe('PlatformMetricsCollectorService — integração PostgreSQL', () => {
  let pool: Pool;
  let collector: PlatformMetricsCollectorService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for platform metrics integration tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    const module: TestingModule = await Test.createTestingModule({
      imports: [DatabaseModule],
      providers: [MetricsRegistryService, PlatformMetricsCollectorService],
    }).compile();
    collector = module.get(PlatformMetricsCollectorService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateIntegrationInboxTables(pool);
    await truncateOutboxTables(pool);
    await truncateBackgroundJobTables(pool);
    await truncateDomainEventTables(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function publishedStatusLabels(
    schema: string,
    table: string,
    column: string,
  ): Promise<string[]> {
    const columnRow = await pool.query<{ udt_schema: string; udt_name: string }>(
      `SELECT udt_schema, udt_name
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
      [schema, table, column],
    );
    const row = columnRow.rows[0];
    if (!row) {
      throw new Error(`column not found in published schema: ${schema}.${table}.${column}`);
    }
    const labels = await pool.query<{ enumlabel: string }>(
      `SELECT e.enumlabel
         FROM pg_type t
         JOIN pg_namespace n ON n.oid = t.typnamespace
         JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE n.nspname = $1 AND t.typname = $2
        ORDER BY e.enumsortorder`,
      [row.udt_schema, row.udt_name],
    );
    return labels.rows.map((entry) => entry.enumlabel);
  }

  async function seedBackgroundJobs(statuses: string[]): Promise<void> {
    for (const status of statuses) {
      await pool.query(
        `INSERT INTO plt.background_jobs (job_kind, status, idempotency_key)
         VALUES ('NOTIFICATION', $1, $2)`,
        [status, `job-${crypto.randomUUID()}`],
      );
    }
  }

  async function seedOutboxEvents(statuses: string[]): Promise<void> {
    let sequence = 0;
    for (const status of statuses) {
      sequence += 1;
      await pool.query(
        `INSERT INTO evt.outbox_events (
           event_type, aggregate_type, aggregate_id, status, idempotency_key,
           ordering_key, sequence_number
         ) VALUES ('SERVICE_ORDER_RELEASED', 'service_order', $1::uuid, $2, $3, $4, $5)`,
        [crypto.randomUUID(), status, `outbox-${crypto.randomUUID()}`, `ord-${sequence}`, sequence],
      );
    }
  }

  /** Cadeia real de FK: domain_event -> notification_intent -> notification -> delivery_attempt. */
  async function seedFailedDeliveryAttempts(count: number): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      const domainEventId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO evt.domain_events (id, event_type, aggregate_type, aggregate_id)
         VALUES ($1::uuid, 'BILLING_READY', 'service_order', $2::uuid)`,
        [domainEventId, crypto.randomUUID()],
      );
      const intentId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO evt.notification_intents (
           id, domain_event_id, intent_key, audience_scope, template_key
         ) VALUES ($1::uuid, $2::uuid, $3, 'UNIT', 'billing.ready')`,
        [intentId, domainEventId, `intent-${crypto.randomUUID()}`],
      );
      const notificationId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO ntf.notifications (
           id, notification_intent_id, channel, recipient_ref, template_key, status
         ) VALUES ($1::uuid, $2::uuid, 'EMAIL', 'operador@cisne.invalid', 'billing.ready', 'FAILED')`,
        [notificationId, intentId],
      );
      await pool.query(
        `INSERT INTO ntf.delivery_attempts (
           id, notification_id, channel, recipient_ref, provider, attempt, status, failure_code
         ) VALUES ($1::uuid, $2::uuid, 'EMAIL', 'operador@cisne.invalid', 'smtp', 1, 'FAILED', 'SMTP_TIMEOUT')`,
        [crypto.randomUUID(), notificationId],
      );
    }
  }

  async function seedIntegrationInbox(
    entries: { provider: string; status: string }[],
  ): Promise<void> {
    for (const entry of entries) {
      await pool.query(
        `INSERT INTO int.integration_inbox (
           provider, external_message_id, event_type, payload_hash, payload, status
         ) VALUES ($1, $2, 'TRACKING_UPDATE', $3, '{}'::jsonb, $4)`,
        [
          entry.provider,
          `msg-${crypto.randomUUID()}`,
          `hash-${crypto.randomUUID()}`,
          entry.status,
        ],
      );
    }
  }

  it('o vocabulário de status usado pelo SQL existe no tipo publicado das colunas', async () => {
    expect(await publishedStatusLabels('plt', 'background_jobs', 'status')).toContain('PENDING');
    expect(await publishedStatusLabels('evt', 'outbox_events', 'status')).toEqual(
      expect.arrayContaining(['PENDING', 'FAILED']),
    );
    expect(await publishedStatusLabels('ntf', 'delivery_attempts', 'status')).toContain('FAILED');
    expect(await publishedStatusLabels('int', 'integration_inbox', 'status')).toContain('FAILED');
  });

  it('conta backlogs reais e casa com o ground truth do banco', async () => {
    await seedBackgroundJobs(['PENDING', 'PENDING', 'RUNNING']);
    await seedOutboxEvents(['PENDING', 'PENDING', 'FAILED', 'PUBLISHED']);
    await seedFailedDeliveryAttempts(2);
    await seedIntegrationInbox([
      { provider: 'erp-acl', status: 'FAILED' },
      { provider: 'tracking-provider', status: 'FAILED' },
      { provider: 'whatsapp-bridge', status: 'FAILED' },
      { provider: 'erp-acl', status: 'PROCESSED' },
    ]);

    const snapshot = await collector.collectBacklogs();

    expect(snapshot).toEqual({
      workerPending: 2,
      outboxPending: 2,
      outboxFailed: 1,
      notificationFailures: 2,
      integrationFailures: 3,
      erpFailures: 1,
      trackingFailures: 1,
    });
    expect(collector.getLastCollectionError()).toBeNull();

    // Ground truth medido de forma independente (mesma base, SQL próprio do teste).
    const truth = await pool.query<{ integration: string; erp: string; tracking: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'FAILED')::text AS integration,
         COUNT(*) FILTER (WHERE status = 'FAILED' AND provider ILIKE '%erp%')::text AS erp,
         COUNT(*) FILTER (WHERE status = 'FAILED' AND provider ILIKE '%tracking%')::text AS tracking
       FROM int.integration_inbox`,
    );
    expect(snapshot.integrationFailures).toBe(Number(truth.rows[0]?.integration));
    expect(snapshot.erpFailures).toBe(Number(truth.rows[0]?.erp));
    expect(snapshot.trackingFailures).toBe(Number(truth.rows[0]?.tracking));
  });

  it('base vazia devolve zero REAL (medido) e nenhum diagnóstico de falha', async () => {
    const snapshot = await collector.collectBacklogs();

    expect(snapshot).toEqual({
      workerPending: 0,
      outboxPending: 0,
      outboxFailed: 0,
      notificationFailures: 0,
      integrationFailures: 0,
      erpFailures: 0,
      trackingFailures: 0,
    });
    expect(collector.getLastCollectionError()).toBeNull();
  });
});
