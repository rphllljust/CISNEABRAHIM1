/**
 * Shared read-model pagination for OS, rentals and transport.
 * The total and hasMore are computed by the authorized NestJS query. Avoid
 * treating a full last page as proof that another page exists.
 */
export function resolveServiceOrderPage(response: {
  items: ReadonlyArray<unknown>;
  offset: number;
  limit: number;
  total?: number;
  hasMore?: boolean;
}): { total: number | null; hasMore: boolean } {
  const total =
    typeof response.total === 'number' &&
    Number.isSafeInteger(response.total) &&
    response.total >= 0
      ? response.total
      : null;

  return {
    total,
    hasMore:
      typeof response.hasMore === 'boolean'
        ? response.hasMore
        : total !== null
          ? response.offset + response.items.length < total
          : response.limit > 0 && response.items.length === response.limit,
  };
}
