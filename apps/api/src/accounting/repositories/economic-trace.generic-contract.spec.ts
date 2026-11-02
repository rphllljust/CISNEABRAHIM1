import { describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../../infrastructure/database/database.service';
import { EconomicTraceReadModelService } from './economic-trace.read-model';

const sourceId = '11111111-1111-4111-8111-111111111111';
const event = {
  id: '22222222-2222-4222-8222-222222222222',
  unit_id: '33333333-3333-4333-8333-333333333333',
  event_kind: 'INVENTORY_MOVEMENT_POSTED',
  source_kind: 'INVENTORY_MOVEMENT',
  source_id: sourceId,
  amount: '125.0000',
  currency_code: 'BRL',
  occurred_on: '2026-11-02',
  outbox_event_id: '44444444-4444-4444-8444-444444444444',
};

function readModel(mode: 'failed' | 'posted') {
  const outbox = {
    id: event.outbox_event_id,
    status: mode === 'failed' ? 'FAILED' : 'DELIVERED',
    attempts: mode === 'failed' ? 3 : 1,
    max_attempts: 10,
    last_error: mode === 'failed' ? 'ACCOUNTING_RULE_NOT_CONFIGURED' : null,
    created_at: '2026-11-02T10:00:00Z',
  };
  const posting = {
    id: '55555555-5555-4555-8555-555555555555',
    event_kind: event.event_kind,
    status: mode === 'failed' ? 'REJECTED' : 'POSTED',
    journal_entry_id: mode === 'failed' ? null : '66666666-6666-4666-8666-666666666666',
    amount: event.amount,
    occurred_on: event.occurred_on,
    posting_rule_id: '77777777-7777-4777-8777-777777777777',
    posting_rule_version_id: '88888888-8888-4888-8888-888888888888',
    created_at: '2026-11-02T10:00:00Z',
  };
  const journal = {
    id: posting.journal_entry_id,
    entry_number: 42,
    kind: 'NORMAL',
    status: 'POSTED',
    posted_at: '2026-11-02T10:01:00Z',
  };
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FROM rpt.read_economic_events')) return { rows: [event] };
    if (sql.includes('FROM rpt.read_outbox_events')) return { rows: [outbox] };
    if (sql.includes('FROM rpt.read_accounting_posting_requests')) return { rows: [posting] };
    if (sql.includes('FROM rpt.read_journal_entries')) return { rows: [journal] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const database = { getConnection: () => ({ pool: { query } }) } as unknown as DatabaseService;
  return new EconomicTraceReadModelService(database);
}

describe('generic economic trace — production browser contract', () => {
  it('INVENTORY failed posting has complete trace/failure and no fictitious settlement', async () => {
    const trace = await readModel('failed').forFact(sourceId);
    expect(trace?.factKind).toBe('INVENTORY_MOVEMENT');
    expect(trace?.financialState).toBe('NOT_APPLICABLE');
    expect(trace?.summary).toContain('FINANCEIRO: NÃO SE APLICA');
    expect(trace?.impact).not.toContain('caixa');
    expect(trace?.trace.map((node) => node.kind)).toEqual(['INVENTORY_MOVEMENT', 'ECONOMIC_EVENT', 'POSTING']);
    expect(trace?.posting.failure).toMatchObject({
      code: 'ACCOUNTING_RULE_NOT_CONFIGURED', attempts: 3, maxAttempts: 10,
    });
    expect(trace?.posting.rule).toBeNull();
    expect(trace?.availableCommands).toContain('RETRY_POSTING');
    expect(trace).not.toHaveProperty('nodes');
  });

  it('posted journal completes chain and does not offer retry', async () => {
    const trace = await readModel('posted').forFact(sourceId);
    expect(trace?.accountingState).toBe('POSTED');
    expect(trace?.trace.map((node) => node.kind)).toEqual([
      'INVENTORY_MOVEMENT', 'ECONOMIC_EVENT', 'POSTING', 'JOURNAL',
    ]);
    expect(trace?.posting.failure).toBeNull();
    expect(trace?.availableCommands).not.toContain('RETRY_POSTING');
    expect(trace?.availableCommands).toContain('OPEN_JOURNAL');
  });
});
