import { describe, expect, it } from 'vitest';
import { SERVICE_ORDER_STATUSES } from './service-order';
import { buildControlCenter } from './operations-control-center';
import type { ServiceOrderControlCenterFacts } from '../repositories/service-order-control-center.persistence';

const facts: ServiceOrderControlCenterFacts = {
  planned_resource_count: 0,
  active_allocation_count: 0,
  execution_entry_count: 0,
  executed_quantity_total: null,
  execution_occurrence_count: 0,
  execution_evidence_count: 0,
  measurement_count: 0,
  measurement_status: null,
  measurement_created_at: null,
  billing_count: 0,
  billing_status: null,
  billing_created_at: null,
  billing_total_amount: null,
  billing_currency_code: null,
};

function build(availableTransitions: Array<'prepare' | 'cancel'>, readinessBlockers: string[] = []) {
  return buildControlCenter({
    status: SERVICE_ORDER_STATUSES.Draft,
    createdAt: '2026-10-17T00:00:00.000Z',
    preparedAt: null,
    releasedAt: null,
    startedAt: null,
    pausedAt: null,
    completedAt: null,
    reopenedAt: null,
    serviceRequestId: null,
    facts,
    availableTransitions,
    readinessBlockers,
  });
}

describe('operations control center command availability', () => {
  it('does not advertise prepare when backend readiness filtered it out', () => {
    const control = build(['cancel'], ['SERVICE_DEFINITION_REQUIRED']);

    expect(control.nextAction.transition).toBeNull();
    expect(control.nextAction.step).toBe('WAITING');
    expect(control.nextAction.availableTransitions).toEqual(['cancel']);
    expect(control.nextAction.blockers).toContain('SERVICE_DEFINITION_REQUIRED');
  });

  it('advertises prepare when it is both ready and available', () => {
    const control = build(['prepare', 'cancel']);

    expect(control.nextAction.transition).toBe('prepare');
    expect(control.nextAction.step).toBe('PREPARE');
    expect(control.nextAction.blockers).not.toContain('SERVICE_DEFINITION_REQUIRED');
  });
});
