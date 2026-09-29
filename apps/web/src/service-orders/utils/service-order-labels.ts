import {
  SERVICE_ORDER_STATUSES,
  type ServiceOrderHistoryEvent,
  type ServiceOrderStatus,
} from '../types/service-order.types';

const STATUS_LABELS: Record<ServiceOrderStatus, string> = {
  [SERVICE_ORDER_STATUSES.Draft]: 'Rascunho',
  [SERVICE_ORDER_STATUSES.Prepared]: 'Preparada',
  [SERVICE_ORDER_STATUSES.Released]: 'Liberada',
  [SERVICE_ORDER_STATUSES.InExecution]: 'Em execução',
  [SERVICE_ORDER_STATUSES.Paused]: 'Pausada',
  [SERVICE_ORDER_STATUSES.Completed]: 'Concluída',
  [SERVICE_ORDER_STATUSES.Cancelled]: 'Cancelada',
};

const HISTORY_EVENT_LABELS: Record<string, string> = {
  CREATED: 'OS criada',
  CONVERTED_FROM_SERVICE_REQUEST: 'Convertida de solicitação',
  UPDATED: 'OS alterada',
  PREPARED: 'OS preparada',
  RELEASED: 'OS liberada',
  STARTED: 'Execução iniciada',
  PAUSED: 'Execução pausada',
  RESUMED: 'Execução retomada',
  COMPLETED: 'OS concluída',
  CANCELLED: 'OS cancelada',
  REOPENED: 'OS reaberta',
  PLANNED_RESOURCE_ADDED: 'Recurso planejado',
  PLANNED_RESOURCE_UPDATED: 'Planejamento alterado',
  PLANNED_RESOURCE_REMOVED: 'Recurso planejado removido',
  RESOURCE_ALLOCATED: 'Recurso alocado',
  RESOURCE_REALLOCATED: 'Recurso realocado',
  ALLOCATION_REMOVED: 'Alocação removida',
  RECORDED: 'Registro de execução',
};

/**
 * Origens reais da OS, espelhando `SERVICE_ORDER_ORIGINS` do backend
 * (`apps/api/src/service-orders/domain/service-order.ts`). Nenhuma origem e inventada aqui,
 * e origem desconhecida nao recebe rotulo.
 */
const ORIGIN_LABELS: Record<string, string> = {
  SERVICE_REQUEST: 'Solicitação de serviço',
  PROPOSAL: 'Proposta',
  PURCHASE_ORDER: 'Pedido de compra',
  AUTHORIZED_DIRECT: 'Autorizada diretamente',
};

/** Rotulo humano da origem; `null` quando a origem nao tem traducao conhecida. */
export function formatServiceOrderOrigin(origin: string | null | undefined): string | null {
  if (typeof origin !== 'string') {
    return null;
  }
  return ORIGIN_LABELS[origin] ?? null;
}

const CHANGED_FIELD_LABELS: Record<string, string> = {
  plannedQuantity: 'quantidade planejada',
  operationalStart: 'início operacional',
  operationalEnd: 'fim operacional',
  notes: 'observações',
};

export function formatServiceOrderHistoryEventLabel(eventType: string): string {
  return HISTORY_EVENT_LABELS[eventType] ?? eventType;
}

function readPayloadString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function formatOperationalWindow(payload: Record<string, unknown>): string | null {
  const start = readPayloadString(payload, 'operationalStart');
  const end = readPayloadString(payload, 'operationalEnd');
  if (!start && !end) {
    return null;
  }
  if (start && end) {
    return `${formatDateTime(start)} — ${formatDateTime(end)}`;
  }
  return formatDateTime((start ?? end) as string);
}

function formatChangedFields(payload: Record<string, unknown>): string | null {
  const changed = payload['changedFields'];
  if (!Array.isArray(changed) || changed.length === 0) {
    return null;
  }
  const labels = changed
    .filter((item): item is string => typeof item === 'string')
    .map((item) => CHANGED_FIELD_LABELS[item] ?? item);
  return labels.length > 0 ? labels.join(', ') : null;
}

/**
 * Detalhe legível do evento. Nunca inventa dado ausente: quando o payload não
 * traz informação, devolve null e a UI omite a linha.
 */
export function formatServiceOrderHistoryEventDetail(
  event: ServiceOrderHistoryEvent,
): string | null {
  const payload = event.payload ?? {};

  const cancelledReason = readPayloadString(payload, 'cancellationReason');
  if (cancelledReason) {
    return `Motivo: ${cancelledReason}`;
  }
  const reopenReason = readPayloadString(payload, 'reopenReason');
  if (reopenReason) {
    return `Motivo: ${reopenReason}`;
  }

  const parts: string[] = [];
  const resourceCode =
    readPayloadString(payload, 'resourceTypeCode') ?? readPayloadString(payload, 'laborTypeCode');
  const quantity = readPayloadString(payload, 'plannedQuantity');
  if (resourceCode && quantity) {
    parts.push(`${resourceCode} · qtd. ${quantity}`);
  } else if (resourceCode) {
    parts.push(resourceCode);
  } else if (quantity) {
    parts.push(`qtd. ${quantity}`);
  }

  const window = formatOperationalWindow(payload);
  if (window) {
    parts.push(window);
  }

  const changed = formatChangedFields(payload);
  if (changed) {
    parts.push(`campos: ${changed}`);
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}

export function formatServiceOrderStatus(status: ServiceOrderStatus): string {
  return STATUS_LABELS[status] ?? status;
}

/**
 * Rotulo HUMANO de um estado do ciclo da ORDEM.
 *
 * O status da medicao e do faturamento chega do Operations Control Center como texto
 * do dominio dono: um valor que esta tabela nao conhece e devolvido COMO VEIO, nunca
 * traduzido por adivinhacao nem escondido atras de um placeholder.
 */
export function toHumanStatusLabel(status: string): string {
  return STATUS_LABELS[status as ServiceOrderStatus] ?? status;
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function formatClientLabel(
  clientSnapshot: Record<string, unknown> | null,
  clientId: string | null,
): string {
  if (clientSnapshot) {
    const tradeName = clientSnapshot['tradeName'];
    const legalName = clientSnapshot['legalName'];
    if (typeof tradeName === 'string' && tradeName.trim()) {
      return tradeName;
    }
    if (typeof legalName === 'string' && legalName.trim()) {
      return legalName;
    }
  }
  return clientId ?? '—';
}

/**
 * Rotulo do responsavel pelo despacho. Nunca inventa nome: quando nao ha
 * alocacao ativa de mao de obra, a OS esta sem responsavel.
 */
export function formatAssigneeLabel(
  member: { memberCode: string; displayName: string } | null,
): string {
  if (!member) {
    return 'Sem responsável';
  }
  return `${member.displayName} (${member.memberCode})`;
}

export function formatDeadlineLabel(deadlineAt: string | null): string {
  return deadlineAt ? formatDateTime(deadlineAt) : 'Sem prazo';
}
