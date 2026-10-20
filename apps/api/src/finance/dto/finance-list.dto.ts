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
  /**
   * Faixa de aging (contas a pagar).
   *
   * Tipado aqui — e não como string livre — porque a faixa é um CONJUNTO FECHADO. Aceitar
   * qualquer texto e deixar o SQL comparar produziria lista vazia, que o operador leria
   * como "não há títulos nesta faixa" quando na verdade a faixa pedida não existe. Valor
   * desconhecido é recusado com 400.
   */
  agingBucket?: string;
  /**
   * Filtro composto já parseado contra o allow-list da ENTIDADE.
   *
   * O parser é genérico
   * (`infrastructure/http/contracts/advanced-filter-query`), mas os campos aceitos são do domínio —
   * por isso cada listagem chama o seu próprio `parseXAdvancedFilter` e entrega o resultado aqui,
   * já validado. Este DTO não valida filtro avançado: ele não conhece a entidade.
   */
  advanced?: unknown;
};

const SORT_DIRECTIONS = new Set(['asc', 'desc']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Faixas de aging aceitas — espelham `PAYABLE_AGING_BUCKETS` do domínio.
 *
 * Declaradas aqui (e não importadas do domínio) por dependência de camada: o DTO é da borda
 * HTTP e não deve depender do domínio de UM módulo financeiro. Há um teste de contrato
 * garantindo que as duas listas permanecem iguais.
 */
const AGING_BUCKETS = new Set([
  'SETTLED',
  'CANCELLED',
  'CURRENT',
  '1_30',
  '31_60',
  '61_90',
  '90_PLUS',
]);

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
    agingBucket: parseOptionalAgingBucket(query['agingBucket']),
  };
}

/** Faixa de aging conhecida ou ausente. Valor fora do conjunto fechado é 400, nunca vazio. */
function parseOptionalAgingBucket(value: unknown): string | undefined {
  const parsed = parseOptionalString(value);
  if (parsed === undefined) {
    return undefined;
  }
  if (!AGING_BUCKETS.has(parsed)) {
    throw badRequest();
  }
  return parsed;
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
