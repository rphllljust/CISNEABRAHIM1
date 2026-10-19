import { HttpStatus } from '@nestjs/common';
import { MoneyValidationError } from '../../platform/kernel/money-math';
import { CashForecastError } from '../domain/cash-flow-forecast';
import { FINANCE_ERROR_CODES } from '../errors/finance-error-codes';
import { FinanceHttpException } from '../errors/finance-http.exception';

export function cashForecastAccessDenied(): FinanceHttpException {
  return new FinanceHttpException(HttpStatus.FORBIDDEN, FINANCE_ERROR_CODES.DENIED, 'Access denied.');
}

export function mapCashForecastDomainError(error: unknown): FinanceHttpException {
  if (error instanceof FinanceHttpException) {
    return error;
  }
  // Invalid request input (missing unitId, malformed currency, bad dates) is a client
  // error. Only a genuinely unexpected failure should be reported as 500, otherwise a
  // typo in the query string looks like a server outage.
  if (error instanceof CashForecastError) {
    if (error.code === 'CASH_FORECAST_NO_DATA') {
      return new FinanceHttpException(
        HttpStatus.NOT_FOUND,
        FINANCE_ERROR_CODES.CASH_FORECAST_NO_DATA,
        'No cash forecast facts exist for the requested unit and currency.',
      );
    }
    if (error.code === 'CASH_FORECAST_FALSE_REALIZED') {
      return new FinanceHttpException(
        HttpStatus.CONFLICT,
        FINANCE_ERROR_CODES.CASH_FORECAST_FALSE_REALIZED,
        'Forecast remaining cannot be classified as realized.',
      );
    }
    return new FinanceHttpException(
      HttpStatus.BAD_REQUEST,
      FINANCE_ERROR_CODES.CASH_FORECAST_INVALID,
      'Cash forecast request is invalid.',
    );
  }
  if (error instanceof MoneyValidationError) {
    return new FinanceHttpException(
      HttpStatus.BAD_REQUEST,
      FINANCE_ERROR_CODES.CASH_FORECAST_INVALID,
      'Cash forecast request is invalid.',
    );
  }  return new FinanceHttpException(
    HttpStatus.INTERNAL_SERVER_ERROR,
    FINANCE_ERROR_CODES.VALIDATION_FAILED,
    'Unexpected cash forecast error.',
  );
}
