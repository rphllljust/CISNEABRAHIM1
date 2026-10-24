/**
 * Tipos de persistência da capability DISPATCH + EXECUTION + ACTUALS.
 *
 * Mantidos separados do repositório para que o serviço de aplicação e os
 * serializadores dependam do CONTRATO, não da implementação SQL.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// LINHAS LIDAS
// ═══════════════════════════════════════════════════════════════════════════════

export type ServiceOrderOperationsRow = {
  id: string;
  order_number: string;
  unit_id: string;
  status: string;
  client_id: string | null;
  client_snapshot: Record<string, unknown> | null;
  service_snapshot: Record<string, unknown>;
  description: string | null;
  priority: string | null;
  row_version: number;
  started_at: string | null;
  paused_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  released_at: string | null;
  contract_id: string | null;
  contract_snapshot: Record<string, unknown> | null;
  operational_notes: string | null;
};

export type DispatchRow = {
  id: string;
  window_start: string;
  window_end: string;
  confirmed_resources: Record<string, unknown>;
  readiness_snapshot: Record<string, unknown>;
  dispatched_at: string;
  checked_in_at: string | null;
  row_version: number;
};

export type AllocationRow = {
  id: string;
  resource_type_code: string;
  operational_start: string;
  operational_end: string;
  status: string;
  physical_asset_id: string | null;
  workforce_member_id: string | null;
  asset_code: string | null;
  asset_name: string | null;
  asset_active: boolean | null;
  asset_under_maintenance: boolean | null;
  member_code: string | null;
  member_name: string | null;
  member_active: boolean | null;
  requires_driver: boolean | null;
  driver_qualifications: Array<{ code: string; expiresAt: string | null }> | null;
};

export type PlannedResourceOperationsRow = {
  id: string;
  requirement_kind: string;
  resource_type_code: string | null;
  labor_type_code: string | null;
  planned_quantity: string;
  operational_start: string | null;
  operational_end: string | null;
  status: string;
};

export type ExecutionActualRow = {
  id: string;
  actual_kind: string;
  physical_asset_id: string | null;
  workforce_member_id: string | null;
  resource_label: string | null;
  actual_value: string;
  unit_of_measure: string;
  planned_value: string | null;
  planned_unit_of_measure: string | null;
  source: string;
  occurred_at: string;
  notes: string | null;
};

export type ExecutionMeterRow = {
  id: string;
  physical_asset_id: string;
  meter_kind: string;
  reading_value: string;
  unit_of_measure: string;
  is_initial: boolean;
  is_final: boolean;
  read_at: string;
};

export type ExecutionFuelRow = {
  id: string;
  physical_asset_id: string;
  volume_liters: string;
  amount: string | null;
  unit_price: string | null;
  odometer_reading: string | null;
  fueled_at: string;
};

export type ExecutionEvidenceOperationsRow = {
  id: string;
  evidence_kind: string;
  status: string;
  recorded_at: string;
};

export type ExecutionSignatureRow = {
  id: string;
  signer_name: string;
  signer_document: string | null;
  signer_role: string | null;
  signature_kind: string;
  signed_at: string;
};

export type ExecutionSituationRow = {
  id: string;
  situation_code: string;
  detected_key: string;
  severity: string;
  status: string;
  title: string;
  detail: string | null;
  /** `{ blocking: boolean, text: string }` — o modelo de impacto da detecção. */
  impact: Record<string, unknown>;
  owner_role: string | null;
  next_best_action: string | null;
  detected_at: string;
};

export type ExecutionEventRow = {
  id: string;
  event_kind: string;
  from_status: string | null;
  to_status: string | null;
  detail: Record<string, unknown>;
  is_blocking: boolean;
  actor_identity_id: string | null;
  occurred_at: string;
};

export type ExecutionClosureRow = {
  id: string;
  closure_number: number;
  actuals_snapshot: Record<string, unknown>;
  plan_vs_actual: Record<string, unknown>;
  evidence_summary: Record<string, unknown>;
  closed_at: string;
};

export type MeasurementBasisRow = {
  id: string;
  closure_id: string;
  status: string;
  lines: unknown;
  actuals: Record<string, unknown>;
  evidence: Record<string, unknown>;
  prepared_at: string;
};

/**
 * Todos os fatos de operação de uma ordem, numa leitura só.
 *
 * `null` no agregado significa "ordem inexistente" — nunca "ordem sem dados".
 */
