import { HttpStatus } from '@nestjs/common';
import { ProcurementHttpException } from '../errors/procurement-http.exception';
import { PROCUREMENT_ERROR_CODES } from '../errors/procurement-error-codes';
import { PURCHASE_REQUEST_STATUSES, SUPPLIER_PURCHASE_ORDER_STATUSES } from '../domain/procurement';
import { SUPPLIER_INVOICE_STATUSES } from '../domain/supplier-invoice';

const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 20;

export type PurchaseRequestListQuery = {
  limit: number;
  offset: number;
  status?: string;
  q?: string;
};

export type SupplierPurchaseOrderListQuery = {
  limit: number;
  offset: number;
  status?: string;
  supplierId?: string;
  q?: string;
};

export type SupplierInvoiceListQuery = {
  limit: number;
  offset: number;
  status?: string;
  supplierId?: string;
  q?: string;
};

function badRequest(): ProcurementHttpException {
  return new ProcurementHttpException(
    HttpStatus.BAD_REQUEST,
    PROCUREMENT_ERROR_CODES.VALIDATION_FAILED,
    'Invalid query parameters.',
  );
}

function parseOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw badRequest();
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parsePagination(query: Record<string, unknown>): { limit: number; offset: number } {
  const rawLimit = query['limit'];
  const rawOffset = query['offset'];
  const limit =
    rawLimit === undefined
      ? DEFAULT_LIST_LIMIT
      : typeof rawLimit === 'string' || typeof rawLimit === 'number'
        ? Number(rawLimit)
        : NaN;
  const offset =
    rawOffset === undefined
      ? 0
      : typeof rawOffset === 'string' || typeof rawOffset === 'number'
        ? Number(rawOffset)
        : NaN;

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    throw badRequest();
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw badRequest();
  }
  return { limit, offset };
}

/**
 * Status aceito apenas se for um estado real do domínio: um valor livre produziria uma lista
 * silenciosamente vazia em vez de um erro honesto.
 */
function parseStatus(value: unknown, allowed: ReadonlyArray<string>): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw badRequest();
  }
  return value;
}

export function parseListPurchaseRequestsQuery(
  query: Record<string, unknown>,
): PurchaseRequestListQuery {
  return {
    ...parsePagination(query),
    status: parseStatus(query['status'], Object.values(PURCHASE_REQUEST_STATUSES)),
    q: parseOptionalString(query['q']),
  };
}

export function parseListSupplierPurchaseOrdersQuery(
  query: Record<string, unknown>,
): SupplierPurchaseOrderListQuery {
  return {
    ...parsePagination(query),
    status: parseStatus(query['status'], Object.values(SUPPLIER_PURCHASE_ORDER_STATUSES)),
    supplierId: parseOptionalString(query['supplierId']),
    q: parseOptionalString(query['q']),
  };
}

export function parseListSupplierInvoicesQuery(
  query: Record<string, unknown>,
): SupplierInvoiceListQuery {
  return {
    ...parsePagination(query),
    status: parseStatus(query['status'], Object.values(SUPPLIER_INVOICE_STATUSES)),
    supplierId: parseOptionalString(query['supplierId']),
    q: parseOptionalString(query['q']),
  };
}
