/** Prevent an older manual page or filter request from overwriting the latest queue state. */
export function canApplyServiceRequestListResult(
  generation: number,
  latestGeneration: number,
  signal?: AbortSignal,
): boolean {
  return generation === latestGeneration && !signal?.aborted;
}
