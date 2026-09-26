import { assertUuid } from '../../platform/kernel/uuid';
import {
  optionalFiscalWhitelist,
  requireFiscalPage,
  requireFiscalPageSize,
} from './fiscal-document.validation';
import { TAX_ASSESSMENT_STATUSES } from './tax-assessment';

export class TaxAssessmentValidationError extends Error {
  constructor(readonly field: string) {
    super(field);
  }
}

export type CreateTaxAssessmentInput = {
  taxCalculationId: string;
  idempotencyKey: string;
  supersedesAssessmentId?: string | null;
};

export type FinalizeTaxAssessmentPayableInput = {
  counterpartyId: string;
  expenseCategoryId: string;
  costCenterId: string;
  costCenterCode: string;
  dueDate: string;
  paymentTerms: string;
};

export type AdjustTaxAssessmentInput = CreateTaxAssessmentInput &
  FinalizeTaxAssessmentPayableInput & {
    reason: string;
  };

export type CancelTaxAssessmentInput = {
  reason: string;
};

function requireNonEmpty(value: string | undefined | null, field: string): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    throw new TaxAssessmentValidationError(field);
  }
  return trimmed;
}

function requireUuid(value: string, field: string): string {
  try {
    return assertUuid(value, field);
  } catch {
    throw new TaxAssessmentValidationError(field);
  }
}

function requireDueDate(value: string | undefined | null, field: string): string {
  const trimmed = value?.trim() ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed) && !/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    throw new TaxAssessmentValidationError(field);
  }
  return trimmed.slice(0, 10);
}

export function validateCreateTaxAssessmentInput(
  input: CreateTaxAssessmentInput,
): CreateTaxAssessmentInput {
  return {
    taxCalculationId: requireUuid(input.taxCalculationId, 'taxCalculationId'),
    idempotencyKey: requireNonEmpty(input.idempotencyKey, 'idempotencyKey'),
    supersedesAssessmentId: input.supersedesAssessmentId
      ? requireUuid(input.supersedesAssessmentId, 'supersedesAssessmentId')
      : null,
  };
}

export function validateFinalizePayableInput(
  input: FinalizeTaxAssessmentPayableInput,
): FinalizeTaxAssessmentPayableInput {
  return {
    counterpartyId: requireUuid(input.counterpartyId, 'counterpartyId'),
    expenseCategoryId: requireUuid(input.expenseCategoryId, 'expenseCategoryId'),
    costCenterId: requireUuid(input.costCenterId, 'costCenterId'),
    costCenterCode: requireNonEmpty(input.costCenterCode, 'costCenterCode'),
    dueDate: requireDueDate(input.dueDate, 'dueDate'),
    paymentTerms: requireNonEmpty(input.paymentTerms, 'paymentTerms'),
  };
}

export function validateAdjustTaxAssessmentInput(input: AdjustTaxAssessmentInput): AdjustTaxAssessmentInput {
  const created = validateCreateTaxAssessmentInput(input);
  const payable = validateFinalizePayableInput(input);
  const reason = requireNonEmpty(input.reason, 'reason');
  if (reason.length < 3) {
    throw new TaxAssessmentValidationError('reason');
  }
  return { ...created, ...payable, reason };
}

export function validateCancelTaxAssessmentInput(input: CancelTaxAssessmentInput): CancelTaxAssessmentInput {
  const reason = requireNonEmpty(input.reason, 'reason');
  if (reason.length < 3) {
    throw new TaxAssessmentValidationError('reason');
  }
  return { reason };
}

const TAX_ASSESSMENT_STATUS_FILTERS = new Set<string>(Object.values(TAX_ASSESSMENT_STATUSES));

export type TaxAssessmentListQuery = {
  unitId: string;
  status?: string;
  periodKey?: string;
  taxComponent?: string;
  page: number;
  pageSize: number;
};

/** Filtros da lista de apuracoes; `unitId` obrigatorio (escopo de unidade). */
export function validateTaxAssessmentListQuery(
  input: Omit<TaxAssessmentListQuery, 'page' | 'pageSize'> & { page?: unknown; pageSize?: unknown },
): TaxAssessmentListQuery {
  const periodKey = input.periodKey?.trim() ?? '';
  if (periodKey !== '' && !/^\d{4}-\d{2}$/.test(periodKey)) {
    throw new TaxAssessmentValidationError('periodKey');
  }
  const taxComponent = input.taxComponent?.trim() ?? '';
  return {
    unitId: requireNonEmpty(input.unitId, 'unitId'),
    status: optionalFiscalWhitelist(input.status, TAX_ASSESSMENT_STATUS_FILTERS, 'status'),
    periodKey: periodKey === '' ? undefined : periodKey,
    taxComponent: taxComponent === '' ? undefined : taxComponent,
    page: requireFiscalPage(input.page, 'page'),
    pageSize: requireFiscalPageSize(input.pageSize, 'pageSize'),
  };
}
