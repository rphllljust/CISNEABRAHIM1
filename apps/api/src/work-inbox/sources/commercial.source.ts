import { HttpException, Injectable } from '@nestjs/common';
import { MAX_LIST_LIMIT } from '../../infrastructure/http/contracts';
import { SERVICE_REQUEST_STATUSES } from '../../requests/domain/service-request';
import { nextStepForStatus } from '../../requests/domain/service-request-readiness';
import type { ServiceRequestListItemResponse } from '../../requests/serializers/service-requests-response.serializer';
import { ServiceRequestsAccessService } from '../../requests/services/service-requests-access.service';
import type { WorkItem } from '../contracts/work-item.contract';
import type { WorkItemActor, WorkItemSource } from './work-item-source';

/**
 * FONTE COMERCIAL — solicitacoes que ESPERAM uma pessoa.
 *
 * Ser "aberta" nao e trabalho: DRAFT e de quem redigiu, APPROVED espera conversao e CONVERTED/REJECTED/
 * CANCELLED sao terminais. A fonte emite APENAS `SUBMITTED`, o estado em que a solicitacao foi enviada e
 * NINGUEM iniciou a analise — o proximo passo que o proprio dominio deriva para esse estado e
 * `START_REVIEW` (`nextStepForStatus`). Nenhum estado novo e nenhum prazo e inventado.
 *
 * Autorizacao: `ServiceRequestsAccessService.list` exige `requests:service-request:list` e aplica o
 * filtro de escopo do modulo dono (unidade/cliente) na consulta — a pagina ja vem so com o que o ator
 * pode ler. Sem concessao o dominio responde 403 e a fonte devolve lista VAZIA (nunca contagem, nunca
 * item anonimizado, nunca sinal de existencia). `clientName`/`serviceLabel` chegam nulos quando o ator
 * pode ler a solicitacao mas nao o cliente/catalogo, e nesse caso o contexto cai para a unidade.
 *
 * LEITURA EM LOTE: pagina no TAMANHO MAXIMO de lista do proprio contrato de paginacao
 * (`MAX_LIST_LIMIT`) ate a ultima pagina. Nenhuma consulta por item — o lote e a unidade de leitura.
 *
 * DEDUPLICACAO: chave logica `COMERCIAL:REQUEST:<id>` — uma por solicitacao, estavel entre leituras.
 */
@Injectable()
export class CommercialWorkSource implements WorkItemSource {
  readonly domain = 'COMERCIAL';

  constructor(private readonly requests: ServiceRequestsAccessService) {}

  async collect(actor: WorkItemActor): Promise<WorkItem[]> {
    const items: WorkItem[] = [];
    try {
      let offset = 0;
      for (;;) {
        const page = await this.requests.list(actor, {
          status: SERVICE_REQUEST_STATUSES.Submitted,
          limit: MAX_LIST_LIMIT,
          offset,
        });
        items.push(...page.items.map(toRequestWorkItem).filter(isWorkItem));
        if (page.items.length < MAX_LIST_LIMIT) {
          break;
        }
        offset += page.items.length;
      }
    } catch (error) {
      if (isAccessDenied(error)) {
        return [];
      }
      throw error;
    }
    return items;
  }
}

/**
 * Normaliza UMA solicitacao em item de trabalho. Puro. Devolve `null` para qualquer estado que nao
 * seja o de espera por analise: a fila nao transforma registro aberto em tarefa.
 *
 * `dueAt` e `null` de proposito: `desiredStartAt`/`desiredEndAt` sao a janela DESEJADA pelo
 * solicitante, nao prazo de atendimento, e o dominio nao persiste SLA de analise. Usar a janela
 * desejada como vencimento seria inventar prazo.
 */
export function toRequestWorkItem(row: ServiceRequestListItemResponse): WorkItem | null {
  if (row.status !== SERVICE_REQUEST_STATUSES.Submitted) {
    return null;
  }
  const nextStep = nextStepForStatus(SERVICE_REQUEST_STATUSES.Submitted);

  return {
    id: `COMERCIAL:REQUEST:${row.id}`,
    domain: 'COMERCIAL',
    kind: 'APPROVAL',
    businessReference: row.requestCode,
    title: 'Solicitação aguardando início de análise',
    contextLabel: requestContextLabel(row),
    status: row.status,
    reason: `Solicitação enviada e ainda sem análise iniciada; o próximo passo derivado pelo domínio para este estado é ${nextStep.step}.`,
    // Fato persistido que colocou a solicitacao na fila: o envio. Sem envio, o registro nao chega aqui.
    occurredAt: row.submittedAt ?? row.createdAt,
    dueAt: null,
    actionLabel: 'Abrir a solicitação',
    targetRoute: `/app/requests/${row.id}`,
    unitId: row.unitId,
  };
}

/** Contexto humano sem uuid: cliente e servico quando o dominio os autorizou; senao a unidade. */
function requestContextLabel(row: ServiceRequestListItemResponse): string {
  const parts = [row.clientName?.trim(), row.serviceLabel?.trim()].filter(
    (part): part is string => Boolean(part),
  );
  if (parts.length > 0) {
    return parts.join(' · ');
  }
  return `Unidade ${row.unitId}`;
}

/** Negacao do dominio dono: 403 e a recusa de leitura desta fila. Outra falha nao vira fila vazia. */
function isAccessDenied(error: unknown): boolean {
  return error instanceof HttpException && error.getStatus() === 403;
}

function isWorkItem(item: WorkItem | null): item is WorkItem {
  return item !== null;
}
