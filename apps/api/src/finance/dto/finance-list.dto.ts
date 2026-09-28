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
  dueFrom?: string;
  dueTo?: string;
  sortBy?: string;
  sortDir?: string;
};

const SORT_DIRECTIONS = new Set(['asc', 'desc']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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
    dueFrom: parseOptionalIsoDate(query['dueFrom']),
    dueTo: parseOptionalIsoDate(query['dueTo']),
    sortBy: parseOptionalString(query['sortBy']),
    // Direcao desconhecida NAO vira default silencioso: e recusada. O default `desc` e
    // aplicado apenas quando o parametro esta ausente.
    sortDir: parseOptionalSortDir(query['sortDir']),
  };
}

/** Data ISO (`AAAA-MM-DD`) ou ausente. Formato inesperado e recusado, nunca coagido. */
function parseOptionalIsoDate(value: unknown): string | undefined {
  const parsed = parseOptionalString(value);
  if (parsed === undefined) {
    return undefined;
  }
  const day = parsed.slice(0, 10);
  if (!ISO_DATE.test(day)) {
    throw badRequest();
  }
  return day;
}

function parseOptionalSortDir(value: unknown): string | undefined {
  const parsed = parseOptionalString(value)?.toLowerCase();
  if (parsed === undefined) {
    return undefined;
  }
  if (!SORT_DIRECTIONS.has(parsed)) {
    throw badRequest();
  }
  return parsed;
}
