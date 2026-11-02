import { describe, expect, it } from 'vitest';
import { bankStatementAbsoluteDifference } from './bank-statement-money';

describe('bank statement money comparison', () => {
  it('preserves differences down to one ten-thousandth', () => {
    expect(bankStatementAbsoluteDifference('100.0000', '99.9999')).toBe('0.0001');
    expect(bankStatementAbsoluteDifference('10000000000000.0000', '9999999999999.9999')).toBe('0.0001');
    expect(bankStatementAbsoluteDifference('0.1000', '0.3000')).toBe('0.2000');
  });

  it('shows an exact zero and handles reverse and negative values', () => {
    expect(bankStatementAbsoluteDifference('100.00', '100.0000')).toBe('0.0000');
    expect(bankStatementAbsoluteDifference('9.5', '10')).toBe('0.5000');
    expect(bankStatementAbsoluteDifference('-10', '-12.0001')).toBe('2.0001');
  });

  it('fails closed for untrusted or unsupported amounts', () => {
    expect(bankStatementAbsoluteDifference('abc', '10')).toBeNull();
    expect(bankStatementAbsoluteDifference('10.00001', '10')).toBeNull();
    expect(bankStatementAbsoluteDifference('NaN', '10')).toBeNull();
  });
});
