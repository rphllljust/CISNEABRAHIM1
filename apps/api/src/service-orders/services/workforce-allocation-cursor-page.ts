import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import type { ServiceOrdersRepository } from '../repositories/service-orders.repository';
import type { ServiceOrdersAccessAuthz } from './service-orders-access.authz';
import { openWorkforceCursor, sealWorkforceCursor } from './workforce-allocation-cursor';

export type AuthorizedWorkforceCursorPage = {
  items: Array<{
    id: string;
    serviceOrderId: string;
    orderNumber: string;
    orderStatus: string;
    status: string;
    operationalStart: string;
    operationalEnd: string;
    allocatedAt: string;
    rowVersion: number;
  }>;
  hasMore: boolean;
  partial: boolean;
  nextCursor: string | null;
};

/**
 * Cursor scan over raw candidates; authorization still happens in the OS owner.
 * The raw candidate position is encrypted and bound to actor, session and person.
 * Each request has a strict work budget; continuation never emits denied metadata.
 */
export async function listAuthorizedWorkforceCursorPage(
  repository: ServiceOrdersRepository,
  authz: ServiceOrdersAccessAuthz,
  actor: IdentityAuthzContext,
  workforceMemberId: string,
  limit: number,
  cursor: string | null,
): Promise<AuthorizedWorkforceCursorPage> {
  await authz.assertWorkforceAllocationDiscovery(actor);
  const pageLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  let rawOffset = cursor ? openWorkforceCursor(cursor, actor, workforceMemberId) : 0;
  const batchSize = 100;
  const scanBudget = 5000;
  let scanned = 0;
  let exhausted = false;
  const items: AuthorizedWorkforceCursorPage['items'] = [];

  while (scanned < scanBudget && items.length < pageLimit) {
    const take = Math.min(batchSize, scanBudget - scanned);
    const candidates = await repository.listWorkforceAllocationCandidates(
      workforceMemberId, take, rawOffset,
    );
    if (candidates.length === 0) {
      exhausted = true;
      break;
    }
    const ids = [...new Set(candidates.map((allocation) => allocation.service_order_id))];
    const orders = await repository.findByIds(ids);
    const readable = await authz.filterReadableRows(actor, orders);
    const permitted = await authz.filterAllocationReadableRows(actor, readable);
    const byId = new Map(permitted.map((order) => [order.id, order]));

    for (const allocation of candidates) {
      rawOffset += 1;
      scanned += 1;
      const order = byId.get(allocation.service_order_id);
      if (order) {
        items.push({
          id: allocation.id,
          serviceOrderId: order.id,
          orderNumber: order.order_number,
          orderStatus: order.status,
          status: allocation.status,
          operationalStart: allocation.operational_start,
          operationalEnd: allocation.operational_end,
          allocatedAt: allocation.allocated_at,
          rowVersion: allocation.row_version,
        });
        if (items.length >= pageLimit) break;
      }
    }
    if (items.length < pageLimit && candidates.length < take) {
      exhausted = true;
      break;
    }
  }

  const hasMore = !exhausted;
  return {
    items,
    hasMore,
    partial: !exhausted && items.length < pageLimit,
    nextCursor: hasMore ? sealWorkforceCursor(actor, workforceMemberId, rawOffset) : null,
  };
}
