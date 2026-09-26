export type ProfitabilitySummary = {
  operationalRevenue: string | null;
  realizedCost: string | null;
  operationalMargin: string | null;
  revenueSupportedCount: number;
  costSupportedCount: number;
  marginComputableCount: number;
  serviceOrderCount: number;
  formula: string;
  disclaimer: string;
  currencyCode: string;
};

export type OperationalProfitabilitySnapshot = {
  generatedAt: string;
  businessTimezone: string;
  period: {
    preset: string;
    from: string;
    to: string;
    fromInclusive: string;
    toExclusive: string;
  };
  groupBy: string;
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
