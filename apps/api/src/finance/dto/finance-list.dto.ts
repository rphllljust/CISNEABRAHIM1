import { HttpStatus } from '@nestjs/common';
import { FinanceHttpException } from '../errors/finance-http.exception';
import { FINANCE_ERROR_CODES } from '../errors/finance-error-codes';

const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 20;

export type FinanceListQuery = {
  limit: number;
  offset: number;
  status?: string;
  unitId?: string;
  q?: string;
};

function badRequest(): FinanceHttpException {
  return new FinanceHttpException(
    HttpStatus.BAD_REQUEST,
    FINANCE_ERROR_CODES.VALIDATION_FAILED,
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

/** Paginação e filtros opcionais comuns às listagens do Financeiro. */
export function parseFinanceListQuery(query: Record<string, unknown>): FinanceListQuery {
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

  return {
    limit,
    offset,
    status: parseOptionalString(query['status']),
    unitId: parseOptionalString(query['unitId']),
    q: parseOptionalString(query['q']),
  };
}
