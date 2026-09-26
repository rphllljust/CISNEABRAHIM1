import type { MeasurementHistoryEvent } from '../types/measurement.types';
import {
  formatMeasurementHistoryEventDetail,
  formatMeasurementHistoryEventLabel,
} from '../utils/measurement-history-labels';
import { formatDateTime } from '../utils/service-order-labels';

type MeasurementTimelineProps = {
  events: MeasurementHistoryEvent[];
};

/**
 * Trilha de decisao da medicao. O backend ja registra cada evento
 * (geracao, submissao, analise, aprovacao, rejeicao, reenvio, ajuste);
 * a UI apenas representa o que foi registrado.
 */
export function MeasurementTimeline({ events }: MeasurementTimelineProps) {
  if (events.length === 0) {
    return (
      <p className="measurement-hint" role="status">
        Nenhum evento registrado para esta medição.
      </p>
    );
  }

  const ordered = [...events].sort(
    (left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt),
  );

  return (
    <ol className="planning-timeline" aria-live="polite">
      {ordered.map((event) => {
        const detail = formatMeasurementHistoryEventDetail(event);
        return (
          <li key={event.id} className="planning-timeline__item">
            <time className="planning-timeline__time" dateTime={event.occurredAt}>
              {formatDateTime(event.occurredAt)}
            </time>
            <p className="planning-timeline__label">
              {formatMeasurementHistoryEventLabel(event.eventType)}
            </p>
            {detail ? <p className="planning-timeline__detail">{detail}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}
