import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { BACKGROUND_JOB_KINDS } from '../../platform/background-jobs/domain/background-job-kind';
import { BackgroundJobsRepository } from '../../platform/background-jobs/repositories/background-jobs.repository';
import { FAULT_HOOKS } from '../../platform/fault-injection/fault-hook.ids';
import { FAULT_INJECTION_PORT, type FaultInjectionPort } from '../../platform/fault-injection/fault-injection.port';
import { maybeInjectFault } from '../../platform/fault-injection/fault-injection.util';
import { BILLING_DOCUMENT_COMMANDS, BILLING_DOCUMENT_HISTORY_EVENTS } from '../domain/billing-document';
import {
  allocateBillingDocumentNumber,
  findBillingDocumentByIdWithClient,
  findBillingDocumentCancelIdempotency,
  findBillingDocumentIssueIdempotency,
  insertBillingDocumentItems,
  persistBillingDocumentRecords,
} from './billing-document-persistence.helpers';
import {
  BILLING_DOCUMENT_ITEM_RETURNING,
  BILLING_DOCUMENT_RETURNING,
} from './billing-document-sql.constants';
import type {
  AllocatedDocumentNumber,
  BillingDocumentHistoryEventRow,
  BillingDocumentItemRow,
  BillingDocumentRow,
  CancelBillingDocumentPersistenceInput,
  CancelBillingDocumentPersistenceResult,
  IssueBillingDocumentPersistenceInput,
  IssueBillingDocumentPersistenceResult,
  PersistedBillingArtifact,
  PurchaseOrderNumberRow,
  ReplaceBillingDocumentPersistenceInput,
} from './billing-document.repository.types';

