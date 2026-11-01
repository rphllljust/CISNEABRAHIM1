import type { FinanceTitleSummary } from '../api/finance-api';

/**
 * Only the backend summary covers the complete authorized receivable/payable portfolio.
 * A list page (even status=OVERDUE) never establishes the monetary total.
 *
 * Monetary strings are formatted without converting the SQL NUMERIC result to a JS number:
 * amounts above 2^53, or with four decimal places, must not lose digits.
 */
const EXACT_NON_NEGATIVE_AMOUNT = /^(?:0|[1-9]\d{0,21})(?:\.\d{1,4})?$/;
const ISO_CURRENCY = /^[A-Z]{3}$/;

export type OverduePortfolio = { count: number | null; amountLabel: string | null };

function formatExactAmount(amount: string, currencyCode: string): string | null {
  if (!EXACT_NON_NEGATIVE_AMOUNT.test(amount) || !ISO_CURRENCY.test(currencyCode)) {
    return null;
  }

  const [integer = '0', fractional = ''] = amount.split('.');
  const grouping = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fraction = fractional.replace(/0+$/, '').padEnd(2, '0');
  const currency = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })
    .formatToParts(0)
    .find((part) => part.type === 'currency')?.value ?? currencyCode;

  return `${currency}\u00a0${grouping},${fraction}`;
}

/**
 * A mixed-currency portfolio is NEVER added together or labeled BRL by default.
 * A malformed or missing server summary is unavailable, not a zero-valued portfolio.
 */
export function overduePortfolio(summary: FinanceTitleSummary | null): OverduePortfolio {
  const unavailable: OverduePortfolio = { count: null, amountLabel: null };
  if (
    !summary ||
    !Number.isSafeInteger(summary.overdueCount) ||
    summary.overdueCount < 0 ||
    !Array.isArray(summary.amounts)
  ) {
    return unavailable;
  }

  if (summary.overdueCount === 0) {
    return { count: 0, amountLabel: 'Sem títulos vencidos' };
  }

  const currencies = new Set<string>();
  const formatted: string[] = [];
  let zeroAmount: string | null = null;

  for (const row of summary.amounts) {
    if (
      !row ||
      typeof row.currencyCode !== 'string' ||
      typeof row.overdueAmount !== 'string' ||
      currencies.has(row.currencyCode)
    ) {
      return { count: summary.overdueCount, amountLabel: null };
    }
    currencies.add(row.currencyCode);
    const label = formatExactAmount(row.overdueAmount, row.currencyCode);
    if (label === null) {
      return { count: summary.overdueCount, amountLabel: null };
    }
    if (/^0(?:\.0+)?$/.test(row.overdueAmount)) {
      zeroAmount ??= label;
    } else {
      formatted.push(label);
    }
  }

  return {
    count: summary.overdueCount,
    amountLabel: formatted.length > 0 ? formatted.join(' · ') : zeroAmount,
  };
}
