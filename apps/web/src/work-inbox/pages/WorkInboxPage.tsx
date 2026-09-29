import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ContextDrawer } from '../../operator';
import { Button } from '../../ui/Button';
import { ModulePage } from '../../ui/module-layout';
import { cn } from '../../ui/utils/cn';
import {
  WORK_DOMAIN_LABELS,
  WORK_DOMAINS,
  WORK_KIND_LABELS,
  WORK_KINDS,
  WorkInboxApiError,
  getWorkInbox,
  type WorkDomain,
  type WorkInboxPage,
  type WorkItem,
  type WorkKind,
} from '../api/work-inbox-api';

/**
 * UNIFIED WORK INBOX — fila de trabalho real de todo o ERP.
 *
 * Nao e dashboard: e fila. Cada linha responde o que aconteceu, por que exige atencao,
 * qual e o objeto, quando, qual a acao e para onde ir.
 *
 * - FILTROS SÃO URL-DRIVEN: o recorte vive na URL, entao recarregar, voltar e compartilhar
 *   o link preservam a fila. O contador por dominio e o proprio filtro: clicar em
 *   "Financeiro 4" aplica `domain=FINANCEIRO`, que e exatamente o que o servidor contou.
 * - CONTEXT DRAWER: selecionar a linha mostra contexto suficiente sem sair da fila.
 * - ACAO: navegar para o objeto. A Inbox nao executa transicao sensivel.
 */

const DEFAULT_LIMIT = 25;

function parseDomain(value: string | null): WorkDomain | null {
  return WORK_DOMAINS.find((candidate) => candidate === value) ?? null;
}

function parseKind(value: string | null): WorkKind | null {
  return WORK_KINDS.find((candidate) => candidate === value) ?? null;
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

/**
 * Dias de atraso a partir do `dueAt` PERSISTIDO.
 *
 * Nao ha score, prioridade nem criticidade inventada: a unica excecao afirmada aqui
 * e a que o proprio dado sustenta — o item tem vencimento e ele ja passou. Sem
 * `dueAt`, nao ha atraso a declarar.
 */
export function daysOverdue(dueAt: string | null, now: Date = new Date()): number | null {
  if (!dueAt) {
    return null;
  }
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) {
    return null;
  }
  const startOfDay = (value: Date) =>
    Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  const diffDays = Math.floor((startOfDay(now) - startOfDay(due)) / 86_400_000);
  return diffDays > 0 ? diffDays : null;
}

