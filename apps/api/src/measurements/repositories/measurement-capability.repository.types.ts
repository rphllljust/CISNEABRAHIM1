/**
 * Tipos de persistência da capability MEASUREMENT → ACCEPTANCE → BILLING READINESS.
 *
 * Mantidos separados do repositório para que o serviço de aplicação e os
 * serializadores dependam do CONTRATO, não da implementação SQL.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// LINHAS LIDAS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Base de medição publicada, lida de `rpt.read_measurement_basis`.
 *
 * A leitura atravessa a FRONTEIRA pela view publicada: a medição não alcança
 * `so.measurement_basis` diretamente. Ver `measurement-readiness.repository.ts`
 * para o porquê, e o teste de fitness que reprova o acesso direto.
 */
export type MeasurementBasisReadRow = {
  id: string;
  service_order_id: string;
  closure_id: string;
  unit_id: string;
  status: string;
  lines: unknown;
  actuals: unknown;
  evidence: unknown;
  prepared_at: string;
};

/** Fechamento da execução — a prova de que os realizados estão congelados. */
export type ExecutionClosureReadRow = {
  id: string;
  closure_number: number;
  closed_at: string;
};

/** Linha de variação persistida. */
export type MeasurementVarianceRow = {
  id: string;
  measurement_id: string;
  measurement_item_id: string | null;
  service_order_id: string;
  unit_id: string;
  dimension: string;
  dimension_key: string;
  planned_value: string | null;
  actual_value: string | null;
  measured_value: string | null;
  absolute_delta: string;
  percentage_delta: string | null;
  tolerance_percentage: string | null;
  tolerance_source: string | null;
  severity: string;
  financial_impact: string | null;
  currency_code: string | null;
  requires_decision: boolean;
  decision_kind: string;
  blocking_reason: string | null;
  recommended_resolution: string | null;
  explanation: string;
  detected_at: string;
  row_version: number;
};

/** Decisão de aceite persistida. */
export type CustomerAcceptanceRow = {
  id: string;
  measurement_id: string;
  service_order_id: string;
  client_id: string | null;
  unit_id: string;
  cycle_number: number;
  policy: string;
  result: string;
  observation: string;
  rejection_reason: string | null;
  evidence_id: string | null;
  signature_id: string | null;
  customer_signer_name: string | null;
  accepted_by_identity_id: string;
  occurred_at: string;
  correlation_id: string | null;
  idempotency_key: string | null;
  row_version: number;
  created_at: string;
};

/** Avaliação de elegibilidade persistida. */
export type BillingEligibilityRow = {
  id: string;
  measurement_id: string;
  service_order_id: string;
  unit_id: string;
  measurement_row_version: number;
  policy: string;
  result: string;
  dimensions: unknown;
  blocking_reasons: unknown;
  total_amount: string | null;
  currency_code: string | null;
  granted_at: string | null;
  evaluated_at: string;
  evaluated_by_identity_id: string | null;
  row_version: number;
};

/** Posição de lacuna de receita persistida. */
export type RevenueLeakagePositionRow = {
  id: string;
  service_order_id: string;
  unit_id: string;
  client_id: string | null;
  measurement_id: string | null;
  stage: string;
  order_number: string;
  client_label: string | null;
  amount: string | null;
  currency_code: string | null;
  age_seconds: string | null;
  owner_role: string | null;
  blocker_code: string | null;
  next_action_code: string | null;
  next_action_label: string | null;
  computed_at: string;
};

/**
 * Fatos de contexto comercial para resolver política e tolerância.
 *
 * Uma leitura só da ordem, porque as três decisões (aceite, tolerância,
 * elegibilidade) dependem das MESMAS fontes: contrato, serviço, cliente e
 * política de entitlement. Três leituras poderiam discordar entre si sobre a
 * mesma OS.
 */
export type CommercialContextRow = {
  service_order_id: string;
  order_number: string;
  unit_id: string;
  status: string;
  client_id: string | null;
  client_snapshot: Record<string, unknown> | null;
  service_snapshot: Record<string, unknown>;
  contract_snapshot: Record<string, unknown> | null;
  contract_reference: string | null;
  proposal_id: string | null;
  purchase_order_id: string | null;
  purchase_order_snapshot: Record<string, unknown> | null;
  client_purchase_order_requirement: string | null;
  completed_at: string | null;
};

