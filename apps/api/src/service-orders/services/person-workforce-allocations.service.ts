import { Injectable } from '@nestjs/common';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { PersonAccessService } from '../../people/services/person-access.service';
import { ResourcePlanningRepository } from '../repositories/resource-planning.repository';
import { ServiceOrdersRepository } from '../repositories/service-orders.repository';
import { ServiceOrdersAccessAuthz } from './service-orders-access.authz';

export type PersonWorkforceAllocationLink = {
  allocationId: string;
  serviceOrderId: string;
  orderNumber: string;
  orderStatus: string;
  allocationStatus: string;
  operationalStart: string;
  operationalEnd: string;
};

/**
 * People 360 relation read model owned by Operations.
 *
 * The person is authorized first. Both OS READ and allocation READ are required,
 * then every candidate OS is evaluated using the existing PDP+direct-grant batch
 * filtering. There is no global count or raw offset in the HTTP response: a
 * caller cannot infer how many denied links were scanned.
 *
 * This endpoint intentionally returns only the latest authorized 20 entries,
 * scanning at most 500 recent assignments to bound DB/PDP work. It is NOT
 * a global utilization count or a substitute for an authorized OS worklist.
 */
@Injectable()
export class PersonWorkforceAllocationsService {
  constructor(
    private readonly people: PersonAccessService,
    private readonly planning: ResourcePlanningRepository,
    private readonly orders: ServiceOrdersRepository,
    private readonly authz: ServiceOrdersAccessAuthz,
  ) {}

  async listRecent(
    actor: IdentityAuthzContext,
    personId: string,
  ): Promise<{ items: PersonWorkforceAllocationLink[] }> {
    await this.people.getById(actor, personId);
    await this.authz.assertAllocationRelationReadAccess(actor);

    const result: PersonWorkforceAllocationLink[] = [];
    const pageSize = 100;
    const maxScan = 500;
    const maxResults = 20;

    for (let offset = 0; offset < maxScan && result.length < maxResults; offset += pageSize) {
      const allocations = await this.planning.listWorkforceAllocations(personId, pageSize, offset);
      if (allocations.length === 0) break;

      const orderIds = [...new Set(allocations.map((allocation) => allocation.service_order_id))];
      const rows = await this.orders.findByIds(orderIds);
      const visible = await this.authz.filterAllocationReadableRows(actor, rows);
      const visibleById = new Map(visible.map((row) => [row.id, row]));

      for (const allocation of allocations) {
        const order = visibleById.get(allocation.service_order_id);
        if (!order) continue;
        result.push({
          allocationId: allocation.id,
          serviceOrderId: order.id,
          orderNumber: order.order_number,
          orderStatus: order.status,
          allocationStatus: allocation.status,
          operationalStart: allocation.operational_start,
          operationalEnd: allocation.operational_end,
        });
        if (result.length === maxResults) break;
      }

      if (allocations.length < pageSize) break;
    }

    return { items: result };
  }
}
