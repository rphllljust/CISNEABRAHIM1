import { formatDateTime, formatRegisteredBy } from '../utils/proposal-labels';
import type { ProposalTimelineEntry } from '../utils/proposal-workbench';

type ProposalCommercialTimelineProps = {
  entries: ProposalTimelineEntry[];
  currentIdentityId?: string | null;
};

/**
 * Linha do tempo comercial.
 *
 * Cada entrada e um timestamp REAL persistido na proposta ou nas suas revisoes. O dominio nao
 * guarda nome de pessoa; o ator aparece com o rotulo neutro ja usado no modulo, sem inventar
 * identidade.
 */
export function ProposalCommercialTimeline({
  entries,
  currentIdentityId = null,
}: ProposalCommercialTimelineProps) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-gray-500" role="status">
        Nenhum evento comercial registrado para esta proposta.
      </p>
    );
  }

  return (
    <ol className="planning-timeline" aria-live="polite">
      {entries.map((entry) => (
        <li key={entry.id} className="planning-timeline__item">
          <time className="planning-timeline__time" dateTime={entry.occurredAt}>
            {formatDateTime(entry.occurredAt)}
          </time>
          <p className="planning-timeline__label">{entry.label}</p>
          {entry.detail ? <p className="planning-timeline__detail">{entry.detail}</p> : null}
          {entry.actorIdentityId ? (
            <p className="planning-timeline__detail text-gray-500">
              {formatRegisteredBy(entry.actorIdentityId, currentIdentityId)}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
