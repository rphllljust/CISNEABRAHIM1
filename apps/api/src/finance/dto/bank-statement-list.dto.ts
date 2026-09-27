import { HttpStatus } from '@nestjs/common';
import { FINANCE_ERROR_CODES } from '../errors/finance-error-codes';
import { FinanceHttpException } from '../errors/finance-http.exception';

const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 20;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Filtros de descoberta de extratos bancários.
 *
 * Só entram filtros que já existem como FATO persistido em `fin.bank_statements` /
 * `fin.financial_accounts`: conta financeira, status, período de referência e janela de datas.
 * Nada aqui é calculado pelo navegador nem inventado pelo servidor.
 */
export type BankStatementListQuery = {
  limit: number;
  offset: number;
  financialAccountId?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
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

function parseOptionalDate(value: unknown): string | undefined {
  const parsed = parseOptionalString(value);
  if (parsed === undefined) {
    return undefined;
  }
  if (!ISO_DATE.test(parsed)) {
    throw badRequest();
  }
  return parsed;
}

/** Paginação e filtros da listagem de extratos, no mesmo dialeto das demais listagens do Financeiro. */
export function parseBankStatementListQuery(
  query: Record<string, unknown>,
): BankStatementListQuery {
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

  const dateFrom = parseOptionalDate(query['dateFrom']);
  const dateTo = parseOptionalDate(query['dateTo']);
  if (dateFrom !== undefined && dateTo !== undefined && dateTo < dateFrom) {
    throw badRequest();
  }

  return {
    limit,
    offset,
    financialAccountId: parseOptionalString(query['financialAccountId']),
    status: parseOptionalString(query['status']),
    dateFrom,
    dateTo,
  };
}

/** Status persistidos de `fin.bank_statement_status`. Filtro só aceita o enumerado real. */
export const BANK_STATEMENT_STATUSES = ['OPEN', 'CLOSED'] as const;

export function assertBankStatementStatus(value: string): string {
  if (!(BANK_STATEMENT_STATUSES as readonly string[]).includes(value)) {
    throw badRequest();
  }
  return value;
}
