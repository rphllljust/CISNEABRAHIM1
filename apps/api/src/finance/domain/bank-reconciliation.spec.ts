import { describe, expect, it } from 'vitest';
import {
  AUTO_EXACT_MATCH_CRITERIA,
  BANK_LINE_MATCH_STATUSES,
  RECONCILIATION_TARGET_KINDS,
  assertBankStatementAccountCurrency,
  assertBankStatementSourceKind,
  assertConfirmedImmutable,
  assertFinancialReconciliationIntegrity,
  assertNotAmountApproximation,
  classifyAutoMatch,
  isExactMatchCandidate,
  targetKindFromOrigin,
} from './bank-reconciliation';

const line = {
  id: 'line-1',
  accountId: 'acc-1',
  direction: 'CREDIT',
  amount: '100.0000',
  occurredOn: '2026-09-01',
};

describe('bank reconciliation domain', () => {
  it('enforces exact account currency without converting nominal amounts', () => {
    expect(() => assertBankStatementAccountCurrency('BRL', 'BRL')).not.toThrow();
    expect(() => assertBankStatementAccountCurrency('brl', 'BRL')).not.toThrow();
    expect(() => assertBankStatementAccountCurrency('USD', 'BRL')).toThrowError(
      'BANK_RECON_CURRENCY_MISMATCH',
    );
    expect(() => assertBankStatementAccountCurrency('BRL', 'USD')).toThrowError(
      'BANK_RECON_CURRENCY_MISMATCH',
    );
  });
  it('matches only on explicit exact account+amount+direction+date', () => {
    expect(AUTO_EXACT_MATCH_CRITERIA).toBe('ACCOUNT+AMOUNT+DIRECTION+OCCURRED_ON');
    expect(
      isExactMatchCandidate(line, {
        id: 'tx-1',
        accountId: 'acc-1',
        direction: 'CREDIT',
        amount: '100.0000',
        occurredOn: '2026-09-01',
        originKind: 'RECEIVABLE_SETTLEMENT',
        originId: 'set-1',
        transferId: null,
      }),
    ).toBe(true);
    expect(
      isExactMatchCandidate(line, {
        id: 'tx-2',
        accountId: 'acc-1',
        direction: 'CREDIT',
        amount: '99.9900',
        occurredOn: '2026-09-01',
        originKind: 'RECEIVABLE_SETTLEMENT',
        originId: 'set-2',
        transferId: null,
      }),
    ).toBe(false);
    expect(() => assertNotAmountApproximation('100.0000', '99.9900')).toThrowError(
      'BANK_RECON_AMOUNT_NOT_EXACT',
    );
  });

  it('sends ambiguous exact candidates to REVIEW_REQUIRED and never auto-selects', () => {
    const classified = classifyAutoMatch([
      {
        id: 'tx-a',
        accountId: 'acc-1',
        direction: 'CREDIT',
        amount: '100.0000',
        occurredOn: '2026-09-01',
        originKind: 'MANUAL_AUTHORIZED',
        originId: 'a',
        transferId: null,
      },
      {
        id: 'tx-b',
        accountId: 'acc-1',
        direction: 'CREDIT',
        amount: '100.0000',
        occurredOn: '2026-09-01',
        originKind: 'MANUAL_AUTHORIZED',
        originId: 'b',
        transferId: null,
      },
    ]);
    expect(classified.status).toBe(BANK_LINE_MATCH_STATUSES.ReviewRequired);
    expect(classified.selected).toBeNull();
    expect(classifyAutoMatch([]).status).toBe(BANK_LINE_MATCH_STATUSES.Unmatched);
  });

  it('classifies settlement, payment, transfer and other movements', () => {
    expect(targetKindFromOrigin('RECEIVABLE_SETTLEMENT', null)).toBe(
      RECONCILIATION_TARGET_KINDS.ReceivableSettlement,
    );
    expect(targetKindFromOrigin('PAYABLE_PAYMENT', null)).toBe(
      RECONCILIATION_TARGET_KINDS.PayablePayment,
    );
    expect(targetKindFromOrigin('TRANSFER', 'tr-1')).toBe(RECONCILIATION_TARGET_KINDS.Transfer);
    expect(targetKindFromOrigin('MANUAL_AUTHORIZED', null)).toBe(
      RECONCILIATION_TARGET_KINDS.FinancialTransaction,
    );
    expect(() => assertBankStatementSourceKind('ERP')).toThrowError('BANK_RECON_ERP_FORBIDDEN');
    expect(() => assertConfirmedImmutable('CONFIRMED', true)).toThrowError(
      'BANK_RECON_CONFIRMED_IMMUTABLE',
    );
    expect(() =>
      assertFinancialReconciliationIntegrity({
        confirmedLineIds: ['a', 'a'],
        uniqueConfirmedLineIds: ['a'],
        confirmedAmountsEqual: true,
      }),
    ).toThrowError('BANK_RECON_DOUBLE_MATCH');
  });
});
