import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SERVICE_ORDER_STATUSES } from '../../service-orders/domain/service-order';
import { MaterialInventoryWorkSource, toMaterialWorkItem } from './material-inventory.source';

const ACTOR = { identityId: 'actor', sessionId: 'session' };
const ORDER_ID = '11111111-2222-4333-8444-555555555555';
const ACTUAL_ID = '22222222-3333-4444-8555-666666666666';
const exception = {
  actualId: ACTUAL_ID, serviceOrderId: ORDER_ID, orderNumber: 'OS-2026-0001',
  unitId: 'UNIT-A', occurredAt: '2026-11-02T10:00:00.000Z',
  status: 'PENDING_COSTING' as const,
};

function makeSource(list: ReturnType<typeof vi.fn>, material: ReturnType<typeof vi.fn>) {
  return new MaterialInventoryWorkSource(
    { listReadableForWorkInbox: list } as never,
    { listMaterialExceptionsForReadableOrders: material } as never,
  );
}

describe('Work Inbox — material reconciliation #193', () => {
  it('projects persisted pending costing without fabricating a currency, GL, or due date', () => {
    const item = toMaterialWorkItem(exception);
    expect(item).toMatchObject({
      id: `OPERACOES:OS:MATERIAL:${ACTUAL_ID}:PENDING_COSTING`,
      domain: 'OPERACOES', kind: 'EXCEPTION', status: 'PENDING_COSTING',
      businessReference: 'OS-2026-0001', unitId: 'UNIT-A',
      occurredAt: exception.occurredAt, dueAt: null,
      targetRoute: `/app/service-orders/${ORDER_ID}`,
    });
    expect(item.reason).toContain('não há valor calculado');
    expect(item.reason).not.toContain('BRL');
  });

  it('distinguishes an authorized bound fact awaiting OUT from a costing exception', () => {
    const item = toMaterialWorkItem({ ...exception, status: 'NOT_POSTED' });
    expect(item.kind).toBe('CONTINUITY');
    expect(item.status).toBe('NOT_POSTED');
    expect(item.reason).toContain('não encontrou OUT');
  });

  it('paginates OS owner LIST+READ and never calls Inventory on an empty readable page', async () => {
    const list = vi.fn().mockResolvedValue({ items: [], hasMore: false });
    const material = vi.fn().mockResolvedValue([]);
    const result = await makeSource(list, material).collect(ACTOR);
    expect(result).toEqual([]);
    expect(list).toHaveBeenCalledTimes(3);
    expect(list.mock.calls.map((call) => call[1].status)).toEqual([
      SERVICE_ORDER_STATUSES.InExecution,
      SERVICE_ORDER_STATUSES.Paused,
      SERVICE_ORDER_STATUSES.Completed,
    ]);
    expect(material).toHaveBeenCalledTimes(3);
    expect(material).toHaveBeenCalledWith(ACTOR, []);
  });

  it('emits only exceptions supplied by authorized owners, not inferred from order status', async () => {
    const list = vi.fn().mockResolvedValueOnce({
      items: [{ id: ORDER_ID, unitId: 'UNIT-A', orderNumber: 'OS-2026-0001' }],
      hasMore: false,
    }).mockResolvedValue({ items: [], hasMore: false });
    const material = vi.fn().mockResolvedValueOnce([exception]).mockResolvedValue([]);
    const items = await makeSource(list, material).collect(ACTOR);
    expect(items).toHaveLength(1);
    expect(material).toHaveBeenNthCalledWith(1, ACTOR, [
      { id: ORDER_ID, unitId: 'UNIT-A', orderNumber: 'OS-2026-0001' },
    ]);
  });

  it('does not disclose work items when OS LIST is forbidden', async () => {
    const list = vi.fn().mockRejectedValue(new HttpException('Forbidden', 403));
    const material = vi.fn();
    expect(await makeSource(list, material).collect(ACTOR)).toEqual([]);
    expect(material).not.toHaveBeenCalled();
  });

  it('propagates Inventory failures so unavailableDomains is reported', async () => {
    const list = vi.fn().mockResolvedValueOnce({
      items: [{ id: ORDER_ID, unitId: 'UNIT-A', orderNumber: 'OS-2026-0001' }],
      hasMore: false,
    });
    const material = vi.fn().mockRejectedValue(new Error('INVENTORY_UNAVAILABLE'));
    await expect(makeSource(list, material).collect(ACTOR)).rejects.toThrow('INVENTORY_UNAVAILABLE');
  });
});
