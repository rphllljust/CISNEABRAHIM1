import { authHeaders, requestJson } from '../../financial-ui/enterprise-api';
import type { ComplianceSnapshot } from '../types/compliance.types';

export type ComplianceFilters = {
  unitId: string;
  period?: string;
  from?: string;
  to?: string;
};

export async function getComplianceSnapshot(
  filters: ComplianceFilters,
  signal?: AbortSignal,
): Promise<ComplianceSnapshot> {
  const params = new URLSearchParams({ unitId: filters.unitId });
  if (filters.period) {
    params.set('period', filters.period);
  }
  if (filters.from) {
    params.set('from', filters.from);
  }
  if (filters.to) {
    params.set('to', filters.to);
  }
  return requestJson<ComplianceSnapshot>(`/api/v1/analytics/compliance?${params.toString()}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  });
}
