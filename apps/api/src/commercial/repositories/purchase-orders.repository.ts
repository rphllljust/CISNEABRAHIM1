import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { queryIsUnitRegistered } from '../../infrastructure/database/reference-lookups';
import { orderByCreatedAtDesc } from '../../infrastructure/database/sql';
import { compareMoneyAmounts, sumMoneyAmounts } from '../domain/money';
import {
  PURCHASE_ORDER_STATUSES,
  assertTransition,
  canEditDraft,
  type PurchaseOrderStatus,
} from '../domain/purchase-order';
import type {
  ClientSnapshotSource,
  CreatePurchaseOrderPersistenceInput,
  PurchaseOrderBillingRuleRow,
  PurchaseOrderDocumentLinkRow,
  PurchaseOrderItemRow,
  PurchaseOrderLinkedRow,
  PurchaseOrderRow,
  RegisterPurchaseOrderPersistenceInput,
  ServiceSnapshotSource,
  UpdatePurchaseOrderDraftPersistenceInput,
} from './purchase-orders.repository.types';
import {
  replacePurchaseOrderBillingRules,
  replacePurchaseOrderItems,
} from './purchase-orders-child-rows';

const PO_SELECT = `
  SELECT
    id,
    internal_code,
    client_id,
    unit_id,
    po_number,
    rc_number,
    issue_date::text AS issue_date,
    buyer_contact,
    service_manager,
    delivery_location,
    billing_location,
    currency_code,
    pricing_structure::text AS pricing_structure,
    total_amount::text AS total_amount,
    consumed_amount::text AS consumed_amount,
    COALESCE(authorized_overrun_amount, 0)::text AS authorized_overrun_amount,
    overrun_justification,
    overrun_authorized_at,
    overrun_authorized_by_identity_id,
    items_line_total_amount::text AS items_line_total_amount,
    payment_terms,
    payment_method,
    client_snapshot,
    commercial_snapshot,
    original_document_id,
    status::text AS status,
    registered_at,
    registered_by_identity_id,
    cancelled_at,
    cancelled_by_identity_id,
    cancellation_reason,
    row_version,
    created_at,
    updated_at
  FROM com.purchase_orders
`;

@Injectable()
export class PurchaseOrdersRepository {
  constructor(private readonly databaseService: DatabaseService) {}

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

