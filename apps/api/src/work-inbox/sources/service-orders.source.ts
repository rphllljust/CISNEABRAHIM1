import { HttpException, Injectable } from '@nestjs/common';
import { MAX_LIST_LIMIT } from '../../infrastructure/http/contracts';
import { SERVICE_ORDER_STATUSES } from '../../service-orders/domain/service-order';
import { nextServiceOrderStep } from '../../service-orders/domain/operations-control-center';
import type { ServiceOrderListResponse } from '../../service-orders/serializers/service-orders-response.serializer';
import { ServiceOrdersAccessService } from '../../service-orders/services/service-orders-access.service';
import type { WorkItem } from '../contracts/work-item.contract';
import type { WorkItemActor, WorkItemSource } from './work-item-source';

/**
 * Fonte OPERACOES — ordens PREPARED aguardando avaliação para liberação.
 *
 * A condição e a transição são do domínio de OS, não da Inbox: apenas PREPARED
 * tem RELEASE como próximo passo. Isto NÃO afirma que a liberação está autorizada
 * ou que suas pré-condições estejam satisfeitas. A página 360 consulta novamente
 * capacidades e bloqueios; o comando backend aplica PDP, versão e invariantes.
 *
 * Usa a listagem autoritativa (filtro de estado + escopo de unidade/cliente no SQL)
 * e revalida em lote a permissão READ por registro antes da projeção.
 * Não infere vínculos por cliente, não consulta por item e não cria estado paralelo.
 * A fila é uma projeção sob demanda: uma OS que deixou PREPARED desaparece após a
 * próxima leitura, sem uma operação artificial de "resolver pendência".
 */
@Injectable()
export class ServiceOrdersWorkSource implements WorkItemSource {
  readonly domain = 'OPERACOES';

  constructor(private readonly orders: ServiceOrdersAccessService) {}

  async collect(actor: WorkItemActor): Promise<WorkItem[]> {
    const items: WorkItem[] = [];

    try {
      for (let offset = 0; ; offset += MAX_LIST_LIMIT) {
        const page = await this.orders.listReadableForWorkInbox(actor, {
          status: SERVICE_ORDER_STATUSES.Prepared,
          limit: MAX_LIST_LIMIT,
          offset,
        });
        items.push(...page.items.map(toPreparedServiceOrderWorkItem).filter(isWorkItem));
        if (!page.hasMore) {
          break;
        }
      }
    } catch (error) {
      // Sem permissão de lista, não revelar sequer a existência das OS.
      if (error instanceof HttpException && error.getStatus() === 403) {
        return [];
      }
      // Erros de banco/rede devem alimentar unavailableDomains na Inbox.
      throw error;
    }

    return items;
  }
}

/**
 * Somente um fato persistido PREPARED produz a obrigação de revisar a liberação.
 * Nenhum vencimento é atribuído: deadlineAt da OS é prazo operacional, não SLA
 * de decisão de liberação. A referência pública é orderNumber, nunca o UUID.
 */
export function toPreparedServiceOrderWorkItem(row: ServiceOrderListResponse): WorkItem | null {
  if (row.status !== SERVICE_ORDER_STATUSES.Prepared || !row.preparedAt) {
    return null;
  }

  const next = nextServiceOrderStep(SERVICE_ORDER_STATUSES.Prepared);
  if (next.transition !== 'release') {
    return null;
  }

  return {
    id: `OPERACOES:OS:RELEASE:${row.id}`,
    domain: 'OPERACOES',
    kind: 'CONTINUITY',
    businessReference: row.orderNumber,
    title: 'Ordem preparada aguardando revisão para liberação',
    contextLabel: row.contractReference
      ? `Contrato ${row.contractReference}`
      : `Unidade ${row.unitId}`,
    status: row.status,
    reason: 'A ordem está preparada; RELEASE é a próxima transição do domínio, sujeita às permissões e pré-condições atuais.',
    occurredAt: row.preparedAt,
    dueAt: null,
    actionLabel: 'Revisar OS 360',
    targetRoute: `/app/service-orders/${row.id}`,
    unitId: row.unitId,
  };
}

function isWorkItem(item: WorkItem | null): item is WorkItem {
  return item !== null;
}
