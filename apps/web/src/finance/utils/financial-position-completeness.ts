/**
 * A partially returned portfolio is UNKNOWN, not empty. This predicate is
 * shared by the Finance workspace and its contract tests; no monetary
 * aggregation is performed in the browser.
 */
export function isFinancialPositionEmpty(input: {
  receivableTotal: number | null | undefined;
  payableTotal: number | null | undefined;
  accountCount: number | null | undefined;
  agingBucketCounts: Array<number | null | undefined> | null;
}): boolean {
  const { receivableTotal, payableTotal, accountCount, agingBucketCounts } = input;
  if (
    receivableTotal === null || receivableTotal === undefined ||
    payableTotal === null || payableTotal === undefined ||
    accountCount === null || accountCount === undefined ||
    agingBucketCounts === null ||
    agingBucketCounts.some((count) => count === null || count === undefined)
  ) {
    return false;
  }
  return receivableTotal === 0 &&
    payableTotal === 0 &&
    accountCount === 0 &&
    agingBucketCounts.every((count) => count === 0);
}
