import { HttpException, HttpStatus } from '@nestjs/common';
import { AuthzHttpException } from '../../authorization/errors/authz-http.exception';
import { FiscalPeriodError } from '../domain/fiscal-period';
import { FiscalPeriodValidationError } from '../domain/fiscal-period.validation';
// A validacao de listagem reutiliza as guardas `requireFiscalPage*`/`optionalFiscalWhitelist` de
// fiscal-document.validation, que lanca `FiscalValidationError` (nao `FiscalPeriodValidationError`).
// Sem esse reconhecimento, uma query de listagem malformada virava 500 em vez de 400.
import { FiscalValidationError } from '../domain/fiscal-document.validation';
import { FISCAL_ERROR_CODES } from '../errors/fiscal-error-codes';
import { FiscalHttpException } from '../errors/fiscal-http.exception';

export function mapFiscalPeriodDomainError(error: unknown): HttpException {
  if (error instanceof AuthzHttpException) {
    throw error;
  }
  if (error instanceof HttpException) {
    return error;
  }
  if (error instanceof FiscalPeriodValidationError || error instanceof FiscalValidationError) {
    return new FiscalHttpException(
      HttpStatus.BAD_REQUEST,
      FISCAL_ERROR_CODES.VALIDATION_FAILED,
      'Invalid fiscal period request.',
    );
  }
  if (!(error instanceof FiscalPeriodError)) {
    return new FiscalHttpException(
      HttpStatus.INTERNAL_SERVER_ERROR,
      FISCAL_ERROR_CODES.VALIDATION_FAILED,
      'Unexpected fiscal period error.',
    );
  }
  switch (error.code) {
    case 'FISCAL_PERIOD_NOT_FOUND':
      return new FiscalHttpException(
        HttpStatus.NOT_FOUND,
        FISCAL_ERROR_CODES.PERIOD_NOT_FOUND,
        'Fiscal period not found.',
      );
    case 'FISCAL_PERIOD_CLOSED':
      return new FiscalHttpException(
        HttpStatus.CONFLICT,
        FISCAL_ERROR_CODES.PERIOD_CLOSED,
        'Closed fiscal period does not accept ordinary changes. Use a formal adjustment or authorized reopen.',
      );
    case 'FISCAL_PERIOD_NOT_CLOSED':
      return new FiscalHttpException(
        HttpStatus.CONFLICT,
        FISCAL_ERROR_CODES.PERIOD_NOT_CLOSED,
        'Fiscal period is not closed.',
      );
    case 'FISCAL_PERIOD_CLOSE_BLOCKED':
      return new FiscalHttpException(
        HttpStatus.CONFLICT,
        FISCAL_ERROR_CODES.PERIOD_CLOSE_BLOCKED,
        'Fiscal period cannot close while documents, assessments, adjustments or critical pendencies remain.',
      );
    case 'FISCAL_PERIOD_DUPLICATE':
      return new FiscalHttpException(
        HttpStatus.CONFLICT,
        FISCAL_ERROR_CODES.PERIOD_DUPLICATE,
        'Fiscal period already exists for this unit and competence.',
      );
    default:
      return new FiscalHttpException(
        HttpStatus.BAD_REQUEST,
        FISCAL_ERROR_CODES.VALIDATION_FAILED,
        'Fiscal period operation is not allowed.',
      );
  }
}
