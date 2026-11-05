import { describe, expect, it, vi } from 'vitest';
import { EconomicTraceReadModelService } from './economic-trace.read-model';

describe('accounting non-financial event classification', () => {
  it('does not treat an inventory posting exception as a finance settlement', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{
      event_id: 'evt', event_kind: 'INVENTORY_COST', source_kind: 'INVENTORY_MOVEMENT',
      source_id: '11111111-1111-4111-8111-111111111111', unit_id: 'unit-1',
      amount: '30.0000', currency_code: 'BRL', occurred_on: '2026-11-05',
      outbox_status: 'FAILED', attempts: 1, last_error: 'MISSING_RULE', first_seen: null,
      posting_status: null, journal_entry_id: null,
    }] }).mockResolvedValueOnce({ rows: [{ pending: '0', failed: '1', reversed: '0' }] });
    const model = new EconomicTraceReadModelService({
      getConnection: () => ({ pool: { query } }),
    } as never);
    const [item] = (await model.worklist('unit-1', 50, 0)).items;
    expect(item?.factKind).toBe('INVENTORY_MOVEMENT');
    expect(item?.financialState).toBe('NOT_APPLICABLE');
    expect(item?.availableCommands).not.toContain('REVERSE_SETTLEMENT');
  });
});