@Injectable()
export class BillingDocumentRepository {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly backgroundJobs: BackgroundJobsRepository,
    @Optional() @Inject(FAULT_INJECTION_PORT) private readonly faultInjection?: FaultInjectionPort,
  ) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  /** The handoff obligation is committed atomically with the FINALIZED document.
   * A worker may retry even if the synchronous Finance call fails or the API crashes.
   * Neither this Billing repository nor the worker writes Finance tables directly.
   */
  private async enqueueReceivableHandoff(client: PoolClient, billingDocumentId: string): Promise<void> {
    await this.backgroundJobs.enqueueJob({
      jobKind: BACKGROUND_JOB_KINDS.BillingReceivableHandoff,
      idempotencyKey: `billing-document:${billingDocumentId}:receivable-handoff`,
      correlationId: billingDocumentId,
      payload: { schemaVersion: 1, billingDocumentId },
      priority: 10,
      maxAttempts: 12,
    }, client);
  }

  /**
   * Serialize financial transitions of a single billing document across the API
   * command and the background worker. This is a PostgreSQL advisory *transaction*
   * lock; it owns no cross-context data and is released on commit/rollback.
   */
  async withHandoffLock<T>(
    billingDocumentId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
        [`billing-document:${billingDocumentId}:finance`],
      );
      const result = await operation();
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async enqueueReceivableCancellation(
    client: PoolClient,
    billingDocumentId: string,
  ): Promise<void> {
    await this.backgroundJobs.enqueueJob({
      jobKind: BACKGROUND_JOB_KINDS.BillingReceivableHandoff,
      idempotencyKey: `billing-document:${billingDocumentId}:receivable-cancel`,
      correlationId: billingDocumentId,
      payload: { schemaVersion: 1, billingDocumentId, action: 'CANCEL' },
      priority: 20,
      maxAttempts: 12,
    }, client);
  }

  async findById(billingDocumentId: string): Promise<BillingDocumentRow | null> {
    const result = await this.pool().query<BillingDocumentRow>(
      `SELECT ${BILLING_DOCUMENT_RETURNING} FROM bil.billing_documents WHERE id = $1`,
      [billingDocumentId],
    );
    return result.rows[0] ?? null;
  }

  async listByBillingRecordId(billingRecordId: string): Promise<BillingDocumentRow[]> {
    const result = await this.pool().query<BillingDocumentRow>(
      `SELECT ${BILLING_DOCUMENT_RETURNING}
       FROM bil.billing_documents
       WHERE billing_record_id = $1
       ORDER BY issued_at DESC, version_number DESC, id DESC`,
      [billingRecordId],
    );
    return result.rows;
  }

  async listItems(billingDocumentId: string): Promise<BillingDocumentItemRow[]> {
    return this.listItemsForBillingDocuments([billingDocumentId]);
  }

  async listItemsForBillingDocuments(
    billingDocumentIds: string[],
  ): Promise<BillingDocumentItemRow[]> {
    if (billingDocumentIds.length === 0) {
      return [];
    }
    const result = await this.pool().query<BillingDocumentItemRow>(
      `SELECT ${BILLING_DOCUMENT_ITEM_RETURNING}
       FROM bil.billing_document_items
       WHERE billing_document_id = ANY($1::uuid[])
       ORDER BY billing_document_id, line_number ASC`,
      [billingDocumentIds],
    );
    return result.rows;
  }

  async listHistoryEvents(billingDocumentId: string): Promise<BillingDocumentHistoryEventRow[]> {
    return this.listHistoryEventsForBillingDocuments([billingDocumentId]);
  }

  async listHistoryEventsForBillingDocuments(
    billingDocumentIds: string[],
  ): Promise<BillingDocumentHistoryEventRow[]> {
    if (billingDocumentIds.length === 0) {
      return [];
    }
    const result = await this.pool().query<BillingDocumentHistoryEventRow>(
      `SELECT id, billing_document_id, event_type, payload, actor_identity_id, occurred_at
       FROM bil.billing_document_history_events
       WHERE billing_document_id = ANY($1::uuid[])
       ORDER BY billing_document_id, occurred_at ASC, id ASC`,
      [billingDocumentIds],
    );
    return result.rows;
  }

  async findPurchaseOrderNumber(purchaseOrderId: string): Promise<string | null> {
    const result = await this.pool().query<PurchaseOrderNumberRow>(
      `SELECT po_number FROM rpt.read_purchase_orders WHERE id = $1`,
      [purchaseOrderId],
    );
    return result.rows[0]?.po_number ?? null;
  }

  async findActiveByBillingRecordId(billingRecordId: string): Promise<BillingDocumentRow | null> {
    const result = await this.pool().query<BillingDocumentRow>(
      `SELECT ${BILLING_DOCUMENT_RETURNING}
       FROM bil.billing_documents
       WHERE billing_record_id = $1 AND status = 'FINALIZED'
       LIMIT 1`,
      [billingRecordId],
    );
    return result.rows[0] ?? null;
  }

  async findDocumentStorage(documentId: string): Promise<{
    storage_key: string;
    original_filename: string;
    sha256_hash: string;
  } | null> {
    const result = await this.pool().query<{
      storage_key: string;
      original_filename: string;
      sha256_hash: string;
    }>(
      `SELECT so.storage_key, so.original_filename, so.sha256_hash
       FROM rpt.read_document_versions dv
       INNER JOIN rpt.read_stored_objects so ON so.id = dv.stored_object_id
       WHERE dv.document_id = $1 AND dv.superseded_at IS NULL
       ORDER BY dv.version_number DESC
       LIMIT 1`,
      [documentId],
    );
    return result.rows[0] ?? null;
  }

  async allocateDocumentNumber(
    client: PoolClient,
    sequenceYear: number,
  ): Promise<AllocatedDocumentNumber> {
    return allocateBillingDocumentNumber(client, sequenceYear);
  }

  async issueBillingDocument(
    input: IssueBillingDocumentPersistenceInput,
    persistArtifact: (allocation: AllocatedDocumentNumber) => Promise<PersistedBillingArtifact>,
  ): Promise<IssueBillingDocumentPersistenceResult> {
    const client = await this.pool().connect();
    let artifact: PersistedBillingArtifact | null = null;
    try {
      await client.query('BEGIN');

      if (input.idempotencyKey) {
        const cached = await findBillingDocumentIssueIdempotency(
          client,
          input.billingRecord.id,
          input.idempotencyKey,
        );
        if (cached?.billing_document_id) {
          const billingDocument = await findBillingDocumentByIdWithClient(client, cached.billing_document_id);
          if (billingDocument) {
            await client.query('COMMIT');
            return { outcome: 'idempotent', billingDocument };
          }
        }
      }

      await client.query(`SELECT id FROM bil.billing_records WHERE id = $1 FOR UPDATE`, [
        input.billingRecord.id,
      ]);

      if (!input.replacesDocumentId) {
        const existing = await client.query(
          `SELECT id FROM bil.billing_documents
           WHERE billing_record_id = $1 AND status = 'FINALIZED'
           LIMIT 1`,
          [input.billingRecord.id],
        );
        if ((existing.rowCount ?? 0) > 0) {
          throw new Error('BILLING_DOCUMENT_ALREADY_EXISTS');
        }
      }

      const issuedAtDate = new Date(input.issuedAt);
      const sequenceYear = issuedAtDate.getUTCFullYear();
      const allocation = await this.allocateDocumentNumber(client, sequenceYear);
      artifact = await persistArtifact(allocation);
      await maybeInjectFault(this.faultInjection, FAULT_HOOKS.BillingDocumentAfterPdfBeforeDb);
      await persistBillingDocumentRecords(client, {
        documentId: artifact.storedDocumentId,
        storedObjectId: artifact.storedObjectId,
        storageKey: artifact.storageKey,
        sha256: artifact.sha256,
        byteSize: artifact.byteSize,
        originalFilename: artifact.originalFilename,
        title: artifact.title,
        unitId: input.billingRecord.unit_id,
        actorIdentityId: input.actorIdentityId,
      });

      const billingDocumentId = randomUUID();
      const inserted = await client.query<BillingDocumentRow>(
        `INSERT INTO bil.billing_documents (
           id,
           billing_record_id,
           service_order_id,
           measurement_id,
           client_id,
           unit_id,
           document_number,
           sequence_year,
           sequence_number,
           version_number,
           replaces_document_id,
           status,
           document_category,
           emitter_legal_name,
           emitter_tax_id,
           emitter_address_snapshot,
           client_legal_name_snapshot,
           client_tax_id_snapshot,
           billing_address_snapshot,
           commercial_reference_snapshot,
           proposal_id,
           purchase_order_id,
           purchase_order_number_snapshot,
           customer_purchase_order_number_snapshot,
           contract_reference,
           currency_code,
           payment_terms,
           due_date,
           total_amount,
           issued_at,
           stored_document_id,
           artifact_sha256,
           artifact_byte_size,
           created_by_identity_id,
           updated_by_identity_id
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'FINALIZED', 'NOTA_FATURA',
           $12, $13, $14::jsonb, $15, $16, $17::jsonb, $18::jsonb, $19, $20, $21, $22,
           $23, $24, $25, $26::date, $27, $28::timestamptz, $29, $30, $31,
           $32, $32
         )
         RETURNING ${BILLING_DOCUMENT_RETURNING}`,
        [
          billingDocumentId,
          input.billingRecord.id,
          input.billingRecord.service_order_id,
          input.billingRecord.measurement_id,
          input.billingRecord.client_id,
          input.billingRecord.unit_id,
          allocation.documentNumber,
          allocation.sequenceYear,
          allocation.sequenceNumber,
          input.versionNumber,
          input.replacesDocumentId ?? null,
          input.emitterLegalName,
          input.emitterTaxId,
          JSON.stringify(input.emitterAddressSnapshot),
          input.billingRecord.client_legal_name_snapshot,
          input.billingRecord.client_tax_id_snapshot,
          JSON.stringify(input.billingRecord.billing_address_snapshot),
          JSON.stringify(input.billingRecord.commercial_reference_snapshot),
          input.billingRecord.proposal_id,
          input.billingRecord.purchase_order_id,
          input.purchaseOrderNumber,
          input.customerPurchaseOrderNumber ?? null,
          input.billingRecord.contract_reference,
          input.billingRecord.currency_code,
          input.billingRecord.payment_terms,
          input.dueDate,
          input.billingRecord.total_amount,
          input.issuedAt,
          artifact.storedDocumentId,
          artifact.sha256,
          artifact.byteSize,
          input.actorIdentityId,
        ],
      );

      await insertBillingDocumentItems(client, billingDocumentId, input.billingItems);

      await client.query(
        `INSERT INTO bil.billing_document_history_events (billing_document_id, event_type, payload, actor_identity_id)
         VALUES ($1, $2, $3::jsonb, $4)`,
        [
          billingDocumentId,
          BILLING_DOCUMENT_HISTORY_EVENTS.Issued,
          JSON.stringify({
            documentNumber: allocation.documentNumber,
            artifactSha256: artifact.sha256,
            storedDocumentId: artifact.storedDocumentId,
          }),
          input.actorIdentityId,
        ],
      );

      if (input.idempotencyKey) {
        await client.query(
          `INSERT INTO bil.billing_document_command_idempotency (
             billing_document_id, billing_record_id, command_name, idempotency_key, response_payload
           )
           VALUES ($1, $2, $3, $4, $5::jsonb)`,
          [
            billingDocumentId,
            input.billingRecord.id,
            BILLING_DOCUMENT_COMMANDS.Issue,
            input.idempotencyKey,
            JSON.stringify({ billingDocumentId }),
          ],
        );
      }

      await this.enqueueReceivableHandoff(client, billingDocumentId);
      await client.query('COMMIT');
      const billingDocument = inserted.rows[0];
      if (!billingDocument) {
        throw new Error('BILLING_DOCUMENT_CREATE_FAILED');
      }
      return { outcome: 'created', billingDocument };
    } catch (error) {
      await client.query('ROLLBACK');
      if (artifact) {
        const enriched = Object.assign(error instanceof Error ? error : new Error(String(error)), {
          storageKey: artifact.storageKey,
        });
        throw enriched;
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async replaceBillingDocument(
    input: ReplaceBillingDocumentPersistenceInput,
    persistArtifact: (allocation: AllocatedDocumentNumber) => Promise<PersistedBillingArtifact>,
  ): Promise<IssueBillingDocumentPersistenceResult> {
    const client = await this.pool().connect();
    let artifact: PersistedBillingArtifact | null = null;
    try {
      await client.query('BEGIN');

      const previous = await client.query<BillingDocumentRow>(
        `SELECT ${BILLING_DOCUMENT_RETURNING}
         FROM bil.billing_documents
         WHERE id = $1 AND billing_record_id = $2
         FOR UPDATE`,
        [input.previousDocumentId, input.billingRecord.id],
      );
      const previousDocument = previous.rows[0];
      if (!previousDocument) {
        throw new Error('BILLING_DOCUMENT_NOT_FOUND');
      }
      if (previousDocument.status !== 'FINALIZED') {
        throw new Error('BILLING_DOCUMENT_INVALID_STATE');
      }
      if (previousDocument.row_version !== input.previousRowVersion) {
        throw new Error('BILLING_VERSION_CONFLICT');
      }

      await client.query(
        `UPDATE bil.billing_documents
         SET status = 'CANCELLED',
             cancelled_at = NOW(),
             cancelled_by_identity_id = $2,
             cancel_reason = $3,
             row_version = row_version + 1,
             updated_at = NOW(),
             updated_by_identity_id = $2
         WHERE id = $1`,
        [input.previousDocumentId, input.actorIdentityId, input.replaceReason],
      );

      await client.query(
        `INSERT INTO bil.billing_document_history_events (billing_document_id, event_type, payload, actor_identity_id)
         VALUES ($1, $2, $3::jsonb, $4)`,
        [
          input.previousDocumentId,
          BILLING_DOCUMENT_HISTORY_EVENTS.Cancelled,
          JSON.stringify({ reason: input.replaceReason, replaced: true }),
          input.actorIdentityId,
        ],
      );

      const issuedAtDate = new Date(input.issuedAt);
      const sequenceYear = issuedAtDate.getUTCFullYear();
      const allocation = await this.allocateDocumentNumber(client, sequenceYear);
      artifact = await persistArtifact(allocation);
      await maybeInjectFault(this.faultInjection, FAULT_HOOKS.BillingDocumentAfterPdfBeforeDb);
      await persistBillingDocumentRecords(client, {
        documentId: artifact.storedDocumentId,
        storedObjectId: artifact.storedObjectId,
        storageKey: artifact.storageKey,
        sha256: artifact.sha256,
        byteSize: artifact.byteSize,
        originalFilename: artifact.originalFilename,
        title: artifact.title,
        unitId: input.billingRecord.unit_id,
        actorIdentityId: input.actorIdentityId,
      });

      const billingDocumentId = randomUUID();
      const inserted = await client.query<BillingDocumentRow>(
        `INSERT INTO bil.billing_documents (
           id,
           billing_record_id,
           service_order_id,
           measurement_id,
           client_id,
           unit_id,
           document_number,
           sequence_year,
           sequence_number,
           version_number,
           replaces_document_id,
           status,
           document_category,
           emitter_legal_name,
           emitter_tax_id,
           emitter_address_snapshot,
           client_legal_name_snapshot,
           client_tax_id_snapshot,
           billing_address_snapshot,
           commercial_reference_snapshot,
           proposal_id,
           purchase_order_id,
           purchase_order_number_snapshot,
           customer_purchase_order_number_snapshot,
           contract_reference,
           currency_code,
           payment_terms,
           due_date,
           total_amount,
           issued_at,
           stored_document_id,
           artifact_sha256,
           artifact_byte_size,
           created_by_identity_id,
           updated_by_identity_id
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'FINALIZED', 'NOTA_FATURA',
           $12, $13, $14::jsonb, $15, $16, $17::jsonb, $18::jsonb, $19, $20, $21, $22,
           $23, $24, $25, $26::date, $27, $28::timestamptz, $29, $30, $31,
           $32, $32
         )
         RETURNING ${BILLING_DOCUMENT_RETURNING}`,
        [
          billingDocumentId,
          input.billingRecord.id,
          input.billingRecord.service_order_id,
          input.billingRecord.measurement_id,
          input.billingRecord.client_id,
          input.billingRecord.unit_id,
          allocation.documentNumber,
          allocation.sequenceYear,
          allocation.sequenceNumber,
          input.versionNumber,
          input.previousDocumentId,
          input.emitterLegalName,
          input.emitterTaxId,
          JSON.stringify(input.emitterAddressSnapshot),
          input.billingRecord.client_legal_name_snapshot,
          input.billingRecord.client_tax_id_snapshot,
          JSON.stringify(input.billingRecord.billing_address_snapshot),
          JSON.stringify(input.billingRecord.commercial_reference_snapshot),
          input.billingRecord.proposal_id,
          input.billingRecord.purchase_order_id,
          input.purchaseOrderNumber,
          input.customerPurchaseOrderNumber ?? null,
          input.billingRecord.contract_reference,
          input.billingRecord.currency_code,
          input.billingRecord.payment_terms,
          input.dueDate,
          input.billingRecord.total_amount,
          input.issuedAt,
          artifact.storedDocumentId,
          artifact.sha256,
          artifact.byteSize,
          input.actorIdentityId,
        ],
      );

      await insertBillingDocumentItems(client, billingDocumentId, input.billingItems);

      await client.query(
        `INSERT INTO bil.billing_document_history_events (billing_document_id, event_type, payload, actor_identity_id)
         VALUES ($1, $2, $3::jsonb, $4)`,
        [
          billingDocumentId,
          BILLING_DOCUMENT_HISTORY_EVENTS.Issued,
          JSON.stringify({
            documentNumber: allocation.documentNumber,
            artifactSha256: artifact.sha256,
            replacesDocumentId: input.previousDocumentId,
          }),
          input.actorIdentityId,
        ],
      );

      await this.enqueueReceivableCancellation(client, input.previousDocumentId);
      await this.enqueueReceivableHandoff(client, billingDocumentId);
      await client.query('COMMIT');
      const billingDocument = inserted.rows[0];
      if (!billingDocument) {
        throw new Error('BILLING_DOCUMENT_CREATE_FAILED');
      }
      return { outcome: 'created', billingDocument };
    } catch (error) {
      await client.query('ROLLBACK');
      if (artifact) {
        const enriched = Object.assign(error instanceof Error ? error : new Error(String(error)), {
          storageKey: artifact.storageKey,
        });
        throw enriched;
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async cancelBillingDocument(
    input: CancelBillingDocumentPersistenceInput,
  ): Promise<CancelBillingDocumentPersistenceResult> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');

      if (input.idempotencyKey) {
        const cached = await findBillingDocumentCancelIdempotency(
          client,
          input.billingRecordId,
          input.idempotencyKey,
        );
        if (cached?.billing_document_id) {
          const billingDocument = await findBillingDocumentByIdWithClient(client, cached.billing_document_id);
          if (billingDocument) {
            await client.query('COMMIT');
            return { outcome: 'idempotent', billingDocument };
          }
        }
      }

      const locked = await client.query<BillingDocumentRow>(
        `SELECT ${BILLING_DOCUMENT_RETURNING}
         FROM bil.billing_documents
         WHERE id = $1 AND billing_record_id = $2
         FOR UPDATE`,
        [input.billingDocumentId, input.billingRecordId],
      );
      const billingDocument = locked.rows[0];
      if (!billingDocument) {
        throw new Error('BILLING_DOCUMENT_NOT_FOUND');
      }
      if (billingDocument.status !== 'FINALIZED') {
        throw new Error('BILLING_DOCUMENT_INVALID_STATE');
      }
      if (billingDocument.row_version !== input.rowVersion) {
        throw new Error('BILLING_VERSION_CONFLICT');
      }

      const updated = await client.query<BillingDocumentRow>(
        `UPDATE bil.billing_documents
         SET status = 'CANCELLED',
             cancelled_at = NOW(),
             cancelled_by_identity_id = $3,
             cancel_reason = $4,
             row_version = row_version + 1,
             updated_at = NOW(),
             updated_by_identity_id = $3
         WHERE id = $1 AND billing_record_id = $2
         RETURNING ${BILLING_DOCUMENT_RETURNING}`,
        [input.billingDocumentId, input.billingRecordId, input.actorIdentityId, input.cancelReason],
      );

      await client.query(
        `INSERT INTO bil.billing_document_history_events (billing_document_id, event_type, payload, actor_identity_id)
         VALUES ($1, $2, $3::jsonb, $4)`,
        [
          input.billingDocumentId,
          BILLING_DOCUMENT_HISTORY_EVENTS.Cancelled,
          JSON.stringify({ reason: input.cancelReason }),
          input.actorIdentityId,
        ],
      );

      if (input.idempotencyKey) {
        await client.query(
          `INSERT INTO bil.billing_document_command_idempotency (
             billing_document_id, billing_record_id, command_name, idempotency_key, response_payload
           )
           VALUES ($1, $2, $3, $4, $5::jsonb)`,
          [
            input.billingDocumentId,
            input.billingRecordId,
            BILLING_DOCUMENT_COMMANDS.Cancel,
            input.idempotencyKey,
            JSON.stringify({ billingDocumentId: input.billingDocumentId }),
          ],
        );
      }

      await this.enqueueReceivableCancellation(client, input.billingDocumentId);
      await client.query('COMMIT');
      const cancelled = updated.rows[0];
      if (!cancelled) {
        throw new Error('BILLING_DOCUMENT_CANCEL_FAILED');
      }
      return { outcome: 'cancelled', billingDocument: cancelled };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

