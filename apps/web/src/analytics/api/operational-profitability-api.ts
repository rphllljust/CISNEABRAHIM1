import { authHeaders, requestJson } from '../../financial-ui/enterprise-api';
import type { OperationalProfitabilitySnapshot } from '../types/operational-profitability.types';

export type OperationalProfitabilityFilters = {
  period?: string;
  groupBy?: string;
};

export async function getOperationalProfitability(
  filters: OperationalProfitabilityFilters,
  signal?: AbortSignal,
): Promise<OperationalProfitabilitySnapshot> {
  const params = new URLSearchParams();
  if (filters.period) {
    params.set('period', filters.period);
  }
  if (filters.groupBy) {
    params.set('groupBy', filters.groupBy);
  }
  const query = params.toString();
  return requestJson<OperationalProfitabilitySnapshot>(
    `/api/v1/analytics/operational-profitability${query ? `?${query}` : ''}`,
    { method: 'GET', headers: authHeaders(), signal },
  );
}
