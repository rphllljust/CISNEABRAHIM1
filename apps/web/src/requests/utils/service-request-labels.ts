import {
  SERVICE_REQUEST_ORIGINS,
  SERVICE_REQUEST_PRIORITIES,
  type ServiceRequestNextStepCode,
  type ServiceRequestOrigin,
  type ServiceRequestPriority,
  type ServiceRequestStatus,
  type ServiceRequestTransition,
} from '../types/service-request.types';

export const SERVICE_REQUEST_ORIGIN_LABELS: Record<ServiceRequestOrigin, string> = {
  [SERVICE_REQUEST_ORIGINS.Whatsapp]: 'WhatsApp',
  [SERVICE_REQUEST_ORIGINS.Phone]: 'Telefone',
  [SERVICE_REQUEST_ORIGINS.Email]: 'E-mail',
  [SERVICE_REQUEST_ORIGINS.PurchaseOrder]: 'Pedido de compra',
  [SERVICE_REQUEST_ORIGINS.Contract]: 'Contrato',
  [SERVICE_REQUEST_ORIGINS.ProposalAcceptance]: 'Aceite de proposta',
  [SERVICE_REQUEST_ORIGINS.DirectRequest]: 'Solicitação direta',
  [SERVICE_REQUEST_ORIGINS.Other]: 'Outro',
};

export const SERVICE_REQUEST_STATUS_LABELS: Record<ServiceRequestStatus, string> = {
  DRAFT: 'Rascunho',
  SUBMITTED: 'Enviada',
  UNDER_REVIEW: 'Em análise',
  APPROVED: 'Aprovada',
  REJECTED: 'Rejeitada',
  CANCELLED: 'Cancelada',
  CONVERTED: 'Convertida',
};

export function formatServiceRequestOrigin(origin: ServiceRequestOrigin): string {
  return SERVICE_REQUEST_ORIGIN_LABELS[origin] ?? origin;
}

export function formatServiceRequestStatus(status: ServiceRequestStatus): string {
  return SERVICE_REQUEST_STATUS_LABELS[status] ?? status;
}

export function formatRegisteredBy(
  createdByIdentityId: string,
  currentIdentityId: string | null,
): string {
  if (currentIdentityId && createdByIdentityId === currentIdentityId) {
    return 'Você (usuário interno)';
  }
  // O id tecnico do ator nao entra no rotulo: nenhum uuid visivel na interface.
  return 'Usuário interno';
}

export function formatDateTime(value: string | null): string {
  if (!value) {
    return '—';
  }
  return new Date(value).toLocaleString('pt-BR');
}

