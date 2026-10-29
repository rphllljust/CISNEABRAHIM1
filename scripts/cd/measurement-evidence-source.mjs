/**
 * Classification of an authorized, read-only Service Order list response.
 * A missing authorized operation is NOT equivalent to a denied request,
 * a broken projection, or an unavailable source. Never turn these into N/A.
 */
export function classifyServiceOrderEvidencePage({ status, payload, unitId }) {
  if (status === 401 || status === 403) {
    return { valid: false, reason: 'BUSINESS_ACCESS_DENIED' };
  }
  if (status === 404) {
    return { valid: false, reason: 'BUSINESS_ROUTE_NOT_FOUND' };
  }
  if (status === null || status >= 500) {
    return { valid: false, reason: 'BUSINESS_SOURCE_UNAVAILABLE' };
  }
  if (status < 200 || status >= 300) {
    return { valid: false, reason: 'BUSINESS_SOURCE_HTTP_ERROR' };
  }
  if (
    !payload ||
    !Array.isArray(payload.items) ||
    typeof payload.hasMore !== 'boolean' ||
    typeof unitId !== 'string' ||
    !unitId
  ) {
    return { valid: false, reason: 'BUSINESS_PROJECTION_INVALID' };
  }
  if (
    payload.items.some(
      (item) => !item || typeof item.id !== 'string' || !item.id ||
        item.unitId !== unitId,
    )
  ) {
    return { valid: false, reason: 'BUSINESS_SCOPE_MISMATCH' };
  }
  if (payload.hasMore && payload.items.length === 0) {
    return { valid: false, reason: 'BUSINESS_PAGINATION_INVALID' };
  }
  return {
    valid: true,
    reason: payload.items.length === 0
      ? 'BUSINESS_EVIDENCE_NOT_AVAILABLE'
      : 'BUSINESS_EVIDENCE_AVAILABLE',
  };
}
