import { describe, expect, it } from 'vitest';
import { projectAuthorizedEconomicStatuses } from './authorized-economic-statuses';

describe('OS 360 economic status projection', () => {
  it('does not infer billing or accounting from OS lifecycle', () => {
    expect(projectAuthorizedEconomicStatuses([
      { kind: 'SERVICE_ORDER', status: 'COMPLETED' },
      { kind: 'MEASUREMENT', status: 'APPROVED' },
    ])).toEqual({ billing: 'UNKNOWN', accounting: 'UNKNOWN' });
  });

  it('reads only authorized owner nodes, retaining cancelled and posted states', () => {
    expect(projectAuthorizedEconomicStatuses([
      { kind: 'BILLING_DOCUMENT', status: 'VOIDED' },
      { kind: 'ACCOUNTING_ENTRY', status: 'POSTED' },
      { kind: 'RECEIVABLE', status: 'SETTLED' },
    ])).toEqual({ billing: 'VOIDED', accounting: 'POSTED' });
  });

  it('does not choose an arbitrary state when authorized documents disagree', () => {
    expect(projectAuthorizedEconomicStatuses([
      { kind: 'BILLING_DOCUMENT', status: 'FINALIZED' },
      { kind: 'BILLING_DOCUMENT', status: 'VOIDED' },
      { kind: 'ACCOUNTING_ENTRY', status: 'POSTED' },
      { kind: 'ACCOUNTING_ENTRY', status: 'POSTED' },
    ])).toEqual({ billing: 'MIXED', accounting: 'POSTED' });
  });

  it('does not treat blank owner states as evidence', () => {
    expect(projectAuthorizedEconomicStatuses([
      { kind: 'BILLING_DOCUMENT', status: '  ' },
    ])).toEqual({ billing: 'UNKNOWN', accounting: 'UNKNOWN' });
  });
});
