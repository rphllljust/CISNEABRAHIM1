import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { queryIsUnitRegistered } from '../../infrastructure/database/reference-lookups';
import { FAULT_HOOKS } from '../../platform/fault-injection/fault-hook.ids';
import { FAULT_INJECTION_PORT, type FaultInjectionPort } from '../../platform/fault-injection/fault-injection.port';
import { maybeInjectFault } from '../../platform/fault-injection/fault-injection.util';
import { OutboxDomainEventWriter } from '../../platform/outbox/services/outbox-domain-event.writer';
import { SERVICE_REQUEST_STATUSES } from '../../requests/domain/service-request';
import {
  lockServiceRequestForConversion,
  markServiceRequestAdditionalConversion,
  markServiceRequestConverted,
} from '../../requests/application/service-request-conversion.persistence';
import { SERVICE_ORDER_STATUSES } from '../domain/service-order';
import type { ServiceOrderListSqlParts } from '../domain/service-order-list.query';
import type {
  ConvertServiceRequestPersistenceInput,
  ConvertServiceRequestPersistenceResult,
  CreateServiceOrderPersistenceInput,
  ServiceOrderHistoryEventRow,
  ServiceOrderRow,
  TransitionServiceOrderPersistenceInput,
  UpdateServiceOrderPersistenceInput,
} from './service-orders.repository.types';
import type {
  ServiceSnapshotAllowedUnit,
  ServiceSnapshotExecutionRequirement,
  ServiceSnapshotLaborRequirement,
  ServiceSnapshotResourceRequirement,
  ServiceSnapshotSource,
} from '../domain/service-order-snapshot';
import {
  buildServiceOrderTransitionFields,
  historyEventForServiceOrderTransition,
  insertServiceOrderHistoryEvent,
  SERVICE_ORDER_RETURNING,
  SERVICE_ORDER_SELECT,
} from './service-orders-history-rows';
import { isServiceRequestUniqueViolation, isServiceOrderUniqueViolation } from './service-orders.repository.errors';

