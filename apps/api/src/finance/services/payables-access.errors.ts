import { HttpStatus } from '@nestjs/common';
import { AuthzHttpException } from '../../authorization/errors/authz-http.exception';
import { SupplierError } from '../../suppliers/domain/supplier';
import { PayableError } from '../domain/payable';
import { PayableValidationError } from '../domain/payable.validation';
import { FINANCE_ERROR_CODES } from '../errors/finance-error-codes';
import { FinanceHttpException } from '../errors/finance-http.exception';

export function payableAccessDenied(): FinanceHttpException {
  return new FinanceHttpException(HttpStatus.FORBIDDEN, FINANCE_ERROR_CODES.DENIED, 'Access denied.');
}

export function payableNotFound(): FinanceHttpException {
  return new FinanceHttpException(
    HttpStatus.NOT_FOUND,
    FINANCE_ERROR_CODES.PAYABLE_NOT_FOUND,
    'Payable not found.',
  );
}

export function mapPayableDomainError(error: unknown): FinanceHttpException {
  if (error instanceof AuthzHttpException) {
    throw error;
  }
  if (error instanceof SupplierError) {
    if (error.code === 'SUPPLIER_NOT_FOUND') {
      return new FinanceHttpException(
        HttpStatus.NOT_FOUND,
        FINANCE_ERROR_CODES.SUPPLIER_NOT_FOUND,
        'Supplier not found.',
      );
    }
    if (error.code === 'SUPPLIER_INACTIVE') {
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.SUPPLIER_INACTIVE,
        'Inactive supplier cannot be referenced by a payable.',
      );
    }
  }
  if (error instanceof PayableValidationError) {
    return new FinanceHttpException(
      HttpStatus.BAD_REQUEST,
      FINANCE_ERROR_CODES.VALIDATION_FAILED,
      'Invalid finance request.',
    );
  }
  if (!(error instanceof PayableError)) {
    return new FinanceHttpException(
      HttpStatus.INTERNAL_SERVER_ERROR,
      FINANCE_ERROR_CODES.VALIDATION_FAILED,
      'Unexpected finance error.',
    );
  }
  switch (error.code) {
    case 'PAYABLE_NOT_FOUND':
      return payableNotFound();
    case 'PAYABLE_CANCELLED':
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.PAYABLE_CANCELLED,
        'Cancelled payables cannot be paid.',
      );
    case 'PAYABLE_OVERPAYMENT':
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.PAYABLE_OVERPAYMENT,
        'Payment exceeds remaining balance.',
      );
    case 'PAYABLE_VERSION_CONFLICT':
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.VERSION_CONFLICT,
        'Payable version conflict.',
      );
    case 'PAYABLE_CURRENCY_MISMATCH':
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.CURRENCY_MISMATCH,
        'Payment currency does not match payable.',
      );
    case 'PAYABLE_HAS_PAYMENTS':
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.PAYABLE_HAS_PAYMENTS,
        'Payable with outstanding payments cannot be cancelled.',
      );
    case 'PAYABLE_INSTALLMENT_NOT_FOUND':
      return new FinanceHttpException(
        HttpStatus.NOT_FOUND,
        FINANCE_ERROR_CODES.INSTALLMENT_NOT_FOUND,
        'Installment not found.',
      );
    case 'PAYABLE_INVALID_PAYMENT_AMOUNT':
      return new FinanceHttpException(
        HttpStatus.BAD_REQUEST,
        FINANCE_ERROR_CODES.INVALID_PAYMENT_AMOUNT,
        'Payment amount is invalid.',
      );
    case 'PAYABLE_FORBIDDEN_ORIGIN':
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.FORBIDDEN_ORIGIN,
        'Client purchase orders are not payable origins.',
      );
    case 'EXPENSE_CATEGORY_NOT_FOUND':
      return new FinanceHttpException(
        HttpStatus.NOT_FOUND,
        FINANCE_ERROR_CODES.EXPENSE_CATEGORY_NOT_FOUND,
        'Expense category not found.',
      );
    case 'EXPENSE_CATEGORY_DUPLICATE':
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.EXPENSE_CATEGORY_DUPLICATE,
        'Expense category code already exists.',
      );
    case 'EXPENSE_CATEGORY_STATUS_INVALID':
      return new FinanceHttpException(
        HttpStatus.BAD_REQUEST,
        FINANCE_ERROR_CODES.EXPENSE_CATEGORY_STATUS_INVALID,
        'Expense category status is not part of the known set.',
      );
    case 'COST_CENTER_NOT_FOUND':
    case 'FINANCE_COST_CENTER_NOT_FOUND':
      return new FinanceHttpException(
        HttpStatus.NOT_FOUND,
        FINANCE_ERROR_CODES.COST_CENTER_NOT_FOUND,
        'Cost center not found.',
      );
    case 'COST_CENTER_DUPLICATE':
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.COST_CENTER_DUPLICATE,
        'Cost center code already exists.',
      );
    case 'COST_CENTER_STATUS_INVALID':
      return new FinanceHttpException(
        HttpStatus.BAD_REQUEST,
        FINANCE_ERROR_CODES.COST_CENTER_STATUS_INVALID,
        'Cost center status is not part of the known set.',
      );
    case 'PAYMENT_NOT_FOUND':
      return new FinanceHttpException(
        HttpStatus.NOT_FOUND,
        FINANCE_ERROR_CODES.PAYMENT_NOT_FOUND,
        'Payment not found.',
      );
    case 'PAYMENT_IMMUTABLE':
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.PAYMENT_IMMUTABLE,
        'Confirmed payments cannot be edited. Use reversal or adjustment.',
      );
    case 'PAYMENT_ALREADY_REVERSED':
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.PAYMENT_ALREADY_REVERSED,
        'Payment is already reversed.',
      );
    case 'PAYABLE_REVERSAL_EXCEEDS_PAYMENT':
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.PAYABLE_REVERSAL_EXCEEDS_PAYMENT,
        'Reversal exceeds original payment.',
      );
    default:
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.VALIDATION_FAILED,
        'Finance operation is not allowed.',
      );
  }
}
