import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { BusinessChainService } from '../../business-chain/services/business-chain.service';
import type { OperationalCostAccessService } from './operational-cost-access.service';
import type { ServiceOrderPlanningAccessService } from './service-order-planning-access.service';
import type { ServiceOrdersAccessService } from './service-orders-access.service';
import type { ServiceOrdersRepository } from '../repositories/service-orders.repository';
import type { ServiceOrdersAccessAuthz } from './service-orders-access.authz';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import {
  classifyWorkbenchRead,
  ServiceOrderEnterpriseWorkbenchService,
} from './service-order-enterprise-workbench.service';

const actor = { identityId: 'operator-1', sessionId: 'session-1' };

function setup(options: {
  order?: unknown;
  orderError?: Error;
  chain?: unknown;
  chainError?: Error;
  costs?: unknown;
  costsError?: Error;
  plannedResourcesError?: Error;
  allocationsError?: Error;
  planDenied?: boolean;
  costDenied?: boolean;
  status?: string;
} = {}) {
  const getById = vi.fn();
  const getChain = vi.fn();
  const listByServiceOrder = vi.fn();
  const listPlannedResources = vi.fn();
  const listAllocations = vi.fn();
  const findById = vi.fn(async () => ({ id: 'os-1', row_version: 4, status: options.status ?? 'RELEASED' }));
  const assertRecordAction = vi.fn(async (_actor: unknown, action: string) => {
    if (options.planDenied && action === AUTHZ_ACTIONS.ServiceOrdersPlannedResourcePlan) throw new ForbiddenException();
    if (options.costDenied && action === AUTHZ_ACTIONS.ServiceOrdersOperationalCostRecord) throw new ForbiddenException();
  });
  if (options.orderError) getById.mockRejectedValue(options.orderError);
  else getById.mockResolvedValue(options.order ?? { id: 'os-1', rowVersion: 4 });
  if (options.chainError) getChain.mockRejectedValue(options.chainError);
  else getChain.mockResolvedValue(options.chain ?? { anchor: { kind: 'SERVICE_ORDER', id: 'os-1' }, nodes: [], milestones: [] });
  if (options.costsError) listByServiceOrder.mockRejectedValue(options.costsError);
  else listByServiceOrder.mockResolvedValue(options.costs ?? { serviceOrderId: 'os-1', rowVersion: 4, entries: [] });

  if (options.plannedResourcesError) listPlannedResources.mockRejectedValue(options.plannedResourcesError);
  else listPlannedResources.mockResolvedValue([]);
  if (options.allocationsError) listAllocations.mockRejectedValue(options.allocationsError);
  else listAllocations.mockResolvedValue([]);

  const service = new ServiceOrderEnterpriseWorkbenchService(
    { getById } as unknown as ServiceOrdersAccessService,
    { getChain } as unknown as BusinessChainService,
    { listByServiceOrder } as unknown as OperationalCostAccessService,
    { listPlannedResources, listAllocations } as unknown as ServiceOrderPlanningAccessService,
    { findById } as unknown as ServiceOrdersRepository,
    { assertRecordAction } as unknown as ServiceOrdersAccessAuthz,
  );
  return { service, getById, getChain, listByServiceOrder, listPlannedResources, listAllocations, findById, assertRecordAction };
}

describe('enterprise OS workbench — fullstack read boundary', () => {
  it('never probes chain or costs when the OS itself is denied', async () => {
    const { service, getChain, listByServiceOrder, listPlannedResources, listAllocations } = setup({
      orderError: new ForbiddenException(),
    });
    await expect(service.getById(actor, 'os-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(getChain).not.toHaveBeenCalled();
    expect(listByServiceOrder).not.toHaveBeenCalled();
    expect(listPlannedResources).not.toHaveBeenCalled();
    expect(listAllocations).not.toHaveBeenCalled();
  });

  it('composes the real authorized order with independently authorized domains', async () => {
    const { service, getChain, listByServiceOrder } = setup();
    const result = await service.getById(actor, 'os-1');
    expect(result.serviceOrder).toMatchObject({ id: 'os-1', rowVersion: 4 });
    expect(result.chain).toMatchObject({ state: 'ready' });
    expect(result.costs).toMatchObject({ state: 'ready' });
    expect(result.plannedResources).toMatchObject({ state: 'ready', data: [] });
    expect(result.allocations).toMatchObject({ state: 'ready', data: [] });
    expect(result.actions).toEqual({canPlanResource: true, canRecordEstimatedCost: true, canRecordActualCost: false});
    expect(getChain).toHaveBeenCalledWith(actor, 'SERVICE_ORDER', 'os-1');
    expect(listByServiceOrder).toHaveBeenCalledWith(actor, 'os-1');
    expect(Number.isNaN(Date.parse(result.asOf))).toBe(false);
  });

  it('never publishes denied cost evidence, while retaining authorized chain facts', async () => {
    const result = await setup({ costsError: new ForbiddenException('secret economic data') }).service.getById(actor, 'os-1');
    expect(result.chain.state).toBe('ready');
    expect(result.costs).toEqual({ state: 'denied' });
    expect(JSON.stringify(result)).not.toContain('secret economic data');
  });

  it('never conflates a broken domain with zero monetary amounts', async () => {
    const result = await setup({ chainError: new Error('SQL internal'), costsError: new Error('secret stack') }).service.getById(actor, 'os-1');
    expect(result.chain).toEqual({ state: 'unavailable' });
    expect(result.costs).toEqual({ state: 'unavailable' });
    expect(JSON.stringify(result)).not.toContain('secret stack');
    expect(JSON.stringify(result)).not.toContain('SQL internal');
  });

  it('preserves usable modules when planning is unauthorized and allocations are unavailable', async () => {
    const result = await setup({
      plannedResourcesError: new ForbiddenException('private planned asset'),
      allocationsError: new Error('internal pg error'),
    }).service.getById(actor, 'os-1');
    expect(result.costs.state).toBe('ready');
    expect(result.plannedResources).toEqual({ state: 'denied' });
    expect(result.allocations).toEqual({ state: 'unavailable' });
    expect(JSON.stringify(result)).not.toContain('private planned asset');
  });

  it('marks cross-read rowVersion drift as stale, not a reconciled financial view', async () => {
    const result = await setup({ costs: { rowVersion: 3, entries: [{ amount: '12.00' }] } }).service.getById(actor, 'os-1');
    expect(result.costs).toMatchObject({ state: 'stale', data: { rowVersion: 3 } });
  });

  it('enforces per-object write affordances from real domain state and PDP', async () => {
    const read = await setup({ planDenied: true, status: 'IN_EXECUTION' }).service.getById(actor, 'os-1');
    expect(read.actions).toEqual({
      canPlanResource: false,
      canRecordEstimatedCost: true,
      canRecordActualCost: true,
    });
    const noCost = await setup({ costDenied: true, status: 'RELEASED' }).service.getById(actor, 'os-1');
    expect(noCost.actions).toEqual({
      canPlanResource: true,
      canRecordEstimatedCost: false,
      canRecordActualCost: false,
    });
    const draft = await setup({ status: 'DRAFT' }).service.getById(actor, 'os-1');
    expect(draft.actions).toEqual({
      canPlanResource: false,
      canRecordEstimatedCost: false,
      canRecordActualCost: false,
    });
  });

  it('classifies only explicit authorization errors as denied', () => {
    expect(classifyWorkbenchRead({ status: 'rejected', reason: new Error('network') })).toEqual({ state: 'unavailable' });
    expect(classifyWorkbenchRead({ status: 'rejected', reason: new ForbiddenException() })).toEqual({ state: 'denied' });
  });
});
