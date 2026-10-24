import { HttpException, HttpStatus } from '@nestjs/common';
import { buildDomainHttpExceptionBody } from '../../infrastructure/http/api-error.mapper';
import { INVENTORY_ERROR_CODES } from './inventory-error-codes';

export type InventoryErrorCode = (typeof INVENTORY_ERROR_CODES)[keyof typeof INVENTORY_ERROR_CODES];

export class InventoryHttpException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: InventoryErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(buildDomainHttpExceptionBody(code, message), status, options);
  }
}
