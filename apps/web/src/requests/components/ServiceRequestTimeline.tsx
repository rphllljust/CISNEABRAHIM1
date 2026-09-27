import type { ServiceRequestHistoryEvent } from '../types/service-request.types';
import {
  formatDateTime,
  formatRegisteredBy,
  formatServiceRequestHistoryEventDetail,
  formatServiceRequestHistoryEventLabel,
} from '../utils/service-request-labels';

type ServiceRequestTimelineProps = {
  events: ServiceRequestHistoryEvent[];
  currentIdentityId?: string | null;
};

/**
 * Linha do tempo do ciclo de vida da solicitacao.
 *
 * Os eventos vem de `sr.service_request_history_events` — a UI apenas os apresenta em ordem
 * cronologica e nomeia o ator com o rotulo neutro ja existente no modulo (o dominio nao guarda
 * nome de pessoa; inventar um nome seria criar dado sem fonte).
 */
export function ServiceRequestTimeline({ events, currentIdentityId = null }: ServiceRequestTimelineProps) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-gray-500" role="status">
        Nenhum evento registrado para esta solicitação.
      </p>
    );
  }

  const ordered = [...events].sort(
    (left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt),
  );

  return (
    <ol className="planning-timeline" aria-live="polite">
      {ordered.map((event) => {
        const detail = formatServiceRequestHistoryEventDetail(event);
        return (
          <li key={event.id} className="planning-timeline__item">
            <time className="planning-timeline__time" dateTime={event.occurredAt}>
              {formatDateTime(event.occurredAt)}
            </time>
            <p className="planning-timeline__label">
              {formatServiceRequestHistoryEventLabel(event.eventType)}
            </p>
            {detail ? <p className="planning-timeline__detail">{detail}</p> : null}
            {event.actorIdentityId ? (
              <p className="planning-timeline__detail text-gray-500">
                {formatRegisteredBy(event.actorIdentityId, currentIdentityId)}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
