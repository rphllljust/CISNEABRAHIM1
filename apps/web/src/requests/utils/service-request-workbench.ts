import {
  SERVICE_REQUEST_PRIORITIES,
  SERVICE_REQUEST_STATUSES,
  type ServiceRequest,
  type ServiceRequestPriority,
} from '../types/service-request.types';
import { formatDateTime, formatServiceRequestPriority } from './service-request-labels';

/**
 * Derivacoes temporais e de atencao da fila operacional.
 *
 * Tudo aqui e calculado a partir de campos que o backend ja persiste. Nenhum prazo, SLA, atraso
 * ou responsavel e inventado: os textos descrevem FATOS (o inicio desejado ja passou, a solicitacao
 * foi criada ha N, a janela nao foi informada) e nunca uma violacao que o dominio nao define.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

function startOfDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

export function formatRelativePast(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) {
    return null;
  }
  const diff = now.getTime() - new Date(iso).getTime();
  if (Number.isNaN(diff)) {
    return null;
  }
  if (diff < MINUTE_MS) {
    return 'agora há pouco';
  }
  if (diff < HOUR_MS) {
    const minutes = Math.floor(diff / MINUTE_MS);
    return `há ${minutes} min`;
  }
  if (diff < DAY_MS) {
    const hours = Math.floor(diff / HOUR_MS);
    return `há ${hours} h`;
  }
  const days = Math.floor(diff / DAY_MS);
  return days === 1 ? 'há 1 dia' : `há ${days} dias`;
}

export function formatRelativeFuture(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) {
    return null;
  }
  const diff = new Date(iso).getTime() - now.getTime();
  if (Number.isNaN(diff)) {
    return null;
  }
  const days = Math.floor(diff / DAY_MS);
  if (days <= 0) {
    return 'hoje';
  }
  return days === 1 ? 'em 1 dia' : `em ${days} dias`;
}

export type DesiredWindowTiming = {
  text: string;
  tone: 'past' | 'today' | 'soon' | 'future';
};

/** Descreve a janela desejada como fato temporal — sem prazo contratado. */
export function describeDesiredWindowTiming(
  desiredStartAt: string | null,
  now: Date = new Date(),
): DesiredWindowTiming | null {
  if (!desiredStartAt) {
    return null;
  }
  const start = new Date(desiredStartAt);
  if (Number.isNaN(start.getTime())) {
    return null;
  }
  const todayStart = startOfDay(now);
  const startDay = startOfDay(start);
  const dayDiff = Math.round((startDay - todayStart) / DAY_MS);

  if (dayDiff < 0) {
    const days = Math.abs(dayDiff);
    return {
      text: days === 1 ? 'início desejado passou há 1 dia' : `início desejado passou há ${days} dias`,
      tone: 'past',
    };
  }
  if (dayDiff === 0) {
    return { text: 'início desejado é hoje', tone: 'today' };
  }
  if (dayDiff <= 7) {
    return {
      text: dayDiff === 1 ? 'início desejado amanhã' : `início desejado em ${dayDiff} dias`,
      tone: 'soon',
    };
  }
  return {
    text: `início desejado em ${dayDiff} dias`,
    tone: 'future',
  };
}

export function formatDesiredWindow(
  desiredStartAt: string | null,
  desiredEndAt: string | null,
): string {
  if (!desiredStartAt && !desiredEndAt) {
    return 'Período não informado';
  }
  if (desiredStartAt && desiredEndAt) {
    return `${formatDateTime(desiredStartAt)} — ${formatDateTime(desiredEndAt)}`;
  }
  if (desiredStartAt) {
    return `A partir de ${formatDateTime(desiredStartAt)}`;
  }
  return `Até ${formatDateTime(desiredEndAt)}`;
}

export type ServiceRequestAttentionFact = {
  code: string;
  text: string;
  tone: 'critical' | 'warning' | 'info';
};

