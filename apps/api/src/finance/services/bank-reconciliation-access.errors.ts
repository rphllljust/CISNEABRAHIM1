import { HttpStatus } from '@nestjs/common';
import { AuthzHttpException } from '../../authorization/errors/authz-http.exception';
import { InvalidUuidError } from '../../platform/kernel/uuid';
import { BankReconciliationError } from '../domain/bank-reconciliation';
import { BankReconciliationValidationError } from '../domain/bank-reconciliation.validation';
import { FINANCE_ERROR_CODES } from '../errors/finance-error-codes';
import { FinanceHttpException } from '../errors/finance-http.exception';

export function bankReconAccessDenied(): FinanceHttpException {
  return new FinanceHttpException(HttpStatus.FORBIDDEN, FINANCE_ERROR_CODES.DENIED, 'Access denied.');
}

export function mapBankReconciliationError(error: unknown): FinanceHttpException {
  if (error instanceof AuthzHttpException) {
    throw error;
  }
  if (error instanceof FinanceHttpException) {
    return error;
  }
  if (error instanceof InvalidUuidError) {
    // Propaga para o InvalidUuidFilter global -> 400 INVALID_ID (mesma semantica
    // dos demais modulos). Sem isso um id malformado virava 500 INTERNAL.
    throw error;
  }
  if (error instanceof BankReconciliationValidationError) {
    return new FinanceHttpException(
      HttpStatus.BAD_REQUEST,
      FINANCE_ERROR_CODES.VALIDATION_FAILED,
      'Invalid bank reconciliation request.',
    );
  }
  if (!(error instanceof BankReconciliationError)) {
    const message = error instanceof Error ? error.message : 'Unexpected bank reconciliation error.';
    if (message.includes('BANK_RECONCILIATION_CONFIRMED_IMMUTABLE')) {
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.BANK_RECON_CONFIRMED_IMMUTABLE,
        'Confirmed reconciliation cannot be changed silently. Use authorized unreconcile.',
      );
    }
    if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '23505') {
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.BANK_RECON_LINE_ALREADY_MATCHED,
        'The bank line is already reconciled.',
      );
    }
    return new FinanceHttpException(
      HttpStatus.INTERNAL_SERVER_ERROR,
      FINANCE_ERROR_CODES.VALIDATION_FAILED,
      `Unexpected bank reconciliation error: ${message}`,
    );
  }
  switch (error.code) {
    case 'BANK_RECON_NOT_FOUND':
      return new FinanceHttpException(
        HttpStatus.NOT_FOUND,
        FINANCE_ERROR_CODES.BANK_RECON_NOT_FOUND,
        'Bank reconciliation record not found.',
      );
    case 'BANK_RECON_ERP_FORBIDDEN':
      return new FinanceHttpException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        FINANCE_ERROR_CODES.BANK_RECON_ERP_FORBIDDEN,
        'Bank reconciliation does not depend on an ERP.',
      );
    case 'BANK_RECON_INVALID_SOURCE':
      return new FinanceHttpException(
        HttpStatus.BAD_REQUEST,
        FINANCE_ERROR_CODES.BANK_RECON_INVALID_SOURCE,
        'Statement source must be MANUAL, OFX, CNAB, BANK_API, or AUTHORIZED_FILE.',
      );
    case 'BANK_RECON_AMOUNT_NOT_EXACT':
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.BANK_RECON_AMOUNT_NOT_EXACT,
        'Automatic match requires exact amount equality.',
      );
    case 'BANK_RECON_NOT_BANK_ACCOUNT':
      return new FinanceHttpException(
        HttpStatus.BAD_REQUEST,
        FINANCE_ERROR_CODES.BANK_RECON_NOT_BANK_ACCOUNT,
        'Statements can be imported only for BANK accounts.',
      );
    case 'BANK_RECON_LINE_ALREADY_MATCHED':
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.BANK_RECON_LINE_ALREADY_MATCHED,
        'The bank line is already reconciled.',
      );
    case 'BANK_RECON_CONFIRMED_IMMUTABLE':
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.BANK_RECON_CONFIRMED_IMMUTABLE,
        'Confirmed reconciliation cannot be changed silently. Use authorized unreconcile.',
      );
    case 'BANK_RECON_NOT_DRAFT':
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.BANK_RECON_NOT_DRAFT,
        'Only a DRAFT reconciliation can be confirmed.',
      );
    case 'BANK_RECON_NOT_CONFIRMED':
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.BANK_RECON_NOT_CONFIRMED,
        'Only a CONFIRMED reconciliation can be unreconciled.',
      );
    case 'BANK_RECON_REVIEW_REQUIRED':
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.BANK_RECON_REVIEW_REQUIRED,
        'Ambiguous exact candidates require manual review.',
      );
    case 'BANK_IMPORT_LAYOUT_NOT_DOCUMENTED':
      return new FinanceHttpException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        FINANCE_ERROR_CODES.BANK_IMPORT_LAYOUT_NOT_DOCUMENTED,
        'OFX and CNAB parsers are not available until an official layout is documented.',
      );
    case 'BANK_IMPORT_INVALID_FILE':
      return new FinanceHttpException(
        HttpStatus.BAD_REQUEST,
        FINANCE_ERROR_CODES.BANK_IMPORT_INVALID_FILE,
        'The uploaded file is not a documented bank statement format.',
      );
    case 'BANK_IMPORT_MALFORMED':
      return new FinanceHttpException(
        HttpStatus.BAD_REQUEST,
        FINANCE_ERROR_CODES.BANK_IMPORT_MALFORMED,
        'The uploaded statement content is malformed.',
      );
    case 'BANK_IMPORT_EMPTY':
      return new FinanceHttpException(
        HttpStatus.BAD_REQUEST,
        FINANCE_ERROR_CODES.BANK_IMPORT_EMPTY,
        'The uploaded statement file is empty.',
      );
    case 'BANK_IMPORT_TOO_LARGE':
      return new FinanceHttpException(
        HttpStatus.BAD_REQUEST,
        FINANCE_ERROR_CODES.BANK_IMPORT_TOO_LARGE,
        'The uploaded statement exceeds the engineering size limit.',
      );
    case 'BANK_IMPORT_TOO_MANY_LINES':
      return new FinanceHttpException(
        HttpStatus.BAD_REQUEST,
        FINANCE_ERROR_CODES.BANK_IMPORT_TOO_MANY_LINES,
        'The uploaded statement exceeds the engineering line limit.',
      );
    default:
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.VALIDATION_FAILED,
        'Bank reconciliation operation is not allowed.',
      );
  }
}
