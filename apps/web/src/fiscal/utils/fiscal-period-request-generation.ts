/** Ensures only the latest period list request can publish an API result. */
export function canApplyFiscalPeriodResult(
  requestGeneration: number,
  latestGeneration: number,
  signal?: AbortSignal,
): boolean {
  return requestGeneration === latestGeneration && !signal?.aborted;
}
