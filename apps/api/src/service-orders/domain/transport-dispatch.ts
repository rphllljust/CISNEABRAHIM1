/**
 * Transport Dispatch — Trip/Dispatch vinculado à ServiceOrder.
 *
 * Interpretação de engenharia:
 *  - Planning (TripPlan) é separado de TripExecution (saída/chegada/evidências);
 *    alterações de planejamento nunca reescrevem execução já registrada.
 *  - Veículo e motorista NÃO são duplicados: referenciam os cadastros existentes
 *    (physical asset / vehicle profile e driver/workforce). Assignment inválido
 *    (mesmo veículo ou motorista na mesma janela) é rejeitado antes de gravar.
 *  - Carga/passageiros são opcionais ("quando aplicável").
 */

import {
  TransportDispatchError,
  TRANSPORT_DISPATCH_ERROR_CODES,
} from './transport-dispatch-errors';

export const TRIP_STATUSES = {
  Planned: 'PLANNED',
  Dispatched: 'DISPATCHED',
  Active: 'ACTIVE',
  Completed: 'COMPLETED',
  Cancelled: 'CANCELLED',
} as const;

export type TripStatus = (typeof TRIP_STATUSES)[keyof typeof TRIP_STATUSES];

export type TripWindow = {
  plannedDepartureAt: string;
  plannedArrivalAt: string;
};

export type TripLoad = {
  kind: 'CARGA' | 'PASSAGEIROS' | null;
  description?: string | null;
};

/** Planejamento do trip (não é execução). */
export type TripPlan = {
  serviceOrderId: string;
  tripNumber: string;
  vehicleId: string;
  driverId: string;
  origin: string;
  destination: string;
  load: TripLoad;
  window: TripWindow;
  status: 'PLANNED';
};

/** Execução do trip — registros de saída/chegada/evidências. */
export type TripExecution = {
  status: Extract<TripStatus, 'DISPATCHED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'>;
  dispatchedAt: string | null;
  departedAt: string | null;
  arrivedAt: string | null;
  arrivalEvidenceIds: string[];
  cancelReason: string | null;
};

export type ExistingTripAssignmentView = TripWindow & {
  tripId: string;
  serviceOrderId: string;
  vehicleId: string;
  driverId: string;
  status: TripStatus;
};

function dispatchInstant(value: string): number {
  const instant = Date.parse(value);
  if (!value.trim() || !Number.isFinite(instant)) {
    throw new TransportDispatchError(TRANSPORT_DISPATCH_ERROR_CODES.INVALID_DISPATCH_STEP);
  }
  return instant;
}

export function assertValidTripWindow(window: TripWindow): void {
  if (dispatchInstant(window.plannedArrivalAt) <= dispatchInstant(window.plannedDepartureAt)) {
    throw new TransportDispatchError(TRANSPORT_DISPATCH_ERROR_CODES.INVALID_DISPATCH_STEP);
  }
}

/** Janelas [start,end) — mesma semântica da exclusion constraint de alocação. */
export function tripWindowsOverlap(left: TripWindow, right: TripWindow): boolean {
  assertValidTripWindow(left);
  assertValidTripWindow(right);
  return dispatchInstant(left.plannedDepartureAt) < dispatchInstant(right.plannedArrivalAt)
    && dispatchInstant(right.plannedDepartureAt) < dispatchInstant(left.plannedArrivalAt);
}

function conflicts(
  trips: ExistingTripAssignmentView[],
  select: (trip: ExistingTripAssignmentView) => boolean,
  incoming: TripWindow,
): ExistingTripAssignmentView[] {
  return trips.filter(
    (trip) =>
      select(trip) &&
      trip.status !== 'CANCELLED' &&
      trip.status !== 'COMPLETED' &&
      tripWindowsOverlap(trip, incoming),
  );
}

/** Vehicle conflict: mesmo veículo não pode ter dois trips ativos na janela. */
export function assertNoVehicleConflict(
  vehicleId: string,
  incoming: TripWindow,
  trips: ExistingTripAssignmentView[],
): void {
  const blocked = conflicts(trips, (trip) => trip.vehicleId === vehicleId, incoming);
  if (blocked.length > 0) {
    throw new TransportDispatchError(
      TRANSPORT_DISPATCH_ERROR_CODES.VEHICLE_CONFLICT,
      blocked.map((trip) => trip.tripId),
    );
  }
}

