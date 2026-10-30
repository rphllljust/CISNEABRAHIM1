import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { MAX_LIST_LIMIT } from '../../infrastructure/http/contracts';
import { SERVICE_ORDER_STATUSES } from '../../service-orders/domain/service-order';
import type { ServiceOrderListResponse } from '../../service-orders/serializers/service-orders-response.serializer';
import { WorkInboxService } from '../services/work-inbox.service';
import { ServiceOrdersWorkSource, toPreparedServiceOrderWorkItem } from './service-orders.source';

const ACTOR = { identityId: 'identity-1', sessionId: 'session-1' };
const OS_ID = '11111111-2222-4333-8444-555555555555';

function order(overrides: Partial<ServiceOrderListResponse> = {}): ServiceOrderListResponse {
  return {
    id: OS_ID,
    orderNumber: 'OS-2026-0001',
    unitId: 'UN-A',
    status: SERVICE_ORDER_STATUSES.Prepared,
    contractId: '66666666-7777-4888-8999-aaaaaaaaaaaa',
    contractReference: 'CT-2026-001',
    preparedAt: '2026-10-01T09:00:00.000Z',
    createdAt: '2026-09-30T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    deadlineAt: '2026-10-20T09:00:00.000Z',
    ...overrides,
  } as ServiceOrderListResponse;
}

function sourceWith(list: ReturnType<typeof vi.fn>): ServiceOrdersWorkSource {
  return new ServiceOrdersWorkSource({ list } as never);
}

describe('source OS — somente pendencia de liberacao derivada do dominio', () => {
  it('usa identidade, contrato e status persistidos; navega para a OS 360 sem prometer liberar', () => {
    const item = toPreparedServiceOrderWorkItem(order());

    expect(item).toMatchObject({
      id: `OPERACOES:OS:RELEASE:${OS_ID}`,
      domain: 'OPERACOES',
      kind: 'CONTINUITY',
      businessReference: 'OS-2026-0001',
      contextLabel: 'Contrato CT-2026-001',
      status: SERVICE_ORDER_STATUSES.Prepared,
      occurredAt: '2026-10-01T09:00:00.000Z',
      dueAt: null,
      targetRoute: `/app/service-orders/${OS_ID}`,
      actionLabel: 'Revisar OS 360',
      unitId: 'UN-A',
    });
    expect(item?.businessReference).not.toContain(OS_ID);
  });

  it.each([
    SERVICE_ORDER_STATUSES.Draft,
    SERVICE_ORDER_STATUSES.Released,
    SERVICE_ORDER_STATUSES.InExecution,
    SERVICE_ORDER_STATUSES.Paused,
    SERVICE_ORDER_STATUSES.Completed,
    SERVICE_ORDER_STATUSES.Cancelled,
  ])('estado %s nao cria pendencia de liberacao', (status) => {
    expect(toPreparedServiceOrderWorkItem(order({ status }))).toBeNull();
  });

  it('nao inventa timestamp, prazo de aprovacao nem referencia de contrato', () => {
    expect(toPreparedServiceOrderWorkItem(order({ preparedAt: null }))).toBeNull();
    const item = toPreparedServiceOrderWorkItem(order({ contractReference: null }));
    expect(item?.contextLabel).toBe('Unidade UN-A');
    expect(item?.dueAt).toBeNull();
  });

  it('consulta somente PREPARED, pagina no backend e nao faz N+1', async () => {
    const first = Array.from({ length: MAX_LIST_LIMIT }, (_, index) =>
      order({ id: `os-${index}`, orderNumber: `OS-${index}` }),
    );
    const list = vi.fn()
      .mockResolvedValueOnce({ items: first })
      .mockResolvedValueOnce({ items: [order({ id: 'last' })] });

    const items = await sourceWith(list).collect(ACTOR);

    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenNthCalledWith(1, ACTOR, {
      status: SERVICE_ORDER_STATUSES.Prepared,
      limit: MAX_LIST_LIMIT,
      offset: 0,
    });
    expect(list).toHaveBeenNthCalledWith(2, ACTOR, {
      status: SERVICE_ORDER_STATUSES.Prepared,
      limit: MAX_LIST_LIMIT,
      offset: MAX_LIST_LIMIT,
    });
    expect(items).toHaveLength(MAX_LIST_LIMIT + 1);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });

  it('recusa 403 sem vazar itens ou contagens', async () => {
    const list = vi.fn().mockRejectedValue(new HttpException('Access denied', 403));
    await expect(sourceWith(list).collect(ACTOR)).resolves.toEqual([]);
  });

  it('falha de infraestrutura nao vira sucesso vazio', async () => {
    const list = vi.fn().mockRejectedValue(new Error('DATABASE_UNAVAILABLE'));
    await expect(sourceWith(list).collect(ACTOR)).rejects.toThrow('DATABASE_UNAVAILABLE');
  });

  it('a contagem do workspace reconcilia com o drill-down da Inbox e some quando sai de PREPARED', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ items: [order()] })
      .mockResolvedValueOnce({ items: [order()] })
      .mockResolvedValueOnce({ items: [] });
    const service = new WorkInboxService([sourceWith(list)]);

    const snapshot = await service.list(ACTOR, { limit: '0' });
    const drilled = await service.list(ACTOR, { domain: 'OPERACOES' });
    const afterRelease = await service.list(ACTOR, { domain: 'OPERACOES' });

    expect(snapshot.byDomain.OPERACOES).toBe(1);
    expect(drilled.total).toBe(snapshot.byDomain.OPERACOES);
    expect(drilled.items[0]?.targetRoute).toBe(`/app/service-orders/${OS_ID}`);
    expect(afterRelease.total).toBe(0);
    expect(afterRelease.byDomain.OPERACOES).toBe(0);
  });
});
