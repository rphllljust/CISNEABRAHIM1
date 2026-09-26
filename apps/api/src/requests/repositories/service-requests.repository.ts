import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { ScopeContextRepository } from '../../authorization/repositories/scope-context.repository';
import { queryIsUnitRegistered } from '../../infrastructure/database/reference-lookups';
import { orderByCreatedAtDesc } from '../../infrastructure/database/sql';
import { isIdempotencyKeyViolation } from '../../infrastructure/database/pg-unique-violation';
import { OutboxDomainEventWriter } from '../../platform/outbox/services/outbox-domain-event.writer';
import { SERVICE_REQUEST_HISTORY_EVENTS, SERVICE_REQUEST_STATUSES } from '../domain/service-request';
import { historyEventTypeForTransition } from '../domain/service-request.state-machine';
import { insertServiceRequestHistoryEvent } from './service-request-history-rows';
import type {
  CreateServiceRequestPersistenceInput,
  ServiceRequestDocumentLinkRow,
  ServiceRequestHistoryEventRow,
  ServiceRequestRow,
  TransitionServiceRequestPersistenceInput,
  UpdateServiceRequestDraftPersistenceInput,
} from './service-requests.repository.types';

export type ServiceRequestListSummaryCounts = {
  total: number;
  pending: number;
  underReview: number;
  converted: number;
  cancelled: number;
};

function buildServiceRequestListSummarySelectSql(): string {
  const submitted = SERVICE_REQUEST_STATUSES.Submitted;
  const underReview = SERVICE_REQUEST_STATUSES.UnderReview;
  const converted = SERVICE_REQUEST_STATUSES.Converted;
  const cancelled = SERVICE_REQUEST_STATUSES.Cancelled;

  return [
    'COUNT(*)::int AS total,',
    `COUNT(*) FILTER (WHERE status = '${submitted}'::sr.service_request_status)::int AS pending,`,
    `COUNT(*) FILTER (WHERE status = '${underReview}'::sr.service_request_status)::int AS under_review,`,
    `COUNT(*) FILTER (WHERE status = '${converted}'::sr.service_request_status)::int AS converted,`,
    `COUNT(*) FILTER (WHERE status = '${cancelled}'::sr.service_request_status)::int AS cancelled`,
  ].join('\n    ');
}

function mapServiceRequestListSummaryRow(row: {
  total: number;
  pending: number;
  under_review: number;
  converted: number;
  cancelled: number;
}): ServiceRequestListSummaryCounts {
  return {
    total: row.total,
    pending: row.pending,
    underReview: row.under_review,
    converted: row.converted,
    cancelled: row.cancelled,
  };
}

const SR_SELECT = `
  SELECT
    id, request_code, unit_id, status::text AS status, origin_source::text AS origin_source,
    external_contact, external_origin_reference, client_id,
    service_definition_id, service_definition_version_id, description, location,
    desired_start_at, desired_end_at, priority::text AS priority, operational_notes,
    proposal_id, purchase_order_id, submitted_at, submitted_by_identity_id,
    review_started_at, review_started_by_identity_id, approved_at, approved_by_identity_id,
    rejected_at, rejected_by_identity_id, rejection_reason,
    cancelled_at, cancelled_by_identity_id, cancellation_reason,
    converted_at, converted_by_identity_id, converted_service_order_id,
    idempotency_key, row_version, created_at, updated_at,
    created_by_identity_id, updated_by_identity_id
  FROM sr.service_requests
`;

