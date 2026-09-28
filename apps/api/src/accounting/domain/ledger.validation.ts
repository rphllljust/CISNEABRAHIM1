import { assertUuid } from '../../platform/kernel/uuid';
import { assertCurrencyCode } from '../../platform/kernel/money-math';
import { POSTING_EVENTS, POSTING_ORIGINS, POSTING_REQUEST_STATUSES } from './posting';
import {
  AccountingError,
  JOURNAL_SOURCE_KINDS,
  assertAccountClass,
  assertAccountingAmount,
  assertBalancedEntry,
  assertDirection,
  assertSourceKind,
  type JournalLineDraft,
} from './ledger';

export class AccountingValidationError extends Error {
  constructor(readonly field: string) {
    super(field);
  }
}

export type CreateChartInput = { unitId: string; code: string; name: string };

export type CreateAccountInput = {
  code: string;
  name: string;
  class: string;
  parentId?: string;
};

export type CreatePeriodInput = {
  chartId: string;
  unitId: string;
  code: string;
  startsOn: string;
  endsOn: string;
};

export type DraftJournalInput = {
  chartId: string;
  periodId: string;
  description: string;
  occurredOn: string;
  currencyCode: string;
  sourceKind: string;
  sourceId: string;
  sourceReference: string;
  idempotencyKey: string;
  lines: JournalLineDraft[];
};

export type ReverseJournalInput = {
  rowVersion: number;
  idempotencyKey: string;
  reason: string;
};

function requireNonEmpty(value: string | undefined | null, field: string): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    throw new AccountingValidationError(field);
  }
  return trimmed;
}

function requireDate(value: string | undefined | null, field: string): string {
  const trimmed = value?.trim() ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed) && !/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    throw new AccountingValidationError(field);
  }
  return trimmed.slice(0, 10);
}

export function validateCreateChartInput(input: CreateChartInput): CreateChartInput {
  return {
    unitId: requireNonEmpty(input.unitId, 'unitId'),
    code: requireNonEmpty(input.code, 'code'),
    name: requireNonEmpty(input.name, 'name'),
  };
}

export function validateCreateAccountInput(input: CreateAccountInput): CreateAccountInput {
  let accountClass: string;
  try {
    accountClass = assertAccountClass(input.class);
  } catch {
    throw new AccountingValidationError('class');
  }
  if (input.parentId !== undefined) {
    assertUuid(input.parentId, 'parentId');
  }
  return {
    code: requireNonEmpty(input.code, 'code'),
    name: requireNonEmpty(input.name, 'name'),
    class: accountClass,
    parentId: input.parentId,
  };
}

export function validateCreatePeriodInput(input: CreatePeriodInput): CreatePeriodInput {
  assertUuid(input.chartId, 'chartId');
  const startsOn = requireDate(input.startsOn, 'startsOn');
  const endsOn = requireDate(input.endsOn, 'endsOn');
  if (endsOn < startsOn) {
    throw new AccountingValidationError('endsOn');
  }
  return {
    chartId: input.chartId,
    unitId: requireNonEmpty(input.unitId, 'unitId'),
    code: requireNonEmpty(input.code, 'code'),
    startsOn,
    endsOn,
  };
}

