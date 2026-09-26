import { formatMoneyAmountForApi } from '../../platform/kernel/money-math';
import type { ComplianceSummaryRaw } from '../repositories/compliance-read-model.repository';

export type ComplianceMetric = {
  metricId: string;
  metricVersion: string;
  valueType: 'integer' | 'decimal(18,4)';
  /** null quando nao ha populacao elegivel (NO_DATA != 0). */
  value: number | string | null;
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

const NO_DATA = (metricId: string): ComplianceMetric => ({
  metricId,
  metricVersion: '1.0.0',
  valueType: 'integer',
  available: false,
  value: null,
});

/**
 * Monta o snapshot de conformidade. Regras de honestidade do BI:
 *   - bloco sem concessao fica `available: false` e sem metricas (nunca zero);
 *   - soma sem populacao elegivel devolve `value: null` + `available: false` (NO_DATA != 0);
 *   - contagem de conjunto consultado com sucesso devolve zero real (ZERO_REAL).
 */
export function buildComplianceSnapshot(input: {
  generatedAt: string;
  businessTimezone: string;
  unitId: string;
  period: { preset: string; from: string; to: string };
  visibility: { fiscal: boolean; accounting: boolean };
  raw: ComplianceSummaryRaw;
}): ComplianceSnapshot {
  const { raw, visibility } = input;

  const fiscal: ComplianceBlock = visibility.fiscal
    ? {
        available: true,
        metrics: [
          {
            metricId: 'fiscal.documents_pending_transmission_count',
            metricVersion: '1.0.0',
            valueType: 'integer',
            available: true,
            value: raw.fiscalPendingTransmissionCount,
          },
          {
            metricId: 'fiscal.tax_obligations_open_count',
            metricVersion: '1.0.0',
            valueType: 'integer',
            available: true,
            value: raw.taxObligationsOpenCount,
          },
          {
            metricId: 'fiscal.tax_obligations_open_amount',
            metricVersion: '1.0.0',
            valueType: 'decimal(18,4)',
            available: raw.taxObligationsOpenAmount !== null,
            value:
              raw.taxObligationsOpenAmount === null
                ? null
                : (formatMoneyAmountForApi(raw.taxObligationsOpenAmount) ??
                  raw.taxObligationsOpenAmount),
          },
        ],
      }
    : { available: false, metrics: [NO_DATA('fiscal.documents_pending_transmission_count')] };

  const accounting: ComplianceBlock = visibility.accounting
    ? {
        available: true,
        metrics: [
          {
            metricId: 'accounting.periods_open_count',
            metricVersion: '1.0.0',
            valueType: 'integer',
            available: true,
            value: raw.accountingPeriodsOpenCount,
          },
          {
            metricId: 'accounting.journal_entries_posted_count',
            metricVersion: '1.0.0',
            valueType: 'integer',
            available: true,
            value: raw.journalEntriesPostedCount,
          },
          {
            metricId: 'accounting.journal_entries_draft_count',
            metricVersion: '1.0.0',
            valueType: 'integer',
            available: true,
            value: raw.journalEntriesDraftCount,
          },
        ],
      }
    : { available: false, metrics: [NO_DATA('accounting.periods_open_count')] };

  return {
    generatedAt: input.generatedAt,
    businessTimezone: input.businessTimezone,
    unitId: input.unitId,
    period: input.period,
    visibility,
    fiscal,
    accounting,
  };
}
