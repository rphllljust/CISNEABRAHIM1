import { HttpStatus } from '@nestjs/common';
import { AuthzHttpException } from '../../authorization/errors/authz-http.exception';
import { InvalidUuidError } from '../../platform/kernel/uuid';
import { AccountingError } from '../domain/ledger';
import { AccountingValidationError } from '../domain/ledger.validation';
import { ACCOUNTING_ERROR_CODES } from '../errors/accounting-error-codes';
import { AccountingHttpException } from '../errors/accounting-http.exception';

export function accountingAccessDenied(): AccountingHttpException {
  return new AccountingHttpException(
    HttpStatus.FORBIDDEN,
    ACCOUNTING_ERROR_CODES.DENIED,
    'Access denied.',
  );
}

export function accountingNotFound(): AccountingHttpException {
  return new AccountingHttpException(
    HttpStatus.NOT_FOUND,
    ACCOUNTING_ERROR_CODES.NOT_FOUND,
    'Accounting journal not found.',
  );
}

export function mapAccountingDomainError(error: unknown): AccountingHttpException {
  if (error instanceof AuthzHttpException) {
    throw error;
  }
  if (error instanceof AccountingHttpException) {
    return error;
  }
  if (error instanceof InvalidUuidError || error instanceof AccountingValidationError) {
    return new AccountingHttpException(
      HttpStatus.BAD_REQUEST,
      ACCOUNTING_ERROR_CODES.VALIDATION_FAILED,
      'Invalid accounting request.',
    );
  }
  if (!(error instanceof AccountingError)) {
    // ERRO INESPERADO — a CAUSA PRIMÁRIA é preservada (mesmo padrão de INVENTORY e
    // FISCAL). Sem isto, a superfície relatava apenas `Accounting Http Exception`, o
    // NOME da classe, e a causa real era descartada exatamente onde ela existia.
    return new AccountingHttpException(
      HttpStatus.INTERNAL_SERVER_ERROR,
      ACCOUNTING_ERROR_CODES.VALIDATION_FAILED,
      'Unexpected accounting error.',
      { cause: error },
    );
  }
  switch (error.code) {
    case 'ACCOUNTING_UNBALANCED_ENTRY':
      return new AccountingHttpException(
        HttpStatus.CONFLICT,
        ACCOUNTING_ERROR_CODES.UNBALANCED_ENTRY,
        'Posted journals must have SUM(DEBIT) = SUM(CREDIT).',
      );
    case 'ACCOUNTING_ENTRY_IMMUTABLE':
      return new AccountingHttpException(
        HttpStatus.CONFLICT,
        ACCOUNTING_ERROR_CODES.ENTRY_IMMUTABLE,
        'Posted journals cannot be updated. Use reversal plus a new entry.',
      );
    case 'ACCOUNTING_PERIOD_CLOSED':
      return new AccountingHttpException(
        HttpStatus.CONFLICT,
        ACCOUNTING_ERROR_CODES.PERIOD_CLOSED,
        'Closed accounting periods reject new postings until an authorized reopen.',
      );
    case 'ACCOUNTING_PERIOD_OPEN':
      return new AccountingHttpException(
        HttpStatus.CONFLICT,
        ACCOUNTING_ERROR_CODES.PERIOD_OPEN,
        'Accounting period is already open.',
      );
    case 'ACCOUNTING_VERSION_CONFLICT':
      return new AccountingHttpException(
        HttpStatus.CONFLICT,
        ACCOUNTING_ERROR_CODES.VERSION_CONFLICT,
        'Accounting row version conflict.',
      );
    case 'ACCOUNTING_DUPLICATE_POSTING':
      return new AccountingHttpException(
        HttpStatus.CONFLICT,
        ACCOUNTING_ERROR_CODES.DUPLICATE_POSTING,
        'Duplicate accounting posting.',
      );
    case 'ACCOUNTING_ALREADY_REVERSED':
      return new AccountingHttpException(
        HttpStatus.CONFLICT,
        ACCOUNTING_ERROR_CODES.ALREADY_REVERSED,
        'Journal already has a reversal.',
      );
    case 'ACCOUNTING_NOT_POSTED':
      return new AccountingHttpException(
        HttpStatus.CONFLICT,
        ACCOUNTING_ERROR_CODES.NOT_POSTED,
        'Only posted journals can be reversed.',
      );
    case 'ACCOUNTING_ACCOUNT_NOT_FOUND':
      return new AccountingHttpException(
        HttpStatus.NOT_FOUND,
        ACCOUNTING_ERROR_CODES.ACCOUNT_NOT_FOUND,
        'Accounting account not found.',
      );
    case 'ACCOUNTING_CHART_NOT_FOUND':
      return new AccountingHttpException(
        HttpStatus.NOT_FOUND,
        ACCOUNTING_ERROR_CODES.CHART_NOT_FOUND,
        'Chart of accounts not found.',
      );
    case 'ACCOUNTING_PERIOD_NOT_FOUND':
      return new AccountingHttpException(
        HttpStatus.NOT_FOUND,
        ACCOUNTING_ERROR_CODES.PERIOD_NOT_FOUND,
        'Accounting period not found.',
      );
    case 'ACCOUNTING_NOT_FOUND':
      return accountingNotFound();
    case 'ACCOUNTING_DATE_OUTSIDE_PERIOD':
      return new AccountingHttpException(
        HttpStatus.BAD_REQUEST,
        ACCOUNTING_ERROR_CODES.DATE_OUTSIDE_PERIOD,
        'Occurred date is outside the accounting period.',
      );
    case 'ACCOUNTING_ACCOUNT_INACTIVE':
      return new AccountingHttpException(
        HttpStatus.CONFLICT,
        ACCOUNTING_ERROR_CODES.ACCOUNT_INACTIVE,
        'Inactive accounts reject new postings. Reactivate the account or use another analytical account.',
      );
    case 'ACCOUNTING_ACCOUNT_SYNTHETIC':
      return new AccountingHttpException(
        HttpStatus.CONFLICT,
        ACCOUNTING_ERROR_CODES.ACCOUNT_SYNTHETIC,
        'Synthetic accounts (with children) reject direct postings. Use an analytical account.',
      );
    case 'ACCOUNTING_ACCOUNT_CHART_MISMATCH':
      return new AccountingHttpException(
        HttpStatus.CONFLICT,
        ACCOUNTING_ERROR_CODES.ACCOUNT_CHART_MISMATCH,
        'Account does not belong to the journal chart.',
      );
    case 'ACCOUNTING_INVALID_AMOUNT':
      return new AccountingHttpException(
        HttpStatus.BAD_REQUEST,
        ACCOUNTING_ERROR_CODES.INVALID_AMOUNT,
        'Accounting amount must be positive.',
      );
    case 'ACCOUNTING_LINES_REQUIRED':
      return new AccountingHttpException(
        HttpStatus.BAD_REQUEST,
        ACCOUNTING_ERROR_CODES.LINES_REQUIRED,
        'Posted journals require at least two lines.',
      );
    case 'ACCOUNTING_PERIOD_HAS_DRAFTS':
      return new AccountingHttpException(
        HttpStatus.CONFLICT,
        ACCOUNTING_ERROR_CODES.PERIOD_HAS_DRAFTS,
        'Accounting period cannot close while draft journals remain.',
      );
    case 'ACCOUNTING_UNBALANCED_TRIAL_BALANCE':
      return new AccountingHttpException(
        HttpStatus.CONFLICT,
        ACCOUNTING_ERROR_CODES.UNBALANCED_TRIAL_BALANCE,
        'Accounting period cannot close with an unbalanced trial balance.',
      );
    case 'ACCOUNTING_PERIOD_CLOSE_BLOCKED':
      return new AccountingHttpException(
        HttpStatus.CONFLICT,
        ACCOUNTING_ERROR_CODES.PERIOD_CLOSE_BLOCKED,
        'Period close is blocked by a configured reconciliation check.',
      );
    case 'ACCOUNTING_RULE_NOT_CONFIGURED':
      return new AccountingHttpException(
        HttpStatus.CONFLICT,
        ACCOUNTING_ERROR_CODES.RULE_NOT_CONFIGURED,
        'No published accounting posting rule is configured for this economic event.',
      );
    case 'ACCOUNTING_RULE_VERSION_IMMUTABLE':
      return new AccountingHttpException(
        HttpStatus.CONFLICT,
        ACCOUNTING_ERROR_CODES.RULE_VERSION_IMMUTABLE,
        'Published accounting posting rule versions are immutable.',
      );
    case 'ACCOUNTING_INVALID_CONTEXT':
      return new AccountingHttpException(
        HttpStatus.BAD_REQUEST,
        ACCOUNTING_ERROR_CODES.INVALID_CONTEXT,
        'Accounting posting context is incomplete for the published rule.',
      );
    case 'REPORT_CLASSIFICATION_INCOMPLETE':
      return new AccountingHttpException(
        HttpStatus.CONFLICT,
        ACCOUNTING_ERROR_CODES.CLASSIFICATION_INCOMPLETE,
        'Income statement and balance sheet require a complete account classification. Classification is not invented.',
      );
    case 'ACCOUNTING_FIXED_ASSET_NOT_FOUND':
      return new AccountingHttpException(
        HttpStatus.NOT_FOUND,
        ACCOUNTING_ERROR_CODES.FIXED_ASSET_NOT_FOUND,
        'Fixed asset accounting register not found.',
      );
    case 'ACCOUNTING_FIXED_ASSET_NOT_CAPITALIZED':
      return new AccountingHttpException(
        HttpStatus.CONFLICT,
        ACCOUNTING_ERROR_CODES.FIXED_ASSET_NOT_CAPITALIZED,
        'Fixed asset accounting register is not capitalized.',
      );
    case 'ACCOUNTING_FIXED_ASSET_INVALID':
      return new AccountingHttpException(
        HttpStatus.CONFLICT,
        ACCOUNTING_ERROR_CODES.FIXED_ASSET_INVALID,
        'Fixed asset accounting operation is not allowed.',
      );
    case 'ACCOUNTING_DEPRECIATION_RATE_NOT_CONFIGURED':
      return new AccountingHttpException(
        HttpStatus.CONFLICT,
        ACCOUNTING_ERROR_CODES.DEPRECIATION_RATE_NOT_CONFIGURED,
        'Depreciation is reserved for a future configured rule. No depreciation rate or fiscal formula is invented.',
      );
    default:
      return new AccountingHttpException(
        HttpStatus.CONFLICT,
        ACCOUNTING_ERROR_CODES.VALIDATION_FAILED,
        'Accounting operation is not allowed.',
      );
  }
}
