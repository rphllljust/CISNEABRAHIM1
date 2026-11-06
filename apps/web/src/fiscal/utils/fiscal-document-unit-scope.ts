/** Resolves the visible fiscal unit from a deep link, never retaining a stale previous selection. */
export function resolveFiscalDocumentUnitScope(
  unitFromQuery: string,
  defaultUnitId: string | undefined,
): string {
  return unitFromQuery || defaultUnitId || '';
}
