import {
  optionalFiscalWhitelist,
  requireFiscalPage,
  requireFiscalPageSize,
} from './fiscal-document.validation';
import { FISCAL_PERIOD_STATUSES } from './fiscal-period';

export class FiscalPeriodValidationError extends Error {
  constructor(readonly field: string) {
    super(field);
  }
}

export type OpenFiscalPeriodInput = {
  unitId: string;
  periodKey: string;
};

export type ReopenFiscalPeriodInput = {
  reason: string;
};

function requireNonEmpty(value: string | undefined | null, field: string): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    throw new FiscalPeriodValidationError(field);
  }
  return trimmed;
}

export function validateOpenFiscalPeriodInput(input: OpenFiscalPeriodInput): OpenFiscalPeriodInput {
  const periodKey = requireNonEmpty(input.periodKey, 'periodKey');
  if (!/^\d{4}-\d{2}$/.test(periodKey)) {
    throw new FiscalPeriodValidationError('periodKey');
  }
  return {
    unitId: requireNonEmpty(input.unitId, 'unitId'),
    periodKey,
  };
}

export function validateReopenFiscalPeriodInput(input: ReopenFiscalPeriodInput): ReopenFiscalPeriodInput {
  const reason = requireNonEmpty(input.reason, 'reason');
  if (reason.length < 3) {
    throw new FiscalPeriodValidationError('reason');
  }
  return { reason };
}

const FISCAL_PERIOD_STATUS_FILTERS = new Set<string>(Object.values(FISCAL_PERIOD_STATUSES));

export type FiscalPeriodListQuery = {
  unitId: string;
  status?: string;
  periodKeyFrom?: string;
  periodKeyTo?: string;
  page: number;
  pageSize: number;
};

/** Filtros da lista de periodos fiscais; `unitId` obrigatorio (escopo de unidade). */
export function validateFiscalPeriodListQuery(
  input: Omit<FiscalPeriodListQuery, 'page' | 'pageSize'> & { page?: unknown; pageSize?: unknown },
): FiscalPeriodListQuery {
  const periodKeyFrom = optionalFiscalPeriodKey(input.periodKeyFrom, 'periodKeyFrom');
  const periodKeyTo = optionalFiscalPeriodKey(input.periodKeyTo, 'periodKeyTo');
  if (periodKeyFrom && periodKeyTo && periodKeyFrom > periodKeyTo) {
    throw new FiscalPeriodValidationError('period');
  }
  const status = optionalFiscalWhitelist(input.status, FISCAL_PERIOD_STATUS_FILTERS, 'status');
  return {
    unitId: requireNonEmpty(input.unitId, 'unitId'),
    status,
    periodKeyFrom,
    periodKeyTo,
    page: requireFiscalPage(input.page, 'page'),
    pageSize: requireFiscalPageSize(input.pageSize, 'pageSize'),
  };
}

function optionalFiscalPeriodKey(
  value: string | undefined | null,
  field: string,
): string | undefined {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') {
    return undefined;
  }
  if (!/^\d{4}-\d{2}$/.test(trimmed)) {
    throw new FiscalPeriodValidationError(field);
  }
  return trimmed;
}
