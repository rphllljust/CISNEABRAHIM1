import { describe, expect, it, vi } from 'vitest';
import { ServiceOrderPlanningAccessService } from './service-order-planning-access.service';

const actor = { identityId: '11111111-1111-4111-8111-111111111111', sessionId: 'session' };
const personId = '22222222-2222-4222-8222-222222222222';

function fixture(allowedIds: string[]) {
  const allocations = ['hidden', 'visible-a', 'visible-b', 'hidden-last'].map((key, index) => ({
    id: key,
    service_order_id: `order-${key}`,
    status: 'ACTIVE',
    operational_start: '2026-11-03T10:00:00.000Z',
    operational_end: '2026-11-03T12:00:00.000Z',
    allocated_at: `2026-11-03T0${index}:00:00.000Z`,
    row_version: 1,
  }));
  const orders = allocations.map((row) => ({
    id: row.service_order_id,
    order_number: `OS-${row.id}`,
    status: 'RELEASED',
  }));
  const planningRepository = {
    listWorkforceAllocationCandidates: vi.fn(async (_personId: string, limit: number, offset: number) =>
      allocations.slice(offset, offset + limit)),
  };
  const serviceOrdersRepository = {
    findByIds: vi.fn(async (ids: string[]) => orders.filter((order) => ids.includes(order.id))),
  };
  const authz = {
    assertWorkforceAllocationDiscovery: vi.fn(async () => undefined),
    filterReadableRows: vi.fn(async (_actor: unknown, rows: typeof orders) =>
      rows.filter((order) => allowedIds.includes(order.id))),
    filterAllocationReadableRows: vi.fn(async (_actor: unknown, rows: typeof orders) => rows),
  };
  const service = new ServiceOrderPlanningAccessService(
    serviceOrdersRepository as never,
    planningRepository as never,
    authz as never,
    {} as never,
  );
  return { service, authz, planningRepository };
}

describe('E04-02 authorized Person -> OS allocation links', () => {
  it('returns no metadata or count for denied service orders', async () => {
    const { service } = fixture(['order-visible-a', 'order-visible-b']);
    const first = await service.listAuthorizedWorkforceAllocations(actor, personId, { limit: 1, offset: 0 });
    expect(first.items.map((item) => item.orderNumber)).toEqual(['OS-visible-a']);
    expect(first.hasMore).toBe(true);
    expect(JSON.stringify(first)).not.toContain('OS-hidden');
    expect(first).not.toHaveProperty('total');
    const second = await service.listAuthorizedWorkforceAllocations(actor, personId, { limit: 1, offset: 1 });
    expect(second.items.map((item) => item.orderNumber)).toEqual(['OS-visible-b']);
    expect(second.hasMore).toBe(false);
  });

  it('distinguishes denied collection from an authorized empty page', async () => {
    const { service, authz, planningRepository } = fixture([]);
    authz.assertWorkforceAllocationDiscovery.mockRejectedValueOnce(new Error('ACCESS_DENIED'));
    await expect(service.listAuthorizedWorkforceAllocations(actor, personId, { limit: 10, offset: 0 }))
      .rejects.toThrow('ACCESS_DENIED');
    expect(planningRepository.listWorkforceAllocationCandidates).not.toHaveBeenCalled();

    const empty = await service.listAuthorizedWorkforceAllocations(actor, personId, { limit: 10, offset: 0 });
    expect(empty.items).toEqual([]);
    expect(empty.partial).toBe(false);
    expect(empty.hasMore).toBe(false);
  });
});
