import { describe, expect, it } from 'vitest';
import {
  RENTAL_CYCLE_ERROR_CODES,
  RentalCycleError,
} from './rental-cycle-errors';
import {
  assertCheckInReady,
  assertNoRentalOverlap,
  assertRentalNotTerminal,
  assertReservationWindowLocked,
  computeRentalLateDays,
  windowsOverlap,
  type RentalCheckInInput,
} from './rental-cycle';

const OVERLAPPING: RentalCheckInInput = {
  step: 'ACTIVE',
  readings: { unitCode: 'KM', initialReading: '1200', finalReading: '1450' },
  conditionCode: 'BOM',
  hasReturnEvidence: true,
  plannedEndsOn: '2026-08-31',
  actualEndsOn: '2026-08-31',
};

describe('rental cycle (sobreposição / devolução / atraso / concorrência)', () => {
  it('detects overlapping windows per asset and rejects reservation', () => {
    const existing = [{ id: 'alloc-1', assetId: 'asset-A', startsOn: '2026-08-01', endsOn: '2026-08-10' }];
    expect(() =>
      assertNoRentalOverlap('asset-A', { startsOn: '2026-08-05', endsOn: '2026-08-15' }, existing),
    ).toThrow(RentalCycleError);
    try {
      assertNoRentalOverlap('asset-A', { startsOn: '2026-08-05', endsOn: '2026-08-15' }, existing);
      throw new Error('expected throw');
    } catch (error) {
      expect((error as RentalCycleError).code).toBe(RENTAL_CYCLE_ERROR_CODES.ASSET_OVERLAP);
      expect((error as RentalCycleError).conflictingAllocationIds).toEqual(['alloc-1']);
    }
  });

  it('allows adjacent windows (end exclusive) and other assets', () => {
    const existing = [{ id: 'alloc-1', assetId: 'asset-A', startsOn: '2026-08-01', endsOn: '2026-08-10' }];
    expect(() =>
      assertNoRentalOverlap('asset-A', { startsOn: '2026-08-10', endsOn: '2026-08-20' }, existing),
    ).not.toThrow();
    expect(() =>
      assertNoRentalOverlap('asset-B', { startsOn: '2026-08-01', endsOn: '2026-09-30' }, existing),
    ).not.toThrow();
    expect(windowsOverlap({ startsOn: '2026-08-10', endsOn: '2026-08-20' }, existing[0]!)).toBe(false);
  });

  it('accepts valid check-in (devolução) with meter, condition and evidence', () => {
    expect(() => assertCheckInReady(OVERLAPPING)).not.toThrow();
    expect(computeRentalLateDays('2026-08-31', '2026-08-31')).toBe(0);
  });

  it('rejects check-in without condition/evidence or with backward meter', () => {
    expect(() => assertCheckInReady({ ...OVERLAPPING, conditionCode: '' })).toThrow(
      RENTAL_CYCLE_ERROR_CODES.CONDITION_REQUIRED,
    );
    expect(() => assertCheckInReady({ ...OVERLAPPING, hasReturnEvidence: false })).toThrow(
      RENTAL_CYCLE_ERROR_CODES.RETURN_EVIDENCE_REQUIRED,
    );
    expect(() =>
      assertCheckInReady({
        ...OVERLAPPING,
        readings: { unitCode: 'KM', initialReading: '1450', finalReading: '1200' },
      }),
    ).toThrow(RENTAL_CYCLE_ERROR_CODES.METER_BACKWARD);
    expect(() => assertCheckInReady({ ...OVERLAPPING, step: 'REQUESTED' })).toThrow(
      RENTAL_CYCLE_ERROR_CODES.INVALID_RENTAL_STEP,
    );
  });

  it('computes late days on devolution (atraso)', () => {
    expect(computeRentalLateDays('2026-08-31', '2026-09-05')).toBe(5);
    expect(computeRentalLateDays('2026-08-31', '2026-08-25')).toBe(0);
  });

  it('locks reservation window and forbids re-reservation after check-in (rollback/terminal)', () => {
    expect(() => assertReservationWindowLocked({ startsOn: '2026-08-01', endsOn: '2026-08-10' })).not.toThrow();
    expect(() => assertReservationWindowLocked({ startsOn: '2026-08-10', endsOn: '2026-08-10' })).toThrow(
      RENTAL_CYCLE_ERROR_CODES.INVALID_RENTAL_WINDOW,
    );
    expect(() => assertRentalNotTerminal('CHECKED_IN')).toThrow(RENTAL_CYCLE_ERROR_CODES.RENTAL_TERMINAL);
    expect(() => assertRentalNotTerminal('ACTIVE')).not.toThrow();
  });

  it('validates absolute rental windows across timezone offsets and rejects malformed input', () => {
    expect(windowsOverlap(
      { startsOn: '2026-09-01T07:00:00-04:00', endsOn: '2026-09-01T09:00:00-04:00' },
      { startsOn: '2026-09-01T11:30:00Z', endsOn: '2026-09-01T12:30:00Z' },
    )).toBe(true);
    expect(() => assertReservationWindowLocked({ startsOn: 'bad-date', endsOn: '2026-09-02' }))
      .toThrow(RENTAL_CYCLE_ERROR_CODES.INVALID_RENTAL_WINDOW);
    expect(() => assertReservationWindowLocked({ startsOn: '2026-09-03', endsOn: '2026-09-01' }))
      .toThrow(RENTAL_CYCLE_ERROR_CODES.INVALID_RENTAL_WINDOW);
  });

  it('rejects precision loss and negative or nonnumeric meter readings', () => {
    for (const finalReading of ['1500.00001', '-1500.0', 'not-a-number']) {
      expect(() => assertCheckInReady({
        ...OVERLAPPING, readings: { unitCode: 'KM', initialReading: '1200', finalReading },
      })).toThrow(RENTAL_CYCLE_ERROR_CODES.METER_BACKWARD);
    }
    expect(() => assertCheckInReady({
      ...OVERLAPPING, readings: { unitCode: 'KM', initialReading: '1000.1111', finalReading: '1000.1112' },
    })).not.toThrow();
  });

});
