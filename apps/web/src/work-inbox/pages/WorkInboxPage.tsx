import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useOptionalIdentityId } from '../../auth/context/AuthProvider';
import {
  DynamicContextDrawer,
  DynamicFilterBuilder,
  DynamicKpiDrilldown,
  DynamicSavedViewsBar,
  useSavedViews,
  type FilterGroup,
  type SavedView,
} from '../../engine';
import { Button } from '../../ui/Button';
import { ModulePage } from '../../ui/module-layout';
import {
  WorklistClearFilters,
  WorklistException,
  WorklistField,
  WorklistFilterBar,
  WorklistHeader,
  WorklistStatePanel,
  worklistControlClass,
  worklistSelectClass,
} from '../../ui/enterprise-list';
import {
  OperationalUnitOptions,
  operationalUnitLabel,
  useOperationalUnits,
} from '../../shell/hooks/useOperationalUnits';
import {
  WorkbenchMetric,
  WorkbenchQueue,
  WorkbenchQueueItem,
  WorkbenchSummaryStrip,
  workbenchPrimaryActionClass,
} from '../../ui/workbench';
import { cn } from '../../ui/utils/cn';
import type { MetaEntitySchema } from '../../engine/types';
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
 * Nao e dashboard: e fila. A caixa abre por uma FAIXA DE RESUMO com os numeros reais publicados
 * pelo servidor (total da fila, itens desta pagina e vencidos do recorte) e por uma FILA em que
 * cada item responde, na mesma ordem de elementos de todas as filas do produto: severidade ->
 * motivo (titulo) -> objeto (referencia humana) -> vencimento real -> proxima acao.
 *
 * Antes disso a fila era uma grade: a excecao operacional (atraso derivado do vencimento
 * PERSISTIDO) ficava escondida dentro de uma coluna de tabela. Agora ela e o primeiro elemento
 * lido na linha — sem score inventado e sem tarefa sintetica.
 *
 * - FILTROS SÃO URL-DRIVEN: o recorte vive na URL, entao recarregar, voltar e compartilhar
 *   o link preservam a fila. O contador por dominio e o proprio filtro: clicar em
 *   "Financeiro 4" aplica `domain=FINANCEIRO`, que e exatamente o que o servidor contou.
 * - CONTEXT DRAWER: selecionar a linha mostra contexto suficiente sem sair da fila.
 * - ACAO: navegar para o objeto. A Inbox nao executa transicao sensivel.
 */

const DEFAULT_LIMIT = 25;

const WORK_INBOX_FILTER_SCHEMA: MetaEntitySchema = {
  name: 'work-inbox',
  label: 'Central de trabalho',
  description: 'Recorte governado da fila unificada',
  dataSchema: 'work_inbox',
  dataTable: 'work_inbox',
  labelField: 'title',
  fields: [
    {
      name: 'domain',
      label: 'Domínio',
      type: 'select',
      required: false,
      readOnly: true,
      permLevel: 0,
      options: {
        options: WORK_DOMAINS.map((value) => ({ value, label: WORK_DOMAIN_LABELS[value] })),
      },
      fieldOrder: 1,
      inForm: false,
      inList: true,
      listOrder: 1,
      inFilter: true,
      inSearch: false,
    },
    {
      name: 'kind',
      label: 'Natureza',
      type: 'select',
      required: false,
      readOnly: true,
      permLevel: 0,
      options: {
        options: WORK_KINDS.map((value) => ({ value, label: WORK_KIND_LABELS[value] })),
      },
      fieldOrder: 2,
      inForm: false,
      inList: true,
      listOrder: 2,
      inFilter: true,
      inSearch: false,
    },
    {
      name: 'unitId',
      label: 'Unidade',
      type: 'text',
      required: false,
      readOnly: true,
      permLevel: 0,
      options: null,
      fieldOrder: 3,
      inForm: false,
      inList: true,
      listOrder: 3,
      inFilter: true,
      inSearch: false,
    },
  ],
  views: [],
  workflow: null,
  permissions: [],
  allowedPermLevels: [0],
};

function emptyAdvancedFilter(): FilterGroup {
  return { op: 'AND', rules: [], groups: [] };
}

