import type { BusinessChain } from '../../business-chain/types';
import type { ServiceOrderCostEvidence } from '../api/service-orders-api';
import type { ServiceOrderDetail } from './service-order.types';
import type { PlannedResource, ResourceAllocation } from './resource-planning.types';

/** Mirror of the one-request, independently authorized NestJS OS workbench read. */
export type ServiceOrderWorkbenchSection<T> =
  | { state: 'ready'; data: T }
  | { state: 'stale'; data: T }
  | { state: 'denied' }
  | { state: 'unavailable' };

export type ServiceOrderEnterpriseWorkbench = {
  asOf: string;
  serviceOrder: ServiceOrderDetail;
  chain: ServiceOrderWorkbenchSection<BusinessChain>;
  costs: ServiceOrderWorkbenchSection<ServiceOrderCostEvidence>;
  plannedResources: ServiceOrderWorkbenchSection<PlannedResource[]>;
  allocations: ServiceOrderWorkbenchSection<ResourceAllocation[]>;
  actions: {
    canPlanResource: boolean;
    canRecordEstimatedCost: boolean;
    canRecordActualCost: boolean;
  };
};
