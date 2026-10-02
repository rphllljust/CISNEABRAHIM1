import { useCallback, useEffect, useState } from 'react';
import {
  AuditTimelineApiError,
  defaultAuditTimelinePath,
  fetchAuditTimeline,
  type AuditTimelineEvent,
  type AuditTimelinePathResolver,
} from './audit-timeline-api';
import { t } from '../i18n';
import type { MetaEntitySchema } from './types';

/**
 * Timeline dirigida por metadados.
 *
 * Cada evento traz ESTADO ANTERIOR, ESTADO NOVO, COMANDO, AUTOR e QUANDO — a grade que o
 * backend grava em `audit.audit_logs`. A engine não interpreta domínio: ela desenha a
 * transição que aconteceu, com os rótulos de estado vindos de `meta.fields.options` quando o
 * campo de estado é um `select`.
 *
 * O caminho é resolvido por `resolvePath`, porque o contrato de timeline hoje é POR MÓDULO.
 */
export type DynamicTimelineProps = {
  schema: MetaEntitySchema;
  recordId: string;
  resolvePath?: AuditTimelinePathResolver;
  limit?: number;
};

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; eventos: AuditTimelineEvent[]; total: number }
  | { phase: 'denied' }
  | { phase: 'not_found' }
  | { phase: 'unsupported' }
  | { phase: 'error' };

export function DynamicTimeline({
  schema,
  recordId,
  resolvePath = defaultAuditTimelinePath,
  limit = 50,
}: DynamicTimelineProps): React.ReactElement {
  const path = resolvePath(schema.name, recordId);
  const [state, setState] = useState<State>(path ? { phase: 'loading' } : { phase: 'unsupported' });

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!path) {
        setState({ phase: 'unsupported' });
        return;
      }
      setState({ phase: 'loading' });
      try {
        const response = await fetchAuditTimeline(path, { limit }, signal);
        setState({ phase: 'ready', eventos: response.eventos, total: response.total });
      } catch (error) {
        if (error instanceof AuditTimelineApiError) {
          if (error.status === 403) {
            setState({ phase: 'denied' });
            return;
          }
          if (error.status === 404) {
            setState({ phase: 'not_found' });
            return;
          }
        }
        setState({ phase: 'error' });
      }
    },
    [path, limit],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (state.phase === 'unsupported') {
    return (
      <p className="text-sm text-gray-500" data-testid="dynamic-timeline-unsupported">
        Esta entidade não publica trilha de auditoria.
      </p>
    );
  }

  return (
    <section data-testid="dynamic-timeline" data-entity={schema.name}>
      <h2 className="mb-2 text-sm font-semibold">
        {t('timeline.title')}
        {state.phase === 'ready' ? (
          <span className="ml-2 text-xs font-normal text-gray-500">
            {state.total} {t('timeline.total')}
          </span>
        ) : null}
      </h2>

      {state.phase === 'loading' ? (
        <p className="text-sm text-gray-600" aria-busy="true">
          {t('common.loading')}
        </p>
      ) : null}

      {state.phase === 'denied' ? (
        <p className="text-sm text-red-700" role="alert">
          {t('common.denied')}
        </p>
      ) : null}

      {state.phase === 'not_found' ? (
        <p className="text-sm text-gray-500">{t('timeline.empty')}</p>
      ) : null}

      {state.phase === 'error' ? (
        <p className="text-sm text-red-700" role="alert">
          {t('common.error')}
        </p>
      ) : null}

      {state.phase === 'ready' && state.eventos.length === 0 ? (
        <p className="text-sm text-gray-500">{t('timeline.empty')}</p>
      ) : null}

      {state.phase === 'ready' && state.eventos.length > 0 ? (
        <ol className="relative m-0 list-none space-y-3 border-l border-gray-200 p-0 pl-4">
          {state.eventos.map((evento) => (
            <li key={evento.id} className="relative" data-testid="dynamic-timeline-event">
              <span
                className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-slate-400"
                aria-hidden="true"
              />
              <p className="text-sm">
                <StateTransition schema={schema} evento={evento} />
              </p>
              <p className="text-xs text-gray-500">
                <time dateTime={evento.data}>{formatMoment(evento.data)}</time>
                {' · '}
                {t('timeline.actor')} {evento.usuario_nome ?? t('timeline.system')}
                {evento.comando ? ` · ${evento.comando}` : ''}
              </p>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

/**
 * "RASCUNHO → PREPARADA" usando os RÓTULOS do metadado.
 *
 * Quando a entidade não declara o campo de estado como `select`, cai no valor cru — que é a
 * informação correta, apenas menos amigável. Nunca inventa rótulo.
 */
function StateTransition({
  schema,
  evento,
}: {
  schema: MetaEntitySchema;
  evento: AuditTimelineEvent;
}): React.ReactElement {
  const stateField = schema.workflow?.stateField ?? 'status';
  const label = (value: string): string => {
    const field = schema.fields.find((candidate) => candidate.name === stateField);
    const option = field?.options?.options?.find((candidate) => candidate.value === value);
    return option?.label ?? value;
  };

  if (evento.status_anterior && evento.status_novo) {
    return (
      <>
        <span className="text-gray-500">{label(evento.status_anterior)}</span>
        <span className="mx-1 text-gray-400">→</span>
        <span className="font-medium">{label(evento.status_novo)}</span>
      </>
    );
  }
  if (evento.status_novo) {
    return <span className="font-medium">{label(evento.status_novo)}</span>;
  }
  return <span className="font-medium">{evento.acao}</span>;
}

/** Data legível em pt-BR, sem dependência de biblioteca de datas. */
export function formatMoment(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
