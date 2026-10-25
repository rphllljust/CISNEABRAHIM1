import type {
  MeasurementAdjustmentRow,
  MeasurementHistoryEventRow,
  MeasurementItemRow,
  MeasurementRow,
} from '../repositories/measurements.repository.types';
import { formatMoneyAmountForApi } from '../../commercial/domain/money';
import {
  toHistoryEventResponse as toSharedHistoryEventResponse,
  type HistoryEventResponse,
} from '../../infrastructure/http/contracts';
import { normalizeMeasuredQuantity } from '../domain/measurement-quantity';

/**
 * ITEM DE MEDIÇÃO NA RESPOSTA.
 *
 * `sourceExecutionEntryId` passou a ser `string | null`, e a razão é a correção
 * desta capability: o item novo nasce da BASE publicada e não tem vínculo com a
 * entrada de execução. Manter o tipo `string` obrigaria a mentir (preencher um
 * id que não existe) ou a esconder a origem nova.
 *
 * As três quantidades são publicadas SEPARADAS porque são três verdades:
 * `plannedQuantity` (expectativa congelada da base), `actualQuantity` (realizado
 * congelado) e `measuredQuantity` (reconhecimento comercial). Um campo só faria
 * a tela escolher — e a escolha depende do contrato.
 */
export type MeasurementItemResponse = {
  id: string;
  lineNumber: number;
  /** Origem autoritativa: a base publicada pela execução. */
  sourceMeasurementBasisId: string | null;
  /** Chave da linha na base. */
  sourceBasisLineKey: string | null;
  /** Origem HISTÓRICA. `null` em item derivado da base. */
  sourceExecutionEntryId: string | null;
  unitCode: string;
  plannedQuantity: string | null;
  plannedUnitOfMeasure: string | null;
  actualQuantity: string;
  measuredQuantity: string;
  unitPrice: string | null;
  lineAmount: string | null;
  pricingLineSnapshot: Record<string, unknown>;
  notes: string | null;
};

export type MeasurementAdjustmentResponse = {
  id: string;
  measurementItemId: string;
  adjustmentQuantity: string;
  unitCode: string;
  reason: string;
  authorizedByIdentityId: string;
  createdAt: string;
};

export type MeasurementHistoryEventResponse = HistoryEventResponse;

export type MeasurementResponse = {
  id: string;
  serviceOrderId: string;
  unitId: string;
  status: string;
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
};

export type MeasurementDetailResponse = MeasurementResponse & {
  items: MeasurementItemResponse[];
  adjustments: MeasurementAdjustmentResponse[];
  historyEvents: MeasurementHistoryEventResponse[];
};

export function toMeasurementItemResponse(row: MeasurementItemRow): MeasurementItemResponse {
  const extended = row as unknown as Record<string, unknown>;
  return {
    id: row.id,
    lineNumber: row.line_number,
    sourceMeasurementBasisId: readNullableText(extended['source_measurement_basis_id']),
    sourceBasisLineKey: readNullableText(extended['source_basis_line_key']),
    sourceExecutionEntryId: row.source_execution_entry_id,
    unitCode: row.unit_code,
    plannedQuantity: readNullableText(extended['planned_quantity']),
    plannedUnitOfMeasure: readNullableText(extended['planned_unit_of_measure']),
    actualQuantity: normalizeMeasuredQuantity(row.actual_quantity),
    measuredQuantity: normalizeMeasuredQuantity(row.measured_quantity),
    unitPrice: row.unit_price ? formatMoneyAmountForApi(row.unit_price) : null,
    lineAmount: row.line_amount ? formatMoneyAmountForApi(row.line_amount) : null,
    pricingLineSnapshot: row.pricing_line_snapshot,
    notes: row.notes,
  };
}

/**
 * Lê texto de coluna opcional.
 *
 * Um `null` continua `null`: `String(null)` produziria `"null"`, que na tela é um
 * código válido com aparência de dado — o defeito que `readJsonString` já evita
 * em outro módulo.
 */
function readNullableText(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return null;
}

export function toMeasurementAdjustmentResponse(
  row: MeasurementAdjustmentRow,
): MeasurementAdjustmentResponse {
  return {
    id: row.id,
    measurementItemId: row.measurement_item_id,
    adjustmentQuantity: normalizeMeasuredQuantity(row.adjustment_quantity),
    unitCode: row.unit_code,
    reason: row.reason,
    authorizedByIdentityId: row.authorized_by_identity_id,
    createdAt: row.created_at,
  };
}

export function toMeasurementHistoryEventResponse(
  row: MeasurementHistoryEventRow,
): MeasurementHistoryEventResponse {
  return toSharedHistoryEventResponse(row);
}

export function toMeasurementResponse(row: MeasurementRow): MeasurementResponse {
  return {
    id: row.id,
    serviceOrderId: row.service_order_id,
    unitId: row.unit_id,
    status: row.status,
    commercialReferenceSnapshot: row.commercial_reference_snapshot,
    submittedAt: row.submitted_at,
    submittedByIdentityId: row.submitted_by_identity_id,
    reviewStartedAt: row.review_started_at,
    reviewStartedByIdentityId: row.review_started_by_identity_id,
    decidedAt: row.decided_at,
    decidedByIdentityId: row.decided_by_identity_id,
    rejectionReason: row.rejection_reason,
    rowVersion: row.row_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toMeasurementDetailResponse(
  row: MeasurementRow,
  items: MeasurementItemRow[],
  adjustments: MeasurementAdjustmentRow[],
  historyEvents: MeasurementHistoryEventRow[],
): MeasurementDetailResponse {
  return {
    ...toMeasurementResponse(row),
    items: items.map(toMeasurementItemResponse),
    adjustments: adjustments.map(toMeasurementAdjustmentResponse),
    historyEvents: historyEvents.map(toMeasurementHistoryEventResponse),
  };
}
