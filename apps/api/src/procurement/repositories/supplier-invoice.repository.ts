import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { sumMoneyAmounts } from '../../platform/kernel/money-math';
import { ProcurementError } from '../domain/procurement';
import {
  PROCUREMENT_FAILURE_STAGES,
  type ProcurementFailureInjection,
} from '../domain/procurement-failure-injection';
import {
  assertInvoiceAmountMatches,
  assertInvoiceCanValidate,
  assertInvoiceMatchesRelatedCurrency,
  assertInvoiceMatchesRelatedSupplier,
  assertInvoiceMatchesRelatedUnit,
} from '../domain/supplier-invoice';
import type { GoodsReceiptRow, SupplierPurchaseOrderRow } from '../serializers/procurement-response.serializer';
import type { SupplierInvoiceRow, SupplierInvoiceListRow } from '../serializers/supplier-invoice-response.serializer';

const INVOICE_RETURNING = `
  id, unit_id, supplier_id, invoice_number, issued_on::text AS issued_on, due_date::text AS due_date,
  currency_code, total_amount::text AS total_amount, payment_terms,
  supplier_purchase_order_id, goods_receipt_id, payable_id,
  status::text AS status, version, idempotency_key, created_at, updated_at, validated_at
`;

const SPO_RETURNING = `
  id, request_id, supplier_id, unit_id, currency_code, payment_terms, status::text AS status,
  version, issued_at, updated_at, cancelled_at, cancel_reason
`;

export type PreparedInvoiceValidation =
  | { kind: 'REPLAY'; invoice: SupplierInvoiceRow }
  | { kind: 'ATTACH_EXISTING'; invoice: SupplierInvoiceRow }
  | { kind: 'OPEN_NEW'; invoice: SupplierInvoiceRow };

