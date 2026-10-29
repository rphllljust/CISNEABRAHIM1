/**
 * An approved measurement has line-level historical pricing snapshots.
 * Those immutable line currencies are the authority for measured billing;
 * neither the current service catalogue nor a default company currency
 * may silently re-denominate an already approved commercial obligation.
 */
export class MeasurementBillingCurrencyError extends Error {
  constructor(readonly code: 'BILLING_CURRENCY_UNVERIFIED' | 'BILLING_CURRENCY_MISMATCH') {
    super(code);
  }
}

function currency(value: unknown): string {
  if (typeof value !== 'string') {
    throw new MeasurementBillingCurrencyError('BILLING_CURRENCY_UNVERIFIED');
  }
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new MeasurementBillingCurrencyError('BILLING_CURRENCY_UNVERIFIED');
  }
  return normalized;
}

export function resolveMeasurementBillingCurrency(input: {
  pricingLines: Array<{ pricingLineSnapshot: Record<string, unknown> }>;
  commercialReferenceSnapshot: Record<string, unknown>;
}): string {
  if (input.pricingLines.length === 0) {
    throw new MeasurementBillingCurrencyError('BILLING_CURRENCY_UNVERIFIED');
  }
  const currencies = new Set(
    input.pricingLines.map((line) => currency(line.pricingLineSnapshot['currencyCode'])),
  );
  if (currencies.size !== 1) {
    throw new MeasurementBillingCurrencyError('BILLING_CURRENCY_MISMATCH');
  }
  const lineCurrency = [...currencies][0]!;
  const declaredCurrency = input.commercialReferenceSnapshot['currencyCode'];
  if (declaredCurrency !== undefined && declaredCurrency !== null &&
      currency(declaredCurrency) !== lineCurrency) {
    throw new MeasurementBillingCurrencyError('BILLING_CURRENCY_MISMATCH');
  }
  return lineCurrency;
}
