import { Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { sumMoneyAmounts } from '../../platform/kernel/money-math';
import {
  deriveSupplierPurchaseOrderStatus,
  multiplyQuantityByUnitAmount,
  ProcurementError,
  assertOrderCanReceive,
  assertReceiptDoesNotExceed,
} from '../domain/procurement';
import {
  PROCUREMENT_FAILURE_STAGES,
  type ProcurementFailureInjection,
} from '../domain/procurement-failure-injection';
import type {
  GoodsReceiptRow,
  PurchaseRequestLineRow,
  PurchaseRequestListRow,
  PurchaseRequestRow,
  SupplierPurchaseOrderLineRow,
  SupplierPurchaseOrderListRow,
  SupplierPurchaseOrderRow,
} from '../serializers/procurement-response.serializer';

const REQUEST_RETURNING = `
  id, unit_id, requester_identity_id, justification, currency_code, status::text AS status,
  version, created_at, updated_at, submitted_at, cancelled_at, cancel_reason
`;

const SPO_RETURNING = `
  id, request_id, supplier_id, unit_id, currency_code, payment_terms, status::text AS status,
  version, issued_at, updated_at, cancelled_at, cancel_reason
`;

@Injectable()
export class ProcurementRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  async findRequestById(requestId: string): Promise<PurchaseRequestRow | null> {
    const result = await this.pool().query<PurchaseRequestRow>(
      `SELECT ${REQUEST_RETURNING} FROM prc.purchase_requests WHERE id = $1`,
      [requestId],
    );
    return result.rows[0] ?? null;
  }

  async listRequestLines(requestId: string): Promise<PurchaseRequestLineRow[]> {
    const result = await this.pool().query<PurchaseRequestLineRow>(
      `SELECT id, line_number, description, quantity::text AS quantity,
              unit_amount::text AS unit_amount, line_amount::text AS line_amount
       FROM prc.purchase_request_lines WHERE request_id = $1 ORDER BY line_number`,
      [requestId],
    );
    return result.rows;
  }

  /**
   * Página de solicitações sob o MESMO predicado da contagem. O valor da solicitação vem do
   * próprio servidor (soma das linhas persistidas), nunca de um total informado pelo navegador.
   */
  async listRequestPage(input: {
    whereClause: string;
    params: unknown[];
    limit: number;
    offset: number;
  }): Promise<PurchaseRequestListRow[]> {
    const result = await this.pool().query<PurchaseRequestListRow>(
      `SELECT r.id, r.unit_id, r.justification, r.currency_code, r.status::text AS status,
              r.version, r.created_at, r.updated_at,
              COALESCE(COUNT(l.id), 0)::text AS line_count,
              COALESCE(SUM(l.line_amount), 0)::text AS total_amount
       FROM prc.purchase_requests r
       LEFT JOIN prc.purchase_request_lines l ON l.request_id = r.id
       WHERE ${input.whereClause}
       GROUP BY r.id
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT $${input.params.length + 1}
       OFFSET $${input.params.length + 2}`,
      [...input.params, input.limit, input.offset],
    );
    return result.rows;
  }

  async countRequestList(whereClause: string, params: unknown[]): Promise<number> {
    const result = await this.pool().query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM prc.purchase_requests r WHERE ${whereClause}`,
      params,
    );
    return Number(result.rows[0]?.total ?? '0');
  }

  /**
   * Página de pedidos ao fornecedor. A consulta NÃO junta `pty.suppliers`: a fronteira do contexto
   * Comercial é atravessada pelo port, e o serviço compõe a referência humana do fornecedor depois.
   * O filtro por termo de fornecedor chega aqui já resolvido em ids (`supplierIds`).
   */
  async listOrderPage(input: {
    whereClause: string;
    params: unknown[];
    limit: number;
    offset: number;
  }): Promise<SupplierPurchaseOrderListRow[]> {
    const result = await this.pool().query<SupplierPurchaseOrderListRow>(
      `SELECT o.id, o.request_id, o.supplier_id, o.unit_id, o.currency_code, o.payment_terms,
              o.status::text AS status, o.version, o.issued_at, o.updated_at,
              COALESCE(COUNT(l.id), 0)::text AS line_count,
              COALESCE(SUM(l.line_amount), 0)::text AS total_amount,
              COALESCE(SUM(l.received_quantity), 0)::text AS received_quantity
       FROM prc.supplier_purchase_orders o
       LEFT JOIN prc.supplier_purchase_order_lines l ON l.supplier_purchase_order_id = o.id
       WHERE ${input.whereClause}
       GROUP BY o.id
       ORDER BY o.issued_at DESC, o.id DESC
       LIMIT $${input.params.length + 1}
       OFFSET $${input.params.length + 2}`,
      [...input.params, input.limit, input.offset],
    );
    return result.rows;
  }

  async countOrderList(whereClause: string, params: unknown[]): Promise<number> {
    const result = await this.pool().query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM prc.supplier_purchase_orders o WHERE ${whereClause}`,
      params,
    );
    return Number(result.rows[0]?.total ?? '0');
  }

  async findOrderById(orderId: string): Promise<SupplierPurchaseOrderRow | null> {
    const result = await this.pool().query<SupplierPurchaseOrderRow>(
      `SELECT ${SPO_RETURNING} FROM prc.supplier_purchase_orders WHERE id = $1`,
      [orderId],
    );
    return result.rows[0] ?? null;
  }

  async findOrderByRequestId(requestId: string): Promise<SupplierPurchaseOrderRow | null> {
    const result = await this.pool().query<SupplierPurchaseOrderRow>(
      `SELECT ${SPO_RETURNING} FROM prc.supplier_purchase_orders WHERE request_id = $1`,
      [requestId],
    );
    return result.rows[0] ?? null;
  }

  async listOrderLines(orderId: string): Promise<SupplierPurchaseOrderLineRow[]> {
    const result = await this.pool().query<SupplierPurchaseOrderLineRow>(
      `SELECT id, request_line_id, line_number, description,
              ordered_quantity::text AS ordered_quantity, received_quantity::text AS received_quantity,
              unit_amount::text AS unit_amount, line_amount::text AS line_amount
       FROM prc.supplier_purchase_order_lines
       WHERE supplier_purchase_order_id = $1
       ORDER BY line_number`,
      [orderId],
    );
    return result.rows;
  }

  async listReceipts(orderId: string): Promise<GoodsReceiptRow[]> {
    const result = await this.pool().query<GoodsReceiptRow>(
      `SELECT id, supplier_purchase_order_id, status::text AS status, currency_code, received_at,
              actor_identity_id, idempotency_key, payable_id
       FROM prc.goods_receipts WHERE supplier_purchase_order_id = $1 ORDER BY received_at`,
      [orderId],
    );
    return result.rows;
  }

  async createRequest(input: {
    unitId: string;
    requesterIdentityId: string;
    justification: string;
    currencyCode: string;
    lines: Array<{ description: string; quantity: string; unitAmount: string; lineAmount: string }>;
  }): Promise<PurchaseRequestRow> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const created = await client.query<PurchaseRequestRow>(
        `INSERT INTO prc.purchase_requests (unit_id, requester_identity_id, justification, currency_code)
         VALUES ($1, $2, $3, $4)
         RETURNING ${REQUEST_RETURNING}`,
        [input.unitId, input.requesterIdentityId, input.justification, input.currencyCode],
      );
      const request = created.rows[0]!;
      for (const [index, line] of input.lines.entries()) {
        await client.query(
          `INSERT INTO prc.purchase_request_lines (
             request_id, line_number, description, quantity, unit_amount, line_amount
           ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [request.id, index + 1, line.description, line.quantity, line.unitAmount, line.lineAmount],
        );
      }
      await client.query('COMMIT');
      return request;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async transitionRequest(input: {
    requestId: string;
    expectedVersion: number;
    status: string;
    submitted?: boolean;
    cancelled?: boolean;
    cancelReason?: string;
    approval?: { actorIdentityId: string; decision: 'APPROVED' | 'REJECTED'; reason?: string };
  }): Promise<PurchaseRequestRow | 'VERSION_CONFLICT' | null> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query<PurchaseRequestRow>(
        `UPDATE prc.purchase_requests
         SET status = $3::prc.purchase_request_status,
             version = version + 1,
             updated_at = NOW(),
             submitted_at = CASE WHEN $4 THEN NOW() ELSE submitted_at END,
             cancelled_at = CASE WHEN $5 THEN NOW() ELSE cancelled_at END,
             cancel_reason = CASE WHEN $5 THEN $6 ELSE cancel_reason END
         WHERE id = $1 AND version = $2
         RETURNING ${REQUEST_RETURNING}`,
        [
          input.requestId,
          input.expectedVersion,
          input.status,
          input.submitted === true,
          input.cancelled === true,
          input.cancelReason ?? null,
        ],
      );
      if (!updated.rows[0]) {
        await client.query('ROLLBACK');
        const exists = await this.findRequestById(input.requestId);
        return exists ? 'VERSION_CONFLICT' : null;
      }
      if (input.approval) {
        await client.query(
          `INSERT INTO prc.purchase_request_approvals (request_id, actor_identity_id, decision, reason)
           VALUES ($1, $2, $3::prc.approval_decision, $4)`,
          [input.requestId, input.approval.actorIdentityId, input.approval.decision, input.approval.reason ?? null],
        );
      }
      await client.query('COMMIT');
      return updated.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async issueOrder(input: {
    requestId: string;
    expectedRequestVersion: number;
    supplierId: string;
    paymentTerms: string;
  }): Promise<SupplierPurchaseOrderRow | 'VERSION_CONFLICT' | 'DUPLICATE'> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const bumped = await client.query<PurchaseRequestRow>(
        `UPDATE prc.purchase_requests
         SET version = version + 1, updated_at = NOW()
         WHERE id = $1 AND version = $2
         RETURNING ${REQUEST_RETURNING}`,
        [input.requestId, input.expectedRequestVersion],
      );
      if (!bumped.rows[0]) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }
      const request = bumped.rows[0];
      const lines = await client.query<PurchaseRequestLineRow>(
        `SELECT id, line_number, description, quantity::text AS quantity,
                unit_amount::text AS unit_amount, line_amount::text AS line_amount
         FROM prc.purchase_request_lines WHERE request_id = $1 ORDER BY line_number`,
        [input.requestId],
      );
      const issued = await client.query<SupplierPurchaseOrderRow>(
        `INSERT INTO prc.supplier_purchase_orders (
           request_id, supplier_id, unit_id, currency_code, payment_terms
         ) VALUES ($1, $2, $3, $4, $5)
         RETURNING ${SPO_RETURNING}`,
        [input.requestId, input.supplierId, request.unit_id, request.currency_code, input.paymentTerms],
      );
      const order = issued.rows[0]!;
      for (const line of lines.rows) {
        await client.query(
          `INSERT INTO prc.supplier_purchase_order_lines (
             supplier_purchase_order_id, request_line_id, line_number, description,
             ordered_quantity, unit_amount, line_amount
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            order.id,
            line.id,
            line.line_number,
            line.description,
            line.quantity,
            line.unit_amount,
            line.line_amount,
          ],
        );
      }
      await client.query('COMMIT');
      return order;
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) {
        return 'DUPLICATE';
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async cancelOrder(input: {
    orderId: string;
    expectedVersion: number;
    reason: string;
  }): Promise<SupplierPurchaseOrderRow | 'VERSION_CONFLICT' | null> {
    const updated = await this.pool().query<SupplierPurchaseOrderRow>(
      `UPDATE prc.supplier_purchase_orders
       SET status = 'CANCELLED',
           version = version + 1,
           updated_at = NOW(),
           cancelled_at = NOW(),
           cancel_reason = $3
       WHERE id = $1 AND version = $2
       RETURNING ${SPO_RETURNING}`,
      [input.orderId, input.expectedVersion, input.reason],
    );
    if (updated.rows[0]) {
      return updated.rows[0];
    }
    const exists = await this.findOrderById(input.orderId);
    return exists ? 'VERSION_CONFLICT' : null;
  }

  async receive(input: {
    orderId: string;
    expectedVersion: number;
    actorIdentityId: string;
    idempotencyKey: string;
    lines: Array<{ spoLineId: string; quantity: string }>;
    failures?: ProcurementFailureInjection;
  }): Promise<
    | { receipt: GoodsReceiptRow; order: SupplierPurchaseOrderRow; replay: boolean }
    | 'VERSION_CONFLICT'
    | null
  > {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<GoodsReceiptRow>(
        `SELECT id, supplier_purchase_order_id, status::text AS status, currency_code, received_at,
                actor_identity_id, idempotency_key, payable_id
         FROM prc.goods_receipts WHERE idempotency_key = $1 FOR UPDATE`,
        [input.idempotencyKey],
      );
      if (existing.rows[0]) {
        const order = await client.query<SupplierPurchaseOrderRow>(
          `SELECT ${SPO_RETURNING} FROM prc.supplier_purchase_orders WHERE id = $1`,
          [existing.rows[0].supplier_purchase_order_id],
        );
        await client.query('COMMIT');
        return { receipt: existing.rows[0], order: order.rows[0]!, replay: true };
      }
      const locked = await client.query<SupplierPurchaseOrderRow>(
        `SELECT ${SPO_RETURNING} FROM prc.supplier_purchase_orders WHERE id = $1 FOR UPDATE`,
        [input.orderId],
      );
      if (!locked.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }
      if (locked.rows[0].version !== input.expectedVersion) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }
      assertOrderCanReceive(locked.rows[0].status);
      const currentLines = await client.query<SupplierPurchaseOrderLineRow>(
        `SELECT id, request_line_id, line_number, description,
                ordered_quantity::text AS ordered_quantity, received_quantity::text AS received_quantity,
                unit_amount::text AS unit_amount, line_amount::text AS line_amount
         FROM prc.supplier_purchase_order_lines
         WHERE supplier_purchase_order_id = $1
         FOR UPDATE`,
        [input.orderId],
      );
      const byId = new Map(currentLines.rows.map((line) => [line.id, line]));
      const receipt = await client.query<GoodsReceiptRow>(
        `INSERT INTO prc.goods_receipts (
           supplier_purchase_order_id, currency_code, actor_identity_id, idempotency_key
         ) VALUES ($1, $2, $3, $4)
         RETURNING id, supplier_purchase_order_id, status::text AS status, currency_code, received_at,
                   actor_identity_id, idempotency_key, payable_id`,
        [input.orderId, locked.rows[0].currency_code, input.actorIdentityId, input.idempotencyKey],
      );
      for (const incoming of input.lines) {
        const line = byId.get(incoming.spoLineId);
        if (!line) {
          throw new ProcurementError('PROCUREMENT_NOT_FOUND');
        }
        assertReceiptDoesNotExceed(line.ordered_quantity, line.received_quantity, incoming.quantity);
        const lineAmount = multiplyQuantityByUnitAmount(incoming.quantity, line.unit_amount);
        await client.query(
          `INSERT INTO prc.goods_receipt_lines (receipt_id, spo_line_id, quantity, unit_amount, line_amount)
           VALUES ($1, $2, $3, $4, $5)`,
          [receipt.rows[0]!.id, line.id, incoming.quantity, line.unit_amount, lineAmount],
        );
        await client.query(
          `UPDATE prc.supplier_purchase_order_lines
           SET received_quantity = received_quantity + $2
           WHERE id = $1`,
          [line.id, incoming.quantity],
        );
      }
      const refreshed = await client.query<SupplierPurchaseOrderLineRow>(
        `SELECT ordered_quantity::text AS ordered_quantity, received_quantity::text AS received_quantity
         FROM prc.supplier_purchase_order_lines WHERE supplier_purchase_order_id = $1`,
        [input.orderId],
      );
      const orderedSum = sumMoneyAmounts(refreshed.rows.map((line) => line.ordered_quantity));
      const receivedSum = sumMoneyAmounts(refreshed.rows.map((line) => line.received_quantity));
      const nextStatus = deriveSupplierPurchaseOrderStatus(orderedSum, receivedSum);
      const updatedOrder = await client.query<SupplierPurchaseOrderRow>(
        `UPDATE prc.supplier_purchase_orders
         SET status = $3::prc.supplier_purchase_order_status,
             version = version + 1,
             updated_at = NOW()
         WHERE id = $1 AND version = $2
         RETURNING ${SPO_RETURNING}`,
        [input.orderId, input.expectedVersion, nextStatus],
      );
      if (!updatedOrder.rows[0]) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }
      input.failures?.consume(PROCUREMENT_FAILURE_STAGES.AfterReceiptInsert);
      await client.query('COMMIT');
      return { receipt: receipt.rows[0]!, order: updatedOrder.rows[0], replay: false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async receiptPrincipal(receiptId: string): Promise<string> {
    const result = await this.pool().query<{ line_amount: string }>(
      `SELECT line_amount::text AS line_amount FROM prc.goods_receipt_lines WHERE receipt_id = $1`,
      [receiptId],
    );
    return sumMoneyAmounts(result.rows.map((row) => row.line_amount));
  }

  async attachPayable(receiptId: string, payableId: string): Promise<void> {
    await this.pool().query(`UPDATE prc.goods_receipts SET payable_id = $2 WHERE id = $1 AND payable_id IS NULL`, [
      receiptId,
      payableId,
    ]);
  }

  async findValidatedInvoicePayableForOrder(orderId: string): Promise<string | null> {
    const result = await this.pool().query<{ payable_id: string }>(
      `SELECT payable_id
       FROM prc.supplier_invoices
       WHERE supplier_purchase_order_id = $1
         AND status = 'VALIDATED'
         AND payable_id IS NOT NULL
       ORDER BY validated_at NULLS LAST, created_at
       LIMIT 1`,
      [orderId],
    );
    return result.rows[0]?.payable_id ?? null;
  }

  async findReceiptById(receiptId: string): Promise<GoodsReceiptRow | null> {
    const result = await this.pool().query<GoodsReceiptRow>(
      `SELECT id, supplier_purchase_order_id, status::text AS status, currency_code, received_at,
              actor_identity_id, idempotency_key, payable_id
       FROM prc.goods_receipts WHERE id = $1`,
      [receiptId],
    );
    return result.rows[0] ?? null;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

export type { PoolClient };
