export const MEASUREMENT_STATUSES = {
  Draft: 'DRAFT',
  Submitted: 'SUBMITTED',
  UnderReview: 'UNDER_REVIEW',
  Approved: 'APPROVED',
  Rejected: 'REJECTED',
} as const;

export type MeasurementStatus = (typeof MEASUREMENT_STATUSES)[keyof typeof MEASUREMENT_STATUSES];

export const MEASUREMENTS_ERROR_CODES = {
  VALIDATION_FAILED: 'MEASUREMENTS_VALIDATION_FAILED',
  DENIED: 'MEASUREMENTS_DENIED',
  NOT_FOUND: 'MEASUREMENTS_NOT_FOUND',
  SERVICE_ORDER_NOT_FOUND: 'MEASUREMENTS_SERVICE_ORDER_NOT_FOUND',
  INVALID_STATE: 'MEASUREMENTS_INVALID_STATE',
  VERSION_CONFLICT: 'MEASUREMENTS_VERSION_CONFLICT',
  NOT_EDITABLE: 'MEASUREMENTS_NOT_EDITABLE',
  SERVICE_ORDER_NOT_COMPLETED: 'MEASUREMENTS_SERVICE_ORDER_NOT_COMPLETED',
  MEASUREMENT_ALREADY_EXISTS: 'MEASUREMENTS_MEASUREMENT_ALREADY_EXISTS',
  COMMERCIAL_REFERENCE_MISSING: 'MEASUREMENTS_COMMERCIAL_REFERENCE_MISSING',
  MEASUREMENT_ITEMS_REQUIRED: 'MEASUREMENTS_ITEMS_REQUIRED',
  UNIT_NOT_ALLOWED: 'MEASUREMENTS_UNIT_NOT_ALLOWED',
  MEASUREMENT_DIVERGENCE_NOT_AUTHORIZED: 'MEASUREMENTS_DIVERGENCE_NOT_AUTHORIZED',
  SEPARATION_OF_DUTIES_VIOLATION: 'MEASUREMENTS_SEPARATION_OF_DUTIES_VIOLATION',
  ITEM_NOT_FOUND: 'MEASUREMENTS_ITEM_NOT_FOUND',
} as const;

export type MeasurementsErrorCode =
  (typeof MEASUREMENTS_ERROR_CODES)[keyof typeof MEASUREMENTS_ERROR_CODES];

export type MeasurementItem = {
  id: string;
  lineNumber: number;
  /**
   * ORIGEM AUTORITATIVA — a base publicada pelo fechamento da execução.
   *
   * `sourceExecutionEntryId` sozinho descrevia a origem ANTIGA: o item derivado
   * de `so.execution_entries`, a leitura interna da execução. Depois desta
   * capability o item novo nasce da base, e este campo traz a chave da linha
   * publicada.
   */
  sourceMeasurementBasisId: string | null;
  sourceBasisLineKey: string | null;
  /**
   * ORIGEM HISTÓRICA. `null` em item derivado da base.
   *
   * Medições criadas antes desta capability têm itens apontando para a entrada
   * de execução, e esses registros NÃO são reescritos — trocar a origem no meio
   * da vida do registro reescreveria passado.
   */
  sourceExecutionEntryId: string | null;
  unitCode: string;
  /**
   * AS TRÊS VERDADES.
   *
   * `plannedQuantity` (expectativa congelada da base), `actualQuantity`
   * (realizado congelado no fechamento) e `measuredQuantity` (reconhecimento
   * comercial). São campos SEPARADOS porque são três grandezas diferentes: somar
   * as três num número só apagaria a decisão comercial.
   */
  plannedQuantity: string | null;
  plannedUnitOfMeasure: string | null;
  actualQuantity: string;
  measuredQuantity: string;
  unitPrice: string | null;
  lineAmount: string | null;
  pricingLineSnapshot: Record<string, unknown>;
  notes: string | null;
};

export type MeasurementAdjustment = {
  id: string;
  measurementItemId: string;
  adjustmentQuantity: string;
  unitCode: string;
  reason: string;
  authorizedByIdentityId: string;
  createdAt: string;
};

export type MeasurementHistoryEvent = {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  actorIdentityId: string | null;
  occurredAt: string;
};

export type MeasurementDetail = {
  id: string;
  serviceOrderId: string;
  unitId: string;
  status: MeasurementStatus;
  commercialReferenceSnapshot: Record<string, unknown>;
  submittedAt: string | null;
  submittedByIdentityId: string | null;
  reviewStartedAt: string | null;
  reviewStartedByIdentityId: string | null;
  decidedAt: string | null;
  decidedByIdentityId: string | null;
  rejectionReason: string | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
  items: MeasurementItem[];
  adjustments: MeasurementAdjustment[];
  historyEvents: MeasurementHistoryEvent[];
};

export type RowVersionCommand = {
  rowVersion: number;
  idempotencyKey?: string;
};

export type RejectMeasurementPayload = RowVersionCommand & {
  rejectionReason: string;
};

export type AuthorizeAdjustmentPayload = RowVersionCommand & {
  measurementItemId: string;
  adjustmentQuantity: string;
  reason: string;
};

export type UpdateMeasurementItemPayload = {
  rowVersion: number;
  measuredQuantity: string;
};

export type MeasurementCapabilities = {
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canSubmit: boolean;
  canReview: boolean;
  canApprove: boolean;
  canReject: boolean;
};
