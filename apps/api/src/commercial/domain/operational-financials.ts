import { normalizeMoneyAmount, sumMoneyAmounts } from './money';

const MONEY_SCALE_FACTOR = 10_000n;

export const OPERATIONAL_PROFITABILITY_FORMULA =
  'operational_revenue - realized_cost = operational_margin';

export const OPERATIONAL_PROFITABILITY_DISCLAIMER =
  'Operational profitability is indicative and not official accounting.';

function toScaledAmount(value: string): bigint {
  const normalized = normalizeMoneyAmount(value);
  const parts = normalized.split('.');
  const whole = parts[0] ?? '0';
  const fraction = parts[1] ?? '';
  const paddedFraction = fraction.padEnd(4, '0').slice(0, 4);
  return BigInt(whole) * MONEY_SCALE_FACTOR + BigInt(paddedFraction);
}

function fromScaledAmount(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / MONEY_SCALE_FACTOR;
  const fraction = (absolute % MONEY_SCALE_FACTOR).toString().padStart(4, '0');
  const trimmedFraction = fraction.replace(/0+$/, '');
  const formatted = trimmedFraction.length > 0 ? `${whole}.${trimmedFraction}` : `${whole}`;
  return negative ? `-${formatted}` : formatted;
}

export function subtractMoney(left: string, right: string): string {
  return fromScaledAmount(toScaledAmount(left) - toScaledAmount(right));
}

/**
 * Deviation of actual vs estimated cost, in percent with four decimals.
 * The calculation is exact (BigInt scale); when the estimated denominator
 * is absent or zero no percentage can be inferred.
 */
export function computeCostVariancePercent(
  actualCost: string | null,
  estimatedCost: string | null,
): string | null {
  if (actualCost === null || estimatedCost === null) return null;
  const actual = toScaledAmount(actualCost);
  const estimate = toScaledAmount(estimatedCost);
  if (estimate === 0n) return null;
  const delta = actual - estimate;
  const magnitude = delta < 0n ? -delta : delta;
  const rounded = (magnitude * 100n * MONEY_SCALE_FACTOR + estimate / 2n) / estimate;
  return fromScaledAmount(delta < 0n ? -rounded : rounded);
}

export function sumNullableMoneyAmounts(values: Array<string | null | undefined>): string | null {
  const present = values.filter((value): value is string => Boolean(value));
  return present.length > 0 ? sumMoneyAmounts(present) : null;
}

export function computeOperationalMargin(
  operationalRevenue: string | null,
  realizedCost: string | null,
): string | null {
  if (operationalRevenue === null || realizedCost === null) {
    return null;
  }
  return subtractMoney(operationalRevenue, realizedCost);
}

export type OperationalProfitabilityTotals = {
  operationalRevenue: string | null;
  realizedCost: string | null;
  operationalMargin: string | null;
  revenueSupportedCount: number;
  costSupportedCount: number;
  marginComputableCount: number;
  serviceOrderCount: number;
};

export function aggregateOperationalProfitability(
  rows: Array<{
    operationalRevenue: string | null;
    realizedCost: string | null;
  }>,
): OperationalProfitabilityTotals {
  const revenueSupportedCount = rows.filter((row) => row.operationalRevenue !== null).length;
  const costSupportedCount = rows.filter((row) => row.realizedCost !== null).length;
  const marginComputableCount = rows.filter(
    (row) => row.operationalRevenue !== null && row.realizedCost !== null,
  ).length;

  const operationalRevenue = sumNullableMoneyAmounts(rows.map((row) => row.operationalRevenue));
  const realizedCost = sumNullableMoneyAmounts(rows.map((row) => row.realizedCost));
  // Totals may describe different subsets (a revenue-only OS and a cost-only OS).
  // Their difference is NOT consolidated profit. Publish a consolidated margin
  // only if every OS in the requested scope has both authoritative inputs.
  const completeCoverage = marginComputableCount === rows.length && rows.length > 0;
  const operationalMargin = completeCoverage
    ? computeOperationalMargin(operationalRevenue, realizedCost)
    : null;

  return {
    operationalRevenue,
    realizedCost,
    operationalMargin,
    revenueSupportedCount,
    costSupportedCount,
    marginComputableCount,
    serviceOrderCount: rows.length,
  };
}