/**
 * Fatos que exigem atenção. Somente o que é derivável dos dados existentes: prioridade declarada,
 * posição no tempo da janela desejada e ausência de dados. Não existe juízo de atraso/SLA.
 */
export function describeServiceRequestAttention(
  request: Pick<
    ServiceRequest,
    'priority' | 'desiredStartAt' | 'desiredEndAt' | 'clientId' | 'status'
  >,
  now: Date = new Date(),
): ServiceRequestAttentionFact[] {
  const facts: ServiceRequestAttentionFact[] = [];

  if (request.priority === SERVICE_REQUEST_PRIORITIES.Urgent) {
    facts.push({ code: 'PRIORITY_URGENT', text: 'Prioridade urgente', tone: 'critical' });
  } else if (request.priority === SERVICE_REQUEST_PRIORITIES.High) {
    facts.push({ code: 'PRIORITY_HIGH', text: 'Prioridade alta', tone: 'warning' });
  }

  const timing = describeDesiredWindowTiming(request.desiredStartAt, now);
  if (timing?.tone === 'past') {
    facts.push({ code: 'DESIRED_START_PAST', text: timing.text, tone: 'critical' });
  } else if (timing?.tone === 'today') {
    facts.push({ code: 'DESIRED_START_TODAY', text: timing.text, tone: 'warning' });
  } else if (timing?.tone === 'soon') {
    facts.push({ code: 'DESIRED_START_SOON', text: timing.text, tone: 'info' });
  }

  if (!request.desiredStartAt && !request.desiredEndAt) {
    facts.push({
      code: 'DESIRED_WINDOW_MISSING',
      text: 'Período desejado não informado',
      tone: 'info',
    });
  }

  if (!request.clientId && request.status !== SERVICE_REQUEST_STATUSES.Rejected) {
    facts.push({ code: 'CLIENT_UNIDENTIFIED', text: 'Cliente não identificado', tone: 'warning' });
  }

  return facts;
}

export type TemporalContextEntry = {
  label: string;
  value: string;
  relative: string | null;
};

/** Linha do tempo factual da solicitação: cada entrada vem de um timestamp real persistido. */
export function describeServiceRequestTemporalContext(
  request: Pick<
    ServiceRequest,
    | 'createdAt'
    | 'submittedAt'
    | 'reviewStartedAt'
    | 'approvedAt'
    | 'rejectedAt'
    | 'cancelledAt'
    | 'convertedAt'
    | 'desiredStartAt'
    | 'desiredEndAt'
  >,
  now: Date = new Date(),
): TemporalContextEntry[] {
  const entries: Array<{ label: string; iso: string | null }> = [
    { label: 'Criada', iso: request.createdAt },
    { label: 'Enviada', iso: request.submittedAt },
    { label: 'Em análise desde', iso: request.reviewStartedAt },
    { label: 'Aprovada', iso: request.approvedAt },
    { label: 'Rejeitada', iso: request.rejectedAt },
    { label: 'Cancelada', iso: request.cancelledAt },
    { label: 'Convertida', iso: request.convertedAt },
  ];

  const result: TemporalContextEntry[] = entries
    .filter((entry) => Boolean(entry.iso))
    .map((entry) => ({
      label: entry.label,
      value: formatDateTime(entry.iso),
      relative: formatRelativePast(entry.iso, now),
    }));

  if (request.desiredStartAt || request.desiredEndAt) {
    result.push({
      label: 'Janela desejada',
      value: formatDesiredWindow(request.desiredStartAt, request.desiredEndAt),
      relative: describeDesiredWindowTiming(request.desiredStartAt, now)?.text ?? null,
    });
  }

  return result;
}

export const EMPTY_REQUEST_SUMMARY = 'Sem descrição registrada';

export function summarizeServiceRequestDescription(
  description: string | null,
  maxLength = 160,
): string {
  const text = description?.trim();
  if (!text) {
    return EMPTY_REQUEST_SUMMARY;
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

export function describePriority(priority: ServiceRequestPriority | null): string {
  return formatServiceRequestPriority(priority);
}
