import { describe, expect, it, vi } from 'vitest';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import type { ResourceAllocationRow } from '../repositories/resource-planning.repository.types';
import type { ServiceOrderRow } from '../repositories/service-orders.repository.types';
import { PersonWorkforceAllocationsService } from './person-workforce-allocations.service';

const PERSON_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actor: IdentityAuthzContext = {
  identityId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  sessionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
};

function allocation(id: string, serviceOrderId: string): ResourceAllocationRow {
  return {
    id,
    service_order_id: serviceOrderId,
    status: 'ACTIVE',
    operational_start: '2026-11-03T11:00:00Z',
    operational_end: '2026-11-03T13:00:00Z',
  } as ResourceAllocationRow;
}

function order(id: string, number: string): ServiceOrderRow {
  return {
    id,
    order_number: number,
    status: 'RELEASED',
  } as ServiceOrderRow;
}

function fixture() {
  const people = { getById: vi.fn().mockResolvedValue({ id: PERSON_ID }) };
  const planning = {
    listWorkforceAllocations: vi.fn().mockResolvedValue([]),
    findOrdersByIds: vi.fn().mockResolvedValue([]),
  };
  const authz = {
    assertAllocationRelationReadAccess: vi.fn().mockResolvedValue(undefined),
    filterAllocationReadableRows: vi.fn().mockResolvedValue([]),
  };
  const service = new PersonWorkforceAllocationsService(
    people as never,
    planning as never,
    authz as never,
  );
  return { service, people, planning, authz };
}

describe('E04 Pessoas 360 — OS allocation relationship authorization', () => {
  it('denies the person BEFORE fetching any allocation metadata', async () => {
    const f = fixture();
    f.people.getById.mockRejectedValue(new Error('PERSON_DENIED'));
    await expect(f.service.listRecent(actor, PERSON_ID)).rejects.toThrow('PERSON_DENIED');
    expect(f.authz.assertAllocationRelationReadAccess).not.toHaveBeenCalled();
    expect(f.planning.listWorkforceAllocations).not.toHaveBeenCalled();
  });

  it('returns explicit denial rather than empty list without OS read grants', async () => {
    const f = fixture();
    f.authz.assertAllocationRelationReadAccess.mockRejectedValue(new Error('OS_DENIED'));
    await expect(f.service.listRecent(actor, PERSON_ID)).rejects.toThrow('OS_DENIED');
    expect(f.planning.listWorkforceAllocations).not.toHaveBeenCalled();
  });

  it('never returns denied OS numbers, identifiers or a global total', async () => {
    const f = fixture();
    const allowedId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
    const deniedId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002';
    const visible = order(allowedId, 'OS-001');
    const denied = order(deniedId, 'OS-PRIVATE-999');
    f.planning.listWorkforceAllocations.mockResolvedValue([
      allocation('a1', deniedId),
      allocation('a2', allowedId),
    ]);
    f.planning.findOrdersByIds.mockResolvedValue([visible, denied]);
    f.authz.filterAllocationReadableRows.mockResolvedValue([visible]);

    const result = await f.service.listRecent(actor, PERSON_ID);
    expect(result).toEqual({
      items: [{
        allocationId: 'a2',
        serviceOrderId: allowedId,
        orderNumber: 'OS-001',
        orderStatus: 'RELEASED',
        allocationStatus: 'ACTIVE',
        operationalStart: '2026-11-03T11:00:00Z',
        operationalEnd: '2026-11-03T13:00:00Z',
      }],
    });
    expect(JSON.stringify(result)).not.toContain('OS-PRIVATE-999');
    expect(JSON.stringify(result)).not.toContain(deniedId);
    expect(result).not.toHaveProperty('total');
    expect(f.authz.filterAllocationReadableRows).toHaveBeenCalledWith(actor, [visible, denied]);
  });

  it('scans a further bounded page when the first 100 candidates are inaccessible', async () => {
    const f = fixture();
    const deniedId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003';
    const allowedId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000004';
    const invisible = Array.from({ length: 100 }, (_, i) =>
      allocation(`hidden-${i}`, deniedId),
    );
    f.planning.listWorkforceAllocations.mockImplementation(
      async (_personId: string, _limit: number, offset: number) =>
        offset === 0 ? invisible : [allocation('visible', allowedId)],
    );
    f.planning.findOrdersByIds.mockImplementation(async (ids: string[]) =>
      ids.includes(allowedId) ? [order(allowedId, 'OS-004')] : [order(deniedId, 'OS-HIDDEN')],
    );
    f.authz.filterAllocationReadableRows.mockImplementation(
      async (_actor: IdentityAuthzContext, rows: ServiceOrderRow[]) =>
        rows.filter((row) => row.id === allowedId),
    );

    const result = await f.service.listRecent(actor, PERSON_ID);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.orderNumber).toBe('OS-004');
    expect(f.planning.listWorkforceAllocations).toHaveBeenCalledTimes(2);
  });
});
