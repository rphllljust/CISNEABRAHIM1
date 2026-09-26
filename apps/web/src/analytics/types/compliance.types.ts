export type ComplianceMetricValue = number | string | null;

export type ComplianceMetric = {
  metricId: string;
  metricVersion: string;
  valueType: 'integer' | 'decimal(18,4)';
  /** null quando nao ha populacao elegivel (NO_DATA != 0). */
  value: ComplianceMetricValue;
  available: boolean;
};

export type ComplianceBlock = {
  available: boolean;
  metrics: ComplianceMetric[];
};

export type ComplianceSnapshot = {
  generatedAt: string;
  businessTimezone: string;
  unitId: string;
  period: { preset: string; from: string; to: string };
  visibility: { fiscal: boolean; accounting: boolean };
  fiscal: ComplianceBlock;
  accounting: ComplianceBlock;
};
