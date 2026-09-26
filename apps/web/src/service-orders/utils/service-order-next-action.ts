import { SERVICE_ORDER_STATUSES, type ServiceOrderStatus } from '../types/service-order.types';

/**
 * Leitura de produto da maquina de estados de OS.
 *
 * Nao cria estado, nao cria transicao e nao decide nada: apenas nomeia, em linguagem
 * operacional, o passo que o backend JA permite a partir do status atual. As transicoes
 * abaixo espelham exatamente as que `ServiceOrdersListPage` ja executa hoje
 * (prepareServiceOrder / releaseServiceOrder / reopenServiceOrder) e as etapas ja
 * existentes de planejamento, execucao e medicao.
 */
export type ServiceOrderNextAction =
  | { kind: 'lifecycle'; intent: 'prepare' | 'release' | 'reopen'; label: string }
  | { kind: 'stage'; stage: 'planning' | 'execution' | 'measurement'; label: string }
  | { kind: 'none'; label: string };

const NEXT_ACTION_BY_STATUS: Record<ServiceOrderStatus, ServiceOrderNextAction> = {
  [SERVICE_ORDER_STATUSES.Draft]: {
    kind: 'lifecycle',
    intent: 'prepare',
    label: 'Preparar OS',
  },
  [SERVICE_ORDER_STATUSES.Prepared]: {
    kind: 'lifecycle',
    intent: 'release',
    label: 'Liberar OS',
  },
  [SERVICE_ORDER_STATUSES.Released]: {
    kind: 'stage',
    stage: 'planning',
    label: 'Alocar recursos',
  },
  [SERVICE_ORDER_STATUSES.InExecution]: {
    kind: 'stage',
    stage: 'execution',
    label: 'Registrar execução',
  },
  [SERVICE_ORDER_STATUSES.Paused]: {
    kind: 'stage',
    stage: 'execution',
    label: 'Retomar execução',
  },
  [SERVICE_ORDER_STATUSES.Completed]: {
    kind: 'stage',
    stage: 'measurement',
    label: 'Registrar medição',
  },
  [SERVICE_ORDER_STATUSES.Cancelled]: {
    kind: 'lifecycle',
    intent: 'reopen',
    label: 'Reabrir OS',
  },
};

export function resolveServiceOrderNextAction(status: ServiceOrderStatus): ServiceOrderNextAction {
  return NEXT_ACTION_BY_STATUS[status] ?? { kind: 'none', label: 'Sem próxima ação' };
}

export function serviceOrderStagePath(serviceOrderId: string, stage: 'planning' | 'execution' | 'measurement'): string {
  return `/app/service-orders/${serviceOrderId}/${stage}`;
}

export type ServiceOrderAttentionTone = 'critical' | 'warning' | 'neutral';

export type ServiceOrderAttention = {
  tone: ServiceOrderAttentionTone;
  label: string;
};

const OPEN_STATUSES: ReadonlySet<ServiceOrderStatus> = new Set([
  SERVICE_ORDER_STATUSES.Draft,
  SERVICE_ORDER_STATUSES.Prepared,
  SERVICE_ORDER_STATUSES.Released,
  SERVICE_ORDER_STATUSES.InExecution,
  SERVICE_ORDER_STATUSES.Paused,
]);

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Excecao operacional derivada de campos que o backend JA entrega na listagem
 * (`deadlineAt`, `assignedWorkforceMember`). E leitura de dado existente: nao
 * recalcula prazo, nao altera status e nao esconde informacao ausente — quando
 * o dado nao existe, devolve `null` e a celula simplesmente nao renderiza excecao.
 *
 * `now` existe para o teste fixar o instante; em producao usa o relogio corrente.
 */
export function resolveServiceOrderAttention(
  order: {
    status: ServiceOrderStatus;
    deadlineAt: string | null;
    assignedWorkforceMember: { memberCode: string; displayName: string } | null;
  },
  now: Date = new Date(),
): ServiceOrderAttention | null {
  if (!OPEN_STATUSES.has(order.status)) {
    return null;
  }

  if (order.deadlineAt) {
    const deadline = new Date(order.deadlineAt);
    const parsed = deadline.getTime();
    if (!Number.isNaN(parsed)) {
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const startOfDeadline = new Date(
        deadline.getFullYear(),
        deadline.getMonth(),
        deadline.getDate(),
      ).getTime();
      const days = Math.round((startOfDeadline - startOfToday) / DAY_MS);

      if (days < 0) {
        const overdue = Math.abs(days);
        return {
          tone: 'critical',
          label: overdue === 1 ? 'Vencida há 1 dia' : `Vencida há ${overdue} dias`,
        };
      }
      if (days === 0) {
        return { tone: 'critical', label: 'Vence hoje' };
      }
      if (days <= 3) {
        return { tone: 'warning', label: days === 1 ? 'Vence amanhã' : `Vence em ${days} dias` };
      }
    }
  }

  if (!order.assignedWorkforceMember) {
    return { tone: 'warning', label: 'Sem responsável alocado' };
  }

  if (!order.deadlineAt) {
    return { tone: 'neutral', label: 'Sem prazo operacional' };
  }

  return null;
}

const ATTENTION_TONE_CLASS: Record<ServiceOrderAttentionTone, string> = {
  critical: 'text-red-700',
  warning: 'text-amber-700',
  neutral: 'text-gray-500',
};

export function serviceOrderAttentionClass(tone: ServiceOrderAttentionTone): string {
  return ATTENTION_TONE_CLASS[tone];
}
