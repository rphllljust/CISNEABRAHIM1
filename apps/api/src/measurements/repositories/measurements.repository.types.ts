export type MeasurementRow = {
  id: string;
  service_order_id: string;
  unit_id: string;
  status: string;
  commercial_reference_snapshot: Record<string, unknown>;
  submitted_at: string | null;
  submitted_by_identity_id: string | null;
  review_started_at: string | null;
  review_started_by_identity_id: string | null;
  decided_at: string | null;
  decided_by_identity_id: string | null;
  rejection_reason: string | null;
  row_version: number;
  created_at: string;
  updated_at: string;
  created_by_identity_id: string;
  updated_by_identity_id: string;
};

export type MeasurementItemRow = {
  id: string;
  measurement_id: string;
  line_number: number;
  source_execution_entry_id: string;
  unit_code: string;
  actual_quantity: string;
  measured_quantity: string;
  unit_price: string | null;
  line_amount: string | null;
  pricing_line_snapshot: Record<string, unknown>;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type MeasurementAdjustmentRow = {
  id: string;
  measurement_id: string;
  measurement_item_id: string;
  adjustment_quantity: string;
  unit_code: string;
  reason: string;
  authorized_by_identity_id: string;
  created_at: string;
};

export type MeasurementHistoryEventRow = {
  id: string;
  measurement_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  actor_identity_id: string | null;
  occurred_at: string;
};

export type MeasurementCommandIdempotencyRow = {
  id: string;
  measurement_id: string;
  command_name: string;
  idempotency_key: string;
  response_payload: Record<string, unknown>;
  created_at: string;
};

export type ExecutionQuantityEntryRow = {
  id: string;
  entry_type: string;
  quantity_value: string;
  quantity_unit_code: string;
  recorded_at: string;
};

export type PricingModelRow = {
  model_code: string;
  sale_price: string | null;
  internal_cost: string | null;
  currency_code: string;
};

export type UnitOfMeasureRow = {
  code: string;
  decimal_scale: number;
};

/**
 * ITEM A PERSISTIR.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DUAS ORIGENS, UMA ESTRUTURA, E A DIFERENÇA É DECLARADA NO TIPO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   Origem AUTORITATIVA (novas medições)
 *     `sourceMeasurementBasisId` + `sourceBasisLineKey` preenchidos,
 *     `sourceExecutionEntryId` `null`.
 *
 *   Origem HISTÓRICA (medições criadas antes desta capability)
 *     `sourceExecutionEntryId` preenchido, base `null`. Regenerar essas medições
 *     é recusado pelo domínio: trocar a origem no meio da vida do registro
 *     reescreveria passado.
 *
 * As três quantidades são campos SEPARADOS. `plannedQuantity` vem da base e é a
 * referência de comparação; `actualQuantity` é o realizado congelado no
 * fechamento; `measuredQuantity` é o reconhecimento comercial. Um tipo com um
 * campo só apagaria a diferença entre as três verdades.
 */
export type MeasurementItemPersistenceDraft = {
  /** Origem autoritativa. `null` apenas para itens históricos. */
  sourceMeasurementBasisId: string | null;
  /** Chave da linha na base publicada. `null` apenas para itens históricos. */
  sourceBasisLineKey: string | null;
  /** Origem histórica (`execution_entries`). `null` para itens novos. */
  sourceExecutionEntryId: string | null;
  unitCode: string;
  plannedQuantity: string | null;
  plannedUnitOfMeasure: string | null;
  actualQuantity: string;
  measuredQuantity: string;
  unitPrice: string | null;
  lineAmount: string | null;
  pricingLineSnapshot: Record<string, unknown>;
};

export type CreateMeasurementPersistenceInput = {
  serviceOrderId: string;
  unitId: string;
  actorIdentityId: string;
  commercialReferenceSnapshot: Record<string, unknown>;
  items: MeasurementItemPersistenceDraft[];
};

export type CreateMeasurementPersistenceResult =
  | { outcome: 'success'; measurement: MeasurementRow }
  | { outcome: 'already_exists' };

export type RegenerateMeasurementItemsInput = {
  measurementId: string;
  rowVersion: number;
  actorIdentityId: string;
  items: CreateMeasurementPersistenceInput['items'];
};

export type RegenerateMeasurementItemsResult =
  | { outcome: 'success'; rowVersion: number }
  | { outcome: 'version_conflict' }
  | { outcome: 'not_editable' };

export type UpdateMeasurementItemInput = {
  measurementId: string;
  itemId: string;
  rowVersion: number;
  actorIdentityId: string;
  measuredQuantity: string;
  lineAmount: string | null;
};

export type UpdateMeasurementItemResult =
  | { outcome: 'success'; item: MeasurementItemRow; rowVersion: number }
  | { outcome: 'version_conflict' }
  | { outcome: 'not_editable' }
  | { outcome: 'item_not_found' };

export type AuthorizeAdjustmentInput = {
  measurementId: string;
  itemId: string;
  rowVersion: number;
  actorIdentityId: string;
  adjustmentQuantity: string;
  unitCode: string;
  reason: string;
};

export type AuthorizeAdjustmentResult =
  | { outcome: 'success'; adjustment: MeasurementAdjustmentRow; rowVersion: number }
  | { outcome: 'version_conflict' }
  | { outcome: 'not_editable' }
  | { outcome: 'item_not_found' };

export type MeasurementTransitionInput = {
  measurementId: string;
  rowVersion: number;
  actorIdentityId: string;
  currentStatus: string;
  nextStatus: string;
  transition: 'submit' | 'startReview' | 'approve' | 'reject' | 'resubmit';
  commandName: string;
  idempotencyKey?: string;
  rejectionReason?: string;
};

export type MeasurementTransitionResult =
  | { outcome: 'success'; rowVersion: number }
  | { outcome: 'version_conflict' }
  | { outcome: 'invalid_state' };

export type SumAdjustmentsRow = {
  total: string;
};
