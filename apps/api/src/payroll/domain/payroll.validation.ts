import { isPositiveMoneyAmount } from '../../platform/kernel/money-math';
import { assertUuid } from '../../platform/kernel/uuid';
import {
  PAYROLL_PERIOD_STATUSES,
  PayrollError,
  assertConceptualComponentLabel,
  assertNotLaborAssignmentSource,
  assertPayrollEventKind,
  normalizePayrollAmount,
} from './payroll';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class PayrollValidationError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export type CreateEmploymentContractInput = {
  unitId: string;
  code: string;
  displayName: string;
  startsOn: string;
  endsOn?: string | null;
  personRef?: string | null;
};

export type OpenPayrollPeriodInput = {
  unitId: string;
  competenceYear: number;
  competenceMonth: number;
  startsOn: string;
  endsOn: string;
};

export type RecordPayrollEventInput = {
  unitId: string;
  payrollPeriodId: string;
  employmentContractId: string;
  eventKind: string;
  amount: string;
  componentLabel: string;
  description: string;
  idempotencyKey: string;
  sourceKind?: string | null;
  sourceId?: string | null;
};

function requiredText(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PayrollValidationError('PAYROLL_VALIDATION_FAILED');
  }
  return value.trim();
}

function requiredDate(value: unknown): string {
  const date = requiredText(value);
  if (!DATE_PATTERN.test(date)) {
    throw new PayrollValidationError('PAYROLL_VALIDATION_FAILED');
  }
  return date;
}

function requiredCompetenceYear(value: unknown): number {
  const year = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new PayrollValidationError('PAYROLL_VALIDATION_FAILED');
  }
  return year;
}

function requiredCompetenceMonth(value: unknown): number {
  const month = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new PayrollValidationError('PAYROLL_VALIDATION_FAILED');
  }
  return month;
}

export function validateCreateEmploymentContractInput(
  input: CreateEmploymentContractInput,
): CreateEmploymentContractInput {
  const startsOn = requiredDate(input.startsOn);
  const endsOn =
    input.endsOn === undefined || input.endsOn === null || input.endsOn === ''
      ? null
      : requiredDate(input.endsOn);
  if (endsOn && endsOn < startsOn) {
    throw new PayrollValidationError('PAYROLL_VALIDATION_FAILED');
  }
  const personRef =
    input.personRef === undefined || input.personRef === null || input.personRef === ''
      ? null
      : assertUuid(input.personRef, 'personRef');
  return {
    unitId: requiredText(input.unitId),
    code: requiredText(input.code),
    displayName: requiredText(input.displayName),
    startsOn,
    endsOn,
    personRef,
  };
}

export function validateOpenPayrollPeriodInput(input: OpenPayrollPeriodInput): OpenPayrollPeriodInput {
  const startsOn = requiredDate(input.startsOn);
  const endsOn = requiredDate(input.endsOn);
  if (endsOn < startsOn) {
    throw new PayrollValidationError('PAYROLL_VALIDATION_FAILED');
  }
  const competenceYear = requiredCompetenceYear(input.competenceYear);
  const competenceMonth = requiredCompetenceMonth(input.competenceMonth);
  const startYear = Number(startsOn.slice(0, 4));
  const startMonth = Number(startsOn.slice(5, 7));
  if (startYear !== competenceYear || startMonth !== competenceMonth) {
    throw new PayrollValidationError('PAYROLL_VALIDATION_FAILED');
  }
  return {
    unitId: requiredText(input.unitId),
    competenceYear,
    competenceMonth,
    startsOn,
    endsOn,
  };
}

export function validateRecordPayrollEventInput(
  input: RecordPayrollEventInput,
): RecordPayrollEventInput {
  const eventKind = assertPayrollEventKind(requiredText(input.eventKind));
  if (!isPositiveMoneyAmount(String(input.amount))) {
    throw new PayrollError('PAYROLL_INVALID_AMOUNT');
  }
  const sourceKind =
    input.sourceKind === undefined || input.sourceKind === null || input.sourceKind === ''
      ? null
      : requiredText(input.sourceKind);
  assertNotLaborAssignmentSource(sourceKind);
  const sourceId =
    input.sourceId === undefined || input.sourceId === null || input.sourceId === ''
      ? null
      : assertUuid(input.sourceId, 'sourceId');
  return {
    unitId: requiredText(input.unitId),
    payrollPeriodId: assertUuid(input.payrollPeriodId, 'payrollPeriodId'),
    employmentContractId: assertUuid(input.employmentContractId, 'employmentContractId'),
    eventKind,
    amount: normalizePayrollAmount(String(input.amount)),
    componentLabel: assertConceptualComponentLabel(requiredText(input.componentLabel)),
    description: requiredText(input.description),
    idempotencyKey: requiredText(input.idempotencyKey),
    sourceKind,
    sourceId,
  };
}


export type PayrollPeriodListQuery = {
  unitId: string;
  status?: string;
  q?: string;
  page: number;
  pageSize: number;
};

export type EmploymentContractListQuery = {
  unitId: string;
  q?: string;
  page: number;
  pageSize: number;
};

function optionalListText(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new PayrollValidationError('PAYROLL_VALIDATION_FAILED');
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function listPage(value: unknown): number {
  const page = value === undefined || value === '' ? 0 : Number(value);
  if (!Number.isInteger(page) || page < 0) {
    throw new PayrollValidationError('PAYROLL_VALIDATION_FAILED');
  }
  return page;
}

function listPageSize(value: unknown): number {
  const pageSize = value === undefined || value === '' ? 20 : Number(value);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new PayrollValidationError('PAYROLL_VALIDATION_FAILED');
  }
  return pageSize;
}

/** Consulta server-side da carteira de competências da unidade autorizada. */
export function validatePayrollPeriodListQuery(input: {
  unitId?: unknown;
  status?: unknown;
  q?: unknown;
  page?: unknown;
  pageSize?: unknown;
}): PayrollPeriodListQuery {
  const status = optionalListText(input.status)?.toUpperCase();
  if (status && !Object.values(PAYROLL_PERIOD_STATUSES).includes(status as never)) {
    throw new PayrollValidationError('PAYROLL_VALIDATION_FAILED');
  }
  return {
    unitId: requiredText(input.unitId),
    status,
    q: optionalListText(input.q),
    page: listPage(input.page),
    pageSize: listPageSize(input.pageSize),
  };
}

/** Consulta server-side do diretório de contratos de trabalho da unidade autorizada. */
export function validateEmploymentContractListQuery(input: {
  unitId?: unknown;
  q?: unknown;
  page?: unknown;
  pageSize?: unknown;
}): EmploymentContractListQuery {
  return {
    unitId: requiredText(input.unitId),
    q: optionalListText(input.q),
    page: listPage(input.page),
    pageSize: listPageSize(input.pageSize),
  };
}
