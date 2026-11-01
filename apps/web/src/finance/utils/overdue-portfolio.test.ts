import { describe, expect, it } from 'vitest';
import type { FinanceTitleSummary } from '../api/finance-api';
import { overduePortfolio } from './overdue-portfolio';

function summary(overrides: Partial<FinanceTitleSummary> = {}): FinanceTitleSummary {
  return {
    total: 1501,
    openCount: 1501,
    overdueCount: 1501,
    dueCount: 0,
    paidCount: 0,
    amounts: [
      { currencyCode: 'BRL', openAmount: '9007199254740993.0001', overdueAmount: '9007199254740993.0001', dueAmount: '0.0000' },
    ],
    ...overrides,
  };
}

describe('Financeiro — posição vencida autoritativa', () => {
  it('preserves the server count above the list page limit and all monetary digits', () => {
    expect(overduePortfolio(summary())).toEqual({
      count: 1501,
      amountLabel: 'R$\u00a09.007.199.254.740.993,0001',
    });
  });

  it('renders currencies separately rather than adding USD to BRL', () => {
    const result = overduePortfolio(summary({
      amounts: [
        { currencyCode: 'BRL', openAmount: '120.0000', overdueAmount: '120.5000', dueAmount: '0' },
        { currencyCode: 'USD', openAmount: '40.0000', overdueAmount: '40.1234', dueAmount: '0' },
      ],
    }));
    expect(result.count).toBe(1501);
    expect(result.amountLabel).toContain('R$\u00a0120,50');
    expect(result.amountLabel).toContain('US$\u00a040,1234');
    expect(result.amountLabel).not.toContain('160,');
  });

  it('does not display a zero for missing, invalid or duplicate-currency summaries', () => {
    expect(overduePortfolio(null)).toEqual({ count: null, amountLabel: null });
    expect(overduePortfolio(summary({ overdueCount: Number.NaN })).count).toBeNull();
    expect(overduePortfolio(summary({ amounts: [] }))).toEqual({ count: 1501, amountLabel: null });
    expect(overduePortfolio(summary({ amounts: [
      { currencyCode: 'BRL', overdueAmount: '5.0000', openAmount: '5', dueAmount: '0' },
      { currencyCode: 'BRL', overdueAmount: '6.0000', openAmount: '6', dueAmount: '0' },
    ] })).amountLabel).toBeNull();
    expect(overduePortfolio(summary({ amounts: [
      { currencyCode: 'BRL', overdueAmount: 'NaN', openAmount: '0', dueAmount: '0' },
    ] })).amountLabel).toBeNull();
  });

  it('distinguishes an authoritative zero from an unavailable read', () => {
    expect(overduePortfolio(summary({ total: 0, overdueCount: 0, amounts: [] }))).toEqual({
      count: 0,
      amountLabel: 'Sem títulos vencidos',
    });
  });

  it('omits zero-only currency rows in a mixed portfolio with positive exposures', () => {
    expect(overduePortfolio(summary({
      overdueCount: 1,
      amounts: [
        { currencyCode: 'BRL', overdueAmount: '0.0000', openAmount: '100', dueAmount: '100' },
        { currencyCode: 'USD', overdueAmount: '0.0001', openAmount: '0.0001', dueAmount: '0' },
      ],
    }))).toEqual({ count: 1, amountLabel: 'US$\u00a00,0001' });
  });
});
