import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ContextDrawer } from '../../operator';
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
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState<WorkInboxPage | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [selected, setSelected] = useState<WorkItem | null>(null);

  // Filtros reais da API de work-inbox, endereçados na URL da própria seção.
  const domain = parseDomain(searchParams.get('inboxDomain'));
  const overdue = searchParams.get('inboxOverdue') === 'true';

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

      <WorkbenchQueue
        title="Minha fila"
        count={page?.total ?? null}
        description="Trabalho real autorizado, de todos os domínios. Selecione um item para ver contexto sem sair do painel."
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

      <ContextDrawer
        open={selected !== null}
        title="Contexto do trabalho"
        onClose={() => setSelected(null)}
        preview={
          selected
            ? {
                identifier: selected.businessReference,
                subtitle: selected.title,
                facts: [
                  { label: 'Domínio', value: WORK_DOMAIN_LABELS[selected.domain] },
                  { label: 'Natureza', value: WORK_KIND_LABELS[selected.kind] },
                  { label: 'Situação', value: selected.status },
                  { label: 'Motivo', value: selected.reason },
                  { label: 'Contexto', value: selected.contextLabel || '—' },
                  { label: 'Vencimento', value: formatMoment(selected.dueAt) },
                  {
                    label: 'Exceção',
                    value:
                      daysOverdue(selected.dueAt) !== null
                        ? `${daysOverdue(selected.dueAt)} dia(s) em atraso`
                        : null,
                  },
                ],
                nextAction: {
                  label: selected.actionLabel,
                  onClick: () => {
                    setSelected(null);
                    void navigate(selected.targetRoute);
                  },
                  kind: 'primary',
                },
                detailHref: selected.targetRoute,
                detailLabel: 'Abrir na tela de origem',
              }
            : null
        }
      />
    </>
  );
}