@Injectable()
export class SupplierInvoiceRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  async findById(invoiceId: string): Promise<SupplierInvoiceRow | null> {
    const result = await this.pool().query<SupplierInvoiceRow>(
      `SELECT ${INVOICE_RETURNING} FROM prc.supplier_invoices WHERE id = $1`,
      [invoiceId],
    );
    return result.rows[0] ?? null;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<SupplierInvoiceRow | null> {
    const result = await this.pool().query<SupplierInvoiceRow>(
      `SELECT ${INVOICE_RETURNING} FROM prc.supplier_invoices WHERE idempotency_key = $1`,
      [idempotencyKey],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Página de notas sob o MESMO predicado da contagem. A consulta NÃO junta `pty.suppliers`: a
   * referência humana do fornecedor é composta pelo serviço, via port, depois da leitura. O filtro
   * por termo de fornecedor chega aqui já resolvido em ids (`supplierIds`).
   */
  async listPage(input: {
    whereClause: string;
    params: unknown[];
    limit: number;
    offset: number;
  }): Promise<SupplierInvoiceListRow[]> {
    const result = await this.pool().query<SupplierInvoiceListRow>(
      `SELECT i.id, i.unit_id, i.supplier_id, i.invoice_number, i.issued_on::text AS issued_on,
              i.due_date::text AS due_date, i.currency_code, i.total_amount::text AS total_amount,
              i.status::text AS status, i.version, i.payable_id, i.supplier_purchase_order_id,
              i.created_at
       FROM prc.supplier_invoices i
       WHERE ${input.whereClause}
       ORDER BY i.created_at DESC, i.id DESC
       LIMIT $${input.params.length + 1}
       OFFSET $${input.params.length + 2}`,
      [...input.params, input.limit, input.offset],
    );
    return result.rows;
  }

  async countList(whereClause: string, params: unknown[]): Promise<number> {
    const result = await this.pool().query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM prc.supplier_invoices i WHERE ${whereClause}`,
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

  async findReceiptById(receiptId: string): Promise<GoodsReceiptRow | null> {
    const result = await this.pool().query<GoodsReceiptRow>(
      `SELECT id, supplier_purchase_order_id, status::text AS status, currency_code, received_at,
              actor_identity_id, idempotency_key, payable_id
       FROM prc.goods_receipts WHERE id = $1`,
      [receiptId],
    );
    return result.rows[0] ?? null;
  }

  async orderPrincipal(orderId: string): Promise<string> {
    const result = await this.pool().query<{ line_amount: string }>(
      `SELECT line_amount::text AS line_amount
       FROM prc.supplier_purchase_order_lines
       WHERE supplier_purchase_order_id = $1`,
      [orderId],
    );
    return sumMoneyAmounts(result.rows.map((row) => row.line_amount));
  }

  async receiptPrincipal(receiptId: string): Promise<string> {
    const result = await this.pool().query<{ line_amount: string }>(
      `SELECT line_amount::text AS line_amount FROM prc.goods_receipt_lines WHERE receipt_id = $1`,
      [receiptId],
    );
    return sumMoneyAmounts(result.rows.map((row) => row.line_amount));
  }

  async create(input: {
    unitId: string;
    supplierId: string;
    invoiceNumber: string;
    issuedOn: string;
    dueDate: string;
    currencyCode: string;
    totalAmount: string;
    paymentTerms: string;
    supplierPurchaseOrderId: string | null;
    goodsReceiptId: string | null;
    idempotencyKey: string;
  }): Promise<SupplierInvoiceRow> {
    try {
      const created = await this.pool().query<SupplierInvoiceRow>(
        `INSERT INTO prc.supplier_invoices (
           unit_id, supplier_id, invoice_number, issued_on, due_date, currency_code,
           total_amount, payment_terms, supplier_purchase_order_id, goods_receipt_id, idempotency_key
         ) VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, $10, $11)
         RETURNING ${INVOICE_RETURNING}`,
        [
          input.unitId,
          input.supplierId,
          input.invoiceNumber,
          input.issuedOn,
          input.dueDate,
          input.currencyCode,
          input.totalAmount,
          input.paymentTerms,
          input.supplierPurchaseOrderId,
          input.goodsReceiptId,
          input.idempotencyKey,
        ],
      );
      return created.rows[0]!;
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await this.findByIdempotencyKey(input.idempotencyKey);
        if (existing) {
          return existing;
        }
        throw new ProcurementError('SUPPLIER_INVOICE_DUPLICATE');
      }
      throw error;
    }
  }

  async prepareValidation(input: {
    invoiceId: string;
    expectedVersion: number;
    failures?: ProcurementFailureInjection;
  }): Promise<PreparedInvoiceValidation | 'VERSION_CONFLICT' | null> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<SupplierInvoiceRow>(
        `SELECT ${INVOICE_RETURNING} FROM prc.supplier_invoices WHERE id = $1 FOR UPDATE`,
        [input.invoiceId],
      );
      const invoice = locked.rows[0];
      if (!invoice) {
        await client.query('ROLLBACK');
        return null;
      }
      if (invoice.version !== input.expectedVersion) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }
      if (invoice.status === 'VALIDATED' && invoice.payable_id) {
        await client.query('COMMIT');
        return { kind: 'REPLAY', invoice };
      }
      assertInvoiceCanValidate(invoice.status);

      let expectedAmount: string | null = null;
      let receiptPayableId: string | null = null;
      if (invoice.goods_receipt_id) {
        const receipt = await client.query<GoodsReceiptRow>(
          `SELECT id, supplier_purchase_order_id, status::text AS status, currency_code, received_at,
                  actor_identity_id, idempotency_key, payable_id
           FROM prc.goods_receipts WHERE id = $1 FOR UPDATE`,
          [invoice.goods_receipt_id],
        );
        if (!receipt.rows[0]) {
          throw new ProcurementError('PROCUREMENT_NOT_FOUND');
        }
        if (
          invoice.supplier_purchase_order_id &&
          receipt.rows[0].supplier_purchase_order_id !== invoice.supplier_purchase_order_id
        ) {
          throw new ProcurementError('PROCUREMENT_INVALID');
        }
        const order = await client.query<SupplierPurchaseOrderRow>(
          `SELECT ${SPO_RETURNING} FROM prc.supplier_purchase_orders WHERE id = $1 FOR UPDATE`,
          [receipt.rows[0].supplier_purchase_order_id],
        );
        if (!order.rows[0]) {
          throw new ProcurementError('PROCUREMENT_NOT_FOUND');
        }
        assertInvoiceMatchesRelatedSupplier(invoice.supplier_id, order.rows[0].supplier_id);
        assertInvoiceMatchesRelatedUnit(invoice.unit_id, order.rows[0].unit_id);
        assertInvoiceMatchesRelatedCurrency(invoice.currency_code, receipt.rows[0].currency_code);
        const lines = await client.query<{ line_amount: string }>(
          `SELECT line_amount::text AS line_amount FROM prc.goods_receipt_lines WHERE receipt_id = $1`,
          [invoice.goods_receipt_id],
        );
        expectedAmount = sumMoneyAmounts(lines.rows.map((row) => row.line_amount));
        receiptPayableId = receipt.rows[0].payable_id;
      } else if (invoice.supplier_purchase_order_id) {
        const order = await client.query<SupplierPurchaseOrderRow>(
          `SELECT ${SPO_RETURNING} FROM prc.supplier_purchase_orders WHERE id = $1 FOR UPDATE`,
          [invoice.supplier_purchase_order_id],
        );
        if (!order.rows[0]) {
          throw new ProcurementError('PROCUREMENT_NOT_FOUND');
        }
        assertInvoiceMatchesRelatedSupplier(invoice.supplier_id, order.rows[0].supplier_id);
        assertInvoiceMatchesRelatedUnit(invoice.unit_id, order.rows[0].unit_id);
        assertInvoiceMatchesRelatedCurrency(invoice.currency_code, order.rows[0].currency_code);
        const lines = await client.query<{ line_amount: string }>(
          `SELECT line_amount::text AS line_amount
           FROM prc.supplier_purchase_order_lines
           WHERE supplier_purchase_order_id = $1`,
          [invoice.supplier_purchase_order_id],
        );
        expectedAmount = sumMoneyAmounts(lines.rows.map((row) => row.line_amount));
      }
      if (expectedAmount !== null) {
        assertInvoiceAmountMatches(invoice.total_amount, expectedAmount);
      }

      input.failures?.consume(PROCUREMENT_FAILURE_STAGES.AfterInvoiceValidation);

      if (receiptPayableId) {
        const updated = await client.query<SupplierInvoiceRow>(
          `UPDATE prc.supplier_invoices
           SET status = 'VALIDATED',
               payable_id = $2,
               version = version + 1,
               updated_at = NOW(),
               validated_at = NOW()
           WHERE id = $1 AND version = $3
           RETURNING ${INVOICE_RETURNING}`,
          [invoice.id, receiptPayableId, invoice.version],
        );
        if (!updated.rows[0]) {
          await client.query('ROLLBACK');
          return 'VERSION_CONFLICT';
        }
        await client.query('COMMIT');
        return { kind: 'ATTACH_EXISTING', invoice: updated.rows[0] };
      }

      await client.query('COMMIT');
      return { kind: 'OPEN_NEW', invoice };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async attachPayable(invoiceId: string, payableId: string): Promise<SupplierInvoiceRow | null> {
    const updated = await this.pool().query<SupplierInvoiceRow>(
      `UPDATE prc.supplier_invoices
       SET status = 'VALIDATED',
           payable_id = $2,
           version = version + 1,
           updated_at = NOW(),
           validated_at = COALESCE(validated_at, NOW())
       WHERE id = $1 AND payable_id IS NULL
       RETURNING ${INVOICE_RETURNING}`,
      [invoiceId, payableId],
    );
    return updated.rows[0] ?? this.findById(invoiceId);
  }

  async attachPayableToReceipt(receiptId: string, payableId: string): Promise<void> {
    await this.pool().query(
      `UPDATE prc.goods_receipts SET payable_id = $2 WHERE id = $1 AND payable_id IS NULL`,
      [receiptId, payableId],
    );
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