export function validateDraftJournalInput(input: DraftJournalInput): DraftJournalInput {
  assertUuid(input.chartId, 'chartId');
  assertUuid(input.periodId, 'periodId');
  assertUuid(input.sourceId, 'sourceId');
  let sourceKind: string;
  try {
    sourceKind = assertSourceKind(input.sourceKind);
  } catch (error) {
    if (error instanceof AccountingError) {
      throw error;
    }
    throw new AccountingValidationError('sourceKind');
  }
  let currencyCode: string;
  try {
    currencyCode = assertCurrencyCode(input.currencyCode);
  } catch {
    throw new AccountingValidationError('currencyCode');
  }
  const lines = (input.lines ?? []).map((line, index) => {
    assertUuid(line.accountId, 'lines.accountId');
    try {
      return {
        lineNumber: line.lineNumber ?? index + 1,
        accountId: line.accountId,
        direction: assertDirection(line.direction),
        amount: assertAccountingAmount(line.amount),
        description: line.description?.trim() || null,
      };
    } catch {
      throw new AccountingValidationError('lines');
    }
  });
  if (lines.length > 0) {
    try {
      assertBalancedEntry(lines);
    } catch (error) {
      if (error instanceof AccountingError && error.code === 'ACCOUNTING_UNBALANCED_ENTRY') {
        throw error;
      }
      throw new AccountingValidationError('lines');
    }
  }
  return {
    chartId: input.chartId,
    periodId: input.periodId,
    description: requireNonEmpty(input.description, 'description'),
    occurredOn: requireDate(input.occurredOn, 'occurredOn'),
    currencyCode,
    sourceKind,
    sourceId: input.sourceId,
    sourceReference: requireNonEmpty(input.sourceReference, 'sourceReference'),
    idempotencyKey: requireNonEmpty(input.idempotencyKey, 'idempotencyKey'),
    lines,
  };
}

export function validateReverseJournalInput(input: ReverseJournalInput): ReverseJournalInput {
  if (!Number.isInteger(input.rowVersion) || input.rowVersion < 1) {
    throw new AccountingValidationError('rowVersion');
  }
  const reason = requireNonEmpty(input.reason, 'reason');
  if (reason.length < 3) {
    throw new AccountingValidationError('reason');
  }
  return {
    rowVersion: input.rowVersion,
    idempotencyKey: requireNonEmpty(input.idempotencyKey, 'idempotencyKey'),
    reason,
  };
}

export function validateClosePeriodInput(input: { rowVersion: number; reason: string }) {
  if (!Number.isInteger(input.rowVersion) || input.rowVersion < 1) {
    throw new AccountingValidationError('rowVersion');
  }
  const reason = requireNonEmpty(input.reason, 'reason');
  if (reason.length < 3) {
    throw new AccountingValidationError('reason');
  }
  return { rowVersion: input.rowVersion, reason };
}

export function validateReopenPeriodInput(input: { rowVersion: number; reason: string }) {
  return validateClosePeriodInput(input);
}

const PERIOD_STATUS_FILTERS = new Set(['OPEN', 'CLOSED']);
const JOURNAL_STATUS_FILTERS = new Set(['DRAFT', 'POSTED']);
const JOURNAL_KIND_FILTERS = new Set(['ENTRY', 'REVERSAL']);
const SOURCE_KIND_FILTERS = new Set(Object.values(JOURNAL_SOURCE_KINDS));

export function requireNonEmptyText(value: string | undefined | null, field: string): string {
  return requireNonEmpty(value, field);
}

export function optionalWhitelist(value: string | undefined | null, allowed: ReadonlySet<string>, field: string): string | undefined {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') {
    return undefined;
  }
  const normalized = trimmed.toUpperCase();
  if (!allowed.has(normalized)) {
    throw new AccountingValidationError(field);
  }
  return normalized;
}

export function requirePage(value: unknown, field: string): number {
  const numeric = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isInteger(numeric) || numeric < 0) {
    throw new AccountingValidationError(field);
  }
  return numeric;
}

export function requirePageSize(value: unknown, field: string): number {
  const numeric = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isInteger(numeric) || numeric < 1 || numeric > 200) {
    throw new AccountingValidationError(field);
  }
  return numeric;
}

export function optionalDateFilter(value: string | undefined | null, field: string): string | undefined {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') {
    return undefined;
  }
  return requireDate(trimmed, field);
}

export function optionalPeriodStatus(value: string | undefined | null): string | undefined {
  return optionalWhitelist(value, PERIOD_STATUS_FILTERS, 'status');
}

/**
 * Ano de competencia da descoberta de periodo.
 *
 * Faixa deliberadamente larga (1900..2999): o objetivo e recusar lixo de query string, nao impor
 * janela de negocio que nao existe.
 */
