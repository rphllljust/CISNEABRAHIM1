/**
 * A worklist is filtered whenever any server-applied criterion is present.
 * This intentionally excludes unsubmitted search input: only the committed
 * query can explain an empty result set.
 */
export function hasActiveWorklistFilters(...values: Array<string | null | undefined>): boolean {
  return values.some((value) => typeof value === 'string' && value.trim().length > 0);
}
