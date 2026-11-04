import { HttpException, Injectable } from '@nestjs/common';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { BusinessChainService } from '../../business-chain/services/business-chain.service';
import { OperationalCostAccessService } from './operational-cost-access.service';
import { ServiceOrderPlanningAccessService } from './service-order-planning-access.service';
import { ServiceOrdersAccessService } from './service-orders-access.service';

/**
 * Enterprise OS workbench: one authorized read across existing domain contracts.
 *
 * No duplicate financial ledger, table, workflow or authorization policy is created.
 * The OS is verified FIRST; a denied/missing OS never starts the ancillary reads.
 * The chain and operational cost readers keep their own PDP/SoD checks.
 * Failure in one ancillary domain never turns an unavailable monetary value into zero.
 */
export type WorkbenchSection<T> =
  | { state: 'ready'; data: T }
  | { state: 'stale'; data: T }
  | { state: 'denied' }
  | { state: 'unavailable' };

export function classifyWorkbenchRead<T>(
  result: PromiseSettledResult<T>,
  version?: { expected: number; actual: (data: T) => number },
): WorkbenchSection<T> {
  if (result.status === 'fulfilled') {
    if (version && version.actual(result.value) !== version.expected) {
      return { state: 'stale', data: result.value };
    }
    return { state: 'ready', data: result.value };
  }
  const reason: unknown = result.reason;
  if (reason instanceof HttpException && [401, 403].includes(reason.getStatus())) {
    return { state: 'denied' };
  }
  // No stack trace, exception body, identifiers or unscoped domain metadata leave the boundary.
  return { state: 'unavailable' };
}

@Injectable()
export class ServiceOrderEnterpriseWorkbenchService {
  constructor(
    private readonly serviceOrders: ServiceOrdersAccessService,
    private readonly businessChain: BusinessChainService,
    private readonly operationalCosts: OperationalCostAccessService,
    private readonly planning: ServiceOrderPlanningAccessService,
  ) {}

  async getById(actor: IdentityAuthzContext, serviceOrderId: string) {
    const order = await this.serviceOrders.getById(actor, serviceOrderId);

    // Both readers enforce domain-specific authorization. One domain's failure is not
    // misreported as an empty list or a false monetary zero in the remaining sections.
    const [chain, costs, plannedResources, allocations] = await Promise.allSettled([
      this.businessChain.getChain(actor, 'SERVICE_ORDER', order.id),
      this.operationalCosts.listByServiceOrder(actor, order.id),
      this.planning.listPlannedResources(actor, order.id),
      this.planning.listAllocations(actor, order.id),
    ]);

    return {
      asOf: new Date().toISOString(),
      serviceOrder: order,
      chain: classifyWorkbenchRead(chain),
      plannedResources: classifyWorkbenchRead(plannedResources),
      allocations: classifyWorkbenchRead(allocations),
      costs: classifyWorkbenchRead(costs, {
        expected: order.rowVersion,
        actual: (data) => data.rowVersion,
      }),
    };
  }
}
