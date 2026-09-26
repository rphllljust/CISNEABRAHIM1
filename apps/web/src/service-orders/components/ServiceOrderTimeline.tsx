import type { ServiceOrderHistoryEvent } from '../types/service-order.types';
import {
  formatDateTime,
  formatServiceOrderHistoryEventDetail,
  formatServiceOrderHistoryEventLabel,
} from '../utils/service-order-labels';

type ServiceOrderTimelineProps = {
  events: ServiceOrderHistoryEvent[];
};

/**
 * Linha do tempo do ciclo de vida da OS. Inclui a fase de programacao
 * (planejamento e despacho) porque o backend registra esses eventos no mesmo
 * fluxo de historico do agregado. A UI apenas representa o estado registrado.
 */
export function ServiceOrderTimeline({ events }: ServiceOrderTimelineProps) {
  if (events.length === 0) {
    return (
      <p className="planning-empty" role="status">
        Nenhum evento registrado para esta ordem.
      </p>
    );
  }

  const ordered = [...events].sort(
    (left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt),
  );

  return (
    <ol className="planning-timeline" aria-live="polite">
      {ordered.map((event) => {
        const detail = formatServiceOrderHistoryEventDetail(event);
        return (
          <li key={event.id} className="planning-timeline__item">
            <time className="planning-timeline__time" dateTime={event.occurredAt}>
              {formatDateTime(event.occurredAt)}
            </time>
            <p className="planning-timeline__label">
              {formatServiceOrderHistoryEventLabel(event.eventType)}
            </p>
            {detail ? <p className="planning-timeline__detail">{detail}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}
