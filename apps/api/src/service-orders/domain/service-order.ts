export const SERVICE_ORDER_STATUSES = {
  Draft: 'DRAFT',
  Prepared: 'PREPARED',
  Released: 'RELEASED',
  InExecution: 'IN_EXECUTION',
  Paused: 'PAUSED',
  Completed: 'COMPLETED',
  Cancelled: 'CANCELLED',
} as const;

export type ServiceOrderStatus =
  (typeof SERVICE_ORDER_STATUSES)[keyof typeof SERVICE_ORDER_STATUSES];

export const SERVICE_ORDER_ORIGINS = {
  ServiceRequest: 'SERVICE_REQUEST',
  Proposal: 'PROPOSAL',
  PurchaseOrder: 'PURCHASE_ORDER',
  AuthorizedDirect: 'AUTHORIZED_DIRECT',
} as const;

export type ServiceOrderOrigin =
  (typeof SERVICE_ORDER_ORIGINS)[keyof typeof SERVICE_ORDER_ORIGINS];

export const SERVICE_ORDER_HISTORY_EVENTS = {
  Created: 'CREATED',
  ConvertedFromServiceRequest: 'CONVERTED_FROM_SERVICE_REQUEST',
  Prepared: 'PREPARED',
  Released: 'RELEASED',
  Cancelled: 'CANCELLED',
  Updated: 'UPDATED',
  Started: 'STARTED',
  Paused: 'PAUSED',
  Resumed: 'RESUMED',
  Completed: 'COMPLETED',
  Reopened: 'REOPENED',
  /**
   * Planejamento e despacho pertencem à mesma linha do tempo da OS.
   * Sem estes eventos a fase de programação (planejado → alocado) fica
   * invisível na rastreabilidade do agregado.
   */
  PlannedResourceAdded: 'PLANNED_RESOURCE_ADDED',
  PlannedResourceUpdated: 'PLANNED_RESOURCE_UPDATED',
  PlannedResourceRemoved: 'PLANNED_RESOURCE_REMOVED',
  ResourceAllocated: 'RESOURCE_ALLOCATED',
  ResourceReallocated: 'RESOURCE_REALLOCATED',
  AllocationRemoved: 'ALLOCATION_REMOVED',
} as const;

export type ServiceOrderHistoryEventType =
  (typeof SERVICE_ORDER_HISTORY_EVENTS)[keyof typeof SERVICE_ORDER_HISTORY_EVENTS];

const STATUS_SET = new Set<string>(Object.values(SERVICE_ORDER_STATUSES));
const ORIGIN_SET = new Set<string>(Object.values(SERVICE_ORDER_ORIGINS));

export function isServiceOrderStatus(value: string): value is ServiceOrderStatus {
  return STATUS_SET.has(value);
}

export function isServiceOrderOrigin(value: string): value is ServiceOrderOrigin {
  return ORIGIN_SET.has(value);
}

export function assertInitialCreateStatus(status: ServiceOrderStatus): void {
  if (status !== SERVICE_ORDER_STATUSES.Draft) {
    throw new Error('INVALID_INITIAL_STATUS');
  }
}
