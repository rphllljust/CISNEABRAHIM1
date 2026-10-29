import { describe, expect, it } from 'vitest';
import {
  MeasurementBillingCurrencyError,
  resolveMeasurementBillingCurrency,
} from './measurement-billing-currency';

const item = (currencyCode: unknown) => ({
  pricingLineSnapshot: { currencyCode },
});

describe('approved measurement → Billing authoritative currency', () => {
  it('uses immutable line currency even when the measurement header has no currency field', () => {
    expect(resolveMeasurementBillingCurrency({
      pricingLines: [item('BRL'), item('brl')],
      commercialReferenceSnapshot: { pricingLines: [{ currencyCode: 'BRL' }] },
    })).toBe('BRL');
  });

  it('rejects cross-currency measurement before billing total can be committed', () => {
    expect(() => resolveMeasurementBillingCurrency({
      pricingLines: [item('BRL'), item('USD')],
      commercialReferenceSnapshot: {},
    })).toThrowError(new MeasurementBillingCurrencyError('BILLING_CURRENCY_MISMATCH'));
  });

  it('does not manufacture BRL when historical item currency is missing', () => {
    expect(() => resolveMeasurementBillingCurrency({
      pricingLines: [item(undefined)],
      commercialReferenceSnapshot: {},
    })).toThrowError(new MeasurementBillingCurrencyError('BILLING_CURRENCY_UNVERIFIED'));
    expect(() => resolveMeasurementBillingCurrency({
      pricingLines: [],
      commercialReferenceSnapshot: {},
    })).toThrowError(new MeasurementBillingCurrencyError('BILLING_CURRENCY_UNVERIFIED'));
  });

  it('rejects a conflicting currency declared in the commercial reference', () => {
    expect(() => resolveMeasurementBillingCurrency({
      pricingLines: [item('BRL')],
      commercialReferenceSnapshot: { currencyCode: 'USD' },
    })).toThrowError(new MeasurementBillingCurrencyError('BILLING_CURRENCY_MISMATCH'));
  });
});
