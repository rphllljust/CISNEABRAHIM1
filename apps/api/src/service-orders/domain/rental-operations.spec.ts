import { describe, expect, it } from 'vitest';
import {
  assertRentalAllocationWithinContractedPeriod,
  assertRentalContractedPeriodPresent,
  isRentalServiceOrder,
  resolveRentalCommercialUnitCode,
} from './rental-operations';

describe('rental-operations', () => {
  it('identifies rental service orders by archetype', () => {
    expect(isRentalServiceOrder({ archetype: 'RENTAL' })).toBe(true);
    expect(isRentalServiceOrder({ archetype: 'TRANSPORT' })).toBe(false);
  });

  it('resolves commercial unit from service snapshot', () => {
    expect(
      resolveRentalCommercialUnitCode({
        measurementModel: { mode: 'BY_PERIOD', basis: 'TIME', defaultUnitCode: 'DAY' },
      }),
    ).toBe('DAY');
  });

  it('requires contracted period on planned rental resource', () => {
    expect(() =>
      assertRentalContractedPeriodPresent({
        operationalStart: '2026-07-01T08:00:00.000Z',
        operationalEnd: '2026-07-04T18:00:00.000Z',
      }),
    ).not.toThrow();
    expect(() => assertRentalContractedPeriodPresent({ operationalStart: null, operationalEnd: null })).toThrow(
      'RENTAL_CONTRACTED_PERIOD_REQUIRED',
    );
  });

  it('validates allocation interval within contracted rental period', () => {
    const contractedStart = new Date('2026-07-01T08:00:00.000Z');
    const contractedEnd = new Date('2026-07-04T18:00:00.000Z');
    expect(() =>
      assertRentalAllocationWithinContractedPeriod(
        new Date('2026-07-01T08:00:00.000Z'),
        new Date('2026-07-03T18:00:00.000Z'),
        contractedStart,
        contractedEnd,
      ),
    ).not.toThrow();
    expect(() =>
      assertRentalAllocationWithinContractedPeriod(
        new Date('2026-07-01T08:00:00.000Z'),
        new Date('2026-07-05T18:00:00.000Z'),
        contractedStart,
        contractedEnd,
      ),
    ).toThrow('ALLOCATION_OUTSIDE_PLANNED_WINDOW');
  });

  it('rejects inverted contracted periods and invalid allocation timestamps', () => {
    expect(() => assertRentalContractedPeriodPresent({
      operationalStart: '2026-09-02T12:00:00Z',
      operationalEnd: '2026-09-01T12:00:00Z',
    })).toThrow('RENTAL_CONTRACTED_PERIOD_REQUIRED');
    expect(() => assertRentalAllocationWithinContractedPeriod(
      new Date('invalid'), new Date('2026-09-01T12:00:00Z'),
      new Date('2026-09-01T08:00:00Z'), new Date('2026-09-02T08:00:00Z'),
    )).toThrow('ALLOCATION_OUTSIDE_PLANNED_WINDOW');
  });

});
