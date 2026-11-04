import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ServiceOrdersController } from '../controllers/service-orders.controller';
import { ServiceOrderPlanningController } from '../controllers/service-order-planning.controller';
import { OperationalCostController } from '../controllers/operational-cost.controller';
import { ServiceOrderPlanningAccessService } from './service-order-planning-access.service';
import { OperationalCostAccessService } from './operational-cost-access.service';
import { ServiceOrdersAccessService } from './service-orders-access.service';
import { ServiceOrderEnterpriseWorkbenchService } from './service-order-enterprise-workbench.service';

/**
 * HTTP contract smoke without a DB fixture. Authentication guard is substituted only in
 * the test module; the real controller remains guarded. The service owns authorization.
 */
describe('Enterprise OS workbench HTTP boundary', () => {
  let app: NestFastifyApplication;
  const getById = vi.fn();
  const planResource = vi.fn();
  const recordCost = vi.fn();

  beforeAll(async () => {
    const testModule = await Test.createTestingModule({
      controllers: [ServiceOrdersController, ServiceOrderPlanningController, OperationalCostController],
      providers: [
        { provide: ServiceOrdersAccessService, useValue: {} },
        { provide: ServiceOrderEnterpriseWorkbenchService, useValue: { getById } },
        { provide: ServiceOrderPlanningAccessService, useValue: { planResource } },
        { provide: OperationalCostAccessService, useValue: { recordCost } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest().auth = { sub: 'identity-a', sid: 'session-b' };
          return true;
        },
      })
      .compile();

    app = testModule.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(() => { getById.mockReset(); planResource.mockReset(); recordCost.mockReset(); });
  afterAll(async () => { await app?.close(); });

  it('exposes one authenticated endpoint and serializes independent domain coverage', async () => {
    getById.mockResolvedValue({
      asOf: '2026-11-04T12:00:00.000Z',
      serviceOrder: { id: 'os-1', orderNumber: 'OS-22', rowVersion: 4 },
      chain: { state: 'ready', data: { nodes: [] } },
      costs: { state: 'denied' },
      plannedResources: { state: 'ready', data: [] },
      allocations: { state: 'unavailable' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/service-orders/os-1/enterprise-workbench',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      serviceOrder: { orderNumber: 'OS-22' },
      costs: { state: 'denied' },
      allocations: { state: 'unavailable' },
    });
    expect(getById).toHaveBeenCalledWith(
      { identityId: 'identity-a', sessionId: 'session-b' },
      'os-1',
    );
  });

  it('preserves the server 403 rather than disguising the denial as an empty OS', async () => {
    getById.mockRejectedValue(new ForbiddenException('Not permitted'));
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/service-orders/os-2/enterprise-workbench',
    });
    expect(response.statusCode).toBe(403);
    expect(getById).toHaveBeenCalledTimes(1);
  });

  it('routes planning through the authorized existing planning access service', async () => {
    planResource.mockResolvedValue({ id: 'plan-1', plannedQuantity: '2', status: 'PLANNED' });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/service-orders/os-1/planned-resources',
      payload: { requirementKind: 'PHYSICAL_RESOURCE', resourceTypeCode: 'VEHICLE', plannedQuantity: '2' },
    });
    expect(response.statusCode).toBe(201);
    expect(planResource).toHaveBeenCalledWith(
      { identityId: 'identity-a', sessionId: 'session-b' },
      'os-1',
      expect.objectContaining({ requirementKind: 'PHYSICAL_RESOURCE', resourceTypeCode: 'VEHICLE', plannedQuantity: '2' }),
    );
  });

  it('routes versioned monetary cost to the existing write domain, never a new ledger', async () => {
    recordCost.mockResolvedValue({ rowVersion: 5, entry: { id: 'cost-1' } });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/service-orders/os-1/operational-costs',
      payload: {
        origin: 'SERVICE_ORDER', category: 'RESOURCE', costKind: 'ESTIMATED',
        amount: '125.50', currencyCode: 'BRL',
        description: 'Custo verificado pelo operador',
        rowVersion: 4, idempotencyKey: 'key-real-transaction-123',
      },
    });
    expect(response.statusCode).toBe(201);
    expect(recordCost).toHaveBeenCalledWith(
      { identityId: 'identity-a', sessionId: 'session-b' },
      'os-1',
      expect.objectContaining({
        origin: 'SERVICE_ORDER', category: 'RESOURCE', costKind: 'ESTIMATED',
        amount: '125.5000', rowVersion: 4, idempotencyKey: 'key-real-transaction-123',
      }),
    );
  });

  it('rejects a malformed monetary command without reaching the cost domain', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/service-orders/os-1/operational-costs',
      payload: { origin: 'SERVICE_ORDER', category: 'RESOURCE', costKind: 'ESTIMATED', amount: '', rowVersion: 4 },
    });
    expect(response.statusCode).toBe(400);
    expect(recordCost).not.toHaveBeenCalled();
  });

  it('has no write operation on its GET route', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/service-orders/os-1/enterprise-workbench',
    });
    expect(response.statusCode).toBe(404);
    expect(getById).not.toHaveBeenCalled();
  });
});
