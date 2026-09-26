import type { FiscalPeriodCloseCheck } from '../domain/fiscal-period';
import type { FiscalPeriodRow } from '../repositories/fiscal-period.repository.types';

export type FiscalPeriodCloseCheckResponse = {
  kind: string;
  result: string;
  blocking: boolean;
  observedCount: number;
  detail: string;
};

export type FiscalPeriodResponse = {
  id: string;
  unitId: string;
  periodKey: string;
  status: string;
  rowVersion: number;
  closedAt: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  closeChecks: FiscalPeriodCloseCheckResponse[];
};

/** Item de listagem de periodos fiscais (sem as verificacoes de fechamento). */
export type FiscalPeriodListItemResponse = {
  id: string;
  unitId: string;
  periodKey: string;
  status: string;
  rowVersion: number;
  closedAt: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FiscalPeriodPageResponse = {
  page: number;
  pageSize: number;
  total: number;
  items: FiscalPeriodListItemResponse[];
};

export function toFiscalPeriodListItemResponse(row: FiscalPeriodRow): FiscalPeriodListItemResponse {
  return {
    id: row.id,
    unitId: row.unit_id,
    periodKey: row.period_key,
    status: row.status,
    rowVersion: row.row_version,
    closedAt: row.closed_at ? row.closed_at.toISOString() : null,
    reopenedAt: row.reopened_at ? row.reopened_at.toISOString() : null,
    reopenReason: row.reopen_reason,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function toFiscalPeriodPageResponse(input: {
  page: number;
  pageSize: number;
  total: number;
  items: FiscalPeriodRow[];
}): FiscalPeriodPageResponse {
  return {
    page: input.page,
    pageSize: input.pageSize,
    total: input.total,
    items: input.items.map(toFiscalPeriodListItemResponse),
  };
}

export function toFiscalPeriodResponse(
  row: FiscalPeriodRow,
  closeChecks: FiscalPeriodCloseCheck[] = [],
): FiscalPeriodResponse {
  return {
    id: row.id,
    unitId: row.unit_id,
    periodKey: row.period_key,
    status: row.status,
    rowVersion: row.row_version,
    closedAt: row.closed_at ? row.closed_at.toISOString() : null,
    reopenedAt: row.reopened_at ? row.reopened_at.toISOString() : null,
    reopenReason: row.reopen_reason,
    closeChecks: closeChecks.map((item) => ({
      kind: item.kind,
      result: item.result,
      blocking: item.blocking,
      observedCount: item.observedCount,
      detail: item.detail,
    })),
  };
}
