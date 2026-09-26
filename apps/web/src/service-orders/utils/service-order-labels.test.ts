import { describe, expect, it } from 'vitest';
import {
  formatAssigneeLabel,
  formatDeadlineLabel,
  formatServiceOrderHistoryEventDetail,
  formatServiceOrderHistoryEventLabel,
} from './service-order-labels';

describe('dispatch projection labels', () => {
  it('declares the absence of assignment instead of inventing a responsible', () => {
    expect(formatAssigneeLabel(null)).toBe('Sem responsável');
    expect(formatAssigneeLabel(undefined as never)).toBe('Sem responsável');
  });

  it('identifies the assigned member by name and code, never by uuid', () => {
    expect(formatAssigneeLabel({ memberCode: 'EMP-001', displayName: 'Dev Um' })).toBe(
      'Dev Um (EMP-001)',
    );
  });

  it('declares the absence of a deadline instead of inventing one', () => {
    expect(formatDeadlineLabel(null)).toBe('Sem prazo');
    expect(formatDeadlineLabel('2026-01-02T10:00:00.000Z')).not.toBe('Sem prazo');
  });
});

describe('service order history labels', () => {
  it('labels the programming phase registered by the backend', () => {
    expect(formatServiceOrderHistoryEventLabel('PLANNED_RESOURCE_ADDED')).toBe(
      'Recurso planejado',
    );
    expect(formatServiceOrderHistoryEventLabel('RESOURCE_ALLOCATED')).toBe('Recurso alocado');
    expect(formatServiceOrderHistoryEventLabel('ALLOCATION_REMOVED')).toBe('Alocação removida');
  });

  it('falls back to the raw event type instead of inventing a label', () => {
    expect(formatServiceOrderHistoryEventLabel('UNKNOWN_EVENT')).toBe('UNKNOWN_EVENT');
  });

  it('reports the changed fields on a replan', () => {
    expect(
      formatServiceOrderHistoryEventDetail({
        id: 'e1',
        eventType: 'PLANNED_RESOURCE_UPDATED',
        payload: { resourceTypeCode: 'TRUCK', plannedQuantity: '3.0000', changedFields: ['plannedQuantity'] },
        actorIdentityId: null,
        occurredAt: '2026-01-02T08:00:00.000Z',
      }),
    ).toBe('TRUCK · qtd. 3.0000 · campos: quantidade planejada');
  });

  it('returns null when a lifecycle transition carries no detail', () => {
    expect(
      formatServiceOrderHistoryEventDetail({
        id: 'e2',
        eventType: 'RELEASED',
        payload: { fromStatus: 'PREPARED', toStatus: 'RELEASED' },
        actorIdentityId: null,
        occurredAt: '2026-01-02T08:00:00.000Z',
      }),
    ).toBeNull();
  });
});
