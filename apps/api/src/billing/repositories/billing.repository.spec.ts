import { describe, expect, it, vi } from 'vitest';
import { BillingRepository } from './billing.repository';

describe('BillingRepository.listWorklist', () => {
  it('executes one scoped server projection with exact count, currency summary, and pagination', async () => {
    const query = vi.fn(async (_sql: string, _params: unknown[]) => ({
      rows: [{
        items: [],
        total: '0',
        counts: { ready: 0, prepared: 0 },
        amounts_by_currency: [],
      }],
    }));
    const repository = new BillingRepository(
      { getConnection: () => ({ pool: { query } }) } as never,
      {} as never,
    );

    const result = await repository.listWorklist({
      scopeClause: 'so.unit_id = ANY($1::text[])',
      scopeParams: [['unit-a']],
      documentScopeClause: 'so.client_id = ANY($1::uuid[])',
      documentScopeParams: [['client-a']],
      search: 'OS-2026',
      bucket: 'ready',
      limit: 20,
      offset: 40,
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] ?? [];
    expect(sql).toContain('WITH base AS MATERIALIZED');
    expect(sql).toContain('LEFT JOIN LATERAL');
    expect(sql).toContain('count(*)::text AS total');
    expect(sql).toContain('GROUP BY currency_code');
    expect(sql).toContain('so.client_id = ANY($2::uuid[])');
    expect(sql).toContain('LIMIT $4 OFFSET $5');
    expect(sql).toContain('WHERE bucket = $6');
    expect(params).toEqual([['unit-a'], ['client-a'], '%OS-2026%', 20, 40, 'ready']);
    expect(result.summary.total).toBe(0);
    expect(result.summary.amountsByCurrency).toEqual([]);
  });
});
