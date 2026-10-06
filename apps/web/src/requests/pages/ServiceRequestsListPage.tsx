import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { RELATION_SCOPE_KEYS, useRelationScope } from '../../enterprise-object';
import { isPersistableValue } from '../../operator';
import {
  DynamicContextDrawer,
  DynamicSavedViewsBar,
  useSavedViews,
  type CrossReference,
} from '../../engine';
import {
  getServiceRequestSummary,
  listServiceRequests,
  ServiceRequestsApiError,
} from '../api/service-requests-api';
import { mapRequestErrorToMessage } from '../api/request-error-messages';
import { ServiceRequestPriorityBadge } from '../components/ServiceRequestPriorityBadge';
import { ServiceRequestStatusBadge } from '../components/ServiceRequestStatusBadge';
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
  formatServiceRequestPriority,
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
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModuleStatePage,
  ModulePagination,
  ModulePrimaryLink,
  ModuleTableLink,
} from '../../ui/module-layout';
import {
  EnterpriseMetric,
  WorklistClearFilters,
  WorklistField,
  WorklistFilterBar,
  WorklistHeader,
  WorklistStatePanel,
  worklistControlClass,
  worklistSelectClass,
  rowPrimaryActionClass,
} from '../../ui/enterprise-list';
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

/**
 * ROTULO CURTO DA ACAO POR ESTADO — mesma maquina de estados, verbo de superficie.
 *
 * O rotulo longo de `NEXT_STEP_BY_STATUS` e uma FRASE ("Enviar para analise"); no botao da
 * linha cabe o VERBO. Nenhuma transicao nova: a tabela abaixo e a mesma do mapa acima, so
 * encurtada para o alvo de clique.
 */
