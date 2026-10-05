import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SavedViewsBar, useSavedViews } from '../../operator';
import {
  WorkbenchQueue,
  WorkbenchQueueItem,
  workbenchPrimaryActionClass,
} from '../../ui/workbench';
import { WorklistException } from '../../ui/enterprise-list';
import {
  WORK_DOMAIN_LABELS,
  WORK_DOMAINS,
  WORK_KIND_LABELS,
  getWorkInbox,
  type WorkInboxPage,
  type WorkItem,
  type WorkDomain,
} from '../../work-inbox/api/work-inbox-api';
import { daysOverdue } from '../../work-inbox/pages/WorkInboxPage';
import { cn } from '../../ui/utils/cn';

/**
 * MINHA FILA — fila de trabalho real do ERP, composta DENTRO do Command Center.
 *
 * Consome o MESMO read model `GET /work-inbox` (server-side filtering real: `domain` e
 * `overdue`). Os filtros vivem na URL da seção para o recorte sobreviver a reload/voltar e a
 * seleção persistir enquanto o operador percorre a fila — sem sair do painel para recortar.
 * Atraso vem do `dueAt` persistido; ausência de `dueAt` não é atraso.
 */

const DEFAULT_LIMIT = 8;

const SCOPE = 'dashboard.inbox';

/** Allow-list dos filtros reais da work-inbox que esta secao pode persistir. */
const INBOX_ALLOWED_FILTERS = {
  filters: {
    domain: [...WORK_DOMAINS] as readonly string[],
    overdue: ['true'] as readonly string[],
  },
} as const;

function parseDomain(value: string | null): WorkDomain | null {
  return WORK_DOMAINS.find((candidate) => candidate === value) ?? null;
}

function formatMoment(value: string | null): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleDateString('pt-BR');
}