export type ExecutionOperationsFacts = {
  order: ServiceOrderOperationsRow;
  dispatch: DispatchRow | null;
  allocations: AllocationRow[];
  plannedResources: PlannedResourceOperationsRow[];
  actuals: ExecutionActualRow[];
  meters: ExecutionMeterRow[];
  fuel: ExecutionFuelRow[];
  evidence: ExecutionEvidenceOperationsRow[];
  signatures: ExecutionSignatureRow[];
  situations: ExecutionSituationRow[];
  events: ExecutionEventRow[];
  closure: ExecutionClosureRow | null;
  measurementBasis: MeasurementBasisRow | null;
  /**
   * Códigos dos tipos de recurso físico classificados como `VEHICLE`.
   *
   * Lido de `cat.physical_resource_types.classification`, que é o ÚNICO lugar do
   * schema que declara a natureza do recurso. Sem este conjunto, a exigência de
   * condutor teria de ser adivinhada pelo nome do tipo — e o nome é texto livre
   * (`WATER_TRUCK`, `CAMINHAO_PIPA`, `PIPA-01`). O domínio recebe o conjunto pronto
   * e não consulta banco.
   */
  vehicleTypeCodes: string[];
  /**
   * Quantidade de entradas operacionais do tipo QUANTITY.
   *
   * Fonte de "quantidade medida" para o gate de conclusão. Distinta do realizado de
   * custo: a medição consome `so.execution_entries`, não `so.execution_actuals`.
   */
  measuredQuantityCount: number;
  /** Quantidade de entradas operacionais (progresso, medição, observação). */
  progressEntryCount: number;
  /**
   * Tipos de evidência JÁ SATISFEITOS por entrada operacional.
   *
   * Uma entrada MILEAGE/HOUR_METER/QUANTITY/OBSERVATION satisfaz a exigência do
   * mesmo tipo — regra que o domínio de execução já aplica
   * (`collectSatisfiedEvidenceKinds`). Sem esta lista, o gate de conclusão olhava
   * apenas `so.execution_evidence` e recusava ordens corretamente registradas.
   */
  satisfiedEvidenceKinds: string[];
};

// ═══════════════════════════════════════════════════════════════════════════════
// ENTRADAS DE COMANDO
// ═══════════════════════════════════════════════════════════════════════════════

export type RecordDispatchInput = {
  serviceOrderId: string;
  unitId: string;
  clientId: string | null;
  orderNumber: string;
  rowVersion: number;
  windowStart: string;
  windowEnd: string;
  confirmedResources: unknown[];
  readinessSnapshot: Record<string, unknown>;
  actorIdentityId: string;
  idempotencyKey: string;
};

export type RecordExecutionActualInput = {
  serviceOrderId: string;
  actualKind: string;
  physicalAssetId: string | null;
  workforceMemberId: string | null;
  resourceLabel: string | null;
  actualValue: string;
  unitOfMeasure: string;
  plannedValue: string | null;
  plannedUnitOfMeasure: string | null;
  source: string;
  evidenceId: string | null;
  occurredAt: string;
  actorIdentityId: string;
  notes: string | null;
  correlationId: string | null;
  idempotencyKey: string;
  rowVersion: number;
};

export type RecordExecutionMeterInput = {
  serviceOrderId: string;
  physicalAssetId: string;
  meterKind: string;
  readingValue: string;
  unitOfMeasure: string;
  isInitial: boolean;
  isFinal: boolean;
  readAt: string;
  actorIdentityId: string;
  evidenceId: string | null;
  notes: string | null;
  idempotencyKey: string;
  rowVersion: number;
};

export type RecordExecutionFuelInput = {
  serviceOrderId: string;
  physicalAssetId: string;
  volumeLiters: string;
  unitPrice: string | null;
  amount: string | null;
  odometerReading: string | null;
  fueledAt: string;
  actorIdentityId: string;
  evidenceId: string | null;
  supplierReference: string | null;
  notes: string | null;
  idempotencyKey: string;
  rowVersion: number;
};

export type RecordExecutionSignatureInput = {
  serviceOrderId: string;
  signerName: string;
  signerDocument: string | null;
  signerRole: string | null;
  signatureKind: string;
  evidenceId: string | null;
  signedAt: string;
  actorIdentityId: string;
  notes: string | null;
  idempotencyKey: string;
  rowVersion: number;
};

// ═══════════════════════════════════════════════════════════════════════════════
// DESFECHOS
// ═══════════════════════════════════════════════════════════════════════════════

export type DispatchPersistenceResult =
  | {
      outcome: 'success';
      dispatchId: string;
      dispatchedAt: string;
      rowVersion: number;
    }
  | { outcome: 'idempotent'; payload: Record<string, unknown> }
  | { outcome: 'version_conflict' }
  | { outcome: 'invalid_state' }
  | { outcome: 'not_found' }
  | { outcome: 'not_dispatched' }
  | { outcome: 'already_dispatched'; dispatchId: string }
  | { outcome: 'already_checked_in' }
  | { outcome: 'idempotency_conflict' };

export type ActualPersistenceResult =
  | { outcome: 'success'; actual: ExecutionActualRow; rowVersion: number }
  | { outcome: 'idempotent'; payload: { actual: ExecutionActualRow } }
  | { outcome: 'version_conflict' }
  | { outcome: 'invalid_state' }
  | { outcome: 'not_found' }
  | { outcome: 'idempotency_conflict' };

export type MeterPersistenceResult =
  | { outcome: 'success'; reading: ExecutionMeterRow; rowVersion: number }
  | { outcome: 'version_conflict' }
  | { outcome: 'invalid_state' }
  | { outcome: 'not_found' }
  | { outcome: 'meter_not_monotonic' }
  | { outcome: 'duplicate_final_reading' }
  | { outcome: 'idempotency_conflict' };

export type FuelPersistenceResult =
  | { outcome: 'success'; record: ExecutionFuelRow; rowVersion: number }
  | { outcome: 'version_conflict' }
  | { outcome: 'invalid_state' }
  | { outcome: 'not_found' }
  | { outcome: 'idempotency_conflict' };

export type SignaturePersistenceResult =
  | { outcome: 'success'; signature: ExecutionSignatureRow; rowVersion: number }
  | { outcome: 'version_conflict' }
  | { outcome: 'invalid_state' }
  | { outcome: 'not_found' }
  | { outcome: 'idempotency_conflict' };