export function optionalPeriodYear(value: string | number | undefined | null): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1900 || parsed > 2999) {
    throw new AccountingValidationError('year');
  }
  return parsed;
}

export function optionalJournalStatus(value: string | undefined | null): string | undefined {
  return optionalWhitelist(value, JOURNAL_STATUS_FILTERS, 'status');
}

export function optionalJournalKind(value: string | undefined | null): string | undefined {
  return optionalWhitelist(value, JOURNAL_KIND_FILTERS, 'kind');
}

export function optionalSourceKind(value: string | undefined | null): string | undefined {
  return optionalWhitelist(value, SOURCE_KIND_FILTERS, 'sourceKind');
}

export type JournalListQuery = {
  periodId?: string;
  status?: string;
  kind?: string;
  occurredFrom?: string;
  occurredTo?: string;
  sourceKind?: string;
  accountId?: string;
  page: number;
  pageSize: number;
};

export function validateJournalListQuery(
  input: Omit<JournalListQuery, 'page' | 'pageSize'> & { page?: unknown; pageSize?: unknown },
): JournalListQuery {
  return {
    periodId: input.periodId,
    status: optionalJournalStatus(input.status),
    kind: optionalJournalKind(input.kind),
    occurredFrom: optionalDateFilter(input.occurredFrom, 'occurredFrom'),
    occurredTo: optionalDateFilter(input.occurredTo, 'occurredTo'),
    sourceKind: optionalSourceKind(input.sourceKind),
    accountId: input.accountId,
    page: requirePage(input.page, 'page'),
    pageSize: requirePageSize(input.pageSize, 'pageSize'),
  };
}

const POSTING_REQUEST_STATUS_FILTERS = new Set(Object.values(POSTING_REQUEST_STATUSES));
const POSTING_ORIGIN_FILTERS = new Set(Object.values(POSTING_ORIGINS));
const POSTING_EVENT_FILTERS = new Set(Object.values(POSTING_EVENTS));

function optionalPostingWhitelist(
  value: string | undefined | null,
  allowed: ReadonlySet<string>,
  field: string,
): string | undefined {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') {
    return undefined;
  }
  const normalized = trimmed.toUpperCase();
  if (!allowed.has(normalized)) {
    throw new AccountingValidationError(field);
  }
  return normalized;
}

export type PostingRequestListQuery = {
  unitId: string;
  status?: string;
  originKind?: string;
  eventKind?: string;
  occurredFrom?: string;
  occurredTo?: string;
  page: number;
  pageSize: number;
};

/**
 * Filtros da rastreabilidade evento -> lancamento. `unitId` e obrigatorio: a autorizacao de
 * listagem e resolvida por escopo de unidade, portanto a consulta nunca varre outra unidade.
 */
export function validatePostingRequestListQuery(
  input: Omit<PostingRequestListQuery, 'page' | 'pageSize'> & { page?: unknown; pageSize?: unknown },
): PostingRequestListQuery {
  const occurredFrom = optionalDateFilter(input.occurredFrom, 'occurredFrom');
  const occurredTo = optionalDateFilter(input.occurredTo, 'occurredTo');
  if (occurredFrom && occurredTo && occurredFrom > occurredTo) {
    throw new AccountingValidationError('period');
  }
  return {
    unitId: requireNonEmpty(input.unitId, 'unitId'),
    status: optionalPostingWhitelist(input.status, POSTING_REQUEST_STATUS_FILTERS, 'status'),
    originKind: optionalPostingWhitelist(input.originKind, POSTING_ORIGIN_FILTERS, 'originKind'),
    eventKind: optionalPostingWhitelist(input.eventKind, POSTING_EVENT_FILTERS, 'eventKind'),
    occurredFrom,
    occurredTo,
    page: requirePage(input.page, 'page'),
    pageSize: requirePageSize(input.pageSize, 'pageSize'),
  };
}
