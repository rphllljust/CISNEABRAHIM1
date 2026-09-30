import { HttpException, HttpStatus } from '@nestjs/common';
import { AuthzHttpException } from '../../authorization/errors/authz-http.exception';
import { InvalidUuidError } from '../../platform/kernel/uuid';
import { PayrollError } from '../domain/payroll';
import { PayrollValidationError } from '../domain/payroll.validation';
import { PAYROLL_ERROR_CODES } from '../errors/payroll-error-codes';
import { PayrollHttpException } from '../errors/payroll-http.exception';

export function payrollAccessDenied(): PayrollHttpException {
  return new PayrollHttpException(HttpStatus.FORBIDDEN, PAYROLL_ERROR_CODES.DENIED, 'Access denied.');
}

export function mapPayrollDomainError(error: unknown): PayrollHttpException {
  if (error instanceof AuthzHttpException) {
    throw error;
  }
  if (error instanceof PayrollHttpException) {
    return error;
  }
  if (error instanceof HttpException) {
    throw error;
  }
  // `assertUuid` lança `InvalidUuidError` dentro das transações de serviço e não é
  // `PayrollError` nem `PayrollValidationError`. Sem este ramo o erro caía no catch-all
  // abaixo e um identificador malformado — erro de CLIENTE — era servido como 500.
  // Mesmo tratamento já usado por `accounting-access.errors.ts` e
  // `bank-reconciliation-access.errors.ts`: identificador inválido é 400.
  if (error instanceof InvalidUuidError || error instanceof PayrollValidationError) {
    return new PayrollHttpException(
      HttpStatus.BAD_REQUEST,
      PAYROLL_ERROR_CODES.VALIDATION_FAILED,
      'Invalid payroll request.',
    );
  }
  if (!(error instanceof PayrollError)) {
    return new PayrollHttpException(
      HttpStatus.INTERNAL_SERVER_ERROR,
      PAYROLL_ERROR_CODES.VALIDATION_FAILED,
      'Unexpected payroll error.',
    );
  }
  switch (error.code) {
    case 'PAYROLL_NOT_FOUND':
      return new PayrollHttpException(
        HttpStatus.NOT_FOUND,
        PAYROLL_ERROR_CODES.NOT_FOUND,
        'Payroll record not found.',
      );
    case 'PAYROLL_INVALID_AMOUNT':
      return new PayrollHttpException(
        HttpStatus.BAD_REQUEST,
        PAYROLL_ERROR_CODES.INVALID_AMOUNT,
        'Amount must be positive.',
      );
    case 'PAYROLL_INVALID_EVENT_KIND':
      return new PayrollHttpException(
        HttpStatus.BAD_REQUEST,
        PAYROLL_ERROR_CODES.INVALID_EVENT_KIND,
        'Event kind must be EARNING, DEDUCTION, or EMPLOYER_CHARGE.',
      );
    case 'PAYROLL_PERIOD_CLOSED':
      return new PayrollHttpException(
        HttpStatus.CONFLICT,
        PAYROLL_ERROR_CODES.PERIOD_CLOSED,
        'Closed payroll period is immutable.',
      );
    case 'PAYROLL_PERIOD_NOT_OPEN':
      return new PayrollHttpException(
        HttpStatus.CONFLICT,
        PAYROLL_ERROR_CODES.PERIOD_NOT_OPEN,
        'Payroll period must be OPEN to accept events.',
      );
    case 'PAYROLL_PERIOD_NOT_CALCULATED':
      return new PayrollHttpException(
        HttpStatus.CONFLICT,
        PAYROLL_ERROR_CODES.PERIOD_NOT_CALCULATED,
        'Payroll period must be CALCULATED before close.',
      );
    case 'PAYROLL_PERIOD_NOT_CLOSED':
      return new PayrollHttpException(
        HttpStatus.CONFLICT,
        PAYROLL_ERROR_CODES.PERIOD_NOT_CLOSED,
        'Only a CLOSED payroll period can be reopened.',
      );
    case 'PAYROLL_FORMULA_NOT_DECIDED':
      return new PayrollHttpException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        PAYROLL_ERROR_CODES.FORMULA_NOT_DECIDED,
        'Official payroll formulas are not decided. Legal rates are not invented.',
      );
    case 'PAYROLL_OPERATIONS_COUPLING_FORBIDDEN':
      return new PayrollHttpException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        PAYROLL_ERROR_CODES.OPERATIONS_COUPLING_FORBIDDEN,
        'LaborAssignment and operational people records are not payroll events.',
      );
    default:
      return new PayrollHttpException(
        HttpStatus.CONFLICT,
        PAYROLL_ERROR_CODES.VALIDATION_FAILED,
        'Payroll operation is not allowed.',
      );
  }
}
