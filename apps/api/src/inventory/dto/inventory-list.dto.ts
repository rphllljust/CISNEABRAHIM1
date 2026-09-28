import { HttpStatus } from '@nestjs/common';
import { InventoryHttpException } from '../errors/inventory-http.exception';
import { INVENTORY_ERROR_CODES } from '../errors/inventory-error-codes';

const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 20;

export type InventoryListQuery = {
  limit: number;
  offset: number;
  status?: string;
  unitId?: string;
  warehouseId?: string;
  inventoryItemId?: string;
  movementType?: string;
  q?: string;
};

function badRequest(): InventoryHttpException {
  return new InventoryHttpException(
    HttpStatus.BAD_REQUEST,
    INVENTORY_ERROR_CODES.VALIDATION_FAILED,
    'Invalid query parameters.',
  );
}

function parseOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw badRequest();
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Lista paginada com filtros opcionais — o chamador decide quais filtros usa por recurso. */
export function parseInventoryListQuery(query: Record<string, unknown>): InventoryListQuery {
  const rawLimit = query['limit'];
  const rawOffset = query['offset'];
  const limit =
    rawLimit === undefined
      ? DEFAULT_LIST_LIMIT
      : typeof rawLimit === 'string' || typeof rawLimit === 'number'
        ? Number(rawLimit)
        : NaN;
  const offset =
    rawOffset === undefined
      ? 0
      : typeof rawOffset === 'string' || typeof rawOffset === 'number'
        ? Number(rawOffset)
        : NaN;

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    throw badRequest();
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw badRequest();
  }

  return {
    limit,
    offset,
    status: parseOptionalString(query['status']),
    unitId: parseOptionalString(query['unitId']),
    warehouseId: parseOptionalString(query['warehouseId']),
    inventoryItemId: parseOptionalString(query['inventoryItemId']),
    movementType: parseOptionalString(query['movementType']),
    q: parseOptionalString(query['q']),
  };
}
