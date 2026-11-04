import { HttpException, Injectable } from '@nestjs/common';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { SERVICE_ORDER_PLANNING_ALLOWED_STATUSES } from '../domain/resource-planning';
import { assertOperationalCostRecordableState } from '../domain/operational-cost';
import { ServiceOrdersRepository } from '../repositories/service-orders.repository';
import { ServiceOrdersAccessAuthz } from './service-orders-access.authz';
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
    private readonly ordersRepository: ServiceOrdersRepository,
    private readonly authz: ServiceOrdersAccessAuthz,
  ) {}

  async getById(actor: IdentityAuthzContext, serviceOrderId: string) {
    const order = await this.serviceOrders.getById(actor, serviceOrderId);

    // Both readers enforce domain-specific authorization. One domain's failure is not
    // misreported as an empty list or a false monetary zero in the remaining sections.
    const [chain, costs, plannedResources, allocations, actions] = await Promise.allSettled([
      this.businessChain.getChain(actor, 'SERVICE_ORDER', order.id),
      this.operationalCosts.listByServiceOrder(actor, order.id),
      this.planning.listPlannedResources(actor, order.id),
      this.planning.listAllocations(actor, order.id),
      this.getAvailableActions(actor, order.id, order.rowVersion),
    ]);

    return {
      asOf: new Date().toISOString(),
      serviceOrder: order,
      chain: classifyWorkbenchRead(chain),
      plannedResources: classifyWorkbenchRead(plannedResources),
      allocations: classifyWorkbenchRead(allocations),
      actions: actions.status === 'fulfilled' ? actions.value : {
        canPlanResource: false,
        canRecordEstimatedCost: false,
        canRecordActualCost: false,
      },
      costs: classifyWorkbenchRead(costs, {
        expected: order.rowVersion,
        actual: (data) => data.rowVersion,
      }),
    };
  }
  /**
   * UI write affordances are authorized for THIS OS, not inferred from a session-wide role.
   * A fresh rowVersion prevents offering mutations against an outdated object snapshot.
   * POST endpoints still enforce PDP, rowVersion and the domain state authoritatively.
   */
  private async getAvailableActions(actor: IdentityAuthzContext, id: string, expectedVersion: number) {
    const none = {
      canPlanResource: false,
      canRecordEstimatedCost: false,
      canRecordActualCost: false,
    };
    const row = await this.ordersRepository.findById(id);
    if (!row || row.row_version !== expectedVersion) return none;
    const [plan, recordCost] = await Promise.allSettled([
      this.authz.assertRecordAction(actor, AUTHZ_ACTIONS.ServiceOrdersPlannedResourcePlan, row),
      this.authz.assertRecordAction(actor, AUTHZ_ACTIONS.ServiceOrdersOperationalCostRecord, row),
    ]);
    const canRecord = recordCost.status === 'fulfilled';
    let estimatedAllowed = false;
    let actualAllowed = false;
    try {
      assertOperationalCostRecordableState(row.status, 'ESTIMATED');
      estimatedAllowed = true;
    } catch {
      estimatedAllowed = false;
    }
    try {
      assertOperationalCostRecordableState(row.status, 'ACTUAL');
      actualAllowed = true;
    } catch {
      actualAllowed = false;
    }
    return {
      canPlanResource: plan.status === 'fulfilled' && SERVICE_ORDER_PLANNING_ALLOWED_STATUSES.has(row.status),
      canRecordEstimatedCost: canRecord && estimatedAllowed,
      canRecordActualCost: canRecord && actualAllowed,
    };
  }

}
