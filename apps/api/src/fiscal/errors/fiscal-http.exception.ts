import { HttpException, HttpStatus } from '@nestjs/common';
import { buildDomainHttpExceptionBody } from '../../infrastructure/http/api-error.mapper';
import { FISCAL_ERROR_CODES } from './fiscal-error-codes';

export type FiscalErrorCode = (typeof FISCAL_ERROR_CODES)[keyof typeof FISCAL_ERROR_CODES];

export class FiscalHttpException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: FiscalErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(buildDomainHttpExceptionBody(code, message), status, options);
  }
}