@Injectable()
export class ServiceOrdersRepository {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly outboxWriter: OutboxDomainEventWriter,
    @Optional() @Inject(FAULT_INJECTION_PORT) private readonly faultInjection?: FaultInjectionPort,
  ) {}

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

  async findById(serviceOrderId: string): Promise<ServiceOrderRow | null> {
    const result = await this.pool().query<ServiceOrderRow>(`${SERVICE_ORDER_SELECT} WHERE id = $1`, [
      serviceOrderId,
    ]);
    return result.rows[0] ?? null;
  }

  async findByServiceRequestId(serviceRequestId: string): Promise<ServiceOrderRow | null> {
    const result = await this.pool().query<ServiceOrderRow>(
      `${SERVICE_ORDER_SELECT} WHERE service_request_id = $1`,
      [serviceRequestId],
    );
    return result.rows[0] ?? null;
  }

  async findServiceRequestById(serviceRequestId: string): Promise<{
    service_definition_id: string | null;
    service_definition_version_id: string | null;
    client_id: string | null;
    proposal_id: string | null;
    purchase_order_id: string | null;
    origin_source: string;
    external_origin_reference: string | null;
  } | null> {
    const result = await this.pool().query<{
      service_definition_id: string | null;
      service_definition_version_id: string | null;
      client_id: string | null;
      proposal_id: string | null;
      purchase_order_id: string | null;
      origin_source: string;
      external_origin_reference: string | null;
    }>(
      `SELECT service_definition_id, service_definition_version_id, client_id, proposal_id, purchase_order_id,
              origin_source::text AS origin_source, external_origin_reference
       FROM sr.service_requests WHERE id = $1`,
      [serviceRequestId],
    );
    return result.rows[0] ?? null;
  }

  async listServiceOrders(
    parts: ServiceOrderListSqlParts,
    limit: number,
    offset: number,
  ): Promise<ServiceOrderRow[]> {
    const params = [...parts.params, limit, offset];
    const result = await this.pool().query<ServiceOrderRow>(
      `SELECT
         so.id, so.internal_code, so.order_number, so.unit_id, so.status::text AS status, so.origin::text AS origin,
         so.client_id, so.client_snapshot, so.service_definition_id, so.service_definition_version_id,
         so.service_snapshot, so.description, so.location, so.priority, so.operational_notes,
         so.service_request_id, so.proposal_id, so.proposal_snapshot, so.purchase_order_id, so.purchase_order_snapshot,
         so.rc_number, so.contract_reference, so.contract_snapshot,
         so.prepared_at, so.prepared_by_identity_id, so.released_at, so.released_by_identity_id,
         so.cancelled_at, so.cancelled_by_identity_id, so.cancellation_reason,
         so.started_at, so.started_by_identity_id, so.paused_at, so.paused_by_identity_id,
         so.completed_at, so.completed_by_identity_id,
         so.status_before_cancel, so.reopened_at, so.reopened_by_identity_id, so.reopen_reason,
         so.status_before_reopen,
         so.row_version, so.created_at, so.updated_at, so.created_by_identity_id, so.updated_by_identity_id,
         (
           SELECT wm.identity_id
           FROM res.resource_allocations ra
           INNER JOIN wrk.workforce_members wm ON wm.id = ra.workforce_member_id
           WHERE ra.service_order_id = so.id
             AND ra.status = 'ACTIVE'::res.resource_allocation_status
             AND wm.status = 'ACTIVE'::wrk.workforce_member_status
             AND wm.identity_id IS NOT NULL
           ORDER BY ra.allocated_at ASC, ra.id ASC
           LIMIT 1
         ) AS assigned_identity_id
       FROM ${parts.fromClause}
       WHERE ${parts.whereClause}
       ORDER BY ${parts.orderBy}
       LIMIT $${params.length - 1}
       OFFSET $${params.length}`,
      params,
    );
    return result.rows;
  }

  async listHistoryEvents(serviceOrderId: string): Promise<ServiceOrderHistoryEventRow[]> {
    const result = await this.pool().query<ServiceOrderHistoryEventRow>(
      `SELECT id, service_order_id, event_type, payload, actor_identity_id, occurred_at
       FROM so.service_order_history_events
       WHERE service_order_id = $1
       ORDER BY occurred_at ASC, id ASC`,
      [serviceOrderId],
    );
    return result.rows;
  }

  async findClientById(
    clientId: string,
  ): Promise<{
    id: string;
    legal_name: string;
    trade_name: string | null;
    normalized_tax_id: string;
    status: string;
    purchase_order_requirement: string;
  } | null> {
    const result = await this.pool().query<{
      id: string;
      legal_name: string;
      trade_name: string | null;
      normalized_tax_id: string;
      status: string;
      purchase_order_requirement: string;
    }>(
      `SELECT id, legal_name, trade_name, normalized_tax_id, status::text AS status,
              COALESCE(purchase_order_requirement::text, 'NOT_REQUIRED') AS purchase_order_requirement
       FROM rpt.read_clients WHERE id = $1`,
      [clientId],
    );
    return result.rows[0] ?? null;
  }

  async findProposalById(
    proposalId: string,
  ): Promise<{
    id: string;
    proposal_code: string;
    status: string;
    client_id: string;
    unit_id: string;
    pricing_structure: string | null;
    currency_code: string | null;
    global_sale_price_amount: string | null;
    global_internal_cost_amount: string | null;
    commercial_terms: Record<string, unknown> | null;
  } | null> {
    const result = await this.pool().query<{
      id: string;
      proposal_code: string;
      status: string;
      client_id: string;
      unit_id: string;
      pricing_structure: string | null;
      currency_code: string | null;
      global_sale_price_amount: string | null;
      global_internal_cost_amount: string | null;
      commercial_terms: Record<string, unknown> | null;
    }>(
      `SELECT
         p.id,
         p.proposal_code,
         COALESCE(pv.status::text, 'DRAFT') AS status,
         p.client_id,
         p.unit_id,
         pv.pricing_structure::text AS pricing_structure,
         pv.currency_code,
         pv.global_sale_price_amount::text AS global_sale_price_amount,
         pv.global_internal_cost_amount::text AS global_internal_cost_amount,
         pv.commercial_terms
       FROM rpt.read_proposals p
       LEFT JOIN rpt.read_proposal_versions pv
         ON pv.proposal_id = p.id
        AND pv.version_number = p.current_version_number
       WHERE p.id = $1`,
      [proposalId],
    );
    return result.rows[0] ?? null;
  }

  async findPurchaseOrderById(
    purchaseOrderId: string,
  ): Promise<{
    id: string;
    po_number: string;
    rc_number: string | null;
    status: string;
    client_id: string;
    unit_id: string;
    payment_terms: string | null;
    pricing_structure: string | null;
    total_amount: string | null;
    currency_code: string | null;
  } | null> {
    const result = await this.pool().query<{
      id: string;
      po_number: string;
      rc_number: string | null;
      status: string;
      client_id: string;
      unit_id: string;
      payment_terms: string | null;
      pricing_structure: string | null;
      total_amount: string | null;
      currency_code: string | null;
    }>(
      `SELECT id, po_number, rc_number, status::text AS status, client_id, unit_id,
              payment_terms, pricing_structure::text AS pricing_structure,
              total_amount::text AS total_amount, currency_code
       FROM rpt.read_purchase_orders WHERE id = $1`,
      [purchaseOrderId],
    );
    return result.rows[0] ?? null;
  }

  async findServiceSnapshotSource(
    serviceDefinitionId: string,
    serviceDefinitionVersionId?: string,
  ): Promise<ServiceSnapshotSource | null> {
    const result = await this.pool().query<ServiceSnapshotSource>(
      `SELECT
         sd.id AS service_definition_id,
         sdv.id AS service_definition_version_id,
         sd.code,
         sdv.name,
         sdv.version,
         sdv.status::text AS version_status,
         sdv.archetype::text AS archetype,
         sdv.measurement_mode::text AS measurement_mode,
         sdv.measurement_basis::text AS measurement_basis,
         sdv.default_unit_code,
         sdv.commercial_config,
         sdv.billing_entitlement_policy::text AS billing_entitlement_policy
       FROM cat.service_definitions sd
       INNER JOIN cat.service_definition_versions sdv ON sdv.service_definition_id = sd.id
       WHERE sd.id = $1
         AND ($2::uuid IS NULL OR sdv.id = $2::uuid)
       ORDER BY sdv.version DESC
       LIMIT 1`,
      [serviceDefinitionId, serviceDefinitionVersionId ?? null],
    );
    return result.rows[0] ?? null;
  }

  async loadServiceSnapshotParts(versionId: string): Promise<{
    allowedUnits: ServiceSnapshotAllowedUnit[];
    executionRequirements: ServiceSnapshotExecutionRequirement[];
    resourceRequirements: ServiceSnapshotResourceRequirement[];
    laborRequirements: ServiceSnapshotLaborRequirement[];
  }> {
    const [units, execution, resources, labor] = await Promise.all([
      this.pool().query<ServiceSnapshotAllowedUnit>(
        `SELECT unit_code, is_default, sort_order
         FROM cat.service_allowed_units
         WHERE service_definition_version_id = $1
         ORDER BY sort_order ASC, unit_code ASC`,
        [versionId],
      ),
      this.pool().query<ServiceSnapshotExecutionRequirement>(
        `SELECT evidence_kind::text AS evidence_kind,
                requirement_level::text AS requirement_level,
                config,
                sort_order
         FROM cat.service_evidence_requirements
         WHERE service_definition_version_id = $1
         ORDER BY sort_order ASC, evidence_kind ASC`,
        [versionId],
      ),
      this.pool().query<ServiceSnapshotResourceRequirement>(
        `SELECT physical_resource_type_code,
                requirement_level::text AS requirement_level,
                min_quantity::text AS min_quantity,
                sort_order
         FROM cat.service_resource_requirements
         WHERE service_definition_version_id = $1
         ORDER BY sort_order ASC, physical_resource_type_code ASC`,
        [versionId],
      ),
      this.pool().query<ServiceSnapshotLaborRequirement>(
        `SELECT labor_type_code,
                requirement_level::text AS requirement_level,
                min_quantity::text AS min_quantity,
                sort_order
         FROM cat.service_labor_requirements
         WHERE service_definition_version_id = $1
         ORDER BY sort_order ASC, labor_type_code ASC`,
        [versionId],
      ),
    ]);

    return {
      allowedUnits: units.rows,
      executionRequirements: execution.rows,
      resourceRequirements: resources.rows,
      laborRequirements: labor.rows,
    };
  }

  async create(input: CreateServiceOrderPersistenceInput): Promise<ServiceOrderRow> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const inserted = await this.insertServiceOrder(client, input);
      await client.query('COMMIT');
      return inserted;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async convertFromServiceRequest(
    input: ConvertServiceRequestPersistenceInput,
  ): Promise<ConvertServiceRequestPersistenceResult> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');

      const request = await lockServiceRequestForConversion(client, input.serviceRequestId);
      if (!request) {
        await client.query('ROLLBACK');
        return { outcome: 'version_conflict' };
      }
      if (request.row_version !== input.rowVersion) {
        await client.query('ROLLBACK');
        return { outcome: 'version_conflict' };
      }
      if (request.status === SERVICE_REQUEST_STATUSES.Converted) {
        if (!request.service_definition_id) {
          await client.query('ROLLBACK');
          return { outcome: 'invalid_state' };
        }
        const serviceOrder = await this.insertServiceOrder(client, {
          internalCode: input.internalCode,
          orderNumber: input.orderNumber,
          unitId: request.unit_id,
          origin: 'SERVICE_REQUEST',
          clientId: request.client_id,
          clientSnapshot: input.clientSnapshot,
          serviceDefinitionId: request.service_definition_id,
          serviceDefinitionVersionId: request.service_definition_version_id,
          serviceSnapshot: input.serviceSnapshot,
          description: request.description,
          location: request.location,
          priority: request.priority,
          operationalNotes: request.operational_notes,
          serviceRequestId: request.id,
          proposalId: request.proposal_id,
          proposalSnapshot: input.proposalSnapshot,
          purchaseOrderId: request.purchase_order_id,
          purchaseOrderSnapshot: input.purchaseOrderSnapshot,
          rcNumber: input.rcNumber,
          contractId: input.contractId ?? null,
          contractReference: input.contractReference ?? null,
          contractSnapshot: input.contractSnapshot ?? null,
          actorIdentityId: input.actorIdentityId,
          historyEventType: 'CONVERTED_FROM_SERVICE_REQUEST',
          historyPayload: { serviceRequestId: request.id, requestCode: request.request_code },
        });
        const updated = await markServiceRequestAdditionalConversion(client, {
          serviceRequestId: input.serviceRequestId,
          rowVersion: input.rowVersion,
          actorIdentityId: input.actorIdentityId,
          serviceOrderId: serviceOrder.id,
        });
        if (!updated) {
          await client.query('ROLLBACK');
          return { outcome: 'version_conflict' };
        }
        await client.query('COMMIT');
        return { outcome: 'converted', serviceOrder };
      }
      if (request.status !== SERVICE_REQUEST_STATUSES.Approved) {
        await client.query('ROLLBACK');
        return { outcome: 'invalid_state' };
      }
      if (!request.service_definition_id) {
        await client.query('ROLLBACK');
        return { outcome: 'invalid_state' };
      }

      const serviceOrder = await this.insertServiceOrder(client, {
        internalCode: input.internalCode,
        orderNumber: input.orderNumber,
        unitId: request.unit_id,
        origin: 'SERVICE_REQUEST',
        clientId: request.client_id,
        clientSnapshot: input.clientSnapshot,
        serviceDefinitionId: request.service_definition_id,
        serviceDefinitionVersionId: request.service_definition_version_id,
        serviceSnapshot: input.serviceSnapshot,
        description: request.description,
        location: request.location,
        priority: request.priority,
        operationalNotes: request.operational_notes,
        serviceRequestId: request.id,
        proposalId: request.proposal_id,
        proposalSnapshot: input.proposalSnapshot,
        purchaseOrderId: request.purchase_order_id,
        purchaseOrderSnapshot: input.purchaseOrderSnapshot,
        rcNumber: input.rcNumber,
        contractId: input.contractId ?? null,
        contractReference: input.contractReference ?? null,
        contractSnapshot: input.contractSnapshot ?? null,
        actorIdentityId: input.actorIdentityId,
        historyEventType: 'CONVERTED_FROM_SERVICE_REQUEST',
        historyPayload: { serviceRequestId: request.id, requestCode: request.request_code },
      });

      await maybeInjectFault(this.faultInjection, FAULT_HOOKS.ServiceRequestConvertAfterOsInsert);
      const updated = await markServiceRequestConverted(client, {
        serviceRequestId: input.serviceRequestId,
        rowVersion: input.rowVersion,
        actorIdentityId: input.actorIdentityId,
        serviceOrderId: serviceOrder.id,
      });
      if (!updated) {
        await client.query('ROLLBACK');
        return { outcome: 'version_conflict' };
      }

      await client.query('COMMIT');
      return { outcome: 'converted', serviceOrder };
    } catch (error) {
      await client.query('ROLLBACK');
      if (isServiceRequestUniqueViolation(error)) {
        const existing = await this.findByServiceRequestId(input.serviceRequestId);
        if (existing) {
          return { outcome: 'already_converted', serviceOrderId: existing.id };
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async insertServiceOrder(
    client: PoolClient,
    input: CreateServiceOrderPersistenceInput,
  ): Promise<ServiceOrderRow> {
    const result = await client.query<ServiceOrderRow>(
      `INSERT INTO so.service_orders (
         internal_code, order_number, unit_id, status, origin,
         client_id, client_snapshot, service_definition_id, service_definition_version_id,
         service_snapshot, description, location, priority, operational_notes,
         service_request_id, proposal_id, proposal_snapshot, purchase_order_id, purchase_order_snapshot,
         rc_number, contract_id, contract_reference, contract_snapshot,
         created_by_identity_id, updated_by_identity_id
       )
       VALUES (
         $1, $2, $3, $4::so.service_order_status, $5::so.service_order_origin,
         $6, $7::jsonb, $8, $9,
         $10::jsonb, $11, $12::jsonb, $13, $14,
         $15, $16, $17::jsonb, $18, $19::jsonb,
         $20, $21, $22, $23::jsonb,
         $24, $24
       )
       RETURNING ${SERVICE_ORDER_RETURNING}`,
      [
        input.internalCode,
        input.orderNumber,
        input.unitId,
        SERVICE_ORDER_STATUSES.Draft,
        input.origin,
        input.clientId ?? null,
        input.clientSnapshot ? JSON.stringify(input.clientSnapshot) : null,
        input.serviceDefinitionId ?? null,
        input.serviceDefinitionVersionId ?? null,
        JSON.stringify(input.serviceSnapshot),
        input.description ?? null,
        JSON.stringify(input.location ?? {}),
        input.priority ?? null,
        input.operationalNotes ?? null,
        input.serviceRequestId ?? null,
        input.proposalId ?? null,
        input.proposalSnapshot ? JSON.stringify(input.proposalSnapshot) : null,
        input.purchaseOrderId ?? null,
        input.purchaseOrderSnapshot ? JSON.stringify(input.purchaseOrderSnapshot) : null,
        input.rcNumber ?? null,
        input.contractId ?? null,
        input.contractReference ?? null,
        input.contractSnapshot ? JSON.stringify(input.contractSnapshot) : null,
        input.actorIdentityId,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('SERVICE_ORDER_INSERT_FAILED');
    }

    await insertServiceOrderHistoryEvent(client, {
      serviceOrderId: row.id,
      eventType: input.historyEventType,
      payload: input.historyPayload ?? { origin: input.origin },
      actorIdentityId: input.actorIdentityId,
    });

    return row;
  }

  async update(
    input: UpdateServiceOrderPersistenceInput,
  ): Promise<ServiceOrderRow | 'VERSION_CONFLICT' | 'INVALID_STATE'> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<ServiceOrderRow>(
        `${SERVICE_ORDER_SELECT} WHERE id = $1 FOR UPDATE`,
        [input.serviceOrderId],
      );
      const current = locked.rows[0];
      if (!current) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }
      if (current.row_version !== input.rowVersion) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }
      if (
        current.status !== SERVICE_ORDER_STATUSES.Draft &&
        current.status !== SERVICE_ORDER_STATUSES.Prepared
      ) {
        await client.query('ROLLBACK');
        return 'INVALID_STATE';
      }

      const result = await client.query<ServiceOrderRow>(
        `UPDATE so.service_orders
         SET
           description = CASE WHEN $4::text = '__UNSET__' THEN description WHEN $4 IS NULL THEN NULL ELSE $4 END,
           location = COALESCE($5::jsonb, location),
           priority = CASE WHEN $6::text = '__UNSET__' THEN priority WHEN $6 IS NULL THEN NULL ELSE $6 END,
           operational_notes = CASE WHEN $7::text = '__UNSET__' THEN operational_notes WHEN $7 IS NULL THEN NULL ELSE $7 END,
           client_id = CASE WHEN $8::text = '__UNSET__' THEN client_id WHEN $8 IS NULL THEN NULL ELSE $8::uuid END,
           client_snapshot = CASE WHEN $9::text = '__UNSET__' THEN client_snapshot WHEN $9 IS NULL THEN NULL ELSE $9::jsonb END,
           service_definition_id = CASE WHEN $10::text = '__UNSET__' THEN service_definition_id WHEN $10 IS NULL THEN NULL ELSE $10::uuid END,
           service_definition_version_id = CASE WHEN $11::text = '__UNSET__' THEN service_definition_version_id WHEN $11 IS NULL THEN NULL ELSE $11::uuid END,
           service_snapshot = COALESCE($12::jsonb, service_snapshot),
           proposal_id = CASE WHEN $13::text = '__UNSET__' THEN proposal_id WHEN $13 IS NULL THEN NULL ELSE $13::uuid END,
           proposal_snapshot = CASE WHEN $14::text = '__UNSET__' THEN proposal_snapshot WHEN $14 IS NULL THEN NULL ELSE $14::jsonb END,
           purchase_order_id = CASE WHEN $15::text = '__UNSET__' THEN purchase_order_id WHEN $15 IS NULL THEN NULL ELSE $15::uuid END,
           purchase_order_snapshot = CASE WHEN $16::text = '__UNSET__' THEN purchase_order_snapshot WHEN $16 IS NULL THEN NULL ELSE $16::jsonb END,
           rc_number = CASE WHEN $17::text = '__UNSET__' THEN rc_number WHEN $17 IS NULL THEN NULL ELSE $17 END,
           contract_id = CASE WHEN $20::text = '__UNSET__' THEN contract_id WHEN $20 IS NULL THEN NULL ELSE $20::uuid END,
           contract_reference = CASE WHEN $18::text = '__UNSET__' THEN contract_reference WHEN $18 IS NULL THEN NULL ELSE $18 END,
           contract_snapshot = CASE WHEN $19::text = '__UNSET__' THEN contract_snapshot WHEN $19 IS NULL THEN NULL ELSE $19::jsonb END,
           updated_by_identity_id = $3,
           updated_at = NOW(),
           row_version = row_version + 1
         WHERE id = $1 AND row_version = $2
         RETURNING ${SERVICE_ORDER_RETURNING}`,
        [
          input.serviceOrderId,
          input.rowVersion,
          input.actorIdentityId,
          input.description === undefined ? '__UNSET__' : input.description,
          input.location ? JSON.stringify(input.location) : null,
          input.priority === undefined ? '__UNSET__' : input.priority,
          input.operationalNotes === undefined ? '__UNSET__' : input.operationalNotes,
          input.clientId === undefined ? '__UNSET__' : input.clientId,
          input.clientSnapshot === undefined
            ? '__UNSET__'
            : input.clientSnapshot
              ? JSON.stringify(input.clientSnapshot)
              : null,
          input.serviceDefinitionId === undefined ? '__UNSET__' : input.serviceDefinitionId,
          input.serviceDefinitionVersionId === undefined
            ? '__UNSET__'
            : input.serviceDefinitionVersionId,
          input.serviceSnapshot ? JSON.stringify(input.serviceSnapshot) : null,
          input.proposalId === undefined ? '__UNSET__' : input.proposalId,
          input.proposalSnapshot === undefined
            ? '__UNSET__'
            : input.proposalSnapshot
              ? JSON.stringify(input.proposalSnapshot)
              : null,
          input.purchaseOrderId === undefined ? '__UNSET__' : input.purchaseOrderId,
          input.purchaseOrderSnapshot === undefined
            ? '__UNSET__'
            : input.purchaseOrderSnapshot
              ? JSON.stringify(input.purchaseOrderSnapshot)
              : null,
          input.rcNumber === undefined ? '__UNSET__' : input.rcNumber,
          input.contractReference === undefined ? '__UNSET__' : input.contractReference,
          input.contractSnapshot === undefined
            ? '__UNSET__'
            : input.contractSnapshot
              ? JSON.stringify(input.contractSnapshot)
              : null,
          input.contractId === undefined ? '__UNSET__' : input.contractId,
        ],
      );
      const updated = result.rows[0];
      if (!updated) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }

      await insertServiceOrderHistoryEvent(client, {
        serviceOrderId: updated.id,
        eventType: 'UPDATED',
        payload: {},
        actorIdentityId: input.actorIdentityId,
      });
      await client.query('COMMIT');
      return updated;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async transition(
    input: TransitionServiceOrderPersistenceInput,
  ): Promise<ServiceOrderRow | 'VERSION_CONFLICT' | 'INVALID_STATE'> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<ServiceOrderRow>(
        `${SERVICE_ORDER_SELECT} WHERE id = $1 FOR UPDATE`,
        [input.serviceOrderId],
      );
      const current = locked.rows[0];
      if (!current) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }
      if (current.row_version !== input.rowVersion) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }
      if (current.status !== input.currentStatus) {
        await client.query('ROLLBACK');
        return 'INVALID_STATE';
      }

      const transitionFields = buildServiceOrderTransitionFields(input);
      const transitionSql = transitionFields.sql.length > 0 ? `${transitionFields.sql},` : '';
      const result = await client.query<ServiceOrderRow>(
        `UPDATE so.service_orders
         SET
           status = $3::so.service_order_status,
           ${transitionSql}
           updated_by_identity_id = $4,
           updated_at = NOW(),
           row_version = row_version + 1
         WHERE id = $1
           AND row_version = $2
           AND status = $5::so.service_order_status
         RETURNING ${SERVICE_ORDER_RETURNING}`,
        [
          input.serviceOrderId,
          input.rowVersion,
          input.nextStatus,
          input.actorIdentityId,
          input.currentStatus,
          ...transitionFields.params,
        ],
      );
      const updated = result.rows[0];
      if (!updated) {
        await client.query('ROLLBACK');
        return 'INVALID_STATE';
      }

      if (input.transition === 'release') {
        await maybeInjectFault(this.faultInjection, FAULT_HOOKS.ServiceOrderReleaseAfterMutationBeforeHistory);
      }
      await insertServiceOrderHistoryEvent(client, {
        serviceOrderId: updated.id,
        eventType: historyEventForServiceOrderTransition(input.transition),
        payload: {
          fromStatus: input.currentStatus,
          toStatus: input.nextStatus,
          ...(input.cancellationReason ? { cancellationReason: input.cancellationReason } : {}),
          ...(input.reopenReason ? { reopenReason: input.reopenReason } : {}),
        },
        actorIdentityId: input.actorIdentityId,
      });
      if (input.transition === 'release') {
        await maybeInjectFault(this.faultInjection, FAULT_HOOKS.ServiceOrderReleaseAfterHistoryBeforeAudit);
      }
      if (input.transition === 'release' && updated.released_at) {
        await maybeInjectFault(this.faultInjection, FAULT_HOOKS.ServiceOrderReleaseBeforeOutbox);
        await this.outboxWriter.appendServiceOrderReleased(client, {
          serviceOrderId: updated.id,
          unitId: updated.unit_id,
          clientId: updated.client_id,
          orderNumber: updated.order_number,
          releasedAt: updated.released_at,
        });
      }
      if (input.transition === 'complete' && updated.completed_at) {
        await this.outboxWriter.appendServiceOrderCompleted(client, {
          serviceOrderId: updated.id,
          unitId: updated.unit_id,
          clientId: updated.client_id,
          orderNumber: updated.order_number,
          completedAt: updated.completed_at,
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

  isUniqueViolation(error: unknown): boolean {
    return isServiceOrderUniqueViolation(error);
  }
}
