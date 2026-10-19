import { SERVICE_ORDER_STATUSES, type ServiceOrderStatus } from './service-order';

export type ServiceOrderMutableField =
  | 'description'
  | 'location'
  | 'priority'
  | 'operationalNotes'
  | 'clientId'
  | 'serviceDefinitionId'
  | 'serviceDefinitionVersionId'
  | 'proposalId'
  | 'purchaseOrderId'
  | 'customerPurchaseOrderNumber'
  | 'rcNumber'
  | 'contractReference';

const DRAFT_MUTABLE_FIELDS = new Set<ServiceOrderMutableField>([
  'description',
  'location',
  'priority',
  'operationalNotes',
  'clientId',
  'serviceDefinitionId',
  'serviceDefinitionVersionId',
  'proposalId',
  'purchaseOrderId',
  'customerPurchaseOrderNumber',
  'rcNumber',
  'contractReference',
]);

const PREPARED_MUTABLE_FIELDS = new Set<ServiceOrderMutableField>([
  'description',
  'location',
  'priority',
  'operationalNotes',
]);

const CRITICAL_FIELDS = new Set<ServiceOrderMutableField>([
  'clientId',
  'serviceDefinitionId',
  'serviceDefinitionVersionId',
  'proposalId',
  'purchaseOrderId',
  'customerPurchaseOrderNumber',
  'rcNumber',
  'contractReference',
]);

export class ServiceOrderMutabilityError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export function assertMutableFields(
  status: ServiceOrderStatus,
  fields: ServiceOrderMutableField[],
): void {
  if (
    status === SERVICE_ORDER_STATUSES.Released ||
    status === SERVICE_ORDER_STATUSES.InExecution ||
    status === SERVICE_ORDER_STATUSES.Completed ||
    status === SERVICE_ORDER_STATUSES.Cancelled
  ) {
    if (fields.length > 0) {
      throw new ServiceOrderMutabilityError('IMMUTABLE_STATUS');
    }
    return;
  }

  const allowed =
    status === SERVICE_ORDER_STATUSES.Draft
      ? DRAFT_MUTABLE_FIELDS
      : status === SERVICE_ORDER_STATUSES.Prepared
        ? PREPARED_MUTABLE_FIELDS
        : new Set<ServiceOrderMutableField>();

  for (const field of fields) {
    if (!allowed.has(field)) {
      throw new ServiceOrderMutabilityError(
        CRITICAL_FIELDS.has(field) ? 'IMMUTABLE_CRITICAL_FIELD' : 'IMMUTABLE_STATUS',
      );
    }
  }
}

export function assertUpdateAllowed(status: ServiceOrderStatus): void {
  if (
    status !== SERVICE_ORDER_STATUSES.Draft &&
    status !== SERVICE_ORDER_STATUSES.Prepared
  ) {
    throw new ServiceOrderMutabilityError('IMMUTABLE_STATUS');
  }
}
