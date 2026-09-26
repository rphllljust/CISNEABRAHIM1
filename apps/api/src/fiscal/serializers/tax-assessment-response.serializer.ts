import { formatMoneyAmountForApi } from '../../platform/kernel/money-math';
import type { TaxObligationPayableView } from '../../platform/bounded-contexts/enterprise-core-ports';
import type {
  TaxAssessmentAggregate,
  TaxAssessmentEventRow,
  TaxAssessmentListRow,
  TaxObligationRow,
} from '../repositories/tax-assessment.repository.types';

export type TaxObligationResponse = {
  id: string;
  taxAssessmentId: string;
  taxRuleId: string;
  taxComponent: string;
  periodKey: string;
  currencyCode: string;
  amount: string;
  status: string;
  originCalculationId: string;
  payableId: string | null;
  payablePrincipalSnapshot: string | null;
};

export type TaxAssessmentEventResponse = {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: string;
};

export type TaxAssessmentReconciliationResponse = {
  matched: boolean;
  assessedAmount: string;
  obligationAmount: string | null;
  payablePrincipal: string | null;
  payableId: string | null;
  payableOriginKind: string | null;
};

export type TaxAssessmentDetailResponse = {
  id: string;
  unitId: string;
  taxCalculationId: string;
  taxRuleId: string;
  taxRuleVersionId: string;
  taxComponent: string;
  periodKey: string;
  currencyCode: string;
  assessedAmount: string;
  status: string;
  supersedesAssessmentId: string | null;
  idempotencyKey: string;
  rowVersion: number;
  obligation: TaxObligationResponse | null;
  events: TaxAssessmentEventResponse[];
  reconciliation: TaxAssessmentReconciliationResponse;
};

function money(value: string): string {
  return formatMoneyAmountForApi(value) ?? value;
}

/** Item de listagem de apuracoes: inclui a obrigacao tributaria vinculada quando existir. */
export type TaxAssessmentListItemResponse = {
  id: string;
  unitId: string;
  taxCalculationId: string;
  taxRuleId: string;
  taxRuleVersionId: string;
  taxComponent: string;
  periodKey: string;
  currencyCode: string;
  assessedAmount: string;
  status: string;
  supersedesAssessmentId: string | null;
  rowVersion: number;
  finalizedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  obligation: {
    id: string;
    status: string;
    amount: string;
    payableId: string | null;
  } | null;
};

export type TaxAssessmentPageResponse = {
  page: number;
  pageSize: number;
  total: number;
  items: TaxAssessmentListItemResponse[];
};

export function toTaxAssessmentListItemResponse(
  row: TaxAssessmentListRow,
): TaxAssessmentListItemResponse {
  return {
    id: row.id,
    unitId: row.unit_id,
    taxCalculationId: row.tax_calculation_id,
    taxRuleId: row.tax_rule_id,
    taxRuleVersionId: row.tax_rule_version_id,
    taxComponent: row.tax_component,
    periodKey: row.period_key,
    currencyCode: row.currency_code,
    assessedAmount: money(row.assessed_amount),
    status: row.status,
    supersedesAssessmentId: row.supersedes_assessment_id,
    rowVersion: row.row_version,
    finalizedAt: row.finalized_at ? new Date(row.finalized_at).toISOString() : null,
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at).toISOString() : null,
    cancelReason: row.cancel_reason,
    createdAt: new Date(row.created_at).toISOString(),
    obligation: row.obligation_id
      ? {
          id: row.obligation_id,
          status: row.obligation_status ?? '',
          amount: money(row.obligation_amount ?? '0'),
          payableId: row.obligation_payable_id,
        }
      : null,
  };
}

export function toTaxAssessmentPageResponse(input: {
  page: number;
  pageSize: number;
  total: number;
  items: TaxAssessmentListRow[];
}): TaxAssessmentPageResponse {
  return {
    page: input.page,
    pageSize: input.pageSize,
    total: input.total,
    items: input.items.map(toTaxAssessmentListItemResponse),
  };
}

export function toTaxObligationResponse(row: TaxObligationRow): TaxObligationResponse {
  return {
    id: row.id,
    taxAssessmentId: row.tax_assessment_id,
    taxRuleId: row.tax_rule_id,
    taxComponent: row.tax_component,
    periodKey: row.period_key,
    currencyCode: row.currency_code,
    amount: money(row.amount),
    status: row.status,
    originCalculationId: row.origin_calculation_id,
    payableId: row.payable_id,
    payablePrincipalSnapshot: row.payable_principal_snapshot
      ? money(row.payable_principal_snapshot)
      : null,
  };
}

export function toTaxAssessmentEventResponse(row: TaxAssessmentEventRow): TaxAssessmentEventResponse {
  return {
    id: row.id,
    eventType: row.event_type,
    payload: row.payload,
    occurredAt: row.occurred_at.toISOString(),
  };
}

export function toTaxAssessmentDetailResponse(
  aggregate: TaxAssessmentAggregate,
  payable: TaxObligationPayableView | null,
): TaxAssessmentDetailResponse {
  const assessedAmount = money(aggregate.assessment.assessed_amount);
  const obligationAmount = aggregate.obligation ? money(aggregate.obligation.amount) : null;
  const payablePrincipal = payable ? money(payable.principal) : null;
  const matched =
    Boolean(aggregate.obligation) &&
    Boolean(payable) &&
    assessedAmount === obligationAmount &&
    obligationAmount === payablePrincipal &&
    payable?.originKind === 'TAX_OBLIGATION' &&
    payable.originId === aggregate.obligation?.id;
  return {
    id: aggregate.assessment.id,
    unitId: aggregate.assessment.unit_id,
    taxCalculationId: aggregate.assessment.tax_calculation_id,
    taxRuleId: aggregate.assessment.tax_rule_id,
    taxRuleVersionId: aggregate.assessment.tax_rule_version_id,
    taxComponent: aggregate.assessment.tax_component,
    periodKey: aggregate.assessment.period_key,
    currencyCode: aggregate.assessment.currency_code,
    assessedAmount,
    status: aggregate.assessment.status,
    supersedesAssessmentId: aggregate.assessment.supersedes_assessment_id,
    idempotencyKey: aggregate.assessment.idempotency_key,
    rowVersion: aggregate.assessment.row_version,
    obligation: aggregate.obligation ? toTaxObligationResponse(aggregate.obligation) : null,
    events: aggregate.events.map(toTaxAssessmentEventResponse),
    reconciliation: {
      matched,
      assessedAmount,
      obligationAmount,
      payablePrincipal,
      payableId: payable?.payableId ?? aggregate.obligation?.payable_id ?? null,
      payableOriginKind: payable?.originKind ?? null,
    },
  };
}
