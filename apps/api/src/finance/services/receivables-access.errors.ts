import { HttpStatus } from '@nestjs/common';
import { AuthzHttpException } from '../../authorization/errors/authz-http.exception';
import { ReceivableError } from '../domain/receivable';
import { ReceivableValidationError } from '../domain/receivable.validation';
import { FINANCE_ERROR_CODES } from '../errors/finance-error-codes';
import { FinanceHttpException } from '../errors/finance-http.exception';

export function financeAccessDenied(): FinanceHttpException {
  return new FinanceHttpException(HttpStatus.FORBIDDEN, FINANCE_ERROR_CODES.DENIED, 'Access denied.');
}

export function financeNotFound(): FinanceHttpException {
  return new FinanceHttpException(
    HttpStatus.NOT_FOUND,
    FINANCE_ERROR_CODES.NOT_FOUND,
    'Receivable not found.',
  );
}

export function mapReceivableDomainError(error: unknown): FinanceHttpException {
  if (error instanceof AuthzHttpException) {
    throw error;
  }
  if (error instanceof ReceivableValidationError) {
    return new FinanceHttpException(
      HttpStatus.BAD_REQUEST,
      FINANCE_ERROR_CODES.VALIDATION_FAILED,
      'Invalid finance request.',
    );
  }
  if (!(error instanceof ReceivableError)) {
    return new FinanceHttpException(
      HttpStatus.INTERNAL_SERVER_ERROR,
      FINANCE_ERROR_CODES.VALIDATION_FAILED,
      'Unexpected finance error.',
    );
  }
  switch (error.code) {
    case 'RECEIVABLE_NOT_FOUND':
      return financeNotFound();
    case 'RECEIVABLE_CANCELLED':
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.CANCELLED,
        'Cancelled receivables cannot be settled.',
      );
    case 'RECEIVABLE_OVERPAYMENT':
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.OVERPAYMENT,
        'Settlement exceeds remaining balance.',
      );
    case 'RECEIVABLE_VERSION_CONFLICT':
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.VERSION_CONFLICT,
        'Receivable version conflict.',
      );
    case 'RECEIVABLE_CURRENCY_MISMATCH':
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.CURRENCY_MISMATCH,
        'Settlement currency does not match receivable.',
      );
    case 'RECEIVABLE_HAS_SETTLEMENTS':
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.HAS_SETTLEMENTS,
        'Receivable with settlements cannot be cancelled.',
      );
    case 'RECEIVABLE_INSTALLMENT_NOT_FOUND':
      return new FinanceHttpException(
        HttpStatus.NOT_FOUND,
        FINANCE_ERROR_CODES.INSTALLMENT_NOT_FOUND,
        'Installment not found.',
      );
    case 'RECEIVABLE_INVALID_SETTLEMENT_AMOUNT':
      return new FinanceHttpException(
        HttpStatus.BAD_REQUEST,
        FINANCE_ERROR_CODES.INVALID_SETTLEMENT_AMOUNT,
        'Settlement amount is invalid.',
      );
    case 'RECEIVABLE_SETTLEMENT_NOT_FOUND':
      // Nao vaza existencia de settlement de outro recebivel.
      return new FinanceHttpException(
        HttpStatus.NOT_FOUND,
        FINANCE_ERROR_CODES.SETTLEMENT_NOT_FOUND,
        'Settlement not found.',
      );
    case 'RECEIVABLE_SETTLEMENT_ALREADY_REVERSED':
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.SETTLEMENT_ALREADY_REVERSED,
        'Settlement is already reversed.',
      );
    case 'RECEIVABLE_SETTLEMENT_NOT_REVERSIBLE':
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.SETTLEMENT_NOT_REVERSIBLE,
        'Only posted settlements can be reversed.',
      );
    case 'RECEIVABLE_SETTLEMENT_RECONCILED':
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.SETTLEMENT_RECONCILED,
        'Confirmed reconciliation cannot be changed silently. Use authorized unreconcile first.',
      );
    case 'RECEIVABLE_REVERSAL_REASON_REQUIRED':
      return new FinanceHttpException(
        HttpStatus.BAD_REQUEST,
        FINANCE_ERROR_CODES.REVERSAL_REASON_REQUIRED,
        'Reversal reason is required.',
      );
    default:
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.VALIDATION_FAILED,
        'Finance operation is not allowed.',
      );
  }
}
