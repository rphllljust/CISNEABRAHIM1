export type TaxRuleRow = {
  id: string;
  unit_id: string;
  code: string;
  name: string;
  status: string;
  created_at: Date;
  updated_at: Date;
};

/** Linha de listagem: regra + versao publicada vigente + contagem de versoes. */
export type TaxRuleListRow = TaxRuleRow & {
  published_version_id: string | null;
  published_version_number: number | null;
  published_version_status: string | null;
  published_calculation_method: string | null;
  published_rate: string | null;
  published_fixed_amount: string | null;
  published_source_reference: string | null;
  published_effective_from: string | null;
  published_effective_to: string | null;
  published_at: Date | null;
  version_count: number | null;
};

export type TaxRuleVersionRow = {
  id: string;
  tax_rule_id: string;
  version_number: number;
  status: string;
  calculation_method: string;
  rounding_mode: string;
  rate: string | null;
  fixed_amount: string | null;
  source_reference: string;
  effective_from: string;
  effective_to: string | null;
  specification: Record<string, unknown>;
  row_version: number;
  published_at: Date | null;
  published_by_identity_id: string | null;
};

export type TaxContextRow = {
  id: string;
  unit_id: string;
  currency_code: string;
  base_amount: string;
  effective_on: string;
  attributes: Record<string, unknown>;
};

export type TaxCalculationRow = {
  id: string;
  unit_id: string;
  tax_rule_id: string;
  tax_rule_version_id: string;
  tax_context_id: string;
  inputs: Record<string, unknown>;
  base_amount: string;
  rate: string | null;
  result_amount: string;
  calculated_at: Date;
  idempotency_key: string;
  source_kind: string | null;
  source_id: string | null;
};

export type TaxCalculationLineRow = {
  id: string;
  tax_calculation_id: string;
  line_number: number;
  component_label: string;
  base_amount: string;
  rate: string | null;
  result_amount: string;
  detail_snapshot: Record<string, unknown>;
};

export type TaxCalculationAggregate = {
  calculation: TaxCalculationRow;
  context: TaxContextRow;
  lines: TaxCalculationLineRow[];
  version: TaxRuleVersionRow;
  rule: TaxRuleRow;
};

export type PersistTaxCalculationInput = {
  unitId: string;
  taxRuleId: string;
  taxRuleVersionId: string;
  currencyCode: string;
  baseAmount: string;
  effectiveOn: string;
  attributes: Record<string, unknown>;
  inputs: Record<string, unknown>;
  rate: string | null;
  resultAmount: string;
  componentLabel: string;
  idempotencyKey: string;
  sourceKind: string | null;
  sourceId: string | null;
  actorIdentityId: string;
};