/** Driver conflict: mesmo motorista não pode estar em dois trips na janela. */
export function assertNoDriverConflict(
  driverId: string,
  incoming: TripWindow,
  trips: ExistingTripAssignmentView[],
): void {
  const blocked = conflicts(trips, (trip) => trip.driverId === driverId, incoming);
  if (blocked.length > 0) {
    throw new TransportDispatchError(
      TRANSPORT_DISPATCH_ERROR_CODES.DRIVER_CONFLICT,
      blocked.map((trip) => trip.tripId),
    );
  }
}

/** Dispatch: planejamento completo -> DISPATCHED (nenhuma execução ainda). */
export function dispatchTrip(plan: TripPlan): TripExecution {
  if (
    !plan.vehicleId ||
    !plan.driverId ||
    !plan.origin.trim() ||
    !plan.destination.trim()
  ) {
    throw new TransportDispatchError(TRANSPORT_DISPATCH_ERROR_CODES.ASSIGNMENT_MISSING);
  }
  if (plan.load.kind && !plan.load.kind.match(/^(CARGA|PASSAGEIROS)$/)) {
    throw new TransportDispatchError(TRANSPORT_DISPATCH_ERROR_CODES.ROUTE_REQUIRED);
  }
  assertValidTripWindow(plan.window);
  return {
    status: 'DISPATCHED',
    dispatchedAt: new Date().toISOString(),
    departedAt: null,
    arrivedAt: null,
    arrivalEvidenceIds: [],
    cancelReason: null,
  };
}

/** Saída (CheckOut do trip). */
export function recordDeparture(execution: TripExecution, departedAt: string): TripExecution {
  assertExecutionStep(execution, 'DISPATCHED');
  dispatchInstant(departedAt);
  return { ...execution, status: 'ACTIVE', departedAt };
}

/** Chegada (conclusão): exige saída registrada e evidência de chegada. */
export function recordArrival(
  execution: TripExecution,
  arrivedAt: string,
  arrivalEvidenceId: string,
): TripExecution {
  assertExecutionStep(execution, 'ACTIVE');
  if (!arrivalEvidenceId) {
    throw new TransportDispatchError(TRANSPORT_DISPATCH_ERROR_CODES.ARRIVAL_EVIDENCE_REQUIRED);
  }
  const arrivalTime = dispatchInstant(arrivedAt);
  if (!execution.departedAt) {
    throw new TransportDispatchError(TRANSPORT_DISPATCH_ERROR_CODES.INVALID_DISPATCH_STEP);
  }
  if (arrivalTime <= dispatchInstant(execution.departedAt)) {
    throw new TransportDispatchError(TRANSPORT_DISPATCH_ERROR_CODES.ARRIVAL_BEFORE_DEPARTURE);
  }
  return {
    ...execution,
    status: 'COMPLETED',
    arrivedAt,
    arrivalEvidenceIds: [...execution.arrivalEvidenceIds, arrivalEvidenceId],
  };
}

/** Cancelamento: permitido apenas antes da conclusão; motivo obrigatório. */
export function cancelTrip(execution: TripExecution, reason: string): TripExecution {
  if (execution.status === 'COMPLETED' || execution.status === 'CANCELLED') {
    throw new TransportDispatchError(TRANSPORT_DISPATCH_ERROR_CODES.TRIP_TERMINAL);
  }
  if (!reason.trim()) {
    throw new TransportDispatchError(TRANSPORT_DISPATCH_ERROR_CODES.ROUTE_REQUIRED);
  }
  return { ...execution, status: 'CANCELLED', cancelReason: reason.trim() };
}

/** Execução registrada é imutável: planejamento não reescreve saída/chegada. */
export function assertTripExecutionImmutable(execution: TripExecution): void {
  if (execution.status === 'COMPLETED' || execution.status === 'CANCELLED') {
    throw new TransportDispatchError(TRANSPORT_DISPATCH_ERROR_CODES.EXECUTION_IMMUTABLE);
  }
}

function assertExecutionStep(
  execution: TripExecution,
  expected: TripExecution['status'],
): void {
  if (execution.status !== expected) {
    throw new TransportDispatchError(TRANSPORT_DISPATCH_ERROR_CODES.INVALID_DISPATCH_STEP);
  }
}
