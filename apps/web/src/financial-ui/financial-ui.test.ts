import { describe, expect, it } from 'vitest';
import { classifyBackofficeError } from './enterprise-api';
import { formatMoneyBrl } from '../ui/format/money';
import { BACKOFFICE_TABLE_PAGE_SIZE, sliceTablePage } from './table-slice';

describe('financial UI helpers', () => {
  it('classifies version conflict and closed period without treating them as success', () => {
    expect(classifyBackofficeError(409, 'FINANCE_VERSION_CONFLICT')).toBe('version_conflict');
    expect(classifyBackofficeError(409, 'FINANCE_RECEIVABLE_OVERPAYMENT')).toBe('validation');
    expect(classifyBackofficeError(409, 'ACCOUNTING_PERIOD_CLOSED')).toBe('closed_period');
    expect(classifyBackofficeError(403, 'FINANCE_DENIED')).toBe('denied');
    expect(classifyBackofficeError(403, 'PROCUREMENT_DENIED')).toBe('denied');
    expect(classifyBackofficeError(403, 'INVENTORY_DENIED')).toBe('denied');
    expect(classifyBackofficeError(403, 'PAYROLL_DENIED')).toBe('denied');
    expect(classifyBackofficeError(409, 'PROCUREMENT_VERSION_CONFLICT')).toBe('version_conflict');
    expect(classifyBackofficeError(409, 'SUPPLIER_VERSION_CONFLICT')).toBe('version_conflict');
    expect(classifyBackofficeError(0, undefined)).toBe('unknown');
  });

  it('formats money from API strings without summing', () => {
    expect(formatMoneyBrl('1500.0000')).toMatch(/1\.500/);
    expect(sliceTablePage(Array.from({ length: 60 }, (_, index) => index), 2)).toHaveLength(10);
    expect(BACKOFFICE_TABLE_PAGE_SIZE).toBe(50);
  });
});
