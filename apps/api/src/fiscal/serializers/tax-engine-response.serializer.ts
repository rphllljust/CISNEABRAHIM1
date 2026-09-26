import { formatMoneyAmountForApi } from '../../platform/kernel/money-math';
import type { TaxComputation } from '../domain/tax-engine';
import type {
  TaxCalculationAggregate,
  TaxRuleListRow,
  TaxRuleRow,
  TaxRuleVersionRow,
} from '../repositories/tax-engine.repository.types';

export type TaxRuleResponse = {
  id: string;
  unitId: string;
  code: string;
  name: string;
  status: string;
};

/** Item de listagem de regras: identifica a versao publicada vigente sem consulta extra. */
export type TaxRuleListItemResponse = {
  id: string;
  unitId: string;
  code: string;
  name: string;
  status: string;
  versionCount: number;
  publishedVersion: {
    id: string;
    versionNumber: number;
    status: string;
    calculationMethod: string;
    rate: string | null;
    fixedAmount: string | null;
    sourceReference: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    publishedAt: string | null;
  } | null;
};

export type TaxRulePageResponse = {
  page: number;
  pageSize: number;
  total: number;
  items: TaxRuleListItemResponse[];
};

export function toTaxRuleListItemResponse(row: TaxRuleListRow): TaxRuleListItemResponse {
  return {
    id: row.id,
    unitId: row.unit_id,
    code: row.code,
    name: row.name,
    status: row.status,
    versionCount: row.version_count ?? 0,
    publishedVersion:
      row.published_version_id && row.published_version_number !== null
        ? {
            id: row.published_version_id,
            versionNumber: row.published_version_number,
            status: row.published_version_status ?? 'PUBLISHED',
            calculationMethod: row.published_calculation_method ?? '',
            rate: formatMoneyAmountForApi(row.published_rate),
            fixedAmount: formatMoneyAmountForApi(row.published_fixed_amount),
            sourceReference: row.published_source_reference ?? '',
            effectiveFrom: (row.published_effective_from ?? '').slice(0, 10),
            effectiveTo: row.published_effective_to ? row.published_effective_to.slice(0, 10) : null,
            publishedAt: row.published_at ? row.published_at.toISOString() : null,
          }
        : null,
  };
}

export function toTaxRulePageResponse(input: {
  page: number;
  pageSize: number;
  total: number;
  items: TaxRuleListRow[];
}): TaxRulePageResponse {
  return {
    page: input.page,
    pageSize: input.pageSize,
    total: input.total,
    items: input.items.map(toTaxRuleListItemResponse),
  };
}

export type TaxRuleVersionResponse = {
  id: string;
  taxRuleId: string;
  versionNumber: number;
  status: string;
  calculationMethod: string;
  roundingMode: string;
  rate: string | null;
  fixedAmount: string | null;
  sourceReference: string;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export type TaxCalculationResponse = {
  id: string;
  unitId: string;
  taxRuleId: string;
  ruleCode: string;
  ruleVersionId: string;
  versionNumber: number;
  inputs: Record<string, unknown>;
  baseAmount: string;
  rate: string | null;
  resultAmount: string;
  calculatedAt: string;
  idempotencyKey: string;
  lines: Array<{
    lineNumber: number;
    componentLabel: string;
    baseAmount: string;
    rate: string | null;
    resultAmount: string;
  }>;
};

export type TaxReproductionResponse = {
  calculation: TaxCalculationResponse;
  recomputed: {
    ruleVersionId: string;
    baseAmount: string;
    rate: string | null;
    resultAmount: string;
  };
  matches: boolean;
};

export function toTaxRuleResponse(row: TaxRuleRow): TaxRuleResponse {
  return {
    id: row.id,
    unitId: row.unit_id,
    code: row.code,
    name: row.name,
    status: row.status,
  };
}

export function toTaxRuleVersionResponse(row: TaxRuleVersionRow): TaxRuleVersionResponse {
  return {
    id: row.id,
    taxRuleId: row.tax_rule_id,
    versionNumber: row.version_number,
    status: row.status,
    calculationMethod: row.calculation_method,
    roundingMode: row.rounding_mode,
    rate: row.rate === null ? null : (formatMoneyAmountForApi(row.rate) ?? row.rate),
    fixedAmount: row.fixed_amount === null ? null : (formatMoneyAmountForApi(row.fixed_amount) ?? row.fixed_amount),
    sourceReference: row.source_reference,
    effectiveFrom: row.effective_from.slice(0, 10),
    effectiveTo: row.effective_to === null ? null : row.effective_to.slice(0, 10),
  };
}

export function toTaxCalculationResponse(aggregate: TaxCalculationAggregate): TaxCalculationResponse {
  return {
    id: aggregate.calculation.id,
    unitId: aggregate.calculation.unit_id,
    taxRuleId: aggregate.calculation.tax_rule_id,
    ruleCode: aggregate.rule.code,
    ruleVersionId: aggregate.calculation.tax_rule_version_id,
    versionNumber: aggregate.version.version_number,
    inputs: aggregate.calculation.inputs,
    baseAmount: formatMoneyAmountForApi(aggregate.calculation.base_amount) ?? aggregate.calculation.base_amount,
    rate:
      aggregate.calculation.rate === null
        ? null
        : (formatMoneyAmountForApi(aggregate.calculation.rate) ?? aggregate.calculation.rate),
    resultAmount:
      formatMoneyAmountForApi(aggregate.calculation.result_amount) ?? aggregate.calculation.result_amount,
    calculatedAt: aggregate.calculation.calculated_at.toISOString(),
    idempotencyKey: aggregate.calculation.idempotency_key,
    lines: aggregate.lines.map((line) => ({
      lineNumber: line.line_number,
      componentLabel: line.component_label,
      baseAmount: formatMoneyAmountForApi(line.base_amount) ?? line.base_amount,
      rate: line.rate === null ? null : (formatMoneyAmountForApi(line.rate) ?? line.rate),
      resultAmount: formatMoneyAmountForApi(line.result_amount) ?? line.result_amount,
    })),
  };
}

export function toTaxReproductionResponse(
  aggregate: TaxCalculationAggregate,
  recomputed: TaxComputation,
  matches: boolean,
): TaxReproductionResponse {
  return {
    calculation: toTaxCalculationResponse(aggregate),
    recomputed: {
      ruleVersionId: recomputed.ruleVersionId,
      baseAmount: formatMoneyAmountForApi(recomputed.baseAmount) ?? recomputed.baseAmount,
      rate: recomputed.rate === null ? null : (formatMoneyAmountForApi(recomputed.rate) ?? recomputed.rate),
      resultAmount: formatMoneyAmountForApi(recomputed.resultAmount) ?? recomputed.resultAmount,
    },
    matches,
  };
}
