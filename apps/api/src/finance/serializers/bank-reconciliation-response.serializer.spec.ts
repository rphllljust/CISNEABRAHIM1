import { describe, expect, it } from 'vitest';
import type { BankStatementRow } from '../repositories/bank-reconciliation.repository.types';
import { toStatementResponse } from './bank-reconciliation-response.serializer';

const statement: BankStatementRow = {
  id: 'statement-1',
  unit_id: 'unit-1',
  financial_account_id: 'bank-1',
  source_kind: 'MANUAL',
  source_reference: 'EXT-001',
  period_starts_on: '2026-08-01',
  period_ends_on: '2026-08-31',
  currency_code: 'USD',
  status: 'OPEN',
  idempotency_key: 'idem-1',
  file_checksum: null,
};

describe('bank statement detail serialization', () => {
  it('exposes the persisted currency for the authorized statement, never a BRL default', () => {
    const detail = toStatementResponse(statement, [], false);
    expect(detail.currencyCode).toBe('USD');
    expect(detail.financialAccountId).toBe('bank-1');
    expect(detail.lines).toEqual([]);
  });
});
