import { HttpStatus } from '@nestjs/common';
import { SupplierHttpException } from '../errors/supplier-http.exception';
import { SUPPLIER_ERROR_CODES } from '../errors/supplier-error-codes';
import { isSupplierStatus } from '../domain/supplier.validation';

const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 20;

export type SupplierListQuery = {
  limit: number;
  offset: number;
  status?: 'ACTIVE' | 'INACTIVE';
  q?: string;
};

function badRequest(): SupplierHttpException {
  return new SupplierHttpException(
    HttpStatus.BAD_REQUEST,
    SUPPLIER_ERROR_CODES.VALIDATION_FAILED,
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

function parseNumber(value: unknown, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw badRequest();
  }
  return Number(value);
}

export function parseListSuppliersQuery(query: Record<string, unknown>): SupplierListQuery {
  const limit = parseNumber(query['limit'], DEFAULT_LIST_LIMIT);
  const offset = parseNumber(query['offset'], 0);

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    throw badRequest();
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw badRequest();
  }

  const statusRaw = query['status'];
  let status: 'ACTIVE' | 'INACTIVE' | undefined;
  if (statusRaw !== undefined) {
    if (typeof statusRaw !== 'string' || !isSupplierStatus(statusRaw)) {
      throw badRequest();
    }
    status = statusRaw;
  }

  return { limit, offset, status, q: parseOptionalString(query['q']) };
}
