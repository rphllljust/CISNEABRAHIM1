import { HttpException, HttpStatus } from '@nestjs/common';
import { buildDomainHttpExceptionBody } from '../../infrastructure/http/api-error.mapper';
import { ACCOUNTING_ERROR_CODES } from './accounting-error-codes';

export type AccountingErrorCode =
  (typeof ACCOUNTING_ERROR_CODES)[keyof typeof ACCOUNTING_ERROR_CODES];

export class AccountingHttpException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: AccountingErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(buildDomainHttpExceptionBody(code, message), status, options);
  }
}
