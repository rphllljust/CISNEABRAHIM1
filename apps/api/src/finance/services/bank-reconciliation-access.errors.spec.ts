import { describe, expect, it } from 'vitest';
import { InvalidUuidError } from '../../platform/kernel/uuid';
import { FinanceHttpException } from '../errors/finance-http.exception';
import { mapBankReconciliationError } from './bank-reconciliation-access.errors';

describe('mapBankReconciliationError', () => {
  it('propagates InvalidUuidError so the global filter returns 400 INVALID_ID', () => {
    expect(() => mapBankReconciliationError(new InvalidUuidError('statementId'))).toThrow(
      InvalidUuidError,
    );
  });

  it('maps unknown errors to an internal FinanceHttpException (never leaks details)', () => {
    const mapped = mapBankReconciliationError(new Error('boom'));
    expect(mapped).toBeInstanceOf(FinanceHttpException);
    expect(mapped.getStatus()).toBe(500);
    const body = mapped.getResponse();
    expect(typeof body).toBe('object');
    const nested = body as { error?: { code?: string } };
    expect(nested.error?.code).toBe('FINANCE_VALIDATION_FAILED');
  });
});
