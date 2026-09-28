import {
  BUSINESS_ALERT_TYPES,
  type BusinessAlertListItem,
  type BusinessAlertType,
} from '../../alerts/types/alerts.types';

/**
 * REAL WORK INBOX — derivacao de pendencia a partir de ESTADO REAL PERSISTIDO.
 *
 * REGRA MASTER: NAO INVENTAR TAREFA.
 *
 * A unica fonte de pendencia transversal persistida e hoje o Alert Center
 * (`/api/v1/alerts`), que ja deriva alertas de estados reais de OS, medicao,
 * faturamento e pagamento. Este modulo NAO cria uma segunda fonte, NAO interpreta
 * payload de outros modulos e NAO sintetiza tarefa a partir de heuristica.
 *
 * Areas sem feed de pendencia persistido aparecem declaradamente vazias, com a
 * razao dita ao operador — em vez de um card bonito sem lastro. Isso e
 * deliberado: uma caixa de entrada que inventa item destroi a confianca na fila.
 *
 * "Prioridade derivada" e "tempo parado" sao CALCULADOS de fatos ja presentes
 * (severidade e `triggeredAt`) e sao rotulados como derivados. Nao sao dado novo.
 */

export type WorkAreaId =
  | 'COMERCIAL'
  | 'OPERACOES'
  | 'MEDICAO'
  | 'FINANCEIRO'
  | 'FISCAL'
  | 'CONTABILIDADE';

export type WorkArea = {
  id: WorkAreaId;
  label: string;
  /** Origem real dos itens desta area, quando existe. */
  source: 'alerts' | 'none';
  /** Explicacao honesta quando nao ha feed persistido. */
  missingSourceReason?: string;
};

export const WORK_AREAS: WorkArea[] = [
  {
    id: 'COMERCIAL',
    label: 'Comercial',
    source: 'none',
    missingSourceReason:
      'Ainda não há feed persistido de pendência comercial (proposta aguardando decisão, pedido de compra do cliente parado). Nada é exibido aqui para não inventar tarefa.',
  },
  { id: 'OPERACOES', label: 'Operações', source: 'alerts' },
  { id: 'MEDICAO', label: 'Medição', source: 'alerts' },
  { id: 'FINANCEIRO', label: 'Financeiro', source: 'alerts' },
  {
    id: 'FISCAL',
    label: 'Fiscal',
    source: 'none',
    missingSourceReason:
      'Ainda não há feed persistido de pendência fiscal nesta superfície. Documentos rejeitados e períodos abertos são consultados nas listas do módulo Fiscal.',
  },
  {
    id: 'CONTABILIDADE',
    label: 'Contabilidade',
    source: 'none',
    missingSourceReason:
      'Ainda não há feed persistido de pendência contábil nesta superfície. Rascunhos e períodos abertos são consultados nas listas da Contabilidade.',
  },
];

/** Mapa tipo de alerta -> area empresarial. */
const ALERT_AREA: Record<BusinessAlertType, WorkAreaId> = {
  [BUSINESS_ALERT_TYPES.ServiceOrderOverdue]: 'OPERACOES',
  [BUSINESS_ALERT_TYPES.ServiceOrderDueSoon]: 'OPERACOES',
  [BUSINESS_ALERT_TYPES.ServiceOrderStalled]: 'OPERACOES',
  [BUSINESS_ALERT_TYPES.MeasurementAging]: 'MEDICAO',
  [BUSINESS_ALERT_TYPES.BillingAging]: 'MEDICAO',
  [BUSINESS_ALERT_TYPES.PaymentOverdue]: 'FINANCEIRO',
};

/** Rotulo humano do tipo de pendencia. */
const ALERT_KIND_LABEL: Record<BusinessAlertType, string> = {
  [BUSINESS_ALERT_TYPES.ServiceOrderOverdue]: 'Ordem de serviço vencida',
  [BUSINESS_ALERT_TYPES.ServiceOrderDueSoon]: 'Ordem de serviço vencendo',
  [BUSINESS_ALERT_TYPES.ServiceOrderStalled]: 'Ordem de serviço parada',
  [BUSINESS_ALERT_TYPES.MeasurementAging]: 'Medição parada',
  [BUSINESS_ALERT_TYPES.BillingAging]: 'Faturamento parado',
  [BUSINESS_ALERT_TYPES.PaymentOverdue]: 'Recebimento vencido',
};

/**
 * Proxima acao: NAVEGACAO ate o ponto de decisao, nunca uma transicao.
 * A acao real continua sendo do dominio, com sua autorizacao e sua regra.
 */
