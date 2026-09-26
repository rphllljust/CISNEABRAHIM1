export type TaxAssessmentRow = {
  id: string;
  unit_id: string;
  tax_calculation_id: string;
  tax_rule_id: string;
  tax_rule_version_id: string;
  tax_component: string;
  period_key: string;
  currency_code: string;
  assessed_amount: string;
  status: string;
  supersedes_assessment_id: string | null;
  idempotency_key: string;
  row_version: number;
  finalized_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  created_at: Date;
  updated_at: Date;
};

export type TaxObligationRow = {
  id: string;
  tax_assessment_id: string;
  unit_id: string;
  tax_rule_id: string;
  tax_component: string;
  period_key: string;
  currency_code: string;
  amount: string;
  status: string;
  origin_calculation_id: string;
  payable_id: string | null;
  payable_principal_snapshot: string | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  created_at: Date;
};

/** Linha de listagem: avaliacao + obrigacao vinculada (LEFT JOIN, sem N+1). */
export type TaxAssessmentListRow = TaxAssessmentRow & {
  obligation_id: string | null;
  obligation_status: string | null;
  obligation_amount: string | null;
  obligation_payable_id: string | null;
};

export type TaxAssessmentEventRow = {
  id: string;
  tax_assessment_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  occurred_at: Date;
  actor_identity_id: string;
};

export type TaxAssessmentAggregate = {
  assessment: TaxAssessmentRow;
  obligation: TaxObligationRow | null;
  events: TaxAssessmentEventRow[];
};

export type CreateTaxAssessmentPersistenceInput = {
  unitId: string;
  taxCalculationId: string;
  taxRuleId: string;
  taxRuleVersionId: string;
  taxComponent: string;
  periodKey: string;
  currencyCode: string;
  assessedAmount: string;
  supersedesAssessmentId?: string | null;
  idempotencyKey: string;
  actorIdentityId: string;
};

export type FinalizeTaxAssessmentPersistenceInput = {
  assessmentId: string;
  actorIdentityId: string;
};

export type CancelTaxObligationPersistenceInput = {
  obligationId: string;
  reason: string;
  actorIdentityId: string;
};

export type AttachPayableSnapshotInput = {
  obligationId: string;
  payableId: string;
  payablePrincipal: string;
};
