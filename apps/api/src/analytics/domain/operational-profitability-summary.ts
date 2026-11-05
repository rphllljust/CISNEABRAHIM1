import {
  OPERATIONAL_PROFITABILITY_DISCLAIMER,
  OPERATIONAL_PROFITABILITY_FORMULA,
  aggregateOperationalProfitability,
  type OperationalProfitabilityTotals,
} from '../../commercial/domain/operational-financials';

export const PROFITABILITY_GROUP_BY = {
  None: 'none',
  ServiceOrder: 'service_order',
  Client: 'client',
  Contract: 'contract',
  ServiceType: 'service_type',
} as const;

export type ProfitabilityGroupBy =
  (typeof PROFITABILITY_GROUP_BY)[keyof typeof PROFITABILITY_GROUP_BY];

export type ProfitabilityServiceOrderRaw = {
  serviceOrderId: string;
  serviceOrderCode: string | null;
  clientId: string | null;
  contractReference: string | null;
  serviceType: string | null;
  operationalRevenue: string | null;
  realizedCost: string | null;
  revenueLineCount: number;
  costEntryCount: number;
  currencyCode: string;
  /** True when cost entries for one service order have incompatible currencies. */
  currencyAmbiguous?: boolean;
};

export type ProfitabilitySummary = OperationalProfitabilityTotals & {
  formula: typeof OPERATIONAL_PROFITABILITY_FORMULA;
  disclaimer: typeof OPERATIONAL_PROFITABILITY_DISCLAIMER;
  currencyCode: string;
  /** Never aggregate monetary values from different currencies without a verified FX rule. */
  currencyMixed: boolean;
};

export type ProfitabilitySnapshot = {
  generatedAt: string;
  businessTimezone: string;
  period: {
    preset: string;
    from: string;
    to: string;
    fromInclusive: string;
    toExclusive: string;
  };
  groupBy: ProfitabilityGroupBy;
  supportedDimensions: {
    serviceOrder: boolean;
    client: boolean;
    contract: boolean;
    serviceType: boolean;
    period: boolean;
  };
  visibility: {
    revenue: boolean;
    costs: boolean;
  };
  summary: ProfitabilitySummary;
  groups: Array<{
    key: string;
    label: string;
    summary: ProfitabilitySummary;
    supported: boolean;
  }>;
  lines: Array<{
    serviceOrderId: string;
    serviceOrderCode: string | null;
    clientId: string | null;
    contractReference: string | null;
    serviceType: string | null;
    summary: ProfitabilitySummary;
  }>;
};

export function buildProfitabilitySummary(
  rows: ProfitabilityServiceOrderRaw[],
  currencyCode: string,
): ProfitabilitySummary {
  const totals = aggregateOperationalProfitability(
    rows.map((row) => ({
      operationalRevenue: row.operationalRevenue,
      realizedCost: row.realizedCost,
    })),
  );

  const currencies = new Set(rows.map((row) => row.currencyCode));
  const currencyMixed = rows.some((row) => row.currencyAmbiguous === true) || currencies.size > 1;

  return {
    ...totals,
    // No exchange rate or conversion policy is assumed; preserve row-level
    // evidence and counts, but do not publish financially invalid totals.
    operationalRevenue: currencyMixed ? null : totals.operationalRevenue,
    realizedCost: currencyMixed ? null : totals.realizedCost,
    operationalMargin: currencyMixed ? null : totals.operationalMargin,
    formula: OPERATIONAL_PROFITABILITY_FORMULA,
    disclaimer: OPERATIONAL_PROFITABILITY_DISCLAIMER,
    currencyCode: currencies.size === 1 ? [...currencies][0]! : currencyCode,
    currencyMixed,
  };
}

export function groupProfitabilityRows(
  rows: ProfitabilityServiceOrderRaw[],
  groupBy: ProfitabilityGroupBy,
  currencyCode: string,
): Array<{ key: string; label: string; summary: ProfitabilitySummary; supported: boolean }> {
  if (groupBy === PROFITABILITY_GROUP_BY.None) {
    return [];
  }

  const buckets = new Map<string, ProfitabilityServiceOrderRaw[]>();

  for (const row of rows) {
    const bucket = resolveGroupBucket(row, groupBy);
    if (!bucket.supported) {
      continue;
    }
    const existing = buckets.get(bucket.key) ?? [];
    existing.push(row);
    buckets.set(bucket.key, existing);
  }

  return [...buckets.entries()].map(([key, groupedRows]) => {
    const label = resolveGroupLabel(groupedRows[0]!, groupBy, key);
    const summary = buildProfitabilitySummary(groupedRows, currencyCode);
    return {
      key,
      label,
      summary,
      supported: !summary.currencyMixed,
    };
  });
}

function resolveGroupBucket(
  row: ProfitabilityServiceOrderRaw,
  groupBy: ProfitabilityGroupBy,
): { key: string; supported: boolean } {
  switch (groupBy) {
    case PROFITABILITY_GROUP_BY.ServiceOrder:
      return { key: row.serviceOrderId, supported: true };
    case PROFITABILITY_GROUP_BY.Client:
      return row.clientId
        ? { key: row.clientId, supported: true }
        : { key: 'unsupported', supported: false };
    case PROFITABILITY_GROUP_BY.Contract:
      return row.contractReference
        ? { key: row.contractReference, supported: true }
        : { key: 'unsupported', supported: false };
    case PROFITABILITY_GROUP_BY.ServiceType:
      return row.serviceType
        ? { key: row.serviceType, supported: true }
        : { key: 'UNKNOWN', supported: true };
    default:
      return { key: 'all', supported: false };
  }
}

function resolveGroupLabel(
  row: ProfitabilityServiceOrderRaw,
  groupBy: ProfitabilityGroupBy,
  key: string,
): string {
  switch (groupBy) {
    case PROFITABILITY_GROUP_BY.ServiceOrder:
      return row.serviceOrderCode ?? row.serviceOrderId;
    case PROFITABILITY_GROUP_BY.Client:
      return row.clientId ?? key;
    case PROFITABILITY_GROUP_BY.Contract:
      return row.contractReference ?? key;
    case PROFITABILITY_GROUP_BY.ServiceType:
      return row.serviceType ?? 'UNKNOWN';
    default:
      return key;
  }
}

export function resolveSupportedDimensions(
  rows: ProfitabilityServiceOrderRaw[],
): ProfitabilitySnapshot['supportedDimensions'] {
  return {
    serviceOrder: rows.length > 0,
    client: rows.some((row) => row.clientId !== null),
    contract: rows.some((row) => row.contractReference !== null),
    serviceType: rows.some((row) => row.serviceType !== null),
    period: true,
  };
}