const ALERT_NEXT_ACTION: Record<BusinessAlertType, string> = {
  [BUSINESS_ALERT_TYPES.ServiceOrderOverdue]: 'Abrir a OS e decidir execução ou reprogramação',
  [BUSINESS_ALERT_TYPES.ServiceOrderDueSoon]: 'Confirmar a execução dentro do prazo',
  [BUSINESS_ALERT_TYPES.ServiceOrderStalled]: 'Abrir a OS e destravar a execução',
  [BUSINESS_ALERT_TYPES.MeasurementAging]: 'Abrir a medição pendente',
  [BUSINESS_ALERT_TYPES.BillingAging]: 'Abrir o faturamento pendente',
  [BUSINESS_ALERT_TYPES.PaymentOverdue]: 'Abrir o título vencido e tratar a cobrança',
};

export type WorkInboxItem = {
  id: string;
  area: WorkAreaId;
  /** Tipo real de pendencia. */
  kindLabel: string;
  alertType: BusinessAlertType;
  /** Referencia humana (titulo do alerta, derivado da entidade). */
  reference: string;
  /** Situacao descrita pelo proprio alerta persistido. */
  situation: string;
  severity: 'WARNING' | 'CRITICAL';
  /** Prioridade DERIVADA de severidade + tempo parado. Rotulada como derivada. */
  priorityScore: number;
  priorityLabel: string;
  /** Tempo parado calculado de `triggeredAt` (fato persistido). */
  stalledSince: string;
  stalledLabel: string;
  nextAction: string;
  href: string;
};

export type WorkInboxGroup = {
  area: WorkArea;
  items: WorkInboxItem[];
};

function formatElapsed(fromIso: string, now: Date): string {
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) {
    return 'tempo indisponível';
  }
  const ms = now.getTime() - from.getTime();
  if (ms < 0) {
    return 'agora';
  }
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) {
    return 'menos de 1 h';
  }
  if (hours < 24) {
    return `${hours} h`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days} ${days === 1 ? 'dia' : 'dias'}`;
  }
  const months = Math.floor(days / 30);
  return `${months} ${months === 1 ? 'mês' : 'meses'}`;
}

/**
 * Converte um alerta persistido em item de fila de trabalho.
 * Nao cria estado: apenas renomeia e ordena o que ja foi persistido.
 */
export function toWorkInboxItem(alert: BusinessAlertListItem, now: Date): WorkInboxItem {
  const area = ALERT_AREA[alert.alertType];
  const stalledHours = Math.max(
    0,
    (now.getTime() - new Date(alert.triggeredAt).getTime()) / 3_600_000,
  );
  const severityWeight = alert.severity === 'CRITICAL' ? 1000 : 0;
  const priorityScore = severityWeight + Math.min(stalledHours, 999);

  return {
    id: alert.id,
    area,
    kindLabel: ALERT_KIND_LABEL[alert.alertType],
    alertType: alert.alertType,
    reference: alert.title,
    situation: alert.message,
    severity: alert.severity,
    priorityScore,
    priorityLabel: alert.severity === 'CRITICAL' ? 'Crítico' : 'Atenção',
    stalledSince: alert.triggeredAt,
    stalledLabel: formatElapsed(alert.triggeredAt, now),
    nextAction: ALERT_NEXT_ACTION[alert.alertType],
    href: alert.entityHref,
  };
}

export type BuildWorkInboxOptions = {
  alerts: BusinessAlertListItem[];
  now?: Date;
  /** Filtra por area; null = todas. */
  area?: WorkAreaId | null;
};

/**
 * Agrupa e ordena a fila. Ordem dentro do grupo: prioridade derivada desc, depois
 * mais antigo primeiro — o que esta parado ha mais tempo aparece no topo.
 */
export function buildWorkInbox({
  alerts,
  now = new Date(),
  area = null,
}: BuildWorkInboxOptions): WorkInboxGroup[] {
  const items = alerts
    .filter((alert) => alert.status === 'ACTIVE')
    .map((alert) => toWorkInboxItem(alert, now))
    .filter((item) => (area ? item.area === area : true));

  return WORK_AREAS.map((workArea) => ({
    area: workArea,
    items: items
      .filter((item) => item.area === workArea.id)
      .sort((left, right) => {
        if (right.priorityScore !== left.priorityScore) {
          return right.priorityScore - left.priorityScore;
        }
        return new Date(left.stalledSince).getTime() - new Date(right.stalledSince).getTime();
      }),
  }));
}

/** Contagem real por area — nunca estimada. */
export function countByArea(groups: WorkInboxGroup[]): Record<WorkAreaId, number> {
  return groups.reduce(
    (accumulator, group) => {
      accumulator[group.area.id] = group.items.length;
      return accumulator;
    },
    {
      COMERCIAL: 0,
      OPERACOES: 0,
      MEDICAO: 0,
      FINANCEIRO: 0,
      FISCAL: 0,
      CONTABILIDADE: 0,
    } satisfies Record<WorkAreaId, number>,
  );
}