/**
 * Fatos de PROCESSO de uma ordem — marcos da cadeia Service-to-Cash.
 *
 * Tipo nomeado (e não inline) porque a consulta SQL precisa do genérico
 * `query<T>`: sem ele `rows` é `any[]` e a verificação de tipo some na leitura
 * que alimenta a projeção de processo.
 */
export type MeasurementProcessFactsRow = {
  contract_reference: string | null;
  contract_due_at: string | null;
  planning_confirmed_at: string | null;
  reservation_confirmed_at: string | null;
  dispatched_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  execution_closed_at: string | null;
  measurement_created_at: string | null;
  measurement_approved_at: string | null;
  acceptance_required: boolean;
  acceptance_satisfied_at: string | null;
  billing_prepared_at: string | null;
  receivable_opened_at: string | null;
  settled_at: string | null;
};

/**
 * Ordem concluída com os fatos que a PROJEÇÃO DE LACUNA consome.
 *
 * Uma linha por ordem, lida em UMA consulta: a projeção precisa dos mesmos
 * fatos no mesmo instante para todas as ordens, senão o total somaria estados
 * que nunca coexistiram.
 */
export type LeakageOrderFactsRow = {
  service_order_id: string;
  order_number: string;
  unit_id: string;
  client_id: string | null;
  client_snapshot: Record<string, unknown> | null;
  measurement_id: string | null;
  measurement_status: string | null;
  measurement_updated_at: string | null;
  measurement_amount: string | null;
  measurement_currency: string | null;
  execution_closed_at: string | null;
  completed_at: string | null;
  acceptance_required: boolean;
  acceptance_blocked: boolean;
  eligibility_result: string | null;
  eligibility_blocking_reason: string | null;
  billing_prepared: boolean;
};

/** Item de medição com os campos que a variação precisa. */
export type MeasurementItemVarianceSourceRow = {
  id: string;
  line_number: number;
  unit_code: string;
  planned_quantity: string | null;
  actual_quantity: string;
  measured_quantity: string;
  unit_price: string | null;
  line_amount: string | null;
  pricing_line_snapshot: Record<string, unknown>;
};

// ═══════════════════════════════════════════════════════════════════════════════
// ENTRADAS DE ESCRITA
// ═══════════════════════════════════════════════════════════════════════════════

export type ReplaceVariancesInput = {
  measurementId: string;
  serviceOrderId: string;
  unitId: string;
  variances: Array<{
    dimension: string;
    dimensionKey: string;
    measurementItemId: string | null;
    plannedValue: string | null;
    actualValue: string | null;
    measuredValue: string | null;
    absoluteDelta: string;
    percentageDelta: number | null;
    tolerancePercentage: number;
    toleranceSource: string;
    severity: string;
    financialImpact: string | null;
    currencyCode: string | null;
    requiresDecision: boolean;
    decisionKind: string;
    blockingReason: string | null;
    recommendedResolution: string | null;
    explanation: string;
  }>;
};

export type RecordAcceptancePersistenceInput = {
  measurementId: string;
  serviceOrderId: string;
  clientId: string | null;
  unitId: string;
  cycleNumber: number;
  policy: string;
  result: string;
  observation: string;
  rejectionReason: string | null;
  evidenceId: string | null;
  signatureId: string | null;
  customerSignerName: string | null;
  actorIdentityId: string;
  occurredAt: string;
  correlationId: string | null;
  idempotencyKey: string | null;
};

export type RecordAcceptancePersistenceResult =
  | { outcome: 'success'; acceptance: CustomerAcceptanceRow }
  | { outcome: 'version_conflict' }
  | { outcome: 'already_recorded'; acceptance: CustomerAcceptanceRow }
  | { outcome: 'not_found' };

export type RecordEligibilityInput = {
  measurementId: string;
  serviceOrderId: string;
  unitId: string;
  measurementRowVersion: number;
  policy: string;
  result: string;
  dimensions: unknown;
  blockingReasons: string[];
  totalAmount: string | null;
  currencyCode: string | null;
  grantedAt: string | null;
  actorIdentityId: string | null;
};

export type RefreshLeakageInput = {
  unitId: string;
  positions: Array<{
    serviceOrderId: string;
    clientId: string | null;
    measurementId: string | null;
    stage: string;
    orderNumber: string;
    clientLabel: string | null;
    amount: string | null;
    currencyCode: string | null;
    ageSeconds: number | null;
    ownerRole: string;
    blockerCode: string | null;
    nextActionCode: string;
    nextActionLabel: string;
  }>;
};
