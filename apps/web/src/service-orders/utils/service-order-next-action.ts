import { SERVICE_ORDER_STATUSES, type ServiceOrderStatus } from '../types/service-order.types';

/*
 * SESSÃO B5 — O MAPA status→comando FOI REMOVIDO DAQUI.
 *
 * Este arquivo mantinha `NEXT_ACTION_BY_STATUS`: um mapa completo de status para comando
 * ("prepare", "release", "reopen"), com rótulos hardcoded. Era uma segunda implementação
 * da state machine — a primeira sendo a do backend.
 *
 * O defeito não era hipotético: qualquer transição nova no backend exigia alteração nos
 * dois lados, e o front podia oferecer um comando que o backend rejeitaria (ou esconder
 * um que ele passou a aceitar).
 *
 * A fonte de verdade agora é `GET /service-orders/:id/available-actions`, consumida por
 * `useAvailableActions` + `ServiceOrderRowActions`. O backend decide quais comandos
 * existem, seus rótulos e se o usuário tem permissão.
 *
 * O que PERMANECE neste arquivo é apresentação, não regra de comando:
 *   - `resolveServiceOrderAttention`: destaca exceção operacional (prazo, responsável).
 *   - `serviceOrderAttentionClass`: cor da atenção.
 * Nenhuma das duas decide qual comando é possível.
 */

export type ServiceOrderAttentionTone = 'critical' | 'warning' | 'neutral';

/**
 * Caminho de navegação para uma etapa da OS.
 *
 * NÃO é regra de comando: é roteamento. As etapas são superfícies fixas do produto
 * (planejamento/execução/medição), não transições da state machine — por isso
 * permanece aqui depois da remoção do mapa status→comando.
 */
export function serviceOrderStagePath(
  serviceOrderId: string,
  stage: 'planning' | 'execution' | 'measurement',
): string {
  return `/app/service-orders/${serviceOrderId}/${stage}`;
}

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
