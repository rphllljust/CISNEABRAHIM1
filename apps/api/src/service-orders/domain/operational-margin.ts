import {
  OPERATIONAL_PROFITABILITY_DISCLAIMER,
  aggregateOperationalProfitability,
  computeOperationalMargin,
  computeCostVariancePercent,
  sumNullableMoneyAmounts,
  subtractMoney,
} from '../../commercial/domain/operational-financials';

export type OperationalCostLineSummary = {
  id: string;
  category: string;
  costKind: string;
  origin: string;
  amount: string;
  currencyCode: string;
  sourceExecutionEntryId: string | null;
};

export type OperationalMarginSummary = {
  capturedAt: string;
  currencyCode: string;
  revenue: string | null;
  totalEstimatedCost: string | null;
  totalActualCost: string | null;
  estimatedMargin: string | null;
  actualMargin: string | null;
  /** Actual less estimated: a positive variance is an overrun, not profit. */
  estimatedToActualVariance: string | null;
  estimatedToActualVariancePercent: string | null;
  /** Every reason is derived from authority/evidence, never a placeholder KPI. */
  blockingReasons: string[];
  disclaimer: string;
  lines: OperationalCostLineSummary[];
};

export function buildOperationalMarginSummary(input: {
  revenue: string | null;
  currencyCode: string;
  lines: OperationalCostLineSummary[];
}): OperationalMarginSummary {
  const estimated = input.lines
    .filter((line) => line.costKind === 'ESTIMATED')
    .map((line) => line.amount);
  const actual = input.lines
    .filter((line) => line.costKind === 'ACTUAL')
    .map((line) => line.amount);

  // A cost ledger can contain entries from distinct currencies. Never add
  // different currencies together and present the result as one business fact.
  const incompatibleCurrencies = input.lines.some(
    (line) => line.currencyCode !== input.currencyCode,
  );
  const totalEstimatedCost = incompatibleCurrencies ? null : sumNullableMoneyAmounts(estimated);
  const totalActualCost = incompatibleCurrencies ? null : sumNullableMoneyAmounts(actual);
  const blockingReasons = [
    ...(incompatibleCurrencies ? ['COST_CURRENCY_MISMATCH'] : []),
    ...(input.revenue === null ? ['APPROVED_MEASUREMENT_REVENUE_UNAVAILABLE'] : []),
    ...(totalActualCost === null && !incompatibleCurrencies ? ['ACTUAL_COST_EVIDENCE_MISSING'] : []),
  ];

  return {
    capturedAt: new Date().toISOString(),
    currencyCode: input.currencyCode,
    revenue: input.revenue,
    totalEstimatedCost,
    totalActualCost,
    estimatedMargin: computeOperationalMargin(input.revenue, totalEstimatedCost),
    actualMargin: computeOperationalMargin(input.revenue, totalActualCost),
    estimatedToActualVariance:
      totalEstimatedCost !== null && totalActualCost !== null
        ? subtractMoney(totalActualCost, totalEstimatedCost)
        : null,
    estimatedToActualVariancePercent: computeCostVariancePercent(
      totalActualCost, totalEstimatedCost,
    ),
    blockingReasons,
    disclaimer: OPERATIONAL_PROFITABILITY_DISCLAIMER,
    lines: input.lines,
  };
}

export { aggregateOperationalProfitability };
