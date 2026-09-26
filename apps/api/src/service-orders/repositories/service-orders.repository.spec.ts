import { describe, expect, it, vi } from 'vitest';
import { buildServiceOrderTransitionFields } from './service-orders-history-rows';
import { ServiceOrdersRepository } from './service-orders.repository';

describe('ServiceOrdersRepository.listServiceOrders', () => {
  it('uses stable ordering and passes pagination params after filter params', async () => {
    const query = vi.fn(async (_sql: string, _params: unknown[]) => ({ rows: [] }));
    const repository = new ServiceOrdersRepository(
      { getConnection: () => ({ pool: { query } }) } as never,
      { appendServiceOrderReleased: vi.fn(), appendServiceOrderCompleted: vi.fn() } as never,
    );

    await repository.listServiceOrders(
      {
        fromClause: 'so.service_orders so',
        whereClause: 'so.unit_id = $1',
        params: ['unit-a'],
        orderBy: 'so.created_at DESC, so.id DESC',
      },
      20,
      40,
    );

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('ORDER BY so.created_at DESC, so.id DESC');
    expect(sql).toContain('LIMIT $2');
    expect(sql).toContain('OFFSET $3');
    expect(params).toEqual(['unit-a', 20, 40]);
  });
});

describe('service order completion fact across transitions', () => {
  it('materializes the completion instant when the order is completed', () => {
    const { sql } = buildServiceOrderTransitionFields({
      transition: 'complete',
    } as never);

    expect(sql).toContain('completed_at = NOW()');
    expect(sql).toContain('completed_by_identity_id = $4');
  });

  it('clears the completion instant when the order is reopened', () => {
    const { sql } = buildServiceOrderTransitionFields({
      transition: 'reopen',
      reopenReason: 'Retrabalho solicitado pelo cliente.',
    } as never);

    expect(sql).toContain('completed_at = NULL');
    expect(sql).toContain('completed_by_identity_id = NULL');
    expect(sql).toContain('reopened_at = NOW()');
    expect(sql).toContain('reopen_reason = $6');
  });
});
