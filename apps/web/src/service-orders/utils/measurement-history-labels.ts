import type { MeasurementHistoryEvent } from '../types/measurement.types';

const MEASUREMENT_HISTORY_EVENT_LABELS: Record<string, string> = {
  CREATED: 'Medição gerada',
  REGENERATED: 'Itens regerados a partir da execução',
  ITEM_UPDATED: 'Item ajustado manualmente',
  ADJUSTMENT_AUTHORIZED: 'Ajuste autorizado',
  SUBMITTED: 'Medição submetida',
  REVIEW_STARTED: 'Análise iniciada',
  APPROVED: 'Medição aprovada',
  REJECTED: 'Medição rejeitada',
  RESUBMITTED: 'Medição reenviada',
};

export function formatMeasurementHistoryEventLabel(eventType: string): string {
  return MEASUREMENT_HISTORY_EVENT_LABELS[eventType] ?? eventType;
}

function readPayloadString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * Detalhe legivel do evento de medicao. Usa apenas chaves que o backend
 * realmente grava; quando nada esta disponivel devolve null e a UI omite.
 */
export function formatMeasurementHistoryEventDetail(
  event: MeasurementHistoryEvent,
): string | null {
  const payload = event.payload ?? {};

  const rejectionReason = readPayloadString(payload, 'rejectionReason');
  if (rejectionReason) {
    return `Motivo: ${rejectionReason}`;
  }

  const parts: string[] = [];
  const itemCount = payload['itemCount'];
  if (typeof itemCount === 'number') {
    parts.push(`${itemCount} ${itemCount === 1 ? 'item' : 'itens'}`);
  }
  const measuredQuantity = readPayloadString(payload, 'measuredQuantity');
  if (measuredQuantity) {
    parts.push(`quantidade medida: ${measuredQuantity}`);
  }
  const adjustmentQuantity = readPayloadString(payload, 'adjustmentQuantity');
  if (adjustmentQuantity) {
    parts.push(`ajuste: ${adjustmentQuantity}`);
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}
