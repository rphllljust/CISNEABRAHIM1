import { describe, expect, it } from 'vitest';
import {
  RECEIVABLE_LIFECYCLES,
  RECEIVABLE_STATUSES,
  assertInstallmentSchedule,
  assertNoOverpayment,
  assertReceivableActive,
  assertSettlementNotReconciled,
  assertSettlementReversible,
  deriveReceivableStatus,
  remainingBalance,
  reconcileReceivable,
} from './receivable';

describe('receivable domain', () => {
  it('derives OPEN, PARTIALLY_PAID, PAID, OVERDUE and CANCELLED without a paid boolean', () => {
    expect(
      deriveReceivableStatus({
        lifecycle: RECEIVABLE_LIFECYCLES.Active,
        principal: '100.0000',
        postedAmounts: [],
        dueDate: '2099-01-01',
      }),
    ).toBe(RECEIVABLE_STATUSES.Open);

    expect(
      deriveReceivableStatus({
        lifecycle: RECEIVABLE_LIFECYCLES.Active,
        principal: '100.0000',
        postedAmounts: ['40.0000'],
        dueDate: '2099-01-01',
      }),
    ).toBe(RECEIVABLE_STATUSES.PartiallyPaid);

    expect(
      deriveReceivableStatus({
        lifecycle: RECEIVABLE_LIFECYCLES.Active,
        principal: '100.0000',
        postedAmounts: ['100.0000'],
        dueDate: '2020-01-01',
      }),
    ).toBe(RECEIVABLE_STATUSES.Paid);

    expect(
      deriveReceivableStatus({
        lifecycle: RECEIVABLE_LIFECYCLES.Active,
        principal: '100.0000',
        postedAmounts: ['10.0000'],
        dueDate: '2020-01-01',
        asOf: new Date('2026-09-01T00:00:00.000Z'),
      }),
    ).toBe(RECEIVABLE_STATUSES.Overdue);

    expect(
      deriveReceivableStatus({
        lifecycle: RECEIVABLE_LIFECYCLES.Cancelled,
        principal: '100.0000',
        postedAmounts: [],
        dueDate: '2099-01-01',
      }),
    ).toBe(RECEIVABLE_STATUSES.Cancelled);
  });

  it('derives remaining balance from principal minus posted settlements', () => {
    expect(remainingBalance('100.50', ['40.25', '10.25'])).toBe('50');
  });

  it('rejects overpayment and cancelled settlement without mutating principal', () => {
    expect(() => assertNoOverpayment('100.0000', ['80.0000'], '30.0000')).toThrowError(
      'RECEIVABLE_OVERPAYMENT',
    );
    expect(() => assertReceivableActive(RECEIVABLE_LIFECYCLES.Cancelled)).toThrowError(
      'RECEIVABLE_CANCELLED',
    );
  });

  it('requires installment principals to equal receivable principal', () => {
    expect(() =>
      assertInstallmentSchedule('100.0000', [
        { installmentNumber: 1, principal: '60.0000', dueDate: '2026-10-01' },
        { installmentNumber: 2, principal: '40.0000', dueDate: '2026-11-01' },
      ]),
    ).not.toThrow();
    expect(() =>
      assertInstallmentSchedule('100.0000', [
        { installmentNumber: 1, principal: '60.0000', dueDate: '2026-10-01' },
      ]),
    ).toThrowError('RECEIVABLE_INSTALLMENT_TOTAL_MISMATCH');
  });

  it('reconciles without negative balance when settlements are valid', () => {
    const result = reconcileReceivable({
      principal: '250.0000',
      postedAmounts: ['100.0000', '150.0000'],
    });
    expect(result.remaining).toBe('0');
    expect(result.settled).toBe('250');
    expect(result.negativeBalance).toBe(false);
  });

  it('only reverses a posted settlement once', () => {
    expect(() => assertSettlementReversible('POSTED')).not.toThrow();
    expect(() => assertSettlementReversible('REVERSED')).toThrowError(
      'RECEIVABLE_SETTLEMENT_ALREADY_REVERSED',
    );
    expect(() => assertSettlementReversible('DRAFT')).toThrowError(
      'RECEIVABLE_SETTLEMENT_NOT_REVERSIBLE',
    );
  });

  it('blocks reversal while a confirmed reconciliation references the settlement', () => {
    expect(() => assertSettlementNotReconciled(0)).not.toThrow();
    expect(() => assertSettlementNotReconciled(1)).toThrowError(
      'RECEIVABLE_SETTLEMENT_RECONCILED',
    );
  });
});
