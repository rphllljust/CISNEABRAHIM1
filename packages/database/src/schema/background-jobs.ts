import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgEnum, pgSchema, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const pltSchema = pgSchema('plt');

export const backgroundJobKindEnum = pgEnum('background_job_kind', [
  'NOTIFICATION',
  'INTEGRATION',
  'DOCUMENT_PROCESSING',
  'REPORT_GENERATION',
  'OPERATIONAL_ALERT_SCAN',
  'BILLING_RECEIVABLE_HANDOFF',
  'BILLING_RECEIVABLE_CANCEL',
]);

export const backgroundJobStatusEnum = pgEnum('background_job_status', [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'DEAD',
]);

export const backgroundJobFailureClassEnum = pgEnum('background_job_failure_class', [
  'TRANSIENT',
  'PERMANENT',
]);

export const backgroundJobs = pltSchema.table(
  'background_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobKind: backgroundJobKindEnum('job_kind').notNull(),
    status: backgroundJobStatusEnum('status').notNull().default('PENDING'),
    idempotencyKey: text('idempotency_key').notNull(),
    payloadVersion: integer('payload_version').notNull().default(1),
    payload: jsonb('payload').notNull().default({}),
    priority: integer('priority').notNull().default(0),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    runAfter: timestamp('run_after', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true, mode: 'string' }),
    lastError: text('last_error'),
    failureClass: backgroundJobFailureClassEnum('failure_class'),
    correlationId: text('correlation_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  (table) => [
    check('background_jobs_payload_version_positive_chk', sql`${table.payloadVersion} >= 1`),
    check('background_jobs_max_attempts_positive_chk', sql`${table.maxAttempts} >= 1`),
    check('background_jobs_attempt_count_non_negative_chk', sql`${table.attemptCount} >= 0`),
    check('background_jobs_idempotency_key_not_empty_chk', sql`length(trim(${table.idempotencyKey})) > 0`),
    uniqueIndex('background_jobs_idempotency_key_uidx').on(table.idempotencyKey),
    index('background_jobs_poll_idx').on(table.status, table.runAfter, table.priority, table.createdAt),
    index('background_jobs_lease_expires_idx')
      .on(table.leaseExpiresAt)
      .where(sql`${table.status} = 'RUNNING'`),
    index('background_jobs_kind_status_idx').on(table.jobKind, table.status),
  ],
);
