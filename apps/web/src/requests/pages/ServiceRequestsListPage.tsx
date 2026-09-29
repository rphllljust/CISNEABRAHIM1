import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RELATION_SCOPE_KEYS, useRelationScope } from '../../enterprise-object';
import { isPersistableValue } from '../../operator';
import {
  getServiceRequestSummary,
  listServiceRequests,
  ServiceRequestsApiError,
} from '../api/service-requests-api';
import { mapRequestErrorToMessage } from '../api/request-error-messages';
import { ServiceRequestPriorityBadge } from '../components/ServiceRequestPriorityBadge';
import { ServiceRequestStatusBadge } from '../components/ServiceRequestStatusBadge';
import { ServiceRequestSummaryCards } from '../components/ServiceRequestSummaryCards';
import { useServiceRequestCapabilities } from '../hooks/useServiceRequestCapabilities';
import {
  SERVICE_REQUEST_LIST_SORTS,
  SERVICE_REQUEST_ORIGINS,
  SERVICE_REQUEST_PRIORITIES,
  SERVICE_REQUEST_STATUSES,
  type ServiceRequestListItem,
  type ServiceRequestListDirection,
  type ServiceRequestListSort,
  type ServiceRequestListSummary,
  type ServiceRequestOrigin,
  type ServiceRequestPriority,
  type ServiceRequestStatus,
} from '../types/service-request.types';
import {
  formatServiceRequestNextStep,
  formatServiceRequestOrigin,
  formatServiceRequestStatus,
} from '../utils/service-request-labels';
import {
  describeDesiredWindowTiming,
  describeServiceRequestAttention,
  formatDesiredWindow,
  formatRelativePast,
  summarizeServiceRequestDescription,
} from '../utils/service-request-workbench';
import {
  FilterCard,
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModulePageHeader,
  ModulePagination,
  ModulePrimaryLink,
  ModuleTableLink,
  filterControlClass,
  filterLabelClass,
} from '../../ui/module-layout';
import { cn } from '../../ui/utils/cn';

const PAGE_SIZE = 20;

const SORT_LABELS: Record<ServiceRequestListSort, string> = {
  [SERVICE_REQUEST_LIST_SORTS.createdAt]: 'Criação',
  [SERVICE_REQUEST_LIST_SORTS.updatedAt]: 'Última atualização',
  [SERVICE_REQUEST_LIST_SORTS.priority]: 'Prioridade',
  [SERVICE_REQUEST_LIST_SORTS.desiredStartAt]: 'Início desejado',
};

type QueueFilters = {
  status: '' | ServiceRequestStatus;
  priority: '' | ServiceRequestPriority;
  originSource: '' | ServiceRequestOrigin;
  unitId: string;
  desiredFrom: string;
  desiredTo: string;
  search: string;
  sort: ServiceRequestListSort;
  direction: ServiceRequestListDirection;
};

const EMPTY_FILTERS: QueueFilters = {
  status: '',
  priority: '',
  originSource: '',
  unitId: '',
  desiredFrom: '',
  desiredTo: '',
  search: '',
  sort: SERVICE_REQUEST_LIST_SORTS.createdAt,
  direction: 'desc',
};

type ListState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error'; message: string; retryable: boolean }
  | { phase: 'ready'; items: ServiceRequestListItem[]; offset: number; hasMore: boolean };

/** Proximo passo por estado — mesma leitura que o backend deriva da maquina de estados. */
const NEXT_STEP_BY_STATUS: Record<ServiceRequestStatus, string> = {
  [SERVICE_REQUEST_STATUSES.Draft]: formatServiceRequestNextStep('SUBMIT_REQUEST'),
  [SERVICE_REQUEST_STATUSES.Submitted]: formatServiceRequestNextStep('START_REVIEW'),
  [SERVICE_REQUEST_STATUSES.UnderReview]: formatServiceRequestNextStep('DECIDE'),
  [SERVICE_REQUEST_STATUSES.Approved]: formatServiceRequestNextStep('CONVERT_TO_SERVICE_ORDER'),
  [SERVICE_REQUEST_STATUSES.Converted]: formatServiceRequestNextStep('OPEN_SERVICE_ORDER'),
  [SERVICE_REQUEST_STATUSES.Rejected]: formatServiceRequestNextStep('CLOSED'),
  [SERVICE_REQUEST_STATUSES.Cancelled]: formatServiceRequestNextStep('CLOSED'),
};

