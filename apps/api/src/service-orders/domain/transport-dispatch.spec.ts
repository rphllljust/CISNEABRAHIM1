import { describe, expect, it } from 'vitest';
import {
  TRANSPORT_DISPATCH_ERROR_CODES,
  TransportDispatchError,
} from './transport-dispatch-errors';
import {
  TRIP_STATUSES,
  assertNoDriverConflict,
  assertNoVehicleConflict,
  assertTripExecutionImmutable,
  cancelTrip,
  dispatchTrip,
  recordArrival,
  recordDeparture,
  tripWindowsOverlap,
  type ExistingTripAssignmentView,
  type TripExecution,
  type TripPlan,
} from './transport-dispatch';

function makePlan(overrides: Partial<TripPlan> = {}): TripPlan {
  return {
    serviceOrderId: 'os-1',
    tripNumber: 'TRIP-001',
    vehicleId: 'veh-1',
    driverId: 'drv-1',
    origin: 'Porto Velho',
    destination: 'Ji-Paraná',
    load: { kind: 'CARGA', description: 'Cimento 10t' },
    window: { plannedDepartureAt: '2026-09-01T08:00:00.000Z', plannedArrivalAt: '2026-09-01T18:00:00.000Z' },
    status: 'PLANNED',
    ...overrides,
  };
}

function makeTrip(id: string, overrides: Partial<ExistingTripAssignmentView> = {}): ExistingTripAssignmentView {
  return {
    tripId: id,
    serviceOrderId: 'os-x',
    vehicleId: 'veh-1',
    driverId: 'drv-1',
    status: TRIP_STATUSES.Active,
    ...TRIP_WINDOW,
    ...overrides,
  };
}

const TRIP_WINDOW = {
  plannedDepartureAt: '2026-09-01T08:00:00.000Z',
  plannedArrivalAt: '2026-09-01T18:00:00.000Z',
};

describe('transport dispatch domain', () => {
  it('dispatch: planejamento completo vira DISPATCHED sem execução', () => {
    const execution = dispatchTrip(makePlan());
    expect(execution).toMatchObject({ status: 'DISPATCHED', departedAt: null, arrivalEvidenceIds: [] });
    expect(() => dispatchTrip(makePlan({ vehicleId: '' }))).toThrow(
      TRANSPORT_DISPATCH_ERROR_CODES.ASSIGNMENT_MISSING,
    );
  });

  it('vehicle conflict: mesmo veículo na mesma janela é rejeitado', () => {
    const trips = [makeTrip('trip-a')];
    expect(() => assertNoVehicleConflict('veh-1', TRIP_WINDOW, trips)).toThrow(TransportDispatchError);
    try {
      assertNoVehicleConflict('veh-1', TRIP_WINDOW, trips);
      throw new Error('expected');
    } catch (error) {
      expect((error as TransportDispatchError).code).toBe(TRANSPORT_DISPATCH_ERROR_CODES.VEHICLE_CONFLICT);
      expect((error as TransportDispatchError).conflictingTripIds).toEqual(['trip-a']);
    }
    // Veículos diferentes e janelas adjacentes são válidos.
    expect(() => assertNoVehicleConflict('veh-2', TRIP_WINDOW, trips)).not.toThrow();
    expect(
      tripWindowsOverlap(
        { plannedDepartureAt: '2026-09-01T08:00:00.000Z', plannedArrivalAt: '2026-09-01T18:00:00.000Z' },
        { plannedDepartureAt: '2026-09-01T18:00:00.000Z', plannedArrivalAt: '2026-09-02T08:00:00.000Z' },
      ),
    ).toBe(false);
  });

  it('driver conflict: mesmo motorista em dois trips na janela é rejeitado', () => {
    const trips = [makeTrip('trip-a')];
    expect(() => assertNoDriverConflict('drv-1', TRIP_WINDOW, trips)).toThrow(
      TRANSPORT_DISPATCH_ERROR_CODES.DRIVER_CONFLICT,
    );
    expect(() => assertNoDriverConflict('drv-2', TRIP_WINDOW, trips)).not.toThrow();
  });

  it('concorrência: trips ativos/cancelados/completos não bloqueiam janela (INVALID ASSIGNMENTS 0)', () => {
    const trips = [
      makeTrip('trip-cancelled', { status: TRIP_STATUSES.Cancelled }),
      makeTrip('trip-completed', { status: TRIP_STATUSES.Completed }),
      makeTrip('trip-other-vehicle', { vehicleId: 'veh-9', driverId: 'drv-9' }),
    ];
    expect(() => assertNoVehicleConflict('veh-1', TRIP_WINDOW, trips)).not.toThrow();
    expect(() => assertNoDriverConflict('drv-1', TRIP_WINDOW, trips)).not.toThrow();
  });

  it('ciclo saída->chegada exige evidência e ordem correta', () => {
    const dispatched = dispatchTrip(makePlan());
    const active = recordDeparture(dispatched, '2026-09-05T08:05:00.000Z');
    expect(active.status).toBe('ACTIVE');
    expect(() => recordDeparture(active, '2026-09-05T09:00:00.000Z')).toThrow(
      TRANSPORT_DISPATCH_ERROR_CODES.INVALID_DISPATCH_STEP,
    );
    const completed = recordArrival(active, '2026-09-05T18:10:00.000Z', 'evid-1');
    expect(completed.status).toBe('COMPLETED');
    expect(() => recordArrival(active, '2026-09-05T18:10:00.000Z', '')).toThrow(
      TRANSPORT_DISPATCH_ERROR_CODES.ARRIVAL_EVIDENCE_REQUIRED,
    );
    expect(() => recordArrival(dispatched, '2026-09-05T18:10:00.000Z', 'evid-1')).toThrow(
      TRANSPORT_DISPATCH_ERROR_CODES.INVALID_DISPATCH_STEP,
    );
    expect(() => recordArrival(active, '2026-09-05T07:00:00.000Z', 'evid-1')).toThrow(
      TRANSPORT_DISPATCH_ERROR_CODES.ARRIVAL_BEFORE_DEPARTURE,
    );
  });

  it('cancelamento: permitido antes da conclusão, com motivo; terminal imutável', () => {
    const cancelled = cancelTrip(dispatchTrip(makePlan()), 'Falha no veículo');
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.cancelReason).toBe('Falha no veículo');
    expect(() => cancelTrip(cancelled, 'Outro motivo')).toThrow(TRANSPORT_DISPATCH_ERROR_CODES.TRIP_TERMINAL);
    const completed = recordArrival(
      recordDeparture(dispatchTrip(makePlan()), '2026-09-05T08:05:00.000Z'),
      '2026-09-05T18:00:00.000Z',
      'evid-2',
    );
    expect(() => cancelTrip(completed, 'Depois')).toThrow(TRANSPORT_DISPATCH_ERROR_CODES.TRIP_TERMINAL);
    expect(() => assertTripExecutionImmutable(completed)).toThrow(
      TRANSPORT_DISPATCH_ERROR_CODES.EXECUTION_IMMUTABLE,
    );
  });

  it('planejamento não reescreve execução registrada (Planning != TripExecution)', () => {
    const plan = makePlan();
    const dispatched = dispatchTrip(plan);
    const execution: TripExecution = { ...dispatched };
    expect(plan.status).toBe('PLANNED');
    expect(execution.status).toBe('DISPATCHED');
    // Planejamento permanece intocado após o dispatch.
    expect(plan).toMatchObject(makePlan());
  });
});
