import { describe, expect, it } from 'vitest';
import {
  formatMeasurementHistoryEventDetail,
  formatMeasurementHistoryEventLabel,
} from './measurement-history-labels';

describe('measurement history labels', () => {
  it('labels every registered decision event', () => {
    expect(formatMeasurementHistoryEventLabel('CREATED')).toBe('Medição gerada');
    expect(formatMeasurementHistoryEventLabel('SUBMITTED')).toBe('Medição submetida');
    expect(formatMeasurementHistoryEventLabel('REVIEW_STARTED')).toBe('Análise iniciada');
    expect(formatMeasurementHistoryEventLabel('APPROVED')).toBe('Medição aprovada');
    expect(formatMeasurementHistoryEventLabel('REJECTED')).toBe('Medição rejeitada');
    expect(formatMeasurementHistoryEventLabel('RESUBMITTED')).toBe('Medição reenviada');
    expect(formatMeasurementHistoryEventLabel('ADJUSTMENT_AUTHORIZED')).toBe('Ajuste autorizado');
  });

  it('falls back to the raw event type instead of inventing a label', () => {
    expect(formatMeasurementHistoryEventLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });

  it('surfaces the rejection reason and item counts from the payload', () => {
    expect(
      formatMeasurementHistoryEventDetail({
        id: 'e1',
        eventType: 'REJECTED',
        payload: { rejectionReason: 'Divergência não justificada.' },
        actorIdentityId: null,
        occurredAt: '2026-01-02T10:00:00.000Z',
      }),
    ).toBe('Motivo: Divergência não justificada.');

    expect(
      formatMeasurementHistoryEventDetail({
        id: 'e2',
        eventType: 'CREATED',
        payload: { itemCount: 2 },
        actorIdentityId: null,
        occurredAt: '2026-01-02T08:00:00.000Z',
      }),
    ).toBe('2 itens');

    expect(
      formatMeasurementHistoryEventDetail({
        id: 'e3',
        eventType: 'CREATED',
        payload: { itemCount: 1 },
        actorIdentityId: null,
        occurredAt: '2026-01-02T08:00:00.000Z',
      }),
    ).toBe('1 item');
  });

  it('omits the detail when the payload carries nothing to show', () => {
    expect(
      formatMeasurementHistoryEventDetail({
        id: 'e4',
        eventType: 'SUBMITTED',
        payload: { fromStatus: 'DRAFT', toStatus: 'SUBMITTED', rejectionReason: null },
        actorIdentityId: null,
        occurredAt: '2026-01-02T09:00:00.000Z',
      }),
    ).toBeNull();
  });
});
