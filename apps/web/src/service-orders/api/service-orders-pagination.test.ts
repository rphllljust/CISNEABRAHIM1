import { describe, expect, it } from 'vitest';
import { resolveServiceOrderPage } from './service-orders-pagination';

describe('authoritative OS pagination shared by rentals and transport', () => {
  it('does not invent an extra page when the last page is full', () => {
    expect(resolveServiceOrderPage({ items: [1, 2], offset: 0, limit: 2, total: 2, hasMore: false }))
      .toEqual({ total: 2, hasMore: false });
  });
  it('derives hasMore using the authorized server total', () => {
    expect(resolveServiceOrderPage({ items: [1, 2], offset: 0, limit: 2, total: 3 }))
      .toEqual({ total: 3, hasMore: true });
    expect(resolveServiceOrderPage({ items: [3], offset: 2, limit: 2, total: 3 }))
      .toEqual({ total: 3, hasMore: false });
  });
  it('distinguishes a partial page from an authoritative total', () => {
    expect(resolveServiceOrderPage({ items: [1, 2], offset: 0, limit: 2 }))
      .toEqual({ total: null, hasMore: true });
  });
  it('discards invalid totals', () => {
    expect(resolveServiceOrderPage({ items: [1], offset: 0, limit: 2, total: -1 }))
      .toEqual({ total: null, hasMore: false });
  });
});