export function WorkInboxPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const domain = parseDomain(searchParams.get('domain'));
  const kind = parseKind(searchParams.get('kind'));
  const overdue = searchParams.get('overdue') === 'true';
  const unitId = searchParams.get('unitId');
  const offset = Number.parseInt(searchParams.get('offset') ?? '0', 10) || 0;

  const [page, setPage] = useState<WorkInboxPage | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<WorkItem | null>(null);

  const filters = useMemo(
    () => ({ domain, kind, overdue, unitId, limit: DEFAULT_LIMIT, offset }),
    [domain, kind, overdue, unitId, offset],
  );

  const updateParam = useCallback(
    (key: string, value: string | null) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (value) {
            next.set(key, value);
          } else {
            next.delete(key);
          }
          // Qualquer mudanca de recorte volta para a primeira pagina.
          if (key !== 'offset') {
            next.delete('offset');
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setPhase('loading');
      try {
        const result = await getWorkInbox(filters, signal);
        setPage(result);
        setPhase('ready');
      } catch (error) {
        if (error instanceof WorkInboxApiError && error.kind === 'denied') {
          setPhase('denied');
          return;
        }
        setErrorMessage(
          error instanceof WorkInboxApiError && error.kind === 'network'
            ? 'Não foi possível falar com o servidor. A fila pode estar incompleta.'
            : 'Não foi possível carregar a fila de trabalho.',
        );
        setPhase('error');
      }
    },
    [filters],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (phase === 'denied') {
    return (
      <ModulePage>
        <p role="alert" className="text-sm text-red-700">
          Você não tem permissão para ler a fila de trabalho.
        </p>
      </ModulePage>
    );
  }

  const items = page?.items ?? [];
  /*
   * EXCECOES DO RECORTE ATUAL — contadas do MESMO conjunto exibido, a partir do
   * vencimento persistido. Nao ha priorizacao inventada: "vencido" e um fato do dado.
   */
  const overdueItems = items.filter((item) => daysOverdue(item.dueAt) !== null);

  return (
    <ModulePage>
      <header className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="m-0 text-lg font-semibold text-gray-900">Central de trabalho</h1>
          <p className="m-0 text-xs text-gray-500">
            O que exige atenção agora, de todos os domínios — somente trabalho real.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {overdueItems.length > 0 ? (
            <button
              type="button"
              onClick={() => updateParam('overdue', overdue ? null : 'true')}
              aria-pressed={overdue}
              className="rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 ring-1 ring-red-500/20 ring-inset hover:bg-red-100"
            >
              {overdueItems.length} vencido{overdueItems.length === 1 ? '' : 's'} neste recorte
            </button>
          ) : null}
          <Button type="button" variant="secondary" onClick={() => void load()}>
            Atualizar
          </Button>
        </div>
      </header>

      {page && page.unavailableDomains.length > 0 ? (
        <p
          role="status"
          className="mb-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-500/20 ring-inset"
        >
          Fila incompleta: {page.unavailableDomains.join(', ')} não respondeu nesta leitura. Os
          demais domínios estão completos.
        </p>
      ) : null}

      {/* AGORA — contagem real por dominio, do MESMO conjunto que a fila exibe. Clicar aplica
          exatamente o recorte contado (sem repetir o bug de filtro silenciosamente ignorado). */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => updateParam('domain', null)}
          aria-pressed={domain === null}
          className={cn(
            'rounded px-2 py-1 text-xs ring-1 ring-inset',
            domain === null
              ? 'bg-brand-600 font-semibold text-white ring-brand-600'
              : 'bg-white text-gray-700 ring-gray-300 hover:bg-gray-50',
          )}
        >
          Todos {page ? page.total : 0}
        </button>
        {WORK_DOMAINS.map((candidate) => {
          const count = page?.byDomain[candidate] ?? 0;
          const isActive = domain === candidate;
          return (
            <button
              key={candidate}
              type="button"
              onClick={() => updateParam('domain', isActive ? null : candidate)}
              aria-pressed={isActive}
              data-domain={candidate}
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
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1.5">
          <span className="text-gray-500">Natureza</span>
          <select
            aria-label="Natureza"
            value={kind ?? ''}
            onChange={(event) => updateParam('kind', event.target.value || null)}
            className="rounded-md border-0 bg-white py-1 px-2 text-xs ring-1 ring-gray-300 ring-inset"
          >
            <option value="">Todas</option>
            {WORK_KINDS.map((candidate) => (
              <option key={candidate} value={candidate}>
                {WORK_KIND_LABELS[candidate]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={overdue}
            onChange={(event) => updateParam('overdue', event.target.checked ? 'true' : null)}
          />
          <span className="text-gray-700">Somente vencidos</span>
        </label>

        <label className="flex items-center gap-1.5">
          <span className="text-gray-500">Unidade</span>
          <input
            aria-label="Unidade"
            value={unitId ?? ''}
            onChange={(event) => updateParam('unitId', event.target.value || null)}
            placeholder="código da unidade"
            className="w-40 rounded-md border-0 bg-white py-1 px-2 text-xs ring-1 ring-gray-300 ring-inset"
          />
        </label>
      </div>

      {phase === 'loading' ? (
        <p aria-busy="true" aria-live="polite" className="text-sm text-gray-500">
          Carregando a fila de trabalho…
        </p>
      ) : null}

      {phase === 'error' ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-500/20 ring-inset">
          {errorMessage}
        </p>
      ) : null}

      {phase === 'ready' && items.length === 0 ? (
        <p className="rounded-md bg-white px-4 py-6 text-sm text-gray-600 ring-1 ring-gray-900/5">
          Nenhum trabalho real neste recorte. A fila não inventa pendência para parecer cheia.
        </p>
      ) : null}

      {items.length > 0 ? (
        <div className="overflow-x-auto rounded-lg bg-white shadow-sm ring-1 ring-gray-900/5">
          <table className="w-full divide-y divide-gray-200">
            <thead className="bg-gray-50/60">
              <tr>
                <th className="px-3 py-2 text-left text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
                  Objeto
                </th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
                  Motivo
                </th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
                  Vencimento
                </th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
                  Ação
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item) => {
                const late = daysOverdue(item.dueAt);
                return (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 align-top">
                    <button
                      type="button"
                      onClick={() => setSelected(item)}
                      className="text-left text-sm font-semibold text-brand-700 hover:text-brand-800"
                    >
                      {item.businessReference}
                    </button>
                    <p className="m-0 text-[11px] text-gray-500">
                      {WORK_DOMAIN_LABELS[item.domain]} · {WORK_KIND_LABELS[item.kind]}
                    </p>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <p className="m-0 text-[13px] text-gray-800">{item.title}</p>
                    <p className="m-0 text-[11px] text-gray-500">{item.reason}</p>
                    {item.contextLabel ? (
                      <p className="m-0 text-[11px] text-gray-500">{item.contextLabel}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 align-top text-[12px] text-gray-700 tabular-nums">
                    {/* A excecao fica VISIVEL na fila, nao escondida dentro da tabela. */}
                    {late !== null ? (
                      <span className="inline-flex items-center rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-700 ring-1 ring-red-500/20 ring-inset">
                        {late} dia{late === 1 ? '' : 's'} em atraso
                      </span>
                    ) : (
                      formatMoment(item.dueAt)
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Link
                      to={item.targetRoute}
                      className="text-xs font-semibold text-brand-700 no-underline hover:text-brand-800"
                    >
                      {item.actionLabel}
                    </Link>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {page && page.totalPages > 1 ? (
        <div className="mt-2 flex items-center justify-between text-xs text-gray-600">
          <span>
            {page.offset + 1}–{Math.min(page.offset + page.limit, page.total)} de {page.total}
          </span>
          <span className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={page.offset === 0}
              onClick={() => updateParam('offset', String(Math.max(0, page.offset - page.limit)))}
            >
              Anterior
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={page.offset + page.limit >= page.total}
              onClick={() => updateParam('offset', String(page.offset + page.limit))}
            >
              Próxima
            </Button>
          </span>
        </div>
      ) : null}

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
                  { label: 'Unidade', value: selected.unitId ?? '—' },
                ],
                nextAction: {
                  label: selected.actionLabel,
                  onClick: () => {
                    setSelected(null);
                    void navigate(selected.targetRoute);
                  },
                  kind: 'primary',
                },
              }
            : null
        }
      />
    </ModulePage>
  );
}
