import { DateTime } from '../../ui/DateTime';
import { cn } from '../../ui/utils/cn';

/**
 * ACTIVITY / HISTORY SURFACE — historico consistente, sem event store nova.
 *
 * Modelo: DATA/HORA · ATOR (quando disponivel) · EVENTO · ESTADO ANTERIOR · ESTADO NOVO · REFERENCIA.
 *
 * REGRA DE HONESTIDADE (vinculante):
 * - Este componente NAO cria evento, NAO deriva evento e NAO preenche lacuna.
 * - Se o modulo so persistiu timestamps, mostramos apenas o fato comprovavel
 *   (ex.: "Criado em", "Atualizado em") — nunca um evento de negocio que nao
 *   foi gravado.
 * - `actor` e `fromState`/`toState` sao opcionais: ausentes, nao aparecem.
 *   Nunca escrevemos "Sistema" ou "—" para suprir ator desconhecido.
 */

export type ActivityFact = {
  /** ISO 8601, como persistido. */
  at: string;
  /** Rotulo factual: "Criado", "Atualizado", "Emitido", "Liquidado". */
  event: string;
  actor?: string | null;
  fromState?: string | null;
  toState?: string | null;
  reference?: string | null;
};

export type ActivityTimelineProps = {
  facts: ActivityFact[];
  title?: string;
  emptyMessage?: string;
  className?: string;
};

export function ActivityTimeline({
  facts,
  title = 'Histórico',
  emptyMessage = 'Nenhum registro de histórico disponível para este item.',
  className,
}: ActivityTimelineProps) {
  // Ordenacao decrescente: o fato mais recente primeiro.
  const ordered = [...facts]
    .filter((fact) => Boolean(fact.at) && !Number.isNaN(new Date(fact.at).getTime()))
    .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());

  return (
    <section className={className} aria-label={title}>
      <h3 className="mb-2 text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
        {title}
      </h3>
      {ordered.length === 0 ? (
        <p className="text-xs text-gray-500">{emptyMessage}</p>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-0 p-0">
          {ordered.map((fact, index) => (
            <li
              key={`${fact.at}:${fact.event}:${index}`}
              className="relative border-l border-gray-200 pb-3 pl-4 last:pb-0"
            >
              <span
                aria-hidden
                className="absolute top-1.5 -left-[3px] h-1.5 w-1.5 rounded-full bg-gray-300"
              />
              <p className="text-[11px] text-gray-500">
                <DateTime value={fact.at} mode="datetime" />
                {fact.actor ? <span> · {fact.actor}</span> : null}
              </p>
              <p className="text-[13px] font-medium text-gray-800">{fact.event}</p>
              {fact.fromState || fact.toState ? (
                <p className="text-[11px] text-gray-600">
                  {fact.fromState ? <span className="text-gray-400">{fact.fromState} </span> : null}
                  {fact.fromState && fact.toState ? <span aria-hidden>→ </span> : null}
                  {fact.toState ? <span className="font-medium">{fact.toState}</span> : null}
                </p>
              ) : null}
              {fact.reference ? (
                <p className={cn('font-mono text-[10px] text-gray-400')}>{fact.reference}</p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * Extrai somente fatos de timestamp comprovaveis de um payload.
 * Usado por modulos que nao possuem trilha de eventos propria.
 */
export function timestampFacts(
  source: Record<string, unknown>,
  map: { field: string; event: string }[],
): ActivityFact[] {
  const facts: ActivityFact[] = [];
  for (const entry of map) {
    const value = source[entry.field];
    if (typeof value === 'string' && value.length > 0) {
      facts.push({ at: value, event: entry.event, reference: entry.field });
    }
  }
  return facts;
}