  async findClientById(clientId: string): Promise<ClientSnapshotSource | null> {
    const result = await this.pool().query<ClientSnapshotSource>(
      `SELECT id, legal_name, trade_name, normalized_tax_id, status::text AS status
       FROM pty.clients WHERE id = $1`,
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

  async findServiceSnapshot(
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
         sdv.status::text AS version_status
       FROM rpt.read_service_definitions sd
       INNER JOIN rpt.read_service_definition_versions sdv ON sdv.service_definition_id = sd.id
       WHERE sd.id = $1
         AND ($2::uuid IS NULL OR sdv.id = $2::uuid)
       ORDER BY sdv.version DESC
       LIMIT 1`,
      [serviceDefinitionId, serviceDefinitionVersionId ?? null],
    );
    return result.rows[0] ?? null;
  }

  async findById(purchaseOrderId: string): Promise<PurchaseOrderRow | null> {
    const result = await this.pool().query<PurchaseOrderRow>(
      `${PO_SELECT} WHERE id = $1`,
      [purchaseOrderId],
    );
    return result.rows[0] ?? null;
  }

  async listPurchaseOrders(
    whereClause: string,
    params: unknown[],
    limit: number,
    offset: number,
  ): Promise<PurchaseOrderRow[]> {
    const result = await this.pool().query<PurchaseOrderRow>(
      `${PO_SELECT}
       WHERE ${whereClause}
       ORDER BY ${orderByCreatedAtDesc()}
       LIMIT $${params.length + 1}
       OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    return result.rows;
  }

  async listItems(purchaseOrderId: string): Promise<PurchaseOrderItemRow[]> {
    const result = await this.pool().query<PurchaseOrderItemRow>(
      `SELECT
         id,
         purchase_order_id,
         line_number,
         description,
         service_definition_id,
         service_definition_version_id,
         service_snapshot,
         commercial_snapshot,
         quantity::text AS quantity,
         unit_code,
         unit_price_amount::text AS unit_price_amount,
         line_total_amount::text AS line_total_amount,
         rc_line_reference
       FROM com.purchase_order_items
       WHERE purchase_order_id = $1
       ORDER BY line_number ASC`,
      [purchaseOrderId],
    );
    return result.rows;
  }

  async listBillingRules(purchaseOrderId: string): Promise<PurchaseOrderBillingRuleRow[]> {
    const result = await this.pool().query<PurchaseOrderBillingRuleRow>(
      `SELECT id, purchase_order_id, rule_type::text AS rule_type, rule_config, precedence_tier, created_at
       FROM com.purchase_order_billing_rules
       WHERE purchase_order_id = $1
       ORDER BY created_at ASC`,
      [purchaseOrderId],
    );
    return result.rows;
  }

  async listDocumentLinks(purchaseOrderId: string): Promise<PurchaseOrderDocumentLinkRow[]> {
    const result = await this.pool().query<PurchaseOrderDocumentLinkRow>(
      `SELECT id, purchase_order_id, document_id, link_purpose, created_at
       FROM com.purchase_order_document_links
       WHERE purchase_order_id = $1
       ORDER BY created_at ASC`,
      [purchaseOrderId],
    );
    return result.rows;
  }

  async createPurchaseOrder(input: CreatePurchaseOrderPersistenceInput): Promise<{
    purchaseOrder: PurchaseOrderRow;
    items: PurchaseOrderItemRow[];
    billingRules: PurchaseOrderBillingRuleRow[];
  }> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');

      const poResult = await client.query<PurchaseOrderRow>(
        `INSERT INTO com.purchase_orders (
           internal_code, client_id, unit_id, po_number, rc_number, issue_date,
           buyer_contact, service_manager, delivery_location, billing_location,
           currency_code, pricing_structure, total_amount, payment_terms, payment_method,
           original_document_id, created_by_identity_id, updated_by_identity_id
         )
         VALUES (
           $1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10,
           $11, $12::com.purchase_order_pricing_structure, $13, $14, $15, $16, $17, $17
         )
         RETURNING
           id, internal_code, client_id, unit_id, po_number, rc_number,
           issue_date::text AS issue_date, buyer_contact, service_manager,
           delivery_location, billing_location, currency_code,
           pricing_structure::text AS pricing_structure,
           total_amount::text AS total_amount, consumed_amount::text AS consumed_amount,
           COALESCE(authorized_overrun_amount, 0)::text AS authorized_overrun_amount,
           overrun_justification, overrun_authorized_at, overrun_authorized_by_identity_id,
           items_line_total_amount::text AS items_line_total_amount,
           payment_terms, payment_method,
           client_snapshot, commercial_snapshot, original_document_id, status::text AS status,
           registered_at, registered_by_identity_id, cancelled_at,
           cancelled_by_identity_id, cancellation_reason, row_version, created_at, updated_at`,
        [
          input.internalCode,
          input.clientId,
          input.unitId,
          input.poNumber,
          input.rcNumber ?? null,
          input.issueDate ?? null,
          JSON.stringify(input.buyerContact),
          input.serviceManager ?? null,
          JSON.stringify(input.deliveryLocation),
          JSON.stringify(input.billingLocation),
          input.currencyCode,
          input.pricingStructure,
          input.totalAmount ?? null,
          input.paymentTerms ?? null,
          input.paymentMethod ?? null,
          input.originalDocumentId ?? null,
          input.actorIdentityId,
        ],
      );
      const purchaseOrder = poResult.rows[0];
      if (!purchaseOrder) {
        throw new Error('PURCHASE_ORDER_CREATE_FAILED');
      }

      const items = await replacePurchaseOrderItems(client, purchaseOrder.id, input.items);
      const billingRules = await replacePurchaseOrderBillingRules(
        client,
        purchaseOrder.id,
        input.billingRules,
        input.actorIdentityId,
      );

      await client.query('COMMIT');
      return { purchaseOrder, items, billingRules };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateDraft(
    input: UpdatePurchaseOrderDraftPersistenceInput,
  ): Promise<
    | { purchaseOrder: PurchaseOrderRow; items: PurchaseOrderItemRow[]; billingRules: PurchaseOrderBillingRuleRow[] }
    | 'VERSION_CONFLICT'
    | 'INVALID_STATE'
  > {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');

      const lock = await client.query<PurchaseOrderRow>(
        `${PO_SELECT} WHERE id = $1 FOR UPDATE`,
        [input.purchaseOrderId],
      );
      const current = lock.rows[0];
      if (!current) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }
      if (!canEditDraft(current.status as PurchaseOrderStatus)) {
        await client.query('ROLLBACK');
        return 'INVALID_STATE';
      }
      if (current.row_version !== input.rowVersion) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }

      await client.query(
        `UPDATE com.purchase_orders
         SET
           po_number = COALESCE($3, po_number),
           rc_number = CASE WHEN $4::text = '__UNSET__' THEN rc_number WHEN $4 IS NULL THEN NULL ELSE $4 END,
           issue_date = CASE WHEN $5::text = '__UNSET__' THEN issue_date WHEN $5 IS NULL THEN NULL ELSE $5::date END,
           buyer_contact = COALESCE($6::jsonb, buyer_contact),
           service_manager = CASE WHEN $7::text = '__UNSET__' THEN service_manager WHEN $7 IS NULL THEN NULL ELSE $7 END,
           delivery_location = COALESCE($8::jsonb, delivery_location),
           billing_location = COALESCE($9::jsonb, billing_location),
           currency_code = COALESCE($10, currency_code),
           pricing_structure = COALESCE($11::com.purchase_order_pricing_structure, pricing_structure),
           total_amount = CASE WHEN $12::text = '__UNSET__' THEN total_amount WHEN $12 IS NULL THEN NULL ELSE $12::numeric END,
           payment_terms = CASE WHEN $13::text = '__UNSET__' THEN payment_terms WHEN $13 IS NULL THEN NULL ELSE $13 END,
           payment_method = CASE WHEN $14::text = '__UNSET__' THEN payment_method WHEN $14 IS NULL THEN NULL ELSE $14 END,
           original_document_id = CASE WHEN $15::text = '__UNSET__' THEN original_document_id WHEN $15 IS NULL THEN NULL ELSE $15::uuid END,
           updated_by_identity_id = $16,
           updated_at = NOW(),
           row_version = row_version + 1
         WHERE id = $1 AND row_version = $2`,
        [
          input.purchaseOrderId,
          input.rowVersion,
          input.poNumber ?? null,
          input.rcNumber === undefined ? '__UNSET__' : input.rcNumber,
          input.issueDate === undefined ? '__UNSET__' : input.issueDate,
          input.buyerContact ? JSON.stringify(input.buyerContact) : null,
          input.serviceManager === undefined ? '__UNSET__' : input.serviceManager,
          input.deliveryLocation ? JSON.stringify(input.deliveryLocation) : null,
          input.billingLocation ? JSON.stringify(input.billingLocation) : null,
          input.currencyCode ?? null,
          input.pricingStructure ?? null,
          input.totalAmount === undefined ? '__UNSET__' : input.totalAmount,
          input.paymentTerms === undefined ? '__UNSET__' : input.paymentTerms,
          input.paymentMethod === undefined ? '__UNSET__' : input.paymentMethod,
          input.originalDocumentId === undefined ? '__UNSET__' : input.originalDocumentId,
          input.actorIdentityId,
        ],
      );

      let items: PurchaseOrderItemRow[];
      if (input.items) {
        items = await replacePurchaseOrderItems(client, input.purchaseOrderId, input.items);
      } else {
        items = await this.listItems(input.purchaseOrderId);
      }

      let billingRules: PurchaseOrderBillingRuleRow[];
      if (input.billingRules) {
        billingRules = await replacePurchaseOrderBillingRules(
          client,
          input.purchaseOrderId,
          input.billingRules,
          input.actorIdentityId,
        );
      } else {
        billingRules = await this.listBillingRules(input.purchaseOrderId);
      }

      await client.query('COMMIT');

      const purchaseOrder = await this.findById(input.purchaseOrderId);
      if (!purchaseOrder) {
        throw new Error('PURCHASE_ORDER_LOAD_FAILED');
      }
      return { purchaseOrder, items, billingRules };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async register(
    input: RegisterPurchaseOrderPersistenceInput,
  ): Promise<PurchaseOrderRow | 'VERSION_CONFLICT' | 'INVALID_STATE'> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');

      const lock = await client.query<PurchaseOrderRow>(
        `${PO_SELECT} WHERE id = $1 FOR UPDATE`,
        [input.purchaseOrderId],
      );
      const current = lock.rows[0];
      if (!current) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }
      if (!canEditDraft(current.status as PurchaseOrderStatus)) {
        await client.query('ROLLBACK');
        return 'INVALID_STATE';
      }
      if (current.row_version !== input.rowVersion) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }
      try {
        assertTransition(current.status as PurchaseOrderStatus, PURCHASE_ORDER_STATUSES.Registered);
      } catch {
        await client.query('ROLLBACK');
        return 'INVALID_STATE';
      }

      for (const snapshot of input.itemSnapshots) {
        await client.query(
          `UPDATE com.purchase_order_items
           SET
             service_snapshot = COALESCE($3::jsonb, service_snapshot),
             commercial_snapshot = $4::jsonb
           WHERE purchase_order_id = $1 AND line_number = $2`,
          [
            input.purchaseOrderId,
            snapshot.lineNumber,
            snapshot.serviceSnapshot ? JSON.stringify(snapshot.serviceSnapshot) : null,
            JSON.stringify(snapshot.commercialSnapshot),
          ],
        );
      }

      const result = await client.query<PurchaseOrderRow>(
        `UPDATE com.purchase_orders
         SET
           status = 'REGISTERED'::com.purchase_order_status,
           client_snapshot = $3::jsonb,
           commercial_snapshot = $4::jsonb,
           items_line_total_amount = $5::numeric,
           registered_at = NOW(),
           registered_by_identity_id = $6,
           updated_by_identity_id = $6,
           updated_at = NOW(),
           row_version = row_version + 1
         WHERE id = $1 AND row_version = $2
         RETURNING
           id, internal_code, client_id, unit_id, po_number, rc_number,
           issue_date::text AS issue_date, buyer_contact, service_manager,
           delivery_location, billing_location, currency_code,
           pricing_structure::text AS pricing_structure,
           total_amount::text AS total_amount, consumed_amount::text AS consumed_amount,
           COALESCE(authorized_overrun_amount, 0)::text AS authorized_overrun_amount,
           overrun_justification, overrun_authorized_at, overrun_authorized_by_identity_id,
           items_line_total_amount::text AS items_line_total_amount,
           payment_terms, payment_method,
           client_snapshot, commercial_snapshot, original_document_id, status::text AS status,
           registered_at, registered_by_identity_id, cancelled_at,
           cancelled_by_identity_id, cancellation_reason, row_version, created_at, updated_at`,
        [
          input.purchaseOrderId,
          input.rowVersion,
          JSON.stringify(input.clientSnapshot),
          JSON.stringify(input.commercialSnapshot),
          input.itemsLineTotal,
          input.actorIdentityId,
        ],
      );

      await client.query('COMMIT');
      return result.rows[0] ?? 'VERSION_CONFLICT';
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Cadeia relacionada do pedido de compra, em UMA consulta.
   *
   * As relacoes JA existem no dominio: `rpt.read_service_requests.purchase_order_id`,
   * `rpt.read_service_orders.purchase_order_id` e, por intermedio da OS,
   * `rpt.read_measurements` / `rpt.read_billing_records` / `rpt.read_billing_documents`.
   * Isto e leitura pura: nenhuma tabela, coluna, regra ou transicao nova. Serve para explicar
   * de onde vem o valor consumido do pedido.
   */
  async findLinkedChain(purchaseOrderId: string): Promise<PurchaseOrderLinkedRow[]> {
    const result = await this.pool().query<PurchaseOrderLinkedRow>(
      `SELECT 'REQUEST' AS kind, id::text AS id, request_code AS label, status::text AS status,
              NULL::text AS amount, NULL::text AS currency_code,
              created_at::text AS occurred_at, NULL::text AS parent_id
         FROM rpt.read_service_requests
        WHERE purchase_order_id = $1
        UNION ALL
       SELECT 'SERVICE_ORDER', id::text, order_number, status::text,
              NULL::text, NULL::text, created_at::text, NULL::text
         FROM rpt.read_service_orders
        WHERE purchase_order_id = $1
        UNION ALL
       SELECT 'MEASUREMENT', m.id::text, so.order_number, m.status::text,
              NULL::text, NULL::text, m.created_at::text, m.service_order_id::text
         FROM rpt.read_measurements m
         INNER JOIN rpt.read_service_orders so ON so.id = m.service_order_id
        WHERE so.purchase_order_id = $1
        UNION ALL
       SELECT 'BILLING_RECORD', id::text, 'Registro de faturamento', status::text,
              total_amount::text, currency_code, created_at::text, service_order_id::text
         FROM rpt.read_billing_records
        WHERE purchase_order_id = $1
        UNION ALL
       SELECT 'BILLING_DOCUMENT', id::text, COALESCE(document_number::text, 'Documento de faturamento'),
              status::text, total_amount::text, currency_code, created_at::text, service_order_id::text
         FROM rpt.read_billing_documents
        WHERE purchase_order_id = $1
        ORDER BY occurred_at ASC`,
      [purchaseOrderId],
    );
    return result.rows;
  }

  async hasBlockingReferences(purchaseOrderId: string): Promise<boolean> {
    const result = await this.pool().query<{ blocked: boolean }>(
      `SELECT (
         EXISTS (
           SELECT 1
           FROM rpt.read_service_requests
           WHERE purchase_order_id = $1
             AND status NOT IN ('CANCELLED', 'REJECTED')
         )
         OR EXISTS (
           SELECT 1
           FROM rpt.read_service_orders
           WHERE purchase_order_id = $1
             AND status <> 'CANCELLED'
         )
         OR EXISTS (
           SELECT 1
           FROM rpt.read_billing_records
           WHERE purchase_order_id = $1
             AND status = 'PREPARED'
         )
         OR EXISTS (
           SELECT 1
           FROM rpt.read_billing_documents
           WHERE purchase_order_id = $1
             AND status = 'FINALIZED'
         )
         OR EXISTS (
           SELECT 1
           FROM rpt.read_measurements m
           INNER JOIN rpt.read_service_orders so ON so.id = m.service_order_id
           WHERE so.purchase_order_id = $1
         )
         OR COALESCE((
           SELECT consumed_amount
           FROM com.purchase_orders
           WHERE id = $1
         ), 0) > 0
       ) AS blocked`,
      [purchaseOrderId],
    );
    return result.rows[0]?.blocked === true;
  }

  async cancel(
    purchaseOrderId: string,
    rowVersion: number,
    actorIdentityId: string,
    cancellationReason?: string,
  ): Promise<PurchaseOrderRow | 'VERSION_CONFLICT' | 'INVALID_STATE'> {
    const result = await this.pool().query<PurchaseOrderRow>(
      `UPDATE com.purchase_orders
       SET
         status = 'CANCELLED'::com.purchase_order_status,
         cancelled_at = NOW(),
         cancelled_by_identity_id = $3,
         cancellation_reason = $4,
         updated_by_identity_id = $3,
         updated_at = NOW(),
         row_version = row_version + 1
       WHERE id = $1
         AND row_version = $2
         AND status IN ('DRAFT'::com.purchase_order_status, 'REGISTERED'::com.purchase_order_status)
       RETURNING
         id, internal_code, client_id, unit_id, po_number, rc_number,
         issue_date::text AS issue_date, buyer_contact, service_manager,
         delivery_location, billing_location, currency_code,
         pricing_structure::text AS pricing_structure,
         total_amount::text AS total_amount, consumed_amount::text AS consumed_amount,
         COALESCE(authorized_overrun_amount, 0)::text AS authorized_overrun_amount,
         overrun_justification, overrun_authorized_at, overrun_authorized_by_identity_id,
         items_line_total_amount::text AS items_line_total_amount,
         payment_terms, payment_method,
         client_snapshot, commercial_snapshot, original_document_id, status::text AS status,
         registered_at, registered_by_identity_id, cancelled_at,
         cancelled_by_identity_id, cancellation_reason, row_version, created_at, updated_at`,
      [purchaseOrderId, rowVersion, actorIdentityId, cancellationReason ?? null],
    );
    if ((result.rowCount ?? 0) === 0) {
      const current = await this.findById(purchaseOrderId);
      if (!current) {
        return 'VERSION_CONFLICT';
      }
      if (current.status === PURCHASE_ORDER_STATUSES.Cancelled) {
        return 'INVALID_STATE';
      }
      return current.row_version !== rowVersion ? 'VERSION_CONFLICT' : 'INVALID_STATE';
    }
    return result.rows[0]!;
  }

  async authorizeOverrun(input: {
    purchaseOrderId: string;
    rowVersion: number;
    amount: string;
    justification: string;
    actorIdentityId: string;
  }): Promise<PurchaseOrderRow | 'VERSION_CONFLICT' | 'INVALID_STATE'> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<{
        total_amount: string;
        consumed_amount: string;
        authorized_overrun_amount: string | null;
        status: string;
        row_version: number;
      }>(
        `SELECT total_amount::text AS total_amount,
                consumed_amount::text AS consumed_amount,
                authorized_overrun_amount::text AS authorized_overrun_amount,
                status::text AS status,
                row_version
         FROM com.purchase_orders
         WHERE id = $1
         FOR UPDATE`,
        [input.purchaseOrderId],
      );
      const current = locked.rows[0];
      if (!current || current.row_version !== input.rowVersion) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }
      if (current.status !== 'REGISTERED') {
        await client.query('ROLLBACK');
        return 'INVALID_STATE';
      }

      // O overrun é substituído (a autorização mais recente vence), mas o novo
      // teto (total + overrun autorizado) nunca pode ficar abaixo do valor já
      // consumido — reautorização menor não pode deixar saldo disponível negativo.
      const newCeiling = sumMoneyAmounts([current.total_amount, input.amount]);
      if (compareMoneyAmounts(current.consumed_amount, newCeiling) > 0) {
        await client.query('ROLLBACK');
        return 'INVALID_STATE';
      }

      const result = await client.query<PurchaseOrderRow>(
        `UPDATE com.purchase_orders
         SET
           authorized_overrun_amount = $3::numeric,
           overrun_justification = $4,
           overrun_authorized_at = NOW(),
           overrun_authorized_by_identity_id = $5,
           updated_by_identity_id = $5,
           updated_at = NOW(),
           row_version = row_version + 1
         WHERE id = $1
           AND row_version = $2
           AND status = 'REGISTERED'::com.purchase_order_status
         RETURNING
           id, internal_code, client_id, unit_id, po_number, rc_number,
           issue_date::text AS issue_date, buyer_contact, service_manager,
           delivery_location, billing_location, currency_code,
           pricing_structure::text AS pricing_structure,
           total_amount::text AS total_amount, consumed_amount::text AS consumed_amount,
           COALESCE(authorized_overrun_amount, 0)::text AS authorized_overrun_amount,
           overrun_justification, overrun_authorized_at, overrun_authorized_by_identity_id,
           items_line_total_amount::text AS items_line_total_amount,
           payment_terms, payment_method,
           client_snapshot, commercial_snapshot, original_document_id, status::text AS status,
           registered_at, registered_by_identity_id, cancelled_at,
           cancelled_by_identity_id, cancellation_reason, row_version, created_at, updated_at`,
        [
          input.purchaseOrderId,
          input.rowVersion,
          input.amount,
          input.justification,
          input.actorIdentityId,
        ],
      );
      if ((result.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }
      await client.query('COMMIT');
      return result.rows[0]!;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async linkDocument(
    purchaseOrderId: string,
    documentId: string,
    linkPurpose: string,
    actorIdentityId: string,
  ): Promise<PurchaseOrderDocumentLinkRow> {
    const result = await this.pool().query<PurchaseOrderDocumentLinkRow>(
      `INSERT INTO com.purchase_order_document_links (
         purchase_order_id, document_id, link_purpose, created_by_identity_id
       )
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (purchase_order_id, document_id, link_purpose) DO UPDATE
         SET created_at = com.purchase_order_document_links.created_at
       RETURNING id, purchase_order_id, document_id, link_purpose, created_at`,
      [purchaseOrderId, documentId, linkPurpose, actorIdentityId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('DOCUMENT_LINK_FAILED');
    }
    return row;
  }
}
