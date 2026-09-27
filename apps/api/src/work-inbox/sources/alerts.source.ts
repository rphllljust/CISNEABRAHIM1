import { HttpException, Injectable } from '@nestjs/common';
import {
  BUSINESS_ALERT_STATUSES,
  BUSINESS_ALERT_TYPES,
  type BusinessAlertListItem,
  type BusinessAlertType,
} from '../../alerts/domain/business-alert';
import { BusinessAlertAccessService } from '../../alerts/services/business-alert-access.service';
import type { WorkDomain, WorkItem, WorkKind } from '../contracts/work-item.contract';
import type { WorkItemActor, WorkItemSource } from './work-item-source';

/**
 * FONTE DE ALERTAS OPERACIONAIS
 *
 * Os alertas de negocio ja sao FATOS PERSISTIDOS derivados das politicas do dominio (`alt.business_alerts`,
 * avaliadas por `alert-evaluation.engine`). Esta fonte nao recalcula prazo, nao reprocessa politica e
 * nao cria alerta: ela LE os alertas que existem e os normaliza para o contrato da fila.
 *
 * Autorizacao: `BusinessAlertAccessService.listAlerts` e a autoridade do modulo ALERTAS — ele resolve a
 * concessao de leitura de OS/faturamento e o escopo de unidade, e sob escopo vazio devolve lista vazia.
 * Sem concessao ele responde 403; nesse caso a fonte devolve lista VAZIA (nunca contagem, nunca item
 * anonimizado, nunca sinal de existencia).
 *
 * DEDUPLICACAO: `id` e a chave logica `DOMINIO:ALERT:<alertId>`. O alerta persistido ja e unico por
 * obrigacao (tem chave de deduplicacao propria no dominio), entao a mesma obrigacao nao entra duas vezes.
 */
@Injectable()
export class AlertsWorkSource implements WorkItemSource {
  readonly domain = 'OPERACOES';

  constructor(private readonly alerts: BusinessAlertAccessService) {}

  async collect(actor: WorkItemActor): Promise<WorkItem[]> {
    let alerts: BusinessAlertListItem[];
    try {
      alerts = await this.alerts.listAlerts(actor, {
        status: BUSINESS_ALERT_STATUSES.Active,
        limit: String(ALERT_READ_LIMIT),
      });
    } catch (error) {
      if (isAccessDenied(error)) {
        return [];
      }
      throw error;
    }

    return alerts.map(toAlertWorkItem).filter(isWorkItem);
  }
}

/**
 * Teto de leitura desta fonte.
 *
 * `AlertListQuery.limit` e clampado em 200 pelo proprio modulo de alertas e NAO existe paginacao por
 * offset nessa consulta. Colocar a leitura no teto do dominio e o maximo que o contrato vigente
 * permite; ler menos seria truncar trabalho por escolha propria. A fonte nunca le "quase tudo" em
 * silencio: quando o teto e atingido, a limitacao e do modulo dono e esta declarada aqui.
 */
export const ALERT_READ_LIMIT = 200;

/** Roteamento de cada tipo de alerta persistido para dominio da fila + natureza do trabalho. */
const ALERT_ROUTING: Record<
  BusinessAlertType,
  { domain: WorkDomain; kind: WorkKind; typeLabel: string; actionLabel: string }
> = {
  [BUSINESS_ALERT_TYPES.ServiceOrderOverdue]: {
    domain: 'OPERACOES',
    kind: 'OVERDUE',
    typeLabel: 'OS vencida',
    actionLabel: 'Abrir o planejamento da OS',
  },
  [BUSINESS_ALERT_TYPES.ServiceOrderDueSoon]: {
    domain: 'OPERACOES',
    kind: 'OVERDUE',
    typeLabel: 'OS vencendo em breve',
    actionLabel: 'Abrir o planejamento da OS',
  },
  [BUSINESS_ALERT_TYPES.ServiceOrderStalled]: {
    // Processo parado no meio: a proxima etapa nao aconteceu.
    domain: 'OPERACOES',
    kind: 'CONTINUITY',
    typeLabel: 'OS parada',
    actionLabel: 'Abrir o planejamento da OS',
  },
  [BUSINESS_ALERT_TYPES.MeasurementAging]: {
    domain: 'OPERACOES',
    kind: 'OVERDUE',
    typeLabel: 'Medição parada',
    actionLabel: 'Abrir a medição da OS',
  },
  [BUSINESS_ALERT_TYPES.BillingAging]: {
    domain: 'OPERACOES',
    kind: 'OVERDUE',
    typeLabel: 'Faturamento parado',
    actionLabel: 'Abrir o faturamento da OS',
  },
  [BUSINESS_ALERT_TYPES.PaymentOverdue]: {
    domain: 'FINANCEIRO',
    kind: 'OVERDUE',
    typeLabel: 'Pagamento vencido',
    actionLabel: 'Abrir o faturamento vencido',
  },
};

/**
 * Normaliza UM alerta persistido em item de trabalho. Puro: nenhuma consulta, nenhuma decisao de acesso.
 *
 * `dueAt` e `null` sempre: o alerta persistido NAO guarda prazo (o motor de avaliacao guarda apenas
 * fase, janela de politica e o atraso observado na mensagem). Inventar prazo aqui seria criar fato.
 * `businessReference` e o rotulo humano que o proprio dominio expoe no alerta (titulo persistido);
 * o modulo de alertas nao publica codigo humano do agregado (numero de OS/nota), e o uuid do
 * `entityHref` nunca vira referencia.
 */
export function toAlertWorkItem(alert: BusinessAlertListItem): WorkItem | null {
  const routing = ALERT_ROUTING[alert.alertType];
  if (!routing) {
    return null;
  }
  // Sem rota real persistida nao existe deep link: o item nao e emitido.
  if (!alert.entityHref?.trim()) {
    return null;
  }
  const title = alert.title?.trim() ?? '';
  const message = alert.message?.trim() ?? '';

  return {
    id: `${routing.domain}:ALERT:${alert.id}`,
    domain: routing.domain,
    kind: routing.kind,
    businessReference: title || `${routing.typeLabel} · ${alert.triggeredAt.slice(0, 10)}`,
    title: title || routing.typeLabel,
    contextLabel: [
      `${routing.typeLabel} · severidade ${alert.severity}`,
      alert.unitId ? `unidade ${alert.unitId}` : null,
    ]
      .filter((part): part is string => part !== null)
      .join(' · '),
    status: alert.status,
    reason: message || `Alerta ${alert.alertType} ativo no domínio.`,
    occurredAt: alert.triggeredAt,
    dueAt: null,
    actionLabel: routing.actionLabel,
    targetRoute: alert.entityHref,
    unitId: alert.unitId,
  };
}

/** Negacao do dominio dono: 403 e a recusa de leitura. Qualquer outra falha NAO vira fila vazia. */
function isAccessDenied(error: unknown): boolean {
  return error instanceof HttpException && error.getStatus() === 403;
}

function isWorkItem(item: WorkItem | null): item is WorkItem {
  return item !== null;
}