function advancedFilterFromParams(
  domain: WorkDomain | null,
  kind: WorkKind | null,
  unitId: string | null,
): FilterGroup {
  const rules: FilterGroup['rules'] = [];
  if (domain) rules.push({ field: 'domain', op: '=', value: domain });
  if (kind) rules.push({ field: 'kind', op: '=', value: kind });
  if (unitId) rules.push({ field: 'unitId', op: '=', value: unitId });
  return { op: 'AND', rules, groups: [] };
}

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
  const identityId = useOptionalIdentityId();
  const savedViews = useSavedViews(identityId, 'work-inbox');
  /** Unidades autorizadas — alimenta o filtro de escopo em linguagem humana. */
  const { options: unitOptions } = useOperationalUnits();

  const domain = parseDomain(searchParams.get('domain'));
  const kind = parseKind(searchParams.get('kind'));
  const overdue = searchParams.get('overdue') === 'true';
  const unitId = searchParams.get('unitId');
  const offset = Number.parseInt(searchParams.get('offset') ?? '0', 10) || 0;

  const [page, setPage] = useState<WorkInboxPage | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<WorkItem | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [advancedFilter, setAdvancedFilter] = useState<FilterGroup>(() =>
    advancedFilterFromParams(domain, kind, unitId),
  );

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
        setLastUpdatedAt(new Date());
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

  const savedViewFilters = useMemo(
    () => ({
      domain: domain ?? '',
      kind: kind ?? '',
      overdue: overdue ? 'true' : '',
      unitId: unitId ?? '',
    }),
    [domain, kind, overdue, unitId],
  );

  const activeSavedView = useMemo(
    () =>
      savedViews.views.find(
        (view) =>
          view.viewType === 'work-inbox' &&
          Object.entries(savedViewFilters).every(
            ([key, value]) => (view.filters[key] ?? '') === value,
          ),
      ) ?? null,
    [savedViewFilters, savedViews.views],
  );

  const applySavedView = useCallback(
    (view: SavedView) => {
      const next = new URLSearchParams();
      for (const key of ['domain', 'kind', 'overdue', 'unitId'] as const) {
        const value = view.filters[key]?.trim();
        if (value) {
          next.set(key, value);
        }
      }
      setSearchParams(next, { replace: true });
    },
    [setSearchParams],
  );

  const clearFilters = useCallback(() => {
    setSearchParams(new URLSearchParams(), { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    setAdvancedFilter(advancedFilterFromParams(domain, kind, unitId));
  }, [domain, kind, unitId]);

  const applyAdvancedFilter = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('domain');
    next.delete('kind');
    next.delete('unitId');
    next.delete('offset');

    for (const rule of advancedFilter.rules) {
      if (rule.op !== '=' || !rule.value.trim()) continue;
      if (rule.field === 'domain' && parseDomain(rule.value)) next.set('domain', rule.value);
      if (rule.field === 'kind' && parseKind(rule.value)) next.set('kind', rule.value);
      if (rule.field === 'unitId') next.set('unitId', rule.value.trim());
    }
    setSearchParams(next, { replace: true });
    setAdvancedFiltersOpen(false);
  }, [advancedFilter.rules, searchParams, setSearchParams]);

  if (phase === 'denied') {
    return (
      <ModulePage layout="workspace">
        <WorklistStatePanel
          tone="critical"
          title="Acesso à central de trabalho indisponível"
          description="Você não tem permissão para ler esta fila."
        />
      </ModulePage>
    );
  }

  const items = page?.items ?? [];
  /*
   * EXCECOES DO RECORTE ATUAL — contadas do MESMO conjunto exibido, a partir do
   * vencimento persistido. Nao ha priorizacao inventada: "vencido" e um fato do dado.
   */
  const overdueItems = items.filter((item) => daysOverdue(item.dueAt) !== null);
  const hasActiveFilters = Boolean(domain || kind || overdue || unitId);
  const scopeLabel = unitId
    ? operationalUnitLabel(unitOptions, unitId, 'Unidade autorizada')
    : 'Todas as unidades autorizadas';
  const domainLabel = domain ? WORK_DOMAIN_LABELS[domain] : 'Todos os domínios';
  const updatedLabel = lastUpdatedAt
    ? lastUpdatedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : 'aguardando leitura';
  const overdueParams = new URLSearchParams(searchParams);
  overdueParams.set('overdue', 'true');
  overdueParams.delete('offset');
  const overdueHref = `/app/work-inbox?${overdueParams.toString()}`;

  return (
    <ModulePage layout="workspace">
      <WorklistHeader
        title="Central de trabalho"
        count={phase === 'ready' && page ? page.total : null}
        context={
          <span>
            {domainLabel} · {scopeLabel} · Atualizado {updatedLabel}
            {activeSavedView ? ` · Visão: ${activeSavedView.name}` : ''}
          </span>
        }
        action={
          <Button type="button" variant="secondary" onClick={() => void load()}>
            Atualizar
          </Button>
        }
      />

      <DynamicSavedViewsBar
        views={savedViews.views}
        onApply={applySavedView}
        onSave={(name) => savedViews.save(name, savedViewFilters, 'work-inbox')}
        onDelete={savedViews.remove}
        persistedLocally={savedViews.persistedLocally}
        persistable={savedViews.persistable}
      />

      <div className="mb-2 flex items-center justify-between gap-2 border-b border-gray-200 pb-1.5">
        <div>
          <p className="cisne-meta-label m-0">Consulta governada</p>
          <p className="cisne-type-helper m-0">
            O recorte permanece na URL e a consulta continua sendo executada pelo servidor.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          aria-expanded={advancedFiltersOpen}
          onClick={() => setAdvancedFiltersOpen((current) => !current)}
        >
          {advancedFiltersOpen ? 'Fechar filtros avançados' : 'Filtros avançados'}
        </Button>
      </div>

      {advancedFiltersOpen ? (
        <div className="cisne-divider mb-2 pb-2">
          <DynamicFilterBuilder
            schema={WORK_INBOX_FILTER_SCHEMA}
            value={advancedFilter}
            onChange={setAdvancedFilter}
          />
          <div className="mt-1.5 flex items-center gap-1.5">
            <Button type="button" onClick={applyAdvancedFilter}>
              Aplicar recorte
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setAdvancedFilter(emptyAdvancedFilter())}
            >
              Limpar construtor
            </Button>
          </div>
        </div>
      ) : null}

      {page && page.unavailableDomains.length > 0 ? (
        <p
          role="status"
          className="mb-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-500/20 ring-inset"
        >
          Fila incompleta: {page.unavailableDomains.join(', ')} não respondeu nesta leitura. Os
          demais domínios estão completos.
        </p>
      ) : null}

      {/*
        RESUMO — so o que o servidor publicou: `total` do recorte, o tamanho desta pagina e os
        vencidos do conjunto exibido. Nenhum numero e estimado e nenhuma faixa aparece antes de
        existir resposta (durante a carga, zero seria invencao).
      */}
      {phase === 'ready' && page ? (
        <WorkbenchSummaryStrip>
          <WorkbenchMetric value={page.total} label="trabalhos na fila" href="/app/work-inbox" />
          <WorkbenchMetric value={items.length} label="nesta página" />
          <WorkbenchMetric
            value={overdueItems.length}
            label="vencidos neste recorte"
            tone={overdueItems.length > 0 ? 'critical' : 'neutral'}
            href={overdueHref}
          />
        </WorkbenchSummaryStrip>
      ) : null}

      {phase === 'ready' && page ? (
        <DynamicKpiDrilldown
          metrics={[
            {
              id: 'all-work',
              label: 'Todo o trabalho',
              value: page.total,
              filterField: 'domain',
              filterValue: '',
              tone: 'neutral',
            },
            ...WORK_DOMAINS.filter((candidate) => page.byDomain[candidate] > 0).map((candidate) => ({
              id: `domain-${candidate}`,
              label: WORK_DOMAIN_LABELS[candidate],
              value: page.byDomain[candidate],
              filterField: 'domain',
              filterValue: candidate,
              tone: candidate === domain ? ('info' as const) : ('neutral' as const),
            })),
          ]}
          activeFilters={{ domain: domain ?? '' }}
          onDrilldown={(field, value) => {
            if (field === 'domain') updateParam('domain', value || null);
          }}
        />
      ) : null}

      <WorklistFilterBar meta={page ? `${items.length} nesta página` : undefined}>
        <WorklistField label="Natureza">
          <select
            aria-label="Natureza"
            value={kind ?? ''}
            onChange={(event) => updateParam('kind', event.target.value || null)}
            className={worklistSelectClass}
          >
            <option value="">Todas</option>
            {WORK_KINDS.map((candidate) => (
              <option key={candidate} value={candidate}>
                {WORK_KIND_LABELS[candidate]}
              </option>
            ))}
          </select>
        </WorklistField>

        <WorklistField label="Unidade">
          <select
            aria-label="Unidade"
            value={unitId ?? ''}
            onChange={(event) => updateParam('unitId', event.target.value || null)}
            className={cn(worklistSelectClass, 'w-44')}
          >
            <OperationalUnitOptions options={unitOptions} includeAllLabel="Todas as unidades" />
          </select>
        </WorklistField>

        <label className="flex min-h-[var(--control-height)] items-center gap-1.5 px-1.5 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={overdue}
            onChange={(event) => updateParam('overdue', event.target.checked ? 'true' : null)}
          />
          Somente vencidos
        </label>

        <WorklistClearFilters visible={hasActiveFilters} onClick={clearFilters} />
      </WorklistFilterBar>

      {hasActiveFilters ? (
        <div aria-label="Filtros ativos" className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="cisne-meta-label">Recorte ativo</span>
          {domain ? (
            <button
              type="button"
              onClick={() => updateParam('domain', null)}
              className={cn(worklistControlClass, 'min-h-0 bg-brand-50 px-2 py-0.5 text-brand-800')}
            >
              Domínio: {WORK_DOMAIN_LABELS[domain]} ×
            </button>
          ) : null}
          {kind ? (
            <button
              type="button"
              onClick={() => updateParam('kind', null)}
              className={cn(worklistControlClass, 'min-h-0 bg-brand-50 px-2 py-0.5 text-brand-800')}
            >
              Natureza: {WORK_KIND_LABELS[kind]} ×
            </button>
          ) : null}
          {overdue ? (
            <button
              type="button"
              onClick={() => updateParam('overdue', null)}
              className={cn(worklistControlClass, 'min-h-0 bg-red-50 px-2 py-0.5 text-red-800')}
            >
              Somente vencidos ×
            </button>
          ) : null}
          {unitId ? (
            <button
              type="button"
              onClick={() => updateParam('unitId', null)}
              className={cn(worklistControlClass, 'min-h-0 bg-brand-50 px-2 py-0.5 text-brand-800')}
            >
              {scopeLabel} ×
            </button>
          ) : null}
        </div>
      ) : null}

      {phase === 'loading' ? (
        <WorklistStatePanel
          title="Atualizando a central de trabalho"
          description="Mantendo o recorte atual enquanto o servidor recompõe a fila."
        />
      ) : null}

      {phase === 'error' ? (
        <WorklistStatePanel
          tone="critical"
          title="Não foi possível carregar a fila de trabalho"
          description={errorMessage}
          action={
            <Button type="button" variant="secondary" onClick={() => void load()}>
              Tentar novamente
            </Button>
          }
        />
      ) : null}

      {/*
        A FILA. `count` e o tamanho REAL do conjunto exibido; com zero itens o proprio componente
        publica o estado vazio compacto — nada de paragrafo solto no meio da pagina.
      */}
      {phase === 'ready' ? (
        <WorkbenchQueue
          title="Fila de trabalho"
          count={items.length}
          description="Ordenada pelo servidor por precedência operacional. O atraso é derivado do vencimento persistido, não de score."
          action={
            items.length > 1 ? (
              <span className="cisne-type-helper hidden md:inline">
                ↑/↓ navega entre objetos · Enter abre contexto · Esc fecha
              </span>
            ) : null
          }
          emptyTitle="Nenhum trabalho real neste recorte."
          emptyDescription="A fila não inventa pendência para parecer cheia. Ajuste o recorte ou aguarde novo trabalho."
          emptyAction={
            hasActiveFilters ? (
              <Button type="button" variant="secondary" onClick={clearFilters}>
                Limpar recorte
              </Button>
            ) : null
          }
        >
          {items.map((item) => {
            const late = daysOverdue(item.dueAt);
            return (
              <WorkbenchQueueItem
                key={item.id}
                severity={
                  late !== null ? (
                    <WorklistException tone="critical">
                      {late} dia{late === 1 ? '' : 's'} em atraso
                    </WorklistException>
                  ) : (
                    <WorklistException tone="info">{item.status}</WorklistException>
                  )
                }
                severityTone={late !== null ? 'critical' : 'info'}
                title={item.title}
                reason={item.reason}
                context={
                  <>
                    <button
                      type="button"
                      data-work-inbox-preview
                      onClick={() => setSelected(item)}
                      onKeyDown={(event) => {
                        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                        const controls = Array.from(
                          document.querySelectorAll<HTMLButtonElement>('[data-work-inbox-preview]'),
                        );
                        const currentIndex = controls.indexOf(event.currentTarget);
                        if (currentIndex < 0 || controls.length === 0) return;
                        const direction = event.key === 'ArrowDown' ? 1 : -1;
                        const nextIndex = (currentIndex + direction + controls.length) % controls.length;
                        controls[nextIndex]?.focus();
                        event.preventDefault();
                      }}
                      className="text-xs font-semibold text-brand-700 hover:text-brand-800"
                    >
                      {item.businessReference}
                    </button>
                    <span className="ml-3">
                      {WORK_DOMAIN_LABELS[item.domain]} · {WORK_KIND_LABELS[item.kind]}
                    </span>
                    {item.contextLabel ? (
                      <span className="ml-3">{item.contextLabel}</span>
                    ) : null}
                  </>
                }
                age={<>Vencimento {formatMoment(item.dueAt)}</>}
                action={
                  <Link className={workbenchPrimaryActionClass} to={item.targetRoute}>
                    {item.actionLabel}
                  </Link>
                }
              />
            );
          })}
        </WorkbenchQueue>
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

      <DynamicContextDrawer
        open={selected !== null}
        title="Contexto do trabalho"
        onClose={() => setSelected(null)}
        crossReferences={
          selected
            ? [{ label: 'Objeto de origem', detail: selected.businessReference, href: selected.targetRoute }]
            : []
        }
      >
        {selected ? (
          <>
            <div className="cisne-divider pb-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="cisne-type-primary m-0">{selected.businessReference}</p>
                <WorklistException tone={daysOverdue(selected.dueAt) !== null ? 'critical' : 'info'}>
                  {daysOverdue(selected.dueAt) !== null
                    ? `${daysOverdue(selected.dueAt)} dia${daysOverdue(selected.dueAt) === 1 ? '' : 's'} em atraso`
                    : selected.status}
                </WorklistException>
              </div>
              <p className="cisne-type-helper m-0 mt-0.5">{selected.title}</p>
            </div>
            <dl className="m-0 grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 py-2">
              <dt className="cisne-type-helper">Domínio</dt>
              <dd className="cisne-type-body m-0">{WORK_DOMAIN_LABELS[selected.domain]}</dd>
              <dt className="cisne-type-helper">Natureza</dt>
              <dd className="cisne-type-body m-0">{WORK_KIND_LABELS[selected.kind]}</dd>
              <dt className="cisne-type-helper">Motivo</dt>
              <dd className="cisne-type-body m-0">{selected.reason}</dd>
              <dt className="cisne-type-helper">Contexto</dt>
              <dd className="cisne-type-body m-0">{selected.contextLabel || '—'}</dd>
              <dt className="cisne-type-helper">Ocorrido em</dt>
              <dd className="cisne-type-body m-0 tabular-nums">{formatMoment(selected.occurredAt)}</dd>
              <dt className="cisne-type-helper">Vencimento</dt>
              <dd className="cisne-type-body m-0 tabular-nums">{formatMoment(selected.dueAt)}</dd>
              <dt className="cisne-type-helper">Unidade</dt>
              <dd className="cisne-type-body m-0">
                {selected.unitId
                  ? operationalUnitLabel(unitOptions, selected.unitId, 'Unidade autorizada')
                  : 'Sem unidade informada'}
              </dd>
            </dl>
            <div className="cisne-divider pt-2">
              <p className="cisne-meta-label m-0 mb-1">Próxima ação</p>
              <Link className={workbenchPrimaryActionClass} to={selected.targetRoute} onClick={() => setSelected(null)}>
                {selected.actionLabel}
              </Link>
            </div>
          </>
        ) : null}
      </DynamicContextDrawer>
    </ModulePage>
  );
}
