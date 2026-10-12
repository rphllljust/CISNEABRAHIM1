import { formatMoneyAmountForApi } from '../../platform/kernel/money-math';
import type {
  EmploymentContractRow,
  PayrollEventRow,
  PayrollPeriodRow,
  PayrollResultRow,
} from '../repositories/payroll.repository.types';

export type EmploymentContractResponse = {
  id: string;
  unitId: string;
  code: string;
  displayName: string;
  status: string;
  personRef: string | null;
  startsOn: string;
  endsOn: string | null;
};

export type PayrollPeriodResponse = {
  id: string;
  unitId: string;
  competenceYear: number;
  competenceMonth: number;
  startsOn: string;
  endsOn: string;
  status: string;
  rowVersion: number;
};

export type PayrollEventResponse = {
  id: string;
  payrollPeriodId: string;
  employmentContractId: string;
  eventKind: string;
  amount: string;
  componentLabel: string;
  description: string;
  formulaStatus: string;
  idempotencyKey: string;
  idempotent: boolean;
};

export type PayrollResultResponse = {
  id: string;
  payrollCalculationId: string;
  employmentContractId: string;
  earningTotal: string;
  deductionTotal: string;
  employerChargeTotal: string;
  netTotal: string;
};

export type PayrollCalculationResponse = {
  period: PayrollPeriodResponse;
  results: PayrollResultResponse[];
  idempotent: boolean;
};

export type PayrollPeriodListResponse = {
  items: PayrollPeriodResponse[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type EmploymentContractListResponse = {
  items: EmploymentContractResponse[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};


function money(value: string): string {
  const negative = value.startsWith('-');
  const formatted = formatMoneyAmountForApi(negative ? value.slice(1) : value);
  return `${negative ? '-' : ''}${formatted ?? value}`;
}

export function toEmploymentContractResponse(row: EmploymentContractRow): EmploymentContractResponse {
  return {
    id: row.id,
    unitId: row.unit_id,
    code: row.code,
    displayName: row.display_name,
    status: row.status,
    personRef: row.person_ref,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
  };
}

export function toPayrollPeriodResponse(row: PayrollPeriodRow): PayrollPeriodResponse {
  return {
    id: row.id,
    unitId: row.unit_id,
    competenceYear: Number(row.competence_year),
    competenceMonth: Number(row.competence_month),
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    status: row.status,
    rowVersion: Number(row.row_version),
  };
}

export function toPayrollEventResponse(
  row: PayrollEventRow,
  idempotent = false,
): PayrollEventResponse {
  return {
    id: row.id,
    payrollPeriodId: row.payroll_period_id,
    employmentContractId: row.employment_contract_id,
    eventKind: row.event_kind,
    amount: money(row.amount),
    componentLabel: row.component_label,
    description: row.description,
    formulaStatus: row.formula_status,
    idempotencyKey: row.idempotency_key,
    idempotent,
  };
}

export function toPayrollPeriodListResponse(input: {
  items: PayrollPeriodRow[];
  total: number;
  page: number;
  pageSize: number;
}): PayrollPeriodListResponse {
  return {
    items: input.items.map(toPayrollPeriodResponse),
    total: input.total,
    page: input.page,
    pageSize: input.pageSize,
    totalPages: input.pageSize > 0 ? Math.ceil(input.total / input.pageSize) : 0,
  };
}

export function toEmploymentContractListResponse(input: {
  items: EmploymentContractRow[];
  total: number;
  page: number;
  pageSize: number;
}): EmploymentContractListResponse {
  return {
    items: input.items.map(toEmploymentContractResponse),
    total: input.total,
    page: input.page,
    pageSize: input.pageSize,
    totalPages: input.pageSize > 0 ? Math.ceil(input.total / input.pageSize) : 0,
  };
}

export function toPayrollResultResponse(row: PayrollResultRow): PayrollResultResponse {
  return {
    id: row.id,
    payrollCalculationId: row.payroll_calculation_id,
    employmentContractId: row.employment_contract_id,
    earningTotal: money(row.earning_total),
    deductionTotal: money(row.deduction_total),
    employerChargeTotal: money(row.employer_charge_total),
    netTotal: money(row.net_total),
  };
}
