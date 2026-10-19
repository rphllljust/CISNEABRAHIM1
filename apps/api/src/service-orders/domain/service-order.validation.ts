import { assertUuid, CatalogValidationError } from '../../catalog/domain/service-catalog.validation';
import {
  isServiceOrderOrigin,
  SERVICE_ORDER_ORIGINS,
  SERVICE_ORDER_STATUSES,
  type ServiceOrderOrigin,
} from './service-order';

export class ServiceOrderValidationError extends Error {
  constructor(readonly field: string) {
    super(field);
  }
}

export type CreateServiceOrderInput = {
  origin: ServiceOrderOrigin;
  unitId: string;
  clientId?: string;
  serviceDefinitionId?: string;
  serviceDefinitionVersionId?: string;
  description?: string;
  location?: Record<string, unknown>;
  priority?: string;
  operationalNotes?: string;
  proposalId?: string;
  purchaseOrderId?: string;
  customerPurchaseOrderNumber?: string;
  rcNumber?: string;
  contractReference?: string;
  idempotencyKey?: string;
};

export type UpdateServiceOrderInput = {
  rowVersion: number;
  description?: string | null;
  location?: Record<string, unknown>;
  priority?: string | null;
  operationalNotes?: string | null;
  clientId?: string | null;
  serviceDefinitionId?: string | null;
  serviceDefinitionVersionId?: string | null;
  proposalId?: string | null;
  purchaseOrderId?: string | null;
  customerPurchaseOrderNumber?: string | null;
  rcNumber?: string | null;
  contractReference?: string | null;
};

export type CancelServiceOrderInput = {
  rowVersion: number;
  cancellationReason: string;
};

export type ReopenServiceOrderInput = {
  rowVersion: number;
  reopenReason: string;
};

export type RowVersionInput = {
  rowVersion: number;
};

export function validateRowVersionBody(input: RowVersionInput): RowVersionInput {
  if (!Number.isInteger(input.rowVersion) || input.rowVersion < 1) {
    throw new ServiceOrderValidationError('rowVersion');
  }
  return input;
}

export function validateCreateServiceOrderInput(input: CreateServiceOrderInput): CreateServiceOrderInput {
  if (!isServiceOrderOrigin(input.origin)) {
    throw new ServiceOrderValidationError('origin');
  }
  if (input.origin === SERVICE_ORDER_ORIGINS.ServiceRequest) {
    throw new ServiceOrderValidationError('origin');
  }
  const unitId = input.unitId?.trim();
  if (!unitId) {
    throw new ServiceOrderValidationError('unitId');
  }
  if (input.clientId) {
    assertUuid(input.clientId, 'clientId');
  }
  if (input.serviceDefinitionId) {
    assertUuid(input.serviceDefinitionId, 'serviceDefinitionId');
  }
  if (input.serviceDefinitionVersionId) {
    assertUuid(input.serviceDefinitionVersionId, 'serviceDefinitionVersionId');
  }
  if (input.proposalId) {
    assertUuid(input.proposalId, 'proposalId');
  }
  if (input.purchaseOrderId) {
    assertUuid(input.purchaseOrderId, 'purchaseOrderId');
  }
  if (input.origin === SERVICE_ORDER_ORIGINS.Proposal && !input.proposalId) {
    throw new ServiceOrderValidationError('proposalId');
  }
  if (input.origin === SERVICE_ORDER_ORIGINS.PurchaseOrder && !input.purchaseOrderId) {
    throw new ServiceOrderValidationError('purchaseOrderId');
  }
  return {
    ...input,
    unitId,
    description: input.description?.trim() || undefined,
    operationalNotes: input.operationalNotes?.trim() || undefined,
    customerPurchaseOrderNumber: input.customerPurchaseOrderNumber?.trim() || undefined,
    rcNumber: input.rcNumber?.trim() || undefined,
    contractReference: input.contractReference?.trim() || undefined,
    idempotencyKey: input.idempotencyKey?.trim() || undefined,
  };
}

export function validateCreateStatus(status: string | undefined): void {
  if (status !== undefined && status !== SERVICE_ORDER_STATUSES.Draft) {
    throw new ServiceOrderValidationError('status');
  }
}

export { parseListServiceOrdersQuery } from './service-order-list.query';

export function validateUpdateServiceOrderInput(
  input: UpdateServiceOrderInput,
): UpdateServiceOrderInput {
  validateRowVersionBody(input);
  if (input.clientId) {
    assertUuid(input.clientId, 'clientId');
  }
  if (input.serviceDefinitionId) {
    assertUuid(input.serviceDefinitionId, 'serviceDefinitionId');
  }
  if (input.serviceDefinitionVersionId) {
    assertUuid(input.serviceDefinitionVersionId, 'serviceDefinitionVersionId');
  }
  if (input.proposalId) {
    assertUuid(input.proposalId, 'proposalId');
  }
  if (input.purchaseOrderId) {
    assertUuid(input.purchaseOrderId, 'purchaseOrderId');
  }
  return {
    ...input,
    description: input.description === undefined ? undefined : input.description?.trim() || null,
    priority: input.priority === undefined ? undefined : input.priority?.trim() || null,
    operationalNotes:
      input.operationalNotes === undefined ? undefined : input.operationalNotes?.trim() || null,
    customerPurchaseOrderNumber: input.customerPurchaseOrderNumber === undefined ? undefined : input.customerPurchaseOrderNumber?.trim() || null,
    rcNumber: input.rcNumber === undefined ? undefined : input.rcNumber?.trim() || null,
    contractReference:
      input.contractReference === undefined ? undefined : input.contractReference?.trim() || null,
  };
}

export function validateCancelServiceOrderInput(
  input: CancelServiceOrderInput,
): CancelServiceOrderInput {
  validateRowVersionBody(input);
  const cancellationReason = input.cancellationReason?.trim();
  if (!cancellationReason) {
    throw new ServiceOrderValidationError('cancellationReason');
  }
  return { rowVersion: input.rowVersion, cancellationReason };
}

export function validateReopenServiceOrderInput(
  input: ReopenServiceOrderInput,
): ReopenServiceOrderInput {
  validateRowVersionBody(input);
  const reopenReason = input.reopenReason?.trim();
  if (!reopenReason) {
    throw new ServiceOrderValidationError('reopenReason');
  }
  return { rowVersion: input.rowVersion, reopenReason };
}

export { CatalogValidationError };
