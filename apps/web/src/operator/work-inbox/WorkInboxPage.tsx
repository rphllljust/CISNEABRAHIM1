import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertApiError, getAlerts } from '../../alerts/api/alerts-api';
import { DateTime } from '../../ui/DateTime';
import { ModulePage, ModulePageHeader } from '../../ui/module-layout';
import { cn } from '../../ui/utils/cn';
import {
  buildWorkInbox,
  countByArea,
  WORK_AREAS,
  type WorkAreaId,
  type WorkInboxItem,
} from './work-inbox';

/**
 * MINHAS PENDÊNCIAS — superficie para COMECAR O DIA.
 *
 * Nao e "mais um painel de alertas": e a fila de trabalho. Cada linha responde
 * tipo, referencia humana, situacao, prioridade derivada, tempo parado,
 * responsavel quando existir, proxima acao e link direto.
 *
 * Fluidez: mantem o conteudo anterior durante o refresh (nao troca a tela por
 * spinner), nao perde o filtro de area aplicado e nao faz prefetch de nada que
 * o operador ainda nao esteja autorizado a ver — a unica leitura e a lista de
 * alertas, que ja tem sua propria autorizacao no backend.
 */

type InboxState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'ready'; items: Awaited<ReturnType<typeof getAlerts>> }
  | { phase: 'error'; message: string; partial?: Awaited<ReturnType<typeof getAlerts>> };

const POLL_INTERVAL_MS = 60_000;

export function WorkInboxPage() {
  const [state, setState] = useState<InboxState>({ phase: 'loading' });
  const [areaFilter, setAreaFilter] = useState<WorkAreaId | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const items = await getAlerts({ status: 'ACTIVE' }, signal);
      setState({ phase: 'ready', items });
    } catch (error) {
      if (error instanceof AlertApiError && error.kind === 'denied') {
        setState({ phase: 'denied' });
        return;
      }
      setState((previous) => ({
        phase: 'error',
        message:
          error instanceof AlertApiError && error.kind === 'network'
            ? 'Não foi possível carregar suas pendências.'
            : 'Falha ao carregar suas pendências.',
        partial: previous.phase === 'ready' ? previous.items : undefined,
      }));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = window.setInterval(() => {
      void load(controller.signal);
    }, POLL_INTERVAL_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [load]);

  const items =
    state.phase === 'ready'
      ? state.items
      : state.phase === 'error'
        ? (state.partial ?? [])
        : [];

  const groups = useMemo(
    () => buildWorkInbox({ alerts: items, area: areaFilter }),
    [items, areaFilter],
  );
  const counts = useMemo(() => countByArea(buildWorkInbox({ alerts: items })), [items]);
  const total = items.length;

  if (state.phase === 'loading' && items.length === 0) {
    return (
      <ModulePage>
        <ModulePageHeader
          title="Minhas pendências"
          description="Carregando a fila de trabalho derivada de estados reais…"
        />
      </ModulePage>
    );
  }

  if (state.phase === 'denied') {
    return (
      <ModulePage>
        <ModulePageHeader title="Minhas pendências" />
        <p role="alert" className="text-sm text-gray-700">
          Você não tem permissão para visualizar alertas operacionais, que são a origem desta fila.
        </p>
      </ModulePage>
    );
  }

  return (
    <ModulePage>
      <ModulePageHeader
        title="Minhas pendências"
        description="Fila de trabalho derivada apenas de estados reais persistidos. Nenhuma tarefa é criada por heurística."
      />

      {state.phase === 'error' ? (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span role="alert">{state.message}</span>
          {items.length > 0 ? ' Exibindo os últimos dados carregados.' : null}
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => void load()}
          >
            Tentar novamente
          </button>
        </div>
      ) : null}

      <nav className="mb-3 flex flex-wrap items-center gap-1.5" aria-label="Filtrar por área">
        <AreaChip
          label={`Todas as áreas (${total})`}
          active={areaFilter === null}
          onClick={() => setAreaFilter(null)}
        />
        {WORK_AREAS.map((area) => (
          <AreaChip
            key={area.id}
            label={`${area.label} (${counts[area.id]})`}
            active={areaFilter === area.id}
            muted={counts[area.id] === 0}
            onClick={() => setAreaFilter(area.id)}
          />
        ))}
      </nav>

      {total === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center">
          <p className="text-sm font-medium text-gray-800">Nada pendente agora.</p>
          <p className="mx-auto mt-1 max-w-xl text-xs text-gray-500">
            Não há pendência operacional ativa derivada dos estados persistidos. As áreas Fiscal,
            Contábil e Comercial ainda não possuem feed de pendência nesta superfície — consulte as
            listas desses módulos.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <AreaSection key={group.area.id} group={group} />
          ))}
        </div>
      )}
    </ModulePage>
  );
}

function AreaChip({
  label,
  active,
  muted = false,
  onClick,
}: {
  label: string;
  active: boolean;
  muted?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-brand-600 bg-brand-600 text-white'
          : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50',
        muted && !active ? 'opacity-60' : '',
      )}
    >
      {label}
    </button>
  );
}

function AreaSection({
  group,
}: {
  group: { area: { id: WorkAreaId; label: string; source: 'alerts' | 'none'; missingSourceReason?: string }; items: WorkInboxItem[] };
}) {
  return (
    <section aria-label={group.area.label} className="rounded-lg border border-gray-200 bg-white">
      <header className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
        <h2 className="text-sm font-semibold text-gray-900">{group.area.label}</h2>
        <span className="text-xs text-gray-500 tabular-nums">
          {group.items.length} {group.items.length === 1 ? 'pendência' : 'pendências'}
        </span>
      </header>

      {group.area.source === 'none' ? (
        <p className="px-4 py-3 text-xs text-gray-500">{group.area.missingSourceReason}</p>
      ) : group.items.length === 0 ? (
        <p className="px-4 py-3 text-xs text-gray-500">
          Nenhuma pendência ativa nesta área no momento.
        </p>
      ) : (
        <ul className="m-0 list-none divide-y divide-gray-100 p-0">
          {group.items.map((item) => (
            <li key={item.id} className="px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-gray-900">{item.reference}</p>
                  <p className="mt-0.5 text-xs text-gray-600">{item.situation}</p>
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold',
                    item.severity === 'CRITICAL'
                      ? 'bg-red-50 text-red-800'
                      : 'bg-amber-50 text-amber-800',
                  )}
                >
                  {item.priorityLabel} (derivada)
                </span>
              </div>

              <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
                <div className="flex gap-1">
                  <dt>Tipo:</dt>
                  <dd className="m-0 font-medium text-gray-700">{item.kindLabel}</dd>
                </div>
                <div className="flex gap-1">
                  <dt>Parado há:</dt>
                  <dd className="m-0 font-medium text-gray-700 tabular-nums">
                    {item.stalledLabel}
                  </dd>
                </div>
                <div className="flex gap-1">
                  <dt>Desde:</dt>
                  <dd className="m-0 font-medium text-gray-700">
                    <DateTime value={item.stalledSince} mode="datetime" />
                  </dd>
                </div>
              </dl>

              <div className="mt-2 flex flex-wrap items-center gap-3">
                <p className="text-xs text-gray-700">
                  <span className="text-gray-500">Próxima ação: </span>
                  {item.nextAction}
                </p>
                <Link
                  to={item.href}
                  className="rounded-md border border-brand-600 bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white no-underline hover:bg-brand-700"
                >
                  Abrir registro
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
