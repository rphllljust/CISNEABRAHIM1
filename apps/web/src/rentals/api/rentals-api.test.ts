import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listServiceOrders } from '../../service-orders/api/service-orders-api';
import { RENTAL_SERVICE_ARCHETYPE, listRentalServiceOrders } from './rentals-api';

vi.mock('../../service-orders/api/service-orders-api', () => ({ listServiceOrders: vi.fn() }));

describe('rentals API delegates to the authorized service order domain', () => {
  beforeEach(() => vi.clearAllMocks());
  it('pins the canonical service archetype', () => {
    expect(RENTAL_SERVICE_ARCHETYPE).toBe('RENTAL');
  });
  it('preserves filters, pagination and AbortSignal at the API boundary', async () => {
    const signal = new AbortController().signal;
    const response = { items: [], limit: 20, offset: 0, total: 0, hasMore: false };
    vi.mocked(listServiceOrders).mockResolvedValue(response);
    await expect(listRentalServiceOrders({ limit: 20, offset: 0, status: 'PAUSED', q: 'OS-15' }, signal))
      .resolves.toEqual(response);
    expect(listServiceOrders).toHaveBeenCalledWith(
      { archetype: 'RENTAL', limit: 20, offset: 0, status: 'PAUSED', q: 'OS-15' },
      signal,
    );
  });
});