export function formatExternalContact(contact: {
  name?: string;
  email?: string;
  phone?: string;
}): string {
  const parts = [contact.name, contact.email, contact.phone].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

export const SERVICE_REQUEST_PRIORITY_LABELS: Record<ServiceRequestPriority, string> = {
  [SERVICE_REQUEST_PRIORITIES.Low]: 'Baixa',
  [SERVICE_REQUEST_PRIORITIES.Normal]: 'Normal',
  [SERVICE_REQUEST_PRIORITIES.High]: 'Alta',
  [SERVICE_REQUEST_PRIORITIES.Urgent]: 'Urgente',
};

export function formatServiceRequestPriority(priority: ServiceRequestPriority | null): string {
  if (!priority) {
    return 'Não definida';
  }
  return SERVICE_REQUEST_PRIORITY_LABELS[priority] ?? priority;
}

/** Rótulos do próximo passo — espelham os passos derivados no backend, sem criar estado novo. */
export const SERVICE_REQUEST_NEXT_STEP_LABELS: Record<ServiceRequestNextStepCode, string> = {
  SUBMIT_REQUEST: 'Completar e enviar para análise',
  START_REVIEW: 'Iniciar análise',
  DECIDE: 'Registrar decisão da análise',
  CONVERT_TO_SERVICE_ORDER: 'Converter em ordem de serviço',
  OPEN_SERVICE_ORDER: 'Acompanhar a ordem de serviço gerada',
  CLOSED: 'Ciclo encerrado',
};

export function formatServiceRequestNextStep(step: ServiceRequestNextStepCode): string {
  return SERVICE_REQUEST_NEXT_STEP_LABELS[step] ?? step;
}

export const SERVICE_REQUEST_TRANSITION_LABELS: Record<ServiceRequestTransition, string> = {
  submit: 'Enviar para análise',
  startReview: 'Iniciar análise',
  approve: 'Aprovar',
  reject: 'Rejeitar',
  cancel: 'Cancelar',
  convert: 'Converter em OS',
};

export function formatServiceRequestTransition(transition: ServiceRequestTransition): string {
  return SERVICE_REQUEST_TRANSITION_LABELS[transition] ?? transition;
}

/** Motivos de bloqueio são códigos do backend — a UI só os nomeia. */
export const SERVICE_REQUEST_BLOCKER_LABELS: Record<string, string> = {
  DESCRIPTION_OR_SERVICE_REQUIRED: 'Informe a descrição da demanda ou o serviço antes de enviar.',
};

export function formatServiceRequestBlocker(code: string): string {
  return SERVICE_REQUEST_BLOCKER_LABELS[code] ?? code;
}

export const SERVICE_REQUEST_HISTORY_EVENT_LABELS: Record<string, string> = {
  CREATED: 'Solicitação registrada',
  SUBMITTED: 'Enviada para análise',
  REVIEW_STARTED: 'Análise iniciada',
  APPROVED: 'Aprovada',
  REJECTED: 'Rejeitada',
  CANCELLED: 'Cancelada',
  CONVERTED: 'Convertida em ordem de serviço',
  ADDITIONAL_CONVERTED: 'Nova ordem de serviço gerada',
};

export function formatServiceRequestHistoryEventLabel(eventType: string): string {
  return SERVICE_REQUEST_HISTORY_EVENT_LABELS[eventType] ?? eventType;
}

/** Contexto útil do payload do evento. Nunca despeja JSON cru na tela. */
export function formatServiceRequestHistoryEventDetail(event: {
  eventType: string;
  payload: Record<string, unknown>;
}): string | null {
  const payload = event.payload ?? {};
  const fromStatus = typeof payload['fromStatus'] === 'string' ? payload['fromStatus'] : null;
  const toStatus = typeof payload['toStatus'] === 'string' ? payload['toStatus'] : null;
  const priority = typeof payload['priority'] === 'string' ? payload['priority'] : null;
  const rejectionReason =
    typeof payload['rejectionReason'] === 'string' ? payload['rejectionReason'] : null;
  const cancellationReason =
    typeof payload['cancellationReason'] === 'string' ? payload['cancellationReason'] : null;

  const parts: string[] = [];
  if (fromStatus && toStatus && fromStatus !== toStatus) {
    parts.push(
      `${formatServiceRequestStatus(fromStatus as ServiceRequestStatus)} → ${formatServiceRequestStatus(toStatus as ServiceRequestStatus)}`,
    );
  }
  if (priority) {
    parts.push(`Prioridade: ${formatServiceRequestPriority(priority as ServiceRequestPriority)}`);
  }
  if (rejectionReason) {
    parts.push(`Motivo: ${rejectionReason}`);
  }
  if (cancellationReason) {
    parts.push(`Motivo: ${cancellationReason}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

export const SERVICE_REQUEST_LINKED_KIND_LABELS: Record<string, string> = {
  PROPOSAL: 'Proposta comercial',
  PURCHASE_ORDER: 'Pedido de compra',
  SERVICE_ORDER: 'Ordem de serviço',
};

export function formatServiceRequestLinkedKind(kind: string): string {
  return SERVICE_REQUEST_LINKED_KIND_LABELS[kind] ?? kind;
}