export function WorkInboxSection() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState<WorkInboxPage | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [selected, setSelected] = useState<WorkItem | null>(null);

  // Filtros reais da API de work-inbox, endereçados na URL da própria seção.
  const domain = parseDomain(searchParams.get('inboxDomain'));
  const overdue = searchParams.get('inboxOverdue') === 'true';

  // SAVED VIEWS — reutiliza a infraestrutura existente (`useSavedViews`, permitindo persistir
  // o recorte enumerado `domain`/`overdue`; nada de texto livre nem dado de registro).
  const savedViews = useSavedViews(SCOPE, [], INBOX_ALLOWED_FILTERS);

  const filters = useMemo(
    () => ({ domain, overdue, limit: DEFAULT_LIMIT, offset: 0 }),
    [domain, overdue],
  );

  const updateParam = (key: string, value: string | null) => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) {
          next.set(key, value);
        } else {
          next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
  };

  const applyView = (config: { filters: Record<string, string> }) => {
    updateParam('inboxDomain', config.filters.domain ?? null);
    updateParam('inboxOverdue', config.filters.overdue ?? null);
  };

  useEffect(() => {
    setSelected(null);
    const controller = new AbortController();
    void getWorkInbox(filters, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setPage(result);
          setPhase('ready');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setPhase('error');
        }
      });
    return () => controller.abort();
  }, [filters]);

  // AUTO-SELECAO: o Command Center abre já com trabalho + contexto, para o operador entrar
  // processando. Só seleciona o primeiro item quando a fila muda e nada ainda está selecionado.
  useEffect(() => {
    const first = page?.items[0] ?? null;
    if (first && (selected === null || !page!.items.some((item) => item.id === selected.id))) {
      setSelected(first);
    }
  }, [page, selected]);

  const items = page?.items ?? [];

  if (phase === 'denied' || phase === 'error') {
    return null;
  }

  return (
    <>
      {/* RECORTE SERVER-SIDE: os mesmos dois filtros de maior alavancagem do work-inbox,
          endereçados na URL. Não filtrar localmente página parcial. */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => updateParam('inboxDomain', null)}
          aria-pressed={domain === null}
          className={cn(
            'rounded px-2 py-1 text-xs ring-1 ring-inset',
            domain === null
              ? 'bg-brand-600 font-semibold text-white ring-brand-600'
              : 'bg-white text-gray-700 ring-gray-300 hover:bg-gray-50',
          )}
        >
          Todos
        </button>
        {WORK_DOMAINS.map((candidate) => {
          const count = page?.byDomain[candidate] ?? 0;
          const isActive = domain === candidate;
          return (
            <button
              key={candidate}
              type="button"
              onClick={() => updateParam('inboxDomain', isActive ? null : candidate)}
              aria-pressed={isActive}
              className={cn(
                'rounded px-2 py-1 text-xs ring-1 ring-inset',
                isActive
                  ? 'bg-brand-600 font-semibold text-white ring-brand-600'
                  : count === 0
                    ? 'bg-white text-gray-400 ring-gray-200'
                    : 'bg-white text-gray-700 ring-gray-300 hover:bg-gray-50',
              )}
            >
              {WORK_DOMAIN_LABELS[candidate]} {count}
            </button>
          );
        })}
        <label className="ml-1 flex items-center gap-1.5 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={overdue}
            onChange={(event) => updateParam('inboxOverdue', event.target.checked ? 'true' : null)}
          />
          Somente vencidos
        </label>
      </div>

      <SavedViewsBar
        views={savedViews.views}
        builtInViews={[]}
        activeViewId={null}
        onApply={(view) => applyView(view.config)}
        onSave={(name) =>
          savedViews.saveView(name, {
            filters: {
              ...(domain ? { domain } : {}),
              ...(overdue ? { overdue: 'true' } : {}),
            },
            sortKey: null,
            sortDirection: 'asc',
            groupKey: null,
          })
        }
        onRename={savedViews.renameView}
        onRemove={savedViews.removeView}
        currentConfig={{
          filters: {
            ...(domain ? { domain } : {}),
            ...(overdue ? { overdue: 'true' } : {}),
          },
          sortKey: null,
          sortDirection: 'asc',
          groupKey: null,
        }}
        canSave={Boolean(domain || overdue)}
        allLabel="Tudo"
        className="mb-2"
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        {/* COLUNA ESQUERDA — a fila dominante. */}
        <div className="min-w-0">
          <WorkbenchQueue
            title="Minha fila"
            count={page?.total ?? null}
            description="Trabalho real autorizado, de todos os domínios. Selecione um item; o contexto aparece ao lado."
            emptyTitle="Nenhum trabalho real neste recorte."
            emptyDescription="A fila não inventa pendência para parecer cheia."
            action={
              <Link className="text-xs font-semibold text-brand-700 no-underline hover:text-brand-800" to="/app/work-inbox">
                Ver fila completa
              </Link>
            }
          >
            {items.map((item) => {
              const late = daysOverdue(item.dueAt);
              const isSelected = selected?.id === item.id;
              return (
                <WorkbenchQueueItem
                  key={item.id}
                  severityTone={late !== null ? 'critical' : 'info'}
                  severity={
                    late !== null ? (
                      <WorklistException tone="critical">
                        {late} dia{late === 1 ? '' : 's'}
                      </WorklistException>
                    ) : (
                      <WorklistException tone="info">{item.status}</WorklistException>
                    )
                  }
                  title={item.title}
                  reason={item.reason}
                  context={
                    <>
                      <button
                        type="button"
                        className={cn(
                          'text-xs font-semibold hover:text-brand-800',
                          isSelected ? 'text-brand-900 underline' : 'text-brand-700',
                        )}
                        onClick={() => setSelected(item)}
                      >
                        {item.businessReference}
                      </button>
                      <span className="ml-2 text-xs text-gray-500">
                        {WORK_DOMAIN_LABELS[item.domain]}
                      </span>
                    </>
                  }
                  age={<>Venc. {formatMoment(item.dueAt)}</>}
                  action={
                    <Link className={workbenchPrimaryActionClass} to={item.targetRoute}>
                      {item.actionLabel}
                    </Link>
                  }
                />
              );
            })}
          </WorkbenchQueue>
        </div>

        {/* COLUNA DIREITA — contexto do item selecionado, sticky no desktop (Infor business
            context: a seleção na fila atualiza o painel ao lado, sem navegação). */}
        <aside
          className="rounded-md border border-gray-200 bg-white p-3 lg:sticky lg:top-4 lg:self-start"
          aria-label="Contexto do item selecionado"
        >
          {selected ? (
            <div className="flex flex-col gap-3 text-sm">
              <header className="border-b border-gray-100 pb-2">
                <p className="text-sm font-semibold text-gray-900">{selected.businessReference}</p>
                <p className="mt-0.5 text-xs text-gray-500">{selected.title}</p>
                <div className="mt-2">
                  <WorklistException tone={daysOverdue(selected.dueAt) !== null ? 'critical' : 'info'}>
                    {selected.status}
                  </WorklistException>
                </div>
              </header>
              <dl className="m-0 grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-3 gap-y-2">
                <dt className="text-xs text-gray-500">Domínio</dt>
                <dd className="m-0 text-[13px] text-gray-800">{WORK_DOMAIN_LABELS[selected.domain]}</dd>
                <dt className="text-xs text-gray-500">Natureza</dt>
                <dd className="m-0 text-[13px] text-gray-800">{WORK_KIND_LABELS[selected.kind]}</dd>
                <dt className="text-xs text-gray-500">Motivo</dt>
                <dd className="m-0 text-[13px] text-gray-800">{selected.reason}</dd>
                <dt className="text-xs text-gray-500">Contexto</dt>
                <dd className="m-0 text-[13px] text-gray-800">{selected.contextLabel || '—'}</dd>
                <dt className="text-xs text-gray-500">Vencimento</dt>
                <dd className="m-0 text-[13px] text-gray-800 tabular-nums">{formatMoment(selected.dueAt)}</dd>
                <dt className="text-xs text-gray-500">Exceção</dt>
                <dd className="m-0 text-[13px] font-medium text-red-700">
                  {daysOverdue(selected.dueAt) !== null
                    ? `${daysOverdue(selected.dueAt)} dia(s) em atraso`
                    : '—'}
                </dd>
              </dl>
              <div className="mt-1 flex flex-col gap-2 border-t border-gray-100 pt-3">
                <Link
                  className="inline-flex items-center justify-center rounded-md border border-brand-600 bg-brand-600 px-3 py-2 text-xs font-semibold text-white no-underline hover:bg-brand-700"
                  to={selected.targetRoute}
                >
                  {selected.actionLabel}
                </Link>
                <Link
                  className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 no-underline hover:bg-gray-50"
                  to={selected.targetRoute}
                >
                  Abrir na tela de origem
                </Link>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">Selecione um item na fila.</p>
          )}
        </aside>
      </div>
    </>
  );
}
