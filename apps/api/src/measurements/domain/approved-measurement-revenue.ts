/**
 * The revenue proxy in Cost-to-Serve is a sum of APPROVED measurement lines,
 * not billing, cash receipt or recognized accounting revenue.
 *
 * A currency-less line, missing amount or heterogeneous currencies invalidate
 * the aggregate. Retain a blocker rather than pretending all values are BRL.
 */
export type ApprovedMeasurementRevenueRow = {
  currency_code: string | null;
  total_revenue: string | null;
  missing_amount_count: number;
};

export type ApprovedMeasurementRevenueEvidence = {
  amount: string | null;
  currencyCode: string | null;
  issue: 'NONE' | 'NOT_AVAILABLE' | 'UNVERIFIED_CURRENCY' | 'MISSING_AMOUNT';
};

export function resolveApprovedMeasurementRevenueEvidence(
  rows: ApprovedMeasurementRevenueRow[],
): ApprovedMeasurementRevenueEvidence {
  if (rows.length === 0) {
    return { amount: null, currencyCode: null, issue: 'NOT_AVAILABLE' };
  }
  if (rows.length !== 1 || !rows[0]?.currency_code ||
      !/^[A-Z]{3}$/.test(rows[0].currency_code)) {
    return { amount: null, currencyCode: null, issue: 'UNVERIFIED_CURRENCY' };
  }
  const row = rows[0];
  if (row.missing_amount_count > 0 || row.total_revenue === null) {
    return { amount: null, currencyCode: row.currency_code, issue: 'MISSING_AMOUNT' };
  }
  // Zero is an amount, not evidence of an unregistered transaction.
  return { amount: row.total_revenue, currencyCode: row.currency_code, issue: 'NONE' };
}
