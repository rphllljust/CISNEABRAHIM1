import { HttpException, Injectable } from '@nestjs/common';
import { MAX_LIST_LIMIT } from '../../infrastructure/http/contracts';
import { SERVICE_ORDER_STATUSES } from '../../service-orders/domain/service-order';
import { MaterialInventoryBindingService } from '../../service-orders/services/material-inventory-binding.service';
import { ServiceOrdersAccessService } from '../../service-orders/services/service-orders-access.service';
import type { WorkItem } from '../contracts/work-item.contract';
import type { WorkItemActor, WorkItemSource } from './work-item-source';

type MaterialException = Awaited<ReturnType<MaterialInventoryBindingService['listMaterialExceptionsForReadableOrders']>>[number];

/**
 * #193: material obligations are a projection of two authoritative persisted
 * facts (SO binding and Inventory OUT/compensation), not a parallel workflow.
 * LIST+READ are enforced by the OS owner, Inventory READ by the binding service.
 */
@Injectable()
export class MaterialInventoryWorkSource implements WorkItemSource {
  readonly domain = 'OPERACOES';

  constructor(
    private readonly orders: ServiceOrdersAccessService,
    private readonly materials: MaterialInventoryBindingService,
  ) {}

  async collect(actor: WorkItemActor): Promise<WorkItem[]> {
    const items: WorkItem[] = [];
    try {
      for (const status of [
        SERVICE_ORDER_STATUSES.InExecution,
        SERVICE_ORDER_STATUSES.Paused,
        SERVICE_ORDER_STATUSES.Completed,
      ]) {
        for (let offset = 0; ; offset += MAX_LIST_LIMIT) {
          const page = await this.orders.listReadableForWorkInbox(actor, {
            status, limit: MAX_LIST_LIMIT, offset,
          });
          const exceptions = await this.materials.listMaterialExceptionsForReadableOrders(
            actor, page.items.map((order) => ({
              id: order.id, unitId: order.unitId, orderNumber: order.orderNumber,
            })),
          );
          items.push(...exceptions.map(toMaterialWorkItem));
          if (!page.hasMore) break;
        }
      }
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 403) return [];
      throw error;
    }
    return items;
  }
}

export function toMaterialWorkItem(row: MaterialException): WorkItem {
  const pendingCost = row.status === 'PENDING_COSTING';
  return {
    id: `OPERACOES:OS:MATERIAL:${row.actualId}:${row.status}`,
    domain: 'OPERACOES',
    kind: pendingCost ? 'EXCEPTION' : 'CONTINUITY',
    businessReference: row.orderNumber,
    title: pendingCost
      ? 'Material consumido sem custo autoritativo'
      : 'Material vinculado aguardando baixa de estoque',
    contextLabel: `Unidade ${row.unitId}`,
    status: row.status,
    reason: pendingCost
      ? 'O Inventory confirmou OUT, mas não há valor calculado por regra publicada. Não existe custo zero ou lançamento contábil presumido.'
      : 'O vínculo MATERIAL_QUANTITY existe, mas a conciliação do Inventory não encontrou OUT. A baixa exige comando e autorização explícitos.',
    occurredAt: row.occurredAt,
    dueAt: null,
    actionLabel: 'Revisar OS 360',
    targetRoute: `/app/service-orders/${row.serviceOrderId}`,
    unitId: row.unitId,
  };
}