@Injectable()
export class ServiceRequestsRepository {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly outboxWriter: OutboxDomainEventWriter,
    private readonly scopeContextRepository: ScopeContextRepository,
  ) {}

  async registerOperationalUnit(refId: string): Promise<void> {
    await this.scopeContextRepository.ensureUnitScopeRef(refId);
  }

  async listOperationalUnits(): Promise<string[]> {
    return this.scopeContextRepository.listUnitScopeRefs();
  }

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  async isUnitRegistered(unitId: string): Promise<boolean> {
    return queryIsUnitRegistered(this.pool(), unitId);
  }

  async findClientById(clientId: string): Promise<{ id: string; status: string } | null> {
    const result = await this.pool().query<{ id: string; status: string }>(
      `SELECT id, status::text AS status FROM rpt.read_clients WHERE id = $1`,
      [clientId],
    );
    return result.rows[0] ?? null;
  }

  async findDocumentById(documentId: string): Promise<{ id: string; unit_id: string } | null> {
    const result = await this.pool().query<{ id: string; unit_id: string }>(
      `SELECT id, unit_id FROM rpt.read_documents WHERE id = $1`,
      [documentId],
    );
    return result.rows[0] ?? null;
  }

  async findProposalById(
    proposalId: string,
  ): Promise<{ id: string; unit_id: string; client_id: string } | null> {
    const result = await this.pool().query<{ id: string; unit_id: string; client_id: string }>(
      `SELECT id, unit_id, client_id FROM rpt.read_proposals WHERE id = $1`,
      [proposalId],
    );
    return result.rows[0] ?? null;
  }

  async findPurchaseOrderById(
    purchaseOrderId: string,
  ): Promise<{ id: string; unit_id: string; client_id: string; status: string } | null> {
    const result = await this.pool().query<{
      id: string;
      unit_id: string;
      client_id: string;
      status: string;
    }>(
      `SELECT id, unit_id, client_id, status::text AS status
       FROM rpt.read_purchase_orders
       WHERE id = $1`,
      [purchaseOrderId],
    );
    return result.rows[0] ?? null;
  }

  async findServiceDefinition(
    serviceDefinitionId: string,
    serviceDefinitionVersionId?: string,
  ): Promise<{ service_definition_id: string } | null> {
    const result = await this.pool().query<{ service_definition_id: string }>(
      `SELECT sd.id AS service_definition_id
       FROM cat.service_definitions sd
       INNER JOIN cat.service_definition_versions sdv ON sdv.service_definition_id = sd.id
       WHERE sd.id = $1
         AND ($2::uuid IS NULL OR sdv.id = $2::uuid)
       LIMIT 1`,
      [serviceDefinitionId, serviceDefinitionVersionId ?? null],
    );
    return result.rows[0] ?? null;
  }

  async findById(serviceRequestId: string): Promise<ServiceRequestRow | null> {
    const result = await this.pool().query<ServiceRequestRow>(
      `${SR_SELECT} WHERE id = $1`,
      [serviceRequestId],
    );
    return result.rows[0] ?? null;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<ServiceRequestRow | null> {
    const result = await this.pool().query<ServiceRequestRow>(
      `${SR_SELECT} WHERE idempotency_key = $1`,
      [idempotencyKey],
    );
    return result.rows[0] ?? null;
  }

  async listServiceRequests(
    whereClause: string,
    params: unknown[],
    limit: number,
    offset: number,
  ): Promise<ServiceRequestRow[]> {
    const result = await this.pool().query<ServiceRequestRow>(
      `${SR_SELECT}
       WHERE ${whereClause}
       ORDER BY ${orderByCreatedAtDesc()}
       LIMIT $${params.length + 1}
       OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    return result.rows;
  }

  async countListSummary(whereClause: string, params: unknown[]): Promise<ServiceRequestListSummaryCounts> {
    const selectSql = buildServiceRequestListSummarySelectSql();
    const result = await this.pool().query<{
      total: number;
      pending: number;
      under_review: number;
      converted: number;
      cancelled: number;
    }>(`SELECT ${selectSql} FROM sr.service_requests WHERE ${whereClause}`, params);
    return mapServiceRequestListSummaryRow(result.rows[0] ?? {
      total: 0,
      pending: 0,
      under_review: 0,
      converted: 0,
      cancelled: 0,
    });
  }

  async listDocumentLinks(serviceRequestId: string): Promise<ServiceRequestDocumentLinkRow[]> {
    const result = await this.pool().query<ServiceRequestDocumentLinkRow>(
      `SELECT id, service_request_id, document_id, link_purpose, created_at
       FROM sr.service_request_document_links
       WHERE service_request_id = $1
       ORDER BY created_at ASC`,
      [serviceRequestId],
    );
    return result.rows;
  }

  async listHistoryEvents(serviceRequestId: string): Promise<ServiceRequestHistoryEventRow[]> {
    const result = await this.pool().query<ServiceRequestHistoryEventRow>(
      `SELECT id, service_request_id, event_type, occurred_at, actor_identity_id, payload
       FROM sr.service_request_history_events
       WHERE service_request_id = $1
       ORDER BY occurred_at ASC, id ASC`,
      [serviceRequestId],
    );
    return result.rows;
  }

  async create(input: CreateServiceRequestPersistenceInput): Promise<ServiceRequestRow> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<ServiceRequestRow>(
      `INSERT INTO sr.service_requests (
         request_code, unit_id, origin_source, external_contact, external_origin_reference,
         client_id, service_definition_id, service_definition_version_id, description, location,
         desired_start_at, desired_end_at, operational_notes, proposal_id, purchase_order_id,
         idempotency_key, created_by_identity_id, updated_by_identity_id
       )
       VALUES (
         $1, $2, $3::sr.service_request_origin, $4, $5,
         $6, $7, $8, $9, $10,
         $11::timestamptz, $12::timestamptz, $13, $14, $15,
         $16, $17, $17
       )
       RETURNING
         id, request_code, unit_id, status::text AS status, origin_source::text AS origin_source,
         external_contact, external_origin_reference, client_id,
         service_definition_id, service_definition_version_id, description, location,
         desired_start_at, desired_end_at, priority::text AS priority, operational_notes,
         proposal_id, purchase_order_id, submitted_at, submitted_by_identity_id,
         review_started_at, review_started_by_identity_id, approved_at, approved_by_identity_id,
         rejected_at, rejected_by_identity_id, rejection_reason,
         cancelled_at, cancelled_by_identity_id, cancellation_reason,
         converted_at, converted_by_identity_id, converted_service_order_id,
         idempotency_key, row_version, created_at, updated_at,
         created_by_identity_id, updated_by_identity_id`,
      [
        input.requestCode,
        input.unitId,
        input.originSource,
        JSON.stringify(input.externalContact),
        input.externalOriginReference ?? null,
        input.clientId ?? null,
        input.serviceDefinitionId ?? null,
        input.serviceDefinitionVersionId ?? null,
        input.description ?? null,
        JSON.stringify(input.location),
        input.desiredStartAt ?? null,
        input.desiredEndAt ?? null,
        input.operationalNotes ?? null,
        input.proposalId ?? null,
        input.purchaseOrderId ?? null,
        input.idempotencyKey ?? null,
        input.actorIdentityId,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      throw new Error('SERVICE_REQUEST_CREATE_FAILED');
    }
    await insertServiceRequestHistoryEvent(client, {
      serviceRequestId: row.id,
      eventType: SERVICE_REQUEST_HISTORY_EVENTS.Created,
      actorIdentityId: input.actorIdentityId,
      payload: { status: row.status },
    });
    await client.query('COMMIT');
    return row;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateDraft(
    input: UpdateServiceRequestDraftPersistenceInput,
  ): Promise<ServiceRequestRow | 'VERSION_CONFLICT' | 'INVALID_STATE'> {
    const lock = await this.pool().query<ServiceRequestRow>(
      `${SR_SELECT} WHERE id = $1 FOR UPDATE`,
      [input.serviceRequestId],
    );
    const current = lock.rows[0];
    if (!current) {
      return 'VERSION_CONFLICT';
    }
    if (current.status !== SERVICE_REQUEST_STATUSES.Draft) {
      return 'INVALID_STATE';
    }
    if (current.row_version !== input.rowVersion) {
      return 'VERSION_CONFLICT';
    }

    const result = await this.pool().query<ServiceRequestRow>(
      `UPDATE sr.service_requests
       SET
         origin_source = COALESCE($3::sr.service_request_origin, origin_source),
         external_contact = COALESCE($4::jsonb, external_contact),
         external_origin_reference = CASE WHEN $5::text = '__UNSET__' THEN external_origin_reference WHEN $5 IS NULL THEN NULL ELSE $5 END,
         client_id = CASE WHEN $6::text = '__UNSET__' THEN client_id WHEN $6 IS NULL THEN NULL ELSE $6::uuid END,
         service_definition_id = CASE WHEN $7::text = '__UNSET__' THEN service_definition_id WHEN $7 IS NULL THEN NULL ELSE $7::uuid END,
         service_definition_version_id = CASE WHEN $8::text = '__UNSET__' THEN service_definition_version_id WHEN $8 IS NULL THEN NULL ELSE $8::uuid END,
         description = CASE WHEN $9::text = '__UNSET__' THEN description WHEN $9 IS NULL THEN NULL ELSE $9 END,
         location = COALESCE($10::jsonb, location),
         desired_start_at = CASE WHEN $11::text = '__UNSET__' THEN desired_start_at WHEN $11 IS NULL THEN NULL ELSE $11::timestamptz END,
         desired_end_at = CASE WHEN $12::text = '__UNSET__' THEN desired_end_at WHEN $12 IS NULL THEN NULL ELSE $12::timestamptz END,
         operational_notes = CASE WHEN $13::text = '__UNSET__' THEN operational_notes WHEN $13 IS NULL THEN NULL ELSE $13 END,
         proposal_id = CASE WHEN $14::text = '__UNSET__' THEN proposal_id WHEN $14 IS NULL THEN NULL ELSE $14::uuid END,
         purchase_order_id = CASE WHEN $15::text = '__UNSET__' THEN purchase_order_id WHEN $15 IS NULL THEN NULL ELSE $15::uuid END,
         updated_by_identity_id = $16,
         updated_at = NOW(),
         row_version = row_version + 1
       WHERE id = $1 AND row_version = $2
       RETURNING
         id, request_code, unit_id, status::text AS status, origin_source::text AS origin_source,
         external_contact, external_origin_reference, client_id,
         service_definition_id, service_definition_version_id, description, location,
         desired_start_at, desired_end_at, priority::text AS priority, operational_notes,
         proposal_id, purchase_order_id, submitted_at, submitted_by_identity_id,
         review_started_at, review_started_by_identity_id, approved_at, approved_by_identity_id,
         rejected_at, rejected_by_identity_id, rejection_reason,
         cancelled_at, cancelled_by_identity_id, cancellation_reason,
         converted_at, converted_by_identity_id, converted_service_order_id,
         idempotency_key, row_version, created_at, updated_at,
         created_by_identity_id, updated_by_identity_id`,
      [
        input.serviceRequestId,
        input.rowVersion,
        input.originSource ?? null,
        input.externalContact ? JSON.stringify(input.externalContact) : null,
        input.externalOriginReference === undefined ? '__UNSET__' : input.externalOriginReference,
        input.clientId === undefined ? '__UNSET__' : input.clientId,
        input.serviceDefinitionId === undefined ? '__UNSET__' : input.serviceDefinitionId,
        input.serviceDefinitionVersionId === undefined
          ? '__UNSET__'
          : input.serviceDefinitionVersionId,
        input.description === undefined ? '__UNSET__' : input.description,
        input.location ? JSON.stringify(input.location) : null,
        input.desiredStartAt === undefined ? '__UNSET__' : input.desiredStartAt,
        input.desiredEndAt === undefined ? '__UNSET__' : input.desiredEndAt,
        input.operationalNotes === undefined ? '__UNSET__' : input.operationalNotes,
        input.proposalId === undefined ? '__UNSET__' : input.proposalId,
        input.purchaseOrderId === undefined ? '__UNSET__' : input.purchaseOrderId,
        input.actorIdentityId,
      ],
    );
    return result.rows[0] ?? 'VERSION_CONFLICT';
  }

  async transition(
    input: TransitionServiceRequestPersistenceInput,
  ): Promise<ServiceRequestRow | 'VERSION_CONFLICT' | 'INVALID_STATE'> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const { transitionSql, extraParams } = this.buildTransitionSql(input);
      const params = [
        input.serviceRequestId,
        input.rowVersion,
        input.nextStatus,
        input.actorIdentityId,
        input.currentStatus,
        ...extraParams,
      ];
      const result = await client.query<ServiceRequestRow>(
        `UPDATE sr.service_requests
         SET
           status = $3::sr.service_request_status,
           ${transitionSql},
           updated_by_identity_id = $4,
           updated_at = NOW(),
           row_version = row_version + 1
         WHERE id = $1
           AND row_version = $2
           AND status = $5::sr.service_request_status
         RETURNING
           id, request_code, unit_id, status::text AS status, origin_source::text AS origin_source,
           external_contact, external_origin_reference, client_id,
           service_definition_id, service_definition_version_id, description, location,
           desired_start_at, desired_end_at, priority::text AS priority, operational_notes,
           proposal_id, purchase_order_id, submitted_at, submitted_by_identity_id,
           review_started_at, review_started_by_identity_id, approved_at, approved_by_identity_id,
           rejected_at, rejected_by_identity_id, rejection_reason,
           cancelled_at, cancelled_by_identity_id, cancellation_reason,
           converted_at, converted_by_identity_id, converted_service_order_id,
           idempotency_key, row_version, created_at, updated_at,
           created_by_identity_id, updated_by_identity_id`,
        params,
      );
      if ((result.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        const current = await this.findById(input.serviceRequestId);
        if (!current) {
          return 'VERSION_CONFLICT';
        }
        if (current.row_version !== input.rowVersion) {
          return 'VERSION_CONFLICT';
        }
        return 'INVALID_STATE';
      }
      const updated = result.rows[0]!;
      const transitionEventType =
        input.transitionField === 'convert'
          ? SERVICE_REQUEST_HISTORY_EVENTS.Converted
          : historyEventTypeForTransition(input.transitionField);
      await insertServiceRequestHistoryEvent(client, {
        serviceRequestId: updated.id,
        eventType: transitionEventType,
        actorIdentityId: input.actorIdentityId,
        payload: {
          fromStatus: input.currentStatus,
          toStatus: input.nextStatus,
          priority: input.priority ?? null,
          rejectionReason: input.rejectionReason ?? null,
          cancellationReason: input.cancellationReason ?? null,
        },
      });
      if (input.transitionField === 'submit' && updated.submitted_at) {
        await this.outboxWriter.appendServiceRequestSubmitted(client, {
          serviceRequestId: updated.id,
          unitId: updated.unit_id,
          clientId: updated.client_id,
          submittedAt: updated.submitted_at,
        });
      }
      await client.query('COMMIT');
      return updated;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async linkDocument(
    serviceRequestId: string,
    documentId: string,
    linkPurpose: string,
    actorIdentityId: string,
  ): Promise<ServiceRequestDocumentLinkRow> {
    const result = await this.pool().query<ServiceRequestDocumentLinkRow>(
      `INSERT INTO sr.service_request_document_links (
         service_request_id, document_id, link_purpose, created_by_identity_id
       )
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (service_request_id, document_id, link_purpose) DO UPDATE
         SET created_at = sr.service_request_document_links.created_at
       RETURNING id, service_request_id, document_id, link_purpose, created_at`,
      [serviceRequestId, documentId, linkPurpose, actorIdentityId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('DOCUMENT_LINK_FAILED');
    }
    return row;
  }

  isIdempotencyViolation(error: unknown): boolean {
    return isIdempotencyKeyViolation(error);
  }

  private buildTransitionSql(
    input: TransitionServiceRequestPersistenceInput,
  ): { transitionSql: string; extraParams: unknown[] } {
    switch (input.transitionField) {
      case 'submit':
        return {
          transitionSql: `submitted_at = NOW(), submitted_by_identity_id = $4`,
          extraParams: [],
        };
      case 'startReview':
        return {
          transitionSql: `review_started_at = NOW(), review_started_by_identity_id = $4`,
          extraParams: [],
        };
      case 'approve':
        return {
          transitionSql: `approved_at = NOW(), approved_by_identity_id = $4, priority = COALESCE($6::sr.service_request_priority, priority)`,
          extraParams: [input.priority ?? null],
        };
      case 'reject':
        return {
          transitionSql: `rejected_at = NOW(), rejected_by_identity_id = $4, rejection_reason = $6`,
          extraParams: [input.rejectionReason ?? null],
        };
      case 'cancel':
        return {
          transitionSql: `cancelled_at = NOW(), cancelled_by_identity_id = $4, cancellation_reason = $6`,
          extraParams: [input.cancellationReason ?? null],
        };
      case 'convert':
        return {
          transitionSql: `converted_at = NOW(), converted_by_identity_id = $4, converted_service_order_id = $6::uuid`,
          extraParams: [input.convertedServiceOrderId ?? null],
        };
      default:
        return { transitionSql: 'updated_at = NOW()', extraParams: [] };
    }
  }
}
