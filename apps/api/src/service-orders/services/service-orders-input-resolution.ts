import { assertUuid, CatalogValidationError } from '../../catalog/domain/service-catalog.validation';
import type { ServiceOrderStatus } from '../domain/service-order';
import {
  assertMutableFields,
  assertUpdateAllowed,
  ServiceOrderMutabilityError,
  type ServiceOrderMutableField,
} from '../domain/service-order-mutability';
import {
  buildServiceOrderListSqlParts,
  ServiceOrderListQueryError,
  type ListServiceOrdersQuery,
  type ServiceOrderListContext,
} from '../domain/service-order-list.query';
import {
  ServiceOrderValidationError,
  validateCancelServiceOrderInput,
  validateCreateServiceOrderInput,
  validateReopenServiceOrderInput,
  validateRowVersionBody,
  validateUpdateServiceOrderInput,
  type CancelServiceOrderInput,
  type CreateServiceOrderInput,
  type ReopenServiceOrderInput,
  type UpdateServiceOrderInput,
} from '../domain/service-order.validation';
import {
  mapServiceOrderMutabilityError,
  serviceOrdersAccessNotFound,
  serviceOrdersReopenJustificationRequired,
  serviceOrdersValidationFailed,
} from './service-orders-access.errors';

export function assertValidServiceOrderId(serviceOrderId: string): void {
  try {
    assertUuid(serviceOrderId, 'serviceOrderId');
  } catch (error) {
    if (error instanceof CatalogValidationError) {
      throw serviceOrdersAccessNotFound();
    }
    throw error;
  }
}

export function resolveCreateServiceOrderInput(input: CreateServiceOrderInput): CreateServiceOrderInput {
  try {
    return validateCreateServiceOrderInput(input);
  } catch (error) {
    if (error instanceof ServiceOrderValidationError || error instanceof CatalogValidationError) {
      throw serviceOrdersValidationFailed();
    }
    throw error;
  }
}

export function resolveUpdateServiceOrderInput(
  input: UpdateServiceOrderInput,
  currentStatus: ServiceOrderStatus,
): UpdateServiceOrderInput {
  try {
    const validated = validateUpdateServiceOrderInput(input);
    assertUpdateAllowed(currentStatus);
    assertMutableFields(currentStatus, collectMutableFields(validated));
    return validated;
  } catch (error) {
    if (error instanceof ServiceOrderValidationError || error instanceof CatalogValidationError) {
      throw serviceOrdersValidationFailed();
    }
    if (error instanceof ServiceOrderMutabilityError) {
      throw mapServiceOrderMutabilityError(error);
    }
    throw error;
  }
}

export function resolveCancelServiceOrderInput(input: CancelServiceOrderInput): CancelServiceOrderInput {
  try {
    return validateCancelServiceOrderInput(input);
  } catch (error) {
    if (error instanceof ServiceOrderValidationError) {
      throw serviceOrdersValidationFailed();
    }
    throw error;
  }
}

export function resolveReopenServiceOrderInput(input: ReopenServiceOrderInput): ReopenServiceOrderInput {
  try {
    return validateReopenServiceOrderInput(input);
  } catch (error) {
    if (error instanceof ServiceOrderValidationError) {
      if (error.field === 'reopenReason') {
        throw serviceOrdersReopenJustificationRequired();
      }
      throw serviceOrdersValidationFailed();
    }
    throw error;
  }
}

export function resolveRowVersionInput(input: { rowVersion: number }): { rowVersion: number } {
  try {
    return validateRowVersionBody(input);
  } catch (error) {
    if (error instanceof ServiceOrderValidationError) {
      throw serviceOrdersValidationFailed();
    }
    throw error;
  }
}

export function resolveServiceOrderListQuery(
  query: ListServiceOrdersQuery,
  scopeClause: string,
  scopeParams: unknown[],
  context: ServiceOrderListContext = {},
) {
  try {
    return buildServiceOrderListSqlParts(query, scopeClause, scopeParams, context);
  } catch (error) {
    if (error instanceof ServiceOrderListQueryError || error instanceof CatalogValidationError) {
      throw serviceOrdersValidationFailed();
    }
    throw error;
  }
}

function collectMutableFields(input: UpdateServiceOrderInput): ServiceOrderMutableField[] {
  const fields: ServiceOrderMutableField[] = [];
  if (input.description !== undefined) fields.push('description');
  if (input.location !== undefined) fields.push('location');
  if (input.priority !== undefined) fields.push('priority');
  if (input.operationalNotes !== undefined) fields.push('operationalNotes');
  if (input.clientId !== undefined) fields.push('clientId');
  if (input.serviceDefinitionId !== undefined) fields.push('serviceDefinitionId');
  if (input.serviceDefinitionVersionId !== undefined) fields.push('serviceDefinitionVersionId');
  if (input.proposalId !== undefined) fields.push('proposalId');
  if (input.purchaseOrderId !== undefined) fields.push('purchaseOrderId');
  if (input.rcNumber !== undefined) fields.push('rcNumber');
  if (input.contractReference !== undefined) fields.push('contractReference');
  return fields;
}