const ATTENTION_TONE_CLASS: Record<string, string> = {
  critical: 'bg-red-50 text-red-700 ring-red-600/20',
  warning: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  info: 'bg-gray-100 text-gray-600 ring-gray-400/20',
};

function hasActiveFilters(filters: QueueFilters): boolean {
  const { sort, direction, ...rest } = filters;
  void sort;
  void direction;
  return Object.values(rest).some((value) => value !== '');
}

/** Chaves enumeradas da fila que podem trafegar na URL. Nunca texto livre. */
const QUEUE_URL_KEYS = ['status', 'priority', 'originSource'] as const;

/**
 * Fila enderecavel: semeia os recortes enumerados a partir da URL uma unica vez e reflete
 * de volta o recorte atual. Nenhuma autorizacao e decidida aqui — a consulta continua sendo
 * autorizada no servidor; isto apenas transporta o recorte.
 */
function useQueueUrlSync(
  filters: QueueFilters,
  setFilters: Dispatch<SetStateAction<QueueFilters>>,
): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const seeded = useRef(false);

  useEffect(() => {
    if (seeded.current) {
      return;
    }
    seeded.current = true;
    const incoming: Record<string, string> = {};
    for (const key of QUEUE_URL_KEYS) {
      const value = searchParams.get(key);
      if (value && isPersistableValue(value)) {
        incoming[key] = value;
      }
    }
    if (Object.keys(incoming).length > 0) {
      setFilters((current) => ({ ...current, ...incoming }));
    }
    // Semeado apenas na primeira montagem: depois disso o estado da tela e a fonte.
  }, [searchParams, setFilters]);

  useEffect(() => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const key of QUEUE_URL_KEYS) {
          const value = filters[key];
          if (value) {
            next.set(key, value);
          } else {
            next.delete(key);
          }
        }
        return next;
      },
      { replace: true },
    );
    // Apenas os recortes enumerados entram na URL.
  }, [filters.status, filters.priority, filters.originSource, setSearchParams]);
}

