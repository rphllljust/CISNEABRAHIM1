import { assertUuid } from '../../catalog/domain/service-catalog.validation';
import { isServiceOrderOrigin } from '../domain/service-order';
import {
  parseListServiceOrdersQuery,
  validateCreateStatus,
  type CancelServiceOrderInput,
  type CreateServiceOrderInput,
  type ReopenServiceOrderInput,
  type UpdateServiceOrderInput,
} from '../domain/service-order.validation';
import { assertNoPrivilegedFields } from '../../security/domain/forbidden-payload-fields';

function parseOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function parseOptionalObject(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

export function parseCreateServiceOrderInput(body: unknown): CreateServiceOrderInput {
  if (!body || typeof body !== 'object') {
    throw new Error('INVALID_BODY');
  }
  const record = body as Record<string, unknown>;
  assertNoPrivilegedFields(record);
  const origin = parseOptionalString(record, 'origin');
  if (!origin || !isServiceOrderOrigin(origin)) {
    throw new Error('INVALID_ORIGIN');
  }
  validateCreateStatus(typeof record['status'] === 'string' ? record['status'] : undefined);
  const unitId = parseOptionalString(record, 'unitId');
  if (!unitId) {
    throw new Error('INVALID_UNIT');
  }
  return {
    origin,
    unitId,
    clientId: parseOptionalString(record, 'clientId'),
    serviceDefinitionId: parseOptionalString(record, 'serviceDefinitionId'),
    serviceDefinitionVersionId: parseOptionalString(record, 'serviceDefinitionVersionId'),
    description: parseOptionalString(record, 'description'),
    location: parseOptionalObject(record, 'location'),
    priority: parseOptionalString(record, 'priority'),
    operationalNotes: parseOptionalString(record, 'operationalNotes'),
    proposalId: parseOptionalString(record, 'proposalId'),
    purchaseOrderId: parseOptionalString(record, 'purchaseOrderId'),
    customerPurchaseOrderNumber: parseOptionalString(record, 'customerPurchaseOrderNumber'),
    rcNumber: parseOptionalString(record, 'rcNumber'),
    contractReference: parseOptionalString(record, 'contractReference'),
    idempotencyKey: parseOptionalString(record, 'idempotencyKey'),
  };
}

export { parseListServiceOrdersQuery };

export function parseRowVersionBody(body: unknown): { rowVersion: number } {
  if (!body || typeof body !== 'object') {
    throw new Error('INVALID_BODY');
  }
  const record = body as Record<string, unknown>;
  const rowVersion = Number(record['rowVersion']);
  if (!Number.isInteger(rowVersion) || rowVersion < 1) {
    throw new Error('INVALID_ROW_VERSION');
  }
  return { rowVersion };
}

export function parseUpdateServiceOrderInput(body: unknown): UpdateServiceOrderInput {
  if (!body || typeof body !== 'object') {
    throw new Error('INVALID_BODY');
  }
  const record = body as Record<string, unknown>;
  const { rowVersion } = parseRowVersionBody(record);
  return {
    rowVersion,
    description:
      record['description'] === null
        ? null
        : typeof record['description'] === 'string'
          ? record['description']
          : undefined,
    location: parseOptionalObject(record, 'location'),
    priority:
      record['priority'] === null
        ? null
        : typeof record['priority'] === 'string'
          ? record['priority']
          : undefined,
    operationalNotes:
      record['operationalNotes'] === null
        ? null
        : typeof record['operationalNotes'] === 'string'
          ? record['operationalNotes']
          : undefined,
    clientId:
      record['clientId'] === null
        ? null
        : parseOptionalString(record, 'clientId'),
    serviceDefinitionId:
      record['serviceDefinitionId'] === null
        ? null
        : parseOptionalString(record, 'serviceDefinitionId'),
    serviceDefinitionVersionId:
      record['serviceDefinitionVersionId'] === null
        ? null
        : parseOptionalString(record, 'serviceDefinitionVersionId'),
    proposalId:
      record['proposalId'] === null ? null : parseOptionalString(record, 'proposalId'),
    purchaseOrderId:
      record['purchaseOrderId'] === null ? null : parseOptionalString(record, 'purchaseOrderId'),
    customerPurchaseOrderNumber: record['customerPurchaseOrderNumber'] === null ? null : parseOptionalString(record, 'customerPurchaseOrderNumber'),
    rcNumber: record['rcNumber'] === null ? null : parseOptionalString(record, 'rcNumber'),
    contractReference:
      record['contractReference'] === null
        ? null
        : parseOptionalString(record, 'contractReference'),
  };
}

export function parseCancelServiceOrderInput(body: unknown): CancelServiceOrderInput {
  if (!body || typeof body !== 'object') {
    throw new Error('INVALID_BODY');
  }
  const record = body as Record<string, unknown>;
  const { rowVersion } = parseRowVersionBody(record);
  const cancellationReason =
    typeof record['cancellationReason'] === 'string' ? record['cancellationReason'] : '';
  return { rowVersion, cancellationReason };
}

export function parseReopenServiceOrderInput(body: unknown): ReopenServiceOrderInput {
  if (!body || typeof body !== 'object') {
    throw new Error('INVALID_BODY');
  }
  const record = body as Record<string, unknown>;
  const { rowVersion } = parseRowVersionBody(record);
  const reopenReason = typeof record['reopenReason'] === 'string' ? record['reopenReason'] : '';
  return { rowVersion, reopenReason };
}

export function parseServiceOrderId(serviceOrderId: string): string {
  assertUuid(serviceOrderId, 'serviceOrderId');
  return serviceOrderId;
}
