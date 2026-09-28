import { HttpStatus } from '@nestjs/common';
import { AuthzHttpException } from '../../authorization/errors/authz-http.exception';
import { BudgetError } from '../domain/budget';
import { FINANCE_ERROR_CODES } from '../errors/finance-error-codes';
import { FinanceHttpException } from '../errors/finance-http.exception';

export function budgetAccessDenied(): FinanceHttpException {
  return new FinanceHttpException(HttpStatus.FORBIDDEN, FINANCE_ERROR_CODES.DENIED, 'Access denied.');
}

export function mapBudgetDomainError(error: unknown): FinanceHttpException {
  if (error instanceof AuthzHttpException) {
    throw error;
  }
  if (error instanceof FinanceHttpException) {
    return error;
  }
  if (!(error instanceof BudgetError)) {
    return new FinanceHttpException(
      HttpStatus.INTERNAL_SERVER_ERROR,
      FINANCE_ERROR_CODES.VALIDATION_FAILED,
      'Unexpected budget error.',
    );
  }
  switch (error.code) {
    case 'BUDGET_NOT_FOUND':
      return new FinanceHttpException(
        HttpStatus.NOT_FOUND,
        FINANCE_ERROR_CODES.BUDGET_NOT_FOUND,
        'Budget not found.',
      );
    case 'BUDGET_VERSION_IMMUTABLE':
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.BUDGET_VERSION_IMMUTABLE,
        'Approved budget versions are immutable. Create a new version.',
      );
    case 'BUDGET_NOT_DRAFT':
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.BUDGET_NOT_DRAFT,
        'Only a draft budget version can be approved.',
      );
    case 'BUDGET_VERSION_CONFLICT':
      // 409 com codigo proprio: a tela precisa distinguir "estado mudou sob voce" de
      // "ja nao e rascunho". Espelha o contrato ja usado por Expenses.
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.BUDGET_VERSION_CONFLICT,
        'This budget version changed since it was loaded. Reload before approving.',
      );
    case 'BUDGET_INCOMPLETE':
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.BUDGET_INCOMPLETE,
        'A budget version needs at least one period and one line before approval.',
      );
    case 'BUDGET_PERIOD_OVERLAP':
    case 'BUDGET_PERIOD_INVALID':
    case 'BUDGET_PERIOD_DUPLICATE':
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.BUDGET_PERIOD_INVALID,
        'Budget period is invalid, duplicated or overlapping.',
      );
    case 'BUDGET_DUPLICATE':
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.BUDGET_DUPLICATE,
        'A budget with this code already exists for the unit.',
      );
    case 'BUDGET_DRAFT_EXISTS':
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.BUDGET_DRAFT_EXISTS,
        'A draft budget version already exists.',
      );
    case 'BUDGET_NOT_APPROVED':
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.BUDGET_NOT_APPROVED,
        'A new version can only be created from an approved budget.',
      );
    case 'BUDGET_VERSION_REQUIRED':
      return new FinanceHttpException(
        HttpStatus.BAD_REQUEST,
        FINANCE_ERROR_CODES.BUDGET_VERSION_REQUIRED,
        'A budget approval requires the version number that was loaded.',
      );
    case 'BUDGET_LINE_DIMENSION_REQUIRED':
      return new FinanceHttpException(
        HttpStatus.BAD_REQUEST,
        FINANCE_ERROR_CODES.BUDGET_LINE_DIMENSION_REQUIRED,
        'A budget line requires a cost center, category or accounting account.',
      );
    default:
      return new FinanceHttpException(
        HttpStatus.BAD_REQUEST,
        FINANCE_ERROR_CODES.VALIDATION_FAILED,
        'Budget operation is not allowed.',
      );
  }
}
