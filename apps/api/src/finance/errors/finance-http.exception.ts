import { HttpException, HttpStatus } from '@nestjs/common';
import { buildDomainHttpExceptionBody } from '../../infrastructure/http/api-error.mapper';
import { FINANCE_ERROR_CODES } from './finance-error-codes';

export type FinanceErrorCode = (typeof FINANCE_ERROR_CODES)[keyof typeof FINANCE_ERROR_CODES];

export class FinanceHttpException extends HttpException {
  /**
   * F1.1 — `options.cause` preserva a causa original.
   *
   * O corpo HTTP continua sendo só `{ code, message }`: nenhum detalhe interno vaza
   * para o cliente. A causa fica na EXCEÇÃO, para log, stack e diagnóstico. Sem ela,
   * uma falha de infraestrutura virava "Unexpected finance error." e o operador não
   * tinha como saber o que aconteceu.
   */
  constructor(
    status: HttpStatus,
    readonly code: FinanceErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(buildDomainHttpExceptionBody(code, message), status, options);
  }
}