const NEXT_STEP_ACTION_LABEL: Record<ServiceRequestStatus, string> = {
  [SERVICE_REQUEST_STATUSES.Draft]: 'Enviar',
  [SERVICE_REQUEST_STATUSES.Submitted]: 'Iniciar análise',
  [SERVICE_REQUEST_STATUSES.UnderReview]: 'Decidir',
  [SERVICE_REQUEST_STATUSES.Approved]: 'Converter em OS',
  [SERVICE_REQUEST_STATUSES.Converted]: 'Abrir OS',
  [SERVICE_REQUEST_STATUSES.Rejected]: 'Consultar',
  [SERVICE_REQUEST_STATUSES.Cancelled]: 'Consultar',
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
  /*
   * VISÕES SALVAS — a fila de solicitações é reconstruída todo dia com o MESMO recorte:
   * "aprovadas aguardando virar OS", "em análise por prioridade alta". Como o recorte vive na
   * URL (ver `useQueueUrlSync`), salvar a visão preserva o endereço compartilhável — a visão
   * restaura o recorte OPERACIONAL real, não um estado visual solto.
   */
  const savedViews = useSavedViews('local-operator', 'service-requests');
  const [selected, setSelected] = useState<ServiceRequestListItem | null>(null);
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
      <ModuleStatePage title="Solicitações de serviço">
        <ModuleLoadingState message="Carregando solicitações…" />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'denied') {
    return (
      <ModuleStatePage title="Solicitações de serviço">
        <ModuleDeniedState
          message="Você não tem permissão para listar solicitações."
        />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'error') {
    return (
      <ModuleStatePage title="Solicitações de serviço">
        <ModuleErrorState
          message={listState.message}
          retryable={listState.retryable}
          onRetry={() => void loadPage(0, filters)}
        />
      </ModuleStatePage>
    );
  }

  const { items, offset, hasMore } = listState;
  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1;
  const now = new Date();

  return (
    <ModulePage>
      {/*
        GRAMATICA GOLD (aprovada em Clientes) — a tela era `ModulePageHeader` + uma faixa de
        cartoes de resumo + `FilterCard`. O operador lia titulo, cinco cartoes e um card de
        filtro antes de ver a primeira linha da fila.

        Agora a MESMA informacao vive na cabeca da worklist: `WorklistHeader` carrega titulo,
        contagem do SERVIDOR, contexto do modulo, acao primaria e a faixa de indicadores; os
        filtros descem para a toolbar densa, em uma linha.

        Os numeros continuam vindo de `ServiceRequestSummaryCards` (contrato de summary do
        servidor, com o recorte por status que ja existia) — nada foi recalculado.
      */}
      <WorklistHeader
        title="Solicitações de serviço"
        count={summary?.total ?? null}
        context="Fila de entrada do trabalho: o que chegou, em que estado está e qual o próximo passo de cada solicitação."
        action={
          capabilities.canCreate ? (
            <ModulePrimaryLink to="/app/requests/new">Nova solicitação</ModulePrimaryLink>
          ) : null
        }
        metrics={
          <>
            <EnterpriseMetric
              label="Pendentes"
              value={summary?.pending ?? 0}
              tone={(summary?.pending ?? 0) > 0 ? 'warning' : 'neutral'}
            />
            <EnterpriseMetric
              label="Em análise"
              value={summary?.underReview ?? 0}
            />
            <EnterpriseMetric label="Convertidas" value={summary?.converted ?? 0} />
            <EnterpriseMetric
              label="Canceladas"
              value={summary?.cancelled ?? 0}
            />
          </>
        }
      />

      {/*
        RECORTE POR STATUS — os cartoes de resumo eram CLICAVEIS e filtravam a fila. Esse
        contrato e preservado aqui como quick filters na toolbar: mesma acao, mesmo recorte,
        sem a faixa de cartoes que empurrava a primeira linha para fora da dobra.
      */}
      <WorklistFilterBar meta={`${items.length} nesta página`}>
        <WorklistField label="Buscar" htmlFor="request-search-filter" grow>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              applyFilter('search', searchInput);
            }}
          >
            <input
              id="request-search-filter"
              type="search"
              className={worklistControlClass}
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Ex.: SR-2026…, troca de compressor, OC 1234"
            />
            <button type="submit" className="button-secondary">
              Buscar
            </button>
          </form>
        </WorklistField>

        <WorklistField label="Status" htmlFor="request-status-filter">
          <select
            id="request-status-filter"
            className={worklistSelectClass}
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
        </WorklistField>

        <WorklistField label="Prioridade" htmlFor="request-priority-filter">
          <select
              id="request-priority-filter"
              className={worklistSelectClass}
              value={filters.priority}
              onChange={(event) =>
                applyFilter('priority', event.target.value as '' | ServiceRequestPriority)
              }
            >
              <option value="">Todas</option>
              {Object.values(SERVICE_REQUEST_PRIORITIES).map((priority) => (
                <option key={priority} value={priority}>
                  {formatServiceRequestPriority(priority)}
                </option>
              ))}
            </select>
          </WorklistField>

          <WorklistField label="Origem" htmlFor="request-origin-filter">
            <select
              id="request-origin-filter"
              className={worklistSelectClass}
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
          </WorklistField>

          <WorklistField label="Ordenar por" htmlFor="request-sort-filter">
            <select
              id="request-sort-filter"
              className={worklistSelectClass}
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
          </WorklistField>

          <WorklistField label="Sentido" htmlFor="request-direction-filter">
            <select
              id="request-direction-filter"
              className={worklistSelectClass}
              value={filters.direction}
              onChange={(event) =>
                applyFilter('direction', event.target.value as ServiceRequestListDirection)
              }
            >
              <option value="desc">Decrescente</option>
              <option value="asc">Crescente</option>
            </select>
          </WorklistField>

          {activeFilters ? (
            <WorklistClearFilters
              visible
              onClick={() => {
                setSearchInput('');
                setFilters(EMPTY_FILTERS);
              }}
            />
          ) : null}
      </WorklistFilterBar>

      {/*
        VISÕES SALVAS — restaura o recorte INTEIRO da fila (status, prioridade, origem, janela
        desejada, ordenação e o termo de busca). Uma visão que salvasse só parte do recorte
        mentiria sobre o que o operador está vendo.
      */}
      <DynamicSavedViewsBar
        views={savedViews.views}
        persistedLocally={savedViews.persistedLocally}
        onSave={(name) => savedViews.save(name, { ...filters }, 'list')}
        onDelete={savedViews.remove}
        onApply={(view) => {
          /*
           * RESTAURA O RECORTE INTEIRO. Cada chave é lida pelo próprio alfabeto de
           * `EMPTY_FILTERS` (todas são string), então uma visão salva antes de um campo novo
           * existir simplesmente cai no valor padrão em vez de deixar a fila num estado
           * indefinido. `?? ''` cobre a visão antiga; `filters` já traz o default de ordenação.
           */
          const restored: QueueFilters = {
            status: (view.filters['status'] ?? '') as QueueFilters['status'],
            priority: (view.filters['priority'] ?? '') as QueueFilters['priority'],
            originSource: (view.filters['originSource'] ?? '') as QueueFilters['originSource'],
            unitId: view.filters['unitId'] ?? '',
            desiredFrom: view.filters['desiredFrom'] ?? '',
            desiredTo: view.filters['desiredTo'] ?? '',
            search: view.filters['search'] ?? '',
            sort: (view.filters['sort'] || EMPTY_FILTERS.sort) as QueueFilters['sort'],
            direction: (view.filters['direction'] || EMPTY_FILTERS.direction) as QueueFilters['direction'],
          };
          setFilters(restored);
          setSearchInput(restored.search);
        }}
      />

      {/*
        ESTADO VAZIO COMPACTO — era um `<p>` solto de uma linha. O painel declara o recorte,
        explica o que fazer e oferece a acao real quando ela existe, sem ocupar meia tela.
      */}
      {items.length === 0 ? (
        <WorklistStatePanel
          title={
            activeFilters
              ? 'Nenhuma solicitação corresponde aos filtros aplicados.'
              : 'Nenhuma solicitação registrada.'
          }
          description={
            activeFilters
              ? 'Ajuste a busca, o status ou a janela desejada — ou limpe os filtros para ver a fila completa.'
              : 'As solicitações são a entrada do trabalho: quando a primeira chegar, ela aparece aqui com prioridade, janela desejada e próximo passo.'
          }
          action={
            activeFilters ? (
              <WorklistClearFilters
                visible
                onClick={() => {
                  setSearchInput('');
                  setFilters(EMPTY_FILTERS);
                }}
              />
            ) : capabilities.canCreate ? (
              <ModulePrimaryLink to="/app/requests/new">Nova solicitação</ModulePrimaryLink>
            ) : null
          }
        />
      ) : (
        <section aria-label="Fila operacional de solicitações" className="mt-4">
          <div className="hidden grid-cols-[minmax(0,2.1fr)_minmax(0,1.5fr)_7rem_minmax(0,1.3fr)_minmax(0,1.1fr)_minmax(0,1.4fr)_9rem] gap-4 border-b border-gray-200 px-4 pb-2 lg:grid">
            {['Solicitação', 'Cliente e demanda', 'Prioridade', 'Janela desejada', 'Situação', 'Próxima ação', 'Ações'].map(
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
                  /*
                   * CONTEXTO SEM ABANDONAR A FILA — o analista triagem várias solicitações
                   * seguidas. O painel lateral mostra a demanda, a janela e o próximo passo sem
                   * perder o recorte; o código da solicitação continua levando à ficha.
                   */
                  onClick={() => setSelected(item)}
                  className="grid cursor-pointer grid-cols-1 gap-3 px-4 py-4 transition hover:bg-gray-50/70 lg:grid-cols-[minmax(0,2.1fr)_minmax(0,1.5fr)_7rem_minmax(0,1.3fr)_minmax(0,1.1fr)_minmax(0,1.4fr)_9rem] lg:items-start lg:gap-4"
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

                  {/*
                    ACAO DA LINHA — mesma gramatica de Pedidos (GOLD 1) e Pessoas (GOLD 3).
                    A fila so abria pelo codigo; a acao da alvo de teclado com rotulo explicito
                    ao lado do proximo passo, que e onde o operador decide.
                  */}
                  <div className="flex items-start lg:justify-end">
                    <Link
                      to={`/app/requests/${item.id}`}
                      className={rowPrimaryActionClass}
                      /* O clique na ação NAVEGA; o da linha abre o contexto. Sem parar a
                         propagação, o link também abriria o painel por cima da navegação. */
                      onClick={(event) => event.stopPropagation()}
                    >
                      {NEXT_STEP_ACTION_LABEL[item.status] ?? 'Abrir'}
                    </Link>
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

      {/*
        RELAÇÕES DA SOLICITAÇÃO — montadas do que a LINHA já traz, sem chamada de rede nova.
        Contagem de propostas ou de OS convertidas NÃO é publicada por esta listagem, então
        nenhuma é afirmada: número sem origem não entra. O painel entrega contexto, ação real e
        drillback — não duplica a object page.
      */}
      <DynamicContextDrawer
        open={selected !== null}
        title={selected ? selected.requestCode : 'Solicitação'}
        onClose={() => setSelected(null)}
        crossReferences={selected ? requestCrossReferences(selected) : []}
      >
        {selected ? (
          <Link to={`/app/requests/${selected.id}`} className={rowPrimaryActionClass}>
            {NEXT_STEP_ACTION_LABEL[selected.status] ?? 'Abrir solicitação'}
          </Link>
        ) : null}
      </DynamicContextDrawer>
    </ModulePage>
  );
}

/**
 * Referências cruzadas da solicitação, a partir do payload da listagem.
 *
 * Cada item entra só quando o campo existe. Sem cliente identificado, a ausência é DECLARADA —
 * não se fabrica nome nem se omite a linha em silêncio.
 */
function requestCrossReferences(item: ServiceRequestListItem): CrossReference[] {
  const references: CrossReference[] = [
    { label: 'Situação', detail: formatServiceRequestStatus(item.status) },
    { label: 'Prioridade', detail: formatServiceRequestPriority(item.priority) },
    { label: 'Origem', detail: formatServiceRequestOrigin(item.originSource) },
    { label: 'Próximo passo', detail: NEXT_STEP_BY_STATUS[item.status] },
  ];
  references.push({
    label: 'Cliente',
    detail: item.clientName ?? 'Cliente não identificado',
  });
  const window = formatDesiredWindow(item.desiredStartAt, item.desiredEndAt);
  if (window) {
    references.push({ label: 'Janela desejada', detail: window });
  }
  if (item.description) {
    references.push({ label: 'Demanda', detail: summarizeServiceRequestDescription(item.description) });
  }
  return references;
}
