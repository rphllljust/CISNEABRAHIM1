import { describe, expect, it, vi } from 'vitest';
import { ServiceOrderPlanningAccessService } from './service-order-planning-access.service';
import { listAuthorizedWorkforceCursorPage } from './workforce-allocation-cursor-page';
import { openWorkforceCursor } from './workforce-allocation-cursor';

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
  const planningRepository = {};
  const serviceOrdersRepository = {
    listWorkforceAllocationCandidates: vi.fn(async (_personId: string, limit: number, offset: number) =>
      allocations.slice(offset, offset + limit)),
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
  return { service, authz, serviceOrdersRepository };
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
    const { service, authz, serviceOrdersRepository } = fixture([]);
    authz.assertWorkforceAllocationDiscovery.mockRejectedValueOnce(new Error('ACCESS_DENIED'));
    await expect(service.listAuthorizedWorkforceAllocations(actor, personId, { limit: 10, offset: 0 }))
      .rejects.toThrow('ACCESS_DENIED');
    expect(serviceOrdersRepository.listWorkforceAllocationCandidates).not.toHaveBeenCalled();

    const empty = await service.listAuthorizedWorkforceAllocations(actor, personId, { limit: 10, offset: 0 });
    expect(empty.items).toEqual([]);
    expect(empty.partial).toBe(false);
    expect(empty.hasMore).toBe(false);
  });
  it('reports incomplete discovery when 5000 denied candidates exhaust the scan budget', async () => {
    const { service, serviceOrdersRepository } = fixture([]);
    const denied = Array.from({ length: 5000 }, (_, index) => ({
      id: `denied-${index}`,
      service_order_id: `order-denied-${index}`,
      status: 'ACTIVE',
      operational_start: '2026-11-03T10:00:00.000Z',
      operational_end: '2026-11-03T12:00:00.000Z',
      allocated_at: '2026-11-03T09:00:00.000Z',
      row_version: 1,
    }));
    serviceOrdersRepository.listWorkforceAllocationCandidates.mockImplementation(
      async (_personId: string, limit: number, offset: number) => denied.slice(offset, offset + limit),
    );
    serviceOrdersRepository.findByIds.mockImplementation(async () => []);
    const page = await service.listAuthorizedWorkforceAllocations(actor, personId, { limit: 10, offset: 0 });
    expect(page.items).toEqual([]);
    expect(page.partial).toBe(true);
    expect(page.hasMore).toBe(false);
    expect(page).not.toHaveProperty('total');
    expect(serviceOrdersRepository.listWorkforceAllocationCandidates).toHaveBeenCalledTimes(50);
  });

  it('continues beyond 5000 denied allocations without revealing raw offsets', async () => {
    const previous = process.env['JWT_SECRET'];
    process.env['JWT_SECRET'] = 'test-secret-for-workforce-cursor-at-least-32-characters';
    try {
      const { authz, serviceOrdersRepository } = fixture(['order-authorized']);
      const denied = Array.from({ length: 5000 }, (_, index) => ({
        id: `denied-${index}`,
        service_order_id: `order-denied-${index}`,
        status: 'ACTIVE',
        operational_start: '2026-11-03T10:00:00.000Z',
        operational_end: '2026-11-03T12:00:00.000Z',
        allocated_at: '2026-11-03T09:00:00.000Z',
        row_version: 1,
      }));
      const allowed = { ...denied[0]!, id: 'authorized', service_order_id: 'order-authorized' };
      const all = [...denied, allowed];
      serviceOrdersRepository.listWorkforceAllocationCandidates.mockImplementation(
        async (_personId: string, limit: number, offset: number) => all.slice(offset, offset + limit),
      );
      serviceOrdersRepository.findByIds.mockImplementation(async (ids: string[]) =>
        ids.includes('order-authorized')
          ? [{ id: 'order-authorized', order_number: 'OS-AUTHORIZED', status: 'RELEASED' }]
          : [],
      );
      const first = await listAuthorizedWorkforceCursorPage(
        serviceOrdersRepository as never, authz as never, actor, personId, 10, null,
      );
      expect(first.items).toEqual([]);
      expect(first.partial).toBe(true);
      expect(first.nextCursor).toBeTruthy();
      expect(JSON.stringify(first)).not.toContain('order-denied');
      expect(JSON.stringify(first)).not.toContain('5000');
      expect(() => openWorkforceCursor(first.nextCursor!, { ...actor, identityId: 'different' }, personId))
        .toThrow('INVALID_WORKFORCE_CURSOR');
      expect(() => openWorkforceCursor(first.nextCursor!, actor, 'different-person'))
        .toThrow('INVALID_WORKFORCE_CURSOR');

      const second = await listAuthorizedWorkforceCursorPage(
        serviceOrdersRepository as never, authz as never, actor, personId, 10, first.nextCursor,
      );
      expect(second.items.map((item) => item.orderNumber)).toEqual(['OS-AUTHORIZED']);
      expect(second.hasMore).toBe(false);
      expect(second.partial).toBe(false);
    } finally {
      if (previous === undefined) delete process.env['JWT_SECRET'];
      else process.env['JWT_SECRET'] = previous;
    }
  });

});
