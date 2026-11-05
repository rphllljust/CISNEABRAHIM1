import { describe, expect, it } from 'vitest';
import {
  assertTransportAllocationWithinScheduledWindow,
  assertTransportRoutePresent,
  assertTransportScheduledWindowPresent,
  isTransportServiceOrder,
  parseTransportRoute,
  resolveTransportCommercialUnitCode,
} from './transport-operations';

describe('transport-operations', () => {
  it('identifies transport service orders by archetype', () => {
    expect(isTransportServiceOrder({ archetype: 'TRANSPORT' })).toBe(true);
    expect(isTransportServiceOrder({ archetype: 'RENTAL' })).toBe(false);
  });

  it('resolves commercial unit from service snapshot', () => {
    expect(
      resolveTransportCommercialUnitCode({
        measurementModel: { mode: 'BY_EVENT', basis: 'TRIP', defaultUnitCode: 'TRIP' },
      }),
    ).toBe('TRIP');
  });

  it('parses origin and destination from service order location', () => {
    expect(
      parseTransportRoute({
        origin: 'Pátio Central',
        destination: 'Silo Cliente',
        city: 'Porto Velho',
      }),
    ).toEqual({
      origin: 'Pátio Central',
      destination: 'Silo Cliente',
    });
  });

  it('requires origin and destination for transport route', () => {
    expect(() =>
      assertTransportRoutePresent({
        origin: 'Pátio Central',
        destination: 'Silo Cliente',
      }),
    ).not.toThrow();
    expect(() => assertTransportRoutePresent({ origin: 'Pátio Central' })).toThrow('TRANSPORT_ROUTE_REQUIRED');
    expect(() => assertTransportRoutePresent({})).toThrow('TRANSPORT_ROUTE_REQUIRED');
  });

  it('requires scheduled window on planned transport resource', () => {
    expect(() =>
      assertTransportScheduledWindowPresent({
        operationalStart: '2026-08-01T06:00:00.000Z',
        operationalEnd: '2026-08-01T14:00:00.000Z',
      }),
    ).not.toThrow();
    expect(() => assertTransportScheduledWindowPresent({ operationalStart: null, operationalEnd: null })).toThrow(
      'TRANSPORT_SCHEDULED_WINDOW_REQUIRED',
    );
  });

  it('validates allocation interval within scheduled transport window', () => {
    const scheduledStart = new Date('2026-08-01T06:00:00.000Z');
    const scheduledEnd = new Date('2026-08-01T14:00:00.000Z');
    expect(() =>
      assertTransportAllocationWithinScheduledWindow(
        new Date('2026-08-01T06:00:00.000Z'),
        new Date('2026-08-01T10:00:00.000Z'),
        scheduledStart,
        scheduledEnd,
      ),
    ).not.toThrow();
    expect(() =>
      assertTransportAllocationWithinScheduledWindow(
        new Date('2026-08-01T06:00:00.000Z'),
        new Date('2026-08-01T15:00:00.000Z'),
        scheduledStart,
        scheduledEnd,
      ),
    ).toThrow('ALLOCATION_OUTSIDE_PLANNED_WINDOW');
  });

  it('rejects malformed schedules and an invalid reservation interval', () => {
    expect(() => assertTransportScheduledWindowPresent({
      operationalStart: '2026-10-02T12:00:00Z',
      operationalEnd: '2026-10-01T12:00:00Z',
    })).toThrow('TRANSPORT_SCHEDULED_WINDOW_REQUIRED');
    expect(() => assertTransportAllocationWithinScheduledWindow(
      new Date('invalid'), new Date('2026-10-01T12:00:00Z'),
      new Date('2026-10-01T08:00:00Z'), new Date('2026-10-02T08:00:00Z'),
    )).toThrow('ALLOCATION_OUTSIDE_PLANNED_WINDOW');
  });

});
