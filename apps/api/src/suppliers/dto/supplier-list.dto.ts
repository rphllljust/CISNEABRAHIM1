import { HttpStatus } from '@nestjs/common';
import { SupplierHttpException } from '../errors/supplier-http.exception';
import { SUPPLIER_ERROR_CODES } from '../errors/supplier-error-codes';
import { isSupplierStatus } from '../domain/supplier.validation';
import type { SupplierStatus } from '../domain/supplier';

const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 20;

export type SupplierListQuery = {
  limit: number;
  offset: number;
  /** Tipado pela fonte do domínio — inclui ARCHIVED desde a Fase B. */
  status?: SupplierStatus;
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
  // Tipado pela FONTE (`SupplierStatus`), não por união literal: ao acrescentar ARCHIVED ao
  // domínio, a união hardcoded anterior passou a rejeitar um status válido em compilação.
  let status: SupplierStatus | undefined;
  if (statusRaw !== undefined) {
    if (typeof statusRaw !== 'string' || !isSupplierStatus(statusRaw)) {
      throw badRequest();
    }
    status = statusRaw;
  }

  return { limit, offset, status, q: parseOptionalString(query['q']) };
}