export function ServiceRequestsListPage() {
  const { capabilities } = useServiceRequestCapabilities();
  const [filters, setFilters] = useState<QueueFilters>(EMPTY_FILTERS);
  // Escopo de relacao (recorte que vem da URL e NAO e editavel no formulario da fila).
  const relationScope = useRelationScope(RELATION_SCOPE_KEYS);
  const [searchInput, setSearchInput] = useState('');
  const [listState, setListState] = useState<ListState>({ phase: 'loading' });
  const [summary, setSummary] = useState<ServiceRequestListSummary | null>(null);

  // FILA ENDERECAVEL: os recortes enumerados de estado, prioridade e origem passam a viver
  // na URL. Antes viviam so em memoria: recarregar perdia o recorte, o botao voltar nao
  // funcionava e a fila nao podia ser compartilhada nem aberta por link. Somente valores
  // enumerados entram pela URL (o mesmo alfabeto restrito das visoes salvas); texto livre
  // de busca permanece em memoria, por nao ser persistivel.
  useQueueUrlSync(filters, setFilters);

  const loadPage = useCallback(
    async (offset: number, activeFilters: QueueFilters, signal?: AbortSignal) => {
      setListState({ phase: 'loading' });
      try {
        const scopedFilters = {
          unitId: activeFilters.unitId.trim() || undefined,
          // RELATION CONTRACT: o recorte vindo da URL (ex.: clique em "Solicitações N" na
          // object page do cliente) e enviado ao servidor. Sem isto o numero da relacao
          // apontaria para uma lista NAO filtrada, afirmando um recorte inexistente.
          ...(relationScope.clientId ? { clientId: relationScope.clientId } : {}),
        };
        const [response, summaryResponse] = await Promise.all([
          listServiceRequests(
            {
              limit: PAGE_SIZE,
              offset,
              status: activeFilters.status || undefined,
              priority: activeFilters.priority || undefined,
              originSource: activeFilters.originSource || undefined,
              desiredFrom: activeFilters.desiredFrom
                ? new Date(activeFilters.desiredFrom).toISOString()
                : undefined,
              desiredTo: activeFilters.desiredTo
                ? new Date(activeFilters.desiredTo).toISOString()
                : undefined,
              search: activeFilters.search.trim() || undefined,
              sort: activeFilters.sort,
              direction: activeFilters.direction,
              ...scopedFilters,
            },
            signal,
          ),
          getServiceRequestSummary(scopedFilters, signal),
        ]);
        setSummary(summaryResponse);
        setListState({
          phase: 'ready',
          items: response.items,
          offset: response.offset,
          hasMore: response.items.length === response.limit,
        });
      } catch (error) {
        if (error instanceof ServiceRequestsApiError) {
          if (error.kind === 'denied') {
            setListState({ phase: 'denied' });
            return;
          }
          setListState({
            phase: 'error',
            message: mapRequestErrorToMessage(error.code, error.status),
            retryable: error.kind === 'network' || error.kind === 'unknown',
          });
          return;
        }
        setListState({
          phase: 'error',
          message: 'Não foi possível carregar as solicitações.',
          retryable: true,
        });
      }
    },
    [relationScope.clientId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadPage(0, filters, controller.signal);
    return () => controller.abort();
  }, [filters, loadPage]);

  const applyFilter = useCallback(<K extends keyof QueueFilters>(key: K, value: QueueFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
  }, []);

  const activeFilters = useMemo(() => hasActiveFilters(filters), [filters]);

  if (listState.phase === 'loading') {
    return (
      <ModulePage>
        <ModuleLoadingState title="Solicitações de serviço" message="Carregando solicitações…" />
      </ModulePage>
    );
  }

  if (listState.phase === 'denied') {
    return (
      <ModulePage>
        <ModuleDeniedState
          title="Solicitações de serviço"
          message="Você não tem permissão para listar solicitações."
        />
      </ModulePage>
    );
  }

  if (listState.phase === 'error') {
    return (
      <ModulePage>
        <ModuleErrorState
          title="Solicitações de serviço"
          message={listState.message}
          retryable={listState.retryable}
          onRetry={() => void loadPage(0, filters)}
        />
      </ModulePage>
    );
  }

  const { items, offset, hasMore } = listState;
  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1;
  const now = new Date();

  return (
    <ModulePage>
      <ModulePageHeader
        title="Solicitações de serviço"
        action={
          capabilities.canCreate ? (
            <ModulePrimaryLink to="/app/requests/new">Nova solicitação</ModulePrimaryLink>
          ) : null
        }
      />

      <ServiceRequestSummaryCards
        summary={summary}
        activeStatusFilter={filters.status}
        onSelectStatus={(status) => applyFilter('status', status)}
      />

      <FilterCard>
        <form
          className="grid gap-4 lg:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault();
            applyFilter('search', searchInput);
          }}
        >
          <div className="lg:col-span-2">
            <label className={filterLabelClass} htmlFor="request-search-filter">
              Busca (código, descrição ou referência externa)
            </label>
            <div className="flex gap-2">
              <input
                id="request-search-filter"
                type="search"
                className={filterControlClass}
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Ex.: SR-2026…, troca de compressor, OC 1234"
              />
              <button type="submit" className="button-secondary">
                Buscar
              </button>
            </div>
          </div>
          <div>
            <label className={filterLabelClass} htmlFor="request-status-filter">
              Status
            </label>
            <select
              id="request-status-filter"
              className={filterControlClass}
              value={filters.status}
              onChange={(event) =>
                applyFilter('status', event.target.value as '' | ServiceRequestStatus)
              }
            >
              <option value="">Todos</option>
              {Object.values(SERVICE_REQUEST_STATUSES).map((status) => (
                <option key={status} value={status}>
                  {formatServiceRequestStatus(status)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={filterLabelClass} htmlFor="request-priority-filter">
              Prioridade
            </label>
            <select
              id="request-priority-filter"
              className={filterControlClass}
              value={filters.priority}
              onChange={(event) =>
                applyFilter('priority', event.target.value as '' | ServiceRequestPriority)
              }
            >
              <option value="">Todas</option>
              {Object.values(SERVICE_REQUEST_PRIORITIES).map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={filterLabelClass} htmlFor="request-origin-filter">
              Origem
            </label>
            <select
              id="request-origin-filter"
              className={filterControlClass}
              value={filters.originSource}
              onChange={(event) =>
                applyFilter('originSource', event.target.value as '' | ServiceRequestOrigin)
              }
            >
              <option value="">Todas</option>
              {Object.values(SERVICE_REQUEST_ORIGINS).map((origin) => (
                <option key={origin} value={origin}>
                  {formatServiceRequestOrigin(origin)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={filterLabelClass} htmlFor="request-unit-filter">
              Unidade
            </label>
            <input
              id="request-unit-filter"
              type="search"
              className={filterControlClass}
              value={filters.unitId}
              onChange={(event) => applyFilter('unitId', event.target.value)}
              placeholder="Filtrar por unidade"
            />
          </div>
          <div>
            <label className={filterLabelClass} htmlFor="request-desired-from-filter">
              Início desejado a partir de
            </label>
            <input
              id="request-desired-from-filter"
              type="date"
              className={filterControlClass}
              value={filters.desiredFrom}
              onChange={(event) => applyFilter('desiredFrom', event.target.value)}
            />
          </div>
          <div>
            <label className={filterLabelClass} htmlFor="request-desired-to-filter">
              Início desejado até
            </label>
            <input
              id="request-desired-to-filter"
              type="date"
              className={filterControlClass}
              value={filters.desiredTo}
              onChange={(event) => applyFilter('desiredTo', event.target.value)}
            />
          </div>
          <div>
            <label className={filterLabelClass} htmlFor="request-sort-filter">
              Ordenar por
            </label>
            <select
              id="request-sort-filter"
              className={filterControlClass}
              value={filters.sort}
              onChange={(event) =>
                applyFilter('sort', event.target.value as ServiceRequestListSort)
              }
            >
              {Object.values(SERVICE_REQUEST_LIST_SORTS).map((sort) => (
                <option key={sort} value={sort}>
                  {SORT_LABELS[sort]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={filterLabelClass} htmlFor="request-direction-filter">
              Sentido
            </label>
            <select
              id="request-direction-filter"
              className={filterControlClass}
              value={filters.direction}
              onChange={(event) =>
                applyFilter('direction', event.target.value as ServiceRequestListDirection)
              }
            >
              <option value="desc">Decrescente</option>
              <option value="asc">Crescente</option>
            </select>
          </div>
          <div className="flex items-end gap-2 lg:col-span-2">
            {activeFilters ? (
              <button
                type="button"
                className="button-secondary"
                onClick={() => {
                  setSearchInput('');
                  setFilters(EMPTY_FILTERS);
                }}
              >
                Limpar filtros
              </button>
            ) : null}
          </div>
        </form>
      </FilterCard>

      {items.length === 0 ? (
        <p className="text-sm text-gray-500" role="status">
          Nenhuma solicitação encontrada com os filtros aplicados.
        </p>
      ) : (
        <section aria-label="Fila operacional de solicitações" className="mt-4">
          <div className="hidden grid-cols-[minmax(0,2.1fr)_minmax(0,1.5fr)_7rem_minmax(0,1.3fr)_minmax(0,1.1fr)_minmax(0,1.4fr)] gap-4 border-b border-gray-200 px-4 pb-2 lg:grid">
            {['Solicitação', 'Cliente e demanda', 'Prioridade', 'Janela desejada', 'Situação', 'Próxima ação'].map(
              (heading) => (
                <span
                  key={heading}
                  className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase"
                >
                  {heading}
                </span>
              ),
            )}
          </div>
          <ul className="divide-y divide-gray-100">
            {items.map((item) => {
              const attention = describeServiceRequestAttention(item, now);
              const timing = describeDesiredWindowTiming(item.desiredStartAt, now);
              return (
                <li
                  key={item.id}
                  className="grid grid-cols-1 gap-3 px-4 py-4 transition hover:bg-gray-50/70 lg:grid-cols-[minmax(0,2.1fr)_minmax(0,1.5fr)_7rem_minmax(0,1.3fr)_minmax(0,1.1fr)_minmax(0,1.4fr)] lg:items-start lg:gap-4"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <ModuleTableLink to={`/app/requests/${item.id}`}>
                        {item.requestCode}
                      </ModuleTableLink>
                      <span className="text-xs text-gray-400">
                        {formatServiceRequestOrigin(item.originSource)}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-gray-700">
                      {summarizeServiceRequestDescription(item.description)}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      {/*
                        ESCOPO, NAO SLUG: `unitId` e identificador interno (em HML, o
                        slug `unit-synthetic-homolog`) e nao vai para a superficie
                        operacional. Nenhum contrato publica o nome humano da unidade —
                        PARK registrado; ate la a linha declara o escopo.
                      */}
                      No seu escopo · atualizada {formatRelativePast(item.updatedAt, now)}
                    </p>
                  </div>

                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {item.clientName ?? (
                        <span className="text-gray-400">Cliente não identificado</span>
                      )}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-gray-500">
                      {item.serviceLabel ?? summarizeServiceRequestDescription(item.description, 80)}
                    </p>
                    {item.location?.city || item.location?.label ? (
                      <p className="mt-0.5 truncate text-xs text-gray-400">
                        {[item.location.label, item.location.city, item.location.state]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    ) : null}
                  </div>

                  <div>
                    <ServiceRequestPriorityBadge priority={item.priority} />
                  </div>

                  <div className="min-w-0">
                    <p className="text-sm text-gray-800">
                      {formatDesiredWindow(item.desiredStartAt, item.desiredEndAt)}
                    </p>
                    {timing ? (
                      <p
                        className={cn(
                          'mt-0.5 text-xs',
                          timing.tone === 'past'
                            ? 'font-medium text-red-600'
                            : timing.tone === 'today'
                              ? 'font-medium text-amber-700'
                              : 'text-gray-500',
                        )}
                      >
                        {timing.text}
                      </p>
                    ) : null}
                  </div>

                  <div className="min-w-0">
                    <ServiceRequestStatusBadge status={item.status} />
                    <p className="mt-1 text-xs text-gray-400">
                      Criada {formatRelativePast(item.createdAt, now)}
                    </p>
                  </div>

                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800">
                      {NEXT_STEP_BY_STATUS[item.status]}
                    </p>
                    {attention.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {attention.map((fact) => (
                          <span
                            key={fact.code}
                            className={cn(
                              'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
                              ATTENTION_TONE_CLASS[fact.tone],
                            )}
                          >
                            {fact.text}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 px-4 text-xs text-gray-400">
            Janela desejada é a expectativa registrada na solicitação — não é prazo contratado.
          </p>
        </section>
      )}

      <ModulePagination
        pageNumber={pageNumber}
        previousDisabled={offset === 0}
        nextDisabled={!hasMore}
        onPrevious={() => void loadPage(Math.max(0, offset - PAGE_SIZE), filters)}
        onNext={() => void loadPage(offset + PAGE_SIZE, filters)}
      />
    </ModulePage>
  );
}
