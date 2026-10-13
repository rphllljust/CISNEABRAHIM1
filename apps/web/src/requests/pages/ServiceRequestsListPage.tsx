import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useOptionalIdentityId } from '../../auth/context/AuthProvider';
import { RELATION_SCOPE_KEYS, useRelationScope } from '../../enterprise-object';
import { isPersistableValue } from '../../operator';
import { DynamicContextDrawer, useSavedViews, type CrossReference } from '../../engine';
import {
  approveServiceRequest,
  cancelServiceRequest,
  convertServiceRequest,
  getServiceRequest,
  getServiceRequestSummary,
  listServiceRequests,
  rejectServiceRequest,
  startServiceRequestReview,
  submitServiceRequest,
  ServiceRequestsApiError,
} from '../api/service-requests-api';
import { mapRequestErrorToMessage } from '../api/request-error-messages';
import { useServiceRequestCapabilities } from '../hooks/useServiceRequestCapabilities';
import { Button } from '../../ui/Button';
import { Skeleton } from '../../ui/Skeleton';
import {
  DynamicSavedViewsBar,
} from '../../engine';
import {
  SERVICE_REQUEST_LIST_SORTS,
  SERVICE_REQUEST_ORIGINS,
  SERVICE_REQUEST_PRIORITIES,
  SERVICE_REQUEST_STATUSES,
  type ServiceRequestDetail,
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
  ModulePrimaryLink,
} from '../../ui/module-layout';
import { WorklistHeader, WorklistStatePanel } from '../../ui/enterprise-list';
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
 * PESO DO ESTADO — a regra de leitura da work area inteira.
 *
 * Trabalho ABERTO governa o tom da linha; trabalho RESOLVIDO e secundario. E a mesma
 * classificacao que a maquina de estados ja define (o ciclo terminou ou nao), usada apenas
 * para decidir contraste — nenhuma prioridade, risco ou SLA e inferido aqui.
 */
type Workload = 'open' | 'settled';

const WORKLOAD_BY_STATUS: Record<ServiceRequestStatus, Workload> = {
  [SERVICE_REQUEST_STATUSES.Draft]: 'open',
  [SERVICE_REQUEST_STATUSES.Submitted]: 'open',
  [SERVICE_REQUEST_STATUSES.UnderReview]: 'open',
  [SERVICE_REQUEST_STATUSES.Approved]: 'open',
  [SERVICE_REQUEST_STATUSES.Converted]: 'settled',
  [SERVICE_REQUEST_STATUSES.Rejected]: 'settled',
  [SERVICE_REQUEST_STATUSES.Cancelled]: 'settled',
};

const ATTENTION_TONE_CLASS: Record<string, string> = {
  critical: 'text-red-700',
  warning: 'text-amber-700',
  info: 'text-gray-500',
};

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
   * VISOES SALVAS — a fila e reconstruida todo dia com o MESMO recorte. O recorte vive na URL
   * (ver `useQueueUrlSync`), entao salvar a visao preserva o endereco compartilhavel: a visao
   * restaura o recorte OPERACIONAL real, nao um estado visual solto.
   */
  /*
   * DONO REAL — o literal `'local-operator'` foi REMOVIDO.
   *
   * Ele era um namespace compartilhado que não correspondia a nenhuma identidade autenticada: duas
   * contas no mesmo navegador viam as visões uma da outra. A causa era não existir leitura de
   * identidade que não LANÇASSE fora do `AuthProvider`; agora existe, e sem identidade a visão
   * simplesmente não é persistida nem lida.
   */
  const savedViews = useSavedViews(useOptionalIdentityId(), 'service-requests');
  const [selected, setSelected] = useState<ServiceRequestListItem | null>(null);
  // Escopo de relacao (recorte que vem da URL e NAO e editavel no formulario da fila).
  const relationScope = useRelationScope(RELATION_SCOPE_KEYS);
  const [searchInput, setSearchInput] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [listState, setListState] = useState<ListState>({ phase: 'loading' });
  const [summary, setSummary] = useState<ServiceRequestListSummary | null>(null);

  /*
   * CONTEXTO DA SOLICITAÇÃO — detalhe REAL (`GET /service-requests/:id`).
   *
   * A fila publica uma projeção; o detalhe publica `readiness` (prontidão real para converter),
   * `linkedChain` (a LINHAGEM real do processo), documentos e histórico. É o que permite ao
   * operador DECIDIR sem abrir a ficha — e carrega em paralelo com a fila: só o painel espera.
   */
  const [detailState, setDetailState] = useState<
    | { phase: 'idle' }
    | { phase: 'loading' }
    | { phase: 'error'; message: string }
    | { phase: 'ready'; detail: ServiceRequestDetail }
  >({ phase: 'idle' });

  /*
   * MOTIVO DO COMANDO — informado pelo OPERADOR, nunca fabricado.
   * `reject` e `cancel` exigem motivo no contrato: é registro de auditoria. Texto fixo de tela
   * seria o frontend inventando um fato empresarial.
   */
  const [commandReason, setCommandReason] = useState('');
  const [commandBusy, setCommandBusy] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);

  const selectedId = selected?.id ?? null;

  /**
   * RECARGA REAL DA FILA — token monotônico, declarado ANTES de quem o usa.
   *
   * Um comando muda o estado da solicitação; sem este token o efeito de carga não roda de novo e a
   * fila continuaria exibindo o estado anterior ao comando.
   */
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((current) => current + 1), []);

  useEffect(() => {
    if (!selectedId) {
      setDetailState({ phase: 'idle' });
      setCommandReason('');
      setCommandError(null);
      return;
    }
    const controller = new AbortController();
    setDetailState({ phase: 'loading' });
    setCommandError(null);
    void getServiceRequest(selectedId, controller.signal)
      .then((detail) => {
        if (!controller.signal.aborted) {
          setDetailState({ phase: 'ready', detail });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setDetailState({
            phase: 'error',
            message: 'Não foi possível carregar o contexto da solicitação.',
          });
        }
      });
    return () => controller.abort();
  }, [selectedId]);

  /**
   * COMANDO REAL do domínio a partir do contexto. Envia INTENÇÃO + `rowVersion`; quem valida a
   * transição é o backend. `VERSION_CONFLICT` (outro operador agiu antes) não é sobrescrito.
   */
  const runCommand = useCallback(
    async (command: 'submit' | 'review' | 'approve' | 'reject' | 'cancel' | 'convert') => {
      if (!selected) {
        return;
      }
      const rowVersion = selected.rowVersion;
      setCommandBusy(true);
      setCommandError(null);
      try {
        if (command === 'submit') {
          await submitServiceRequest(selected.id, rowVersion);
        } else if (command === 'review') {
          await startServiceRequestReview(selected.id, rowVersion);
        } else if (command === 'approve') {
          await approveServiceRequest(selected.id, rowVersion);
        } else if (command === 'reject') {
          await rejectServiceRequest(selected.id, rowVersion, commandReason);
        } else if (command === 'cancel') {
          await cancelServiceRequest(selected.id, rowVersion, commandReason);
        } else {
          await convertServiceRequest(selected.id, rowVersion);
        }
        setSelected(null);
        reload();
      } catch (error) {
        setCommandError(
          error instanceof ServiceRequestsApiError
            ? mapRequestErrorToMessage(error.code, error.status)
            : 'Não foi possível executar o comando.',
        );
      } finally {
        setCommandBusy(false);
      }
    },
    [commandReason, reload, selected],
  );

  // FILA ENDERECAVEL: os recortes enumerados de estado, prioridade e origem vivem na URL.
  // Somente valores enumerados entram pela URL; texto livre permanece em memoria.
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
  }, [filters, loadPage, reloadToken]);

  const applyFilter = useCallback(<K extends keyof QueueFilters>(key: K, value: QueueFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
  }, []);

  const clearFilters = useCallback(() => {
    setSearchInput('');
    setFilters(EMPTY_FILTERS);
  }, []);

  const hasFilterChips = useMemo(
    () =>
      Boolean(
        filters.status || filters.priority || filters.originSource || filters.search.trim(),
      ),
    [filters],
  );

  if (listState.phase === 'loading') {
    return (
      <ModuleStatePage title="Solicitações">
        <ModuleLoadingState message="Carregando solicitações…" />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'denied') {
    return (
      <ModuleStatePage title="Solicitações">
        <ModuleDeniedState message="Você não tem permissão para listar solicitações." />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'error') {
    return (
      <ModuleStatePage title="Solicitações">
        <ModuleErrorState
          message={listState.message}
          retryable={listState.retryable}
          onRetry={() => void loadPage(0, filters)}
        />
      </ModuleStatePage>
    );
  }

  const { items, offset, hasMore } = listState;
  const now = new Date();
  const total = summary?.total ?? null;
  const scope = describeScope(filters, relationScope.clientId !== undefined);
  const updatedAt = formatRelativePast(latestTimestamp(items), now);
  // Fila vazia sem recorte: a criacao nasce no painel vazio; recorte vazio oferece limpar.
  const isEmptyQueue = items.length === 0 && total === 0 && !hasFilterChips;

  return (
    <ModulePage layout="wide">
      {/*
        SUPERFÍCIE DE TRABALHO FIXA — cabeçalho, faixas de decisão, visões salvas e filtros não
        rolam com a fila: o operador nunca perde o recorte nem a leitura do processo.
      */}
      <div className="sticky top-0 z-20 bg-white" data-region="work-surface">
      {/*
        ZONA 1 — OPERATING HEADER. Uma faixa, nao uma pagina de abertura.
        Identidade, recorte ativo, total AUTORITATIVO do servidor, acao primaria e ultima
        atualizacao. Saiu o paragrafo que explicava a tela: contexto aqui e o RECORTE real.
      */}
      <div data-region="operating-header">
        <WorklistHeader
          title="Solicitações"
          count={total}
          context={updatedAt ? `${scope} · atualizada ${updatedAt}` : scope}
          action={
            capabilities.canCreate && !isEmptyQueue ? (
              <ModulePrimaryLink to="/app/requests/new">Nova solicitação</ModulePrimaryLink>
            ) : null
          }
        />
      </div>

      {/*
        ZONA 2 — DECISION / WORK QUEUE STRIP.
        Nao e um conjunto de cartoes: e uma faixa de estados do PROCESSO. Trabalho ABERTO vem
        primeiro e com peso; resolvido vem depois e em cinza. Cada numero e o publicado pelo
        summary do servidor e cada item APLICA o recorte correspondente na fila.
      */}
      <nav
        aria-label="Faixas de trabalho da fila"
        className="cisne-divider flex flex-wrap items-stretch py-1"
      >
        <QueueStripCell
          label="Pendentes"
          value={summary?.pending ?? null}
          hint="chegaram e ainda não avançaram para análise"
          weight="open"
          active={filters.status === SERVICE_REQUEST_STATUSES.Submitted}
          onClick={() => applyFilter('status', SERVICE_REQUEST_STATUSES.Submitted)}
        />
        <QueueStripCell
          label="Em análise"
          value={summary?.underReview ?? null}
          hint="aguardando decisão de análise"
          weight="open"
          active={filters.status === SERVICE_REQUEST_STATUSES.UnderReview}
          onClick={() => applyFilter('status', SERVICE_REQUEST_STATUSES.UnderReview)}
        />
        <QueueStripCell
          label="Convertidas"
          value={summary?.converted ?? null}
          hint="já geraram ordem de serviço"
          weight="settled"
          active={filters.status === SERVICE_REQUEST_STATUSES.Converted}
          onClick={() => applyFilter('status', SERVICE_REQUEST_STATUSES.Converted)}
        />
        <QueueStripCell
          label="Canceladas"
          value={summary?.cancelled ?? null}
          hint="encerradas sem conversão"
          weight="settled"
          active={filters.status === SERVICE_REQUEST_STATUSES.Cancelled}
          onClick={() => applyFilter('status', SERVICE_REQUEST_STATUSES.Cancelled)}
        />
      </nav>

      {/*
        SAVED VIEWS — FAIXA PRÓPRIA DA WORK AREA, não menu escondido.

        Antes era `SavedViewsMenu`: um botão "Visões" que abria um formulário de salvar. O recorte
        que o operador remonta todo dia — situação, prioridade, origem, unidade, janela desejada —
        passa a ser comando visível da superfície de trabalho, com a visão aplicada evidente.
      */}
      <div className="cisne-divider py-0.5" data-region="saved-view-surface">
        <DynamicSavedViewsBar
          views={savedViews.views}
          persistedLocally={savedViews.persistedLocally}
          persistable={savedViews.persistable}
          onSave={(name) => savedViews.save(name, { ...filters }, 'list')}
          onDelete={savedViews.remove}
          onApply={(view) => {
            const restored: QueueFilters = {
              status: (view.filters['status'] ?? '') as QueueFilters['status'],
              priority: (view.filters['priority'] ?? '') as QueueFilters['priority'],
              originSource: (view.filters['originSource'] ?? '') as QueueFilters['originSource'],
              unitId: view.filters['unitId'] ?? '',
              desiredFrom: view.filters['desiredFrom'] ?? '',
              desiredTo: view.filters['desiredTo'] ?? '',
              search: view.filters['search'] ?? '',
              sort: (view.filters['sort'] || EMPTY_FILTERS.sort) as QueueFilters['sort'],
              direction: (view.filters['direction'] ||
                EMPTY_FILTERS.direction) as QueueFilters['direction'],
            };
            setFilters(restored);
            setSearchInput(restored.search);
          }}
        />
      </div>

      {/*
        ZONA 3 — VIEW + COMMAND SURFACE. UMA barra: segmentos de recorte, busca, situação,
        mais filtros, visões salvas e o recorte ativo — tudo na mesma altura de linha.
        O formulario permanente de SEIS controles saiu; nada foi removido do contrato.
      */}
      <div
        data-region="command-filter-surface"
        className="cisne-divider flex flex-wrap items-center gap-x-2 gap-y-1 px-0 py-1.5"
      >
        <div
          role="group"
          aria-label="Recorte de situação"
          className="flex items-center overflow-hidden rounded border border-gray-300 bg-white"
        >
          {(
            [
              ['all', 'Todos', ''],
              ['submitted', 'Pendentes', SERVICE_REQUEST_STATUSES.Submitted],
              ['review', 'Em análise', SERVICE_REQUEST_STATUSES.UnderReview],
            ] as const
          ).map(([key, label, value]) => {
            const active = filters.status === value;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                className={cn(
                  'min-h-8 border-r border-gray-200 px-2.5 py-1 cisne-type-body font-medium last:border-r-0',
                  active
                    ? 'bg-brand-700 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                )}
                onClick={() => applyFilter('status', value)}
              >
                {label}
              </button>
            );
          })}
        </div>

        <form
          className="flex min-w-56 flex-1 items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            applyFilter('search', searchInput);
          }}
        >
          <input
            id="request-search-filter"
            type="search"
            aria-label="Buscar solicitação"
            className="min-h-8 w-full min-w-0 rounded border border-gray-300 bg-white px-2 py-1 cisne-type-body text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Buscar solicitação…"
          />
        </form>

        <label htmlFor="request-status-filter" className="sr-only">
          Situação
        </label>
        <select
          id="request-status-filter"
          className="min-h-8 rounded border border-gray-300 bg-white px-2 py-1 cisne-type-body text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
          value={filters.status}
          onChange={(event) =>
            applyFilter('status', event.target.value as '' | ServiceRequestStatus)
          }
        >
          <option value="">Situação: todas</option>
          {Object.values(SERVICE_REQUEST_STATUSES).map((status) => (
            <option key={status} value={status}>
              {formatServiceRequestStatus(status)}
            </option>
          ))}
        </select>

        <button
          type="button"
          aria-expanded={moreOpen}
          className="min-h-8 rounded border border-gray-300 bg-white px-2 py-1 cisne-type-body font-medium text-gray-700 hover:bg-gray-50"
          onClick={() => setMoreOpen((current) => !current)}
        >
          {moreOpen ? 'Menos filtros' : 'Mais filtros'}
        </button>

        {moreOpen ? (
          <>
            <select
              aria-label="Prioridade"
              className="min-h-8 rounded border border-gray-300 bg-white px-2 py-1 cisne-type-body"
              value={filters.priority}
              onChange={(event) =>
                applyFilter('priority', event.target.value as '' | ServiceRequestPriority)
              }
            >
              <option value="">Prioridade: todas</option>
              {Object.values(SERVICE_REQUEST_PRIORITIES).map((priority) => (
                <option key={priority} value={priority}>
                  {formatServiceRequestPriority(priority)}
                </option>
              ))}
            </select>
            <select
              aria-label="Origem"
              className="min-h-8 rounded border border-gray-300 bg-white px-2 py-1 cisne-type-body"
              value={filters.originSource}
              onChange={(event) =>
                applyFilter('originSource', event.target.value as '' | ServiceRequestOrigin)
              }
            >
              <option value="">Origem: todas</option>
              {Object.values(SERVICE_REQUEST_ORIGINS).map((origin) => (
                <option key={origin} value={origin}>
                  {formatServiceRequestOrigin(origin)}
                </option>
              ))}
            </select>
            <select
              aria-label="Ordenar por"
              className="min-h-8 rounded border border-gray-300 bg-white px-2 py-1 cisne-type-body"
              value={filters.sort}
              onChange={(event) =>
                applyFilter('sort', event.target.value as ServiceRequestListSort)
              }
            >
              {Object.values(SERVICE_REQUEST_LIST_SORTS).map((sort) => (
                <option key={sort} value={sort}>
                  Ordenar: {SORT_LABELS[sort]}
                </option>
              ))}
            </select>
            <select
              aria-label="Sentido"
              className="min-h-8 rounded border border-gray-300 bg-white px-2 py-1 cisne-type-body"
              value={filters.direction}
              onChange={(event) =>
                applyFilter('direction', event.target.value as ServiceRequestListDirection)
              }
            >
              <option value="desc">Decrescente</option>
              <option value="asc">Crescente</option>
            </select>
          </>
        ) : null}

        {hasFilterChips ? (
          <button
            type="button"
            className="min-h-8 rounded border border-gray-300 bg-white px-2 py-1 cisne-type-body font-medium text-gray-700 hover:bg-gray-50"
            onClick={clearFilters}
          >
            Limpar filtros
          </button>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <span className="cisne-type-helper text-gray-500 tabular-nums">
            {items.length} nesta página
          </span>
        </div>
      </div>
      </div>


      {/*
        ZONA 4 — PROCESSING SURFACE. A area de trabalho: identidade, decisao e metadado em
        hierarquia, com barra de acento pelo PESO do estado. O clique na linha abre o contexto        ao lado; o codigo continua sendo o link para a ficha completa.
      */}
      {items.length === 0 ? (
        <section aria-label="Fila operacional de solicitações" className="border-b border-gray-200" data-region="worklist-master">
          <div className="flex items-center gap-3 border-b border-gray-100 bg-gray-50/80 px-2 py-1 text-[length:var(--type-micro-size)] font-semibold tracking-wide text-gray-500 uppercase">
            <span>Solicitação e demanda</span>
            <span className="ml-auto">Situação</span>
            <span className="w-28 shrink-0 text-right">Idade</span>
          </div>
          <div className="px-1 py-3">
            <WorklistStatePanel
              title={
                hasFilterChips
                  ? 'Nenhuma solicitação corresponde aos filtros aplicados.'
                  : 'Nenhuma solicitação registrada.'
              }
              description={
                hasFilterChips
                  ? 'Ajuste a busca, a situação ou a prioridade — ou limpe os filtros para ver a fila completa.'
                  : 'Quando a primeira solicitação chegar, ela aparece aqui com prioridade, janela desejada e próximo passo.'
              }
              action={
                hasFilterChips ? (
                  <button
                    type="button"
                    className="min-h-8 rounded border border-gray-300 bg-white px-2 py-1 cisne-type-body font-medium text-gray-700 hover:bg-gray-50"
                    onClick={clearFilters}
                  >
                    Limpar filtros
                  </button>
                ) : capabilities.canCreate ? (
                  <ModulePrimaryLink to="/app/requests/new">Nova solicitação</ModulePrimaryLink>
                ) : null
              }
            />
          </div>
        </section>
      ) : (
        <section aria-label="Fila operacional de solicitações" className="border-b border-gray-200" data-region="worklist-master">
          <div className="flex items-center gap-3 border-b border-gray-100 bg-gray-50/80 px-2 py-1 text-[length:var(--type-micro-size)] font-semibold tracking-wide text-gray-500 uppercase">
            <span>Solicitação e demanda</span>
            <span className="ml-auto">Situação</span>
            <span className="w-28 shrink-0 text-right">Idade</span>
          </div>
          <ul className="m-0 list-none p-0">
            {items.map((item) => (
              <ProcessingRow
                key={item.id}
                item={item}
                now={now}
                selected={selected?.id === item.id}
                onSelect={() => setSelected(item)}
              />
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-2">
        <p className="m-0 cisne-type-helper text-gray-400">
          {offset + 1}–{offset + items.length} nesta página · janela desejada é expectativa
          registrada, não prazo contratado.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded border border-gray-300 bg-white px-2 py-1 cisne-type-body font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={offset === 0}
            onClick={() => void loadPage(Math.max(0, offset - PAGE_SIZE), filters)}
          >
            Anterior
          </button>
          <span className="cisne-type-helper text-gray-500 tabular-nums">
            Página {Math.floor(offset / PAGE_SIZE) + 1}
          </span>
          <button
            type="button"
            className="rounded border border-gray-300 bg-white px-2 py-1 cisne-type-body font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!hasMore}
            onClick={() => void loadPage(offset + PAGE_SIZE, filters)}
          >
            Próxima
          </button>
        </div>
      </div>

      {/*
        BUSINESS CONTEXT SOB DEMANDA — a fila nao e abandonada para entender o registro.
        As referencias vem do payload da LINHA: contagem de propostas ou de OS nao e publicada
        por esta listagem, entao nenhuma e afirmada.
      */}
      <DynamicContextDrawer
        open={selected !== null}
        title="Contexto da solicitação"
        onClose={() => setSelected(null)}
        crossReferences={selected ? requestContextRows(selected, now) : []}
      >
        <div data-region="context-region">
          {selected ? (
            <p className="cisne-type-primary m-0 mb-2 truncate">{selected.requestCode}</p>
          ) : null}

          {detailState.phase === 'loading' ? (
            /* SKELETON LOCALIZADO — só o painel espera; a fila segue utilizável. */
            <div aria-busy="true" role="status" className="flex flex-col gap-1.5">
              <span className="cisne-type-helper">Carregando contexto…</span>
              <Skeleton lines={4} />
            </div>
          ) : null}

          {detailState.phase === 'error' ? (
            <p className="cisne-type-body m-0 text-red-700" role="alert">
              {detailState.message}
            </p>
          ) : null}

          {detailState.phase === 'ready' ? (
            <>
              {/*
                PRONTIDÃO PARA CONVERTER — fato REAL do detalhe (`readiness`), não um KPI
                decorativo: é ele que diz se a solicitação pode virar OS e o que ainda falta.
              */}
              {detailState.detail.readiness.blockers.length > 0 ? (
                <div className="mb-2">
                  <h3 className="cisne-section-title m-0 mb-1">Pendências para converter</h3>
                  <ul className="m-0 flex list-none flex-col gap-0 p-0">
                    {detailState.detail.readiness.blockers.map((blocker) => (
                      <li key={blocker} className="cisne-type-helper text-amber-700">
                        {blocker}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="cisne-type-helper m-0 mb-2">
                  Sem pendências conhecidas para conversão em ordem de serviço.
                </p>
              )}

              {/* LINHAGEM REAL do processo — só o que o detalhe publica. */}
              {detailState.detail.linkedChain.length > 0 ? (
                <div className="cisne-divider--top mb-2 pt-2">
                  <h3 className="cisne-section-title m-0 mb-1">Linhagem</h3>
                  <ul className="m-0 flex list-none flex-col gap-0 p-0">
                    {detailState.detail.linkedChain.map((node) => (
                      <li key={`${node.kind}:${node.id}`} className="cisne-type-meta truncate">
                        {node.kind}
                        {node.label ? ` · ${node.label}` : ''}
                        {node.status ? ` · ${node.status}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/*
                COMMAND LAYER — comandos REAIS do domínio, guardados pelas CAPABILITIES reais.
                Cada botão é uma TRANSIÇÃO de processo (não `PATCH status`). Rejeitar e cancelar
                exigem motivo digitado: o campo é do operador, porque motivo é auditoria.
              */}
              <div className="cisne-divider--top mt-2 pt-2">
                {(capabilities.canReject || capabilities.canCancel) ? (
                  <label className="mb-1 block">
                    <span className="cisne-meta-label mb-0.5 block">
                      Motivo (obrigatório para rejeitar ou cancelar)
                    </span>
                    <input
                      type="text"
                      className="min-h-[var(--control-height)] w-full rounded-md border-0 bg-white px-1.5 text-[length:var(--type-body-size)] ring-1 ring-gray-300 ring-inset outline-none focus:ring-2 focus:ring-brand-500"
                      value={commandReason}
                      onChange={(event) => setCommandReason(event.target.value)}
                      placeholder="Informe o motivo real"
                    />
                  </label>
                ) : null}

                <div className="flex flex-wrap items-center gap-1.5">
                  {capabilities.canSubmit ? (
                    <Button
                      variant="secondary"
                      loading={commandBusy}
                      onClick={() => void runCommand('submit')}
                    >
                      Enviar
                    </Button>
                  ) : null}
                  {capabilities.canReview ? (
                    <Button
                      variant="secondary"
                      loading={commandBusy}
                      onClick={() => void runCommand('review')}
                    >
                      Iniciar análise
                    </Button>
                  ) : null}
                  {capabilities.canApprove ? (
                    <Button
                      variant="primary"
                      loading={commandBusy}
                      onClick={() => void runCommand('approve')}
                    >
                      Aprovar
                    </Button>
                  ) : null}
                  {capabilities.canReject ? (
                    <Button
                      variant="secondary"
                      disabled={commandReason.trim() === ''}
                      loading={commandBusy}
                      title={commandReason.trim() === '' ? 'Informe o motivo para executar' : undefined}
                      onClick={() => void runCommand('reject')}
                    >
                      Rejeitar
                    </Button>
                  ) : null}
                  {capabilities.canCancel ? (
                    <Button
                      variant="secondary"
                      disabled={commandReason.trim() === ''}
                      loading={commandBusy}
                      title={commandReason.trim() === '' ? 'Informe o motivo para executar' : undefined}
                      onClick={() => void runCommand('cancel')}
                    >
                      Cancelar
                    </Button>
                  ) : null}
                  <Button
                    variant="secondary"
                    loading={commandBusy}
                    disabled={detailState.detail.readiness.blockers.length > 0}
                    title={
                      detailState.detail.readiness.blockers.length > 0
                        ? 'Existem pendências registradas para a conversão'
                        : undefined
                    }
                    onClick={() => void runCommand('convert')}
                  >
                    Converter em OS
                  </Button>
                </div>

                {commandError ? (
                  <p className="cisne-type-helper m-0 mt-1.5 text-red-700" role="alert">
                    {commandError}
                  </p>
                ) : null}
              </div>

              {/* DRILLBACK ÚNICO — uma vez por registro selecionado, nunca por linha. */}
              <div className="cisne-divider--top mt-2 pt-2">
                <Link
                  to={`/app/requests/${detailState.detail.serviceRequest.id}`}
                  className="cisne-type-action text-brand-700 no-underline hover:underline"
                >
                  Abrir ficha completa
                </Link>
              </div>
            </>
          ) : null}
        </div>
      </DynamicContextDrawer>
    </ModulePage>
  );
}

/**
 * CELULA DA FAIXA DE TRABALHO — numero autoritativo + recorte em UM controle.
 *
 * Sem numero publicado (`null`), a celula declara a ausencia: `0` afirmaria um recorte
 * inexistente (`AUSÊNCIA ≠ ZERO`). O peso visual segue o estado: aberto tem contraste de
 * leitura, resolvido e secundario.
 */
function QueueStripCell({
  label,
  value,
  hint,
  weight,
  active,
  onClick,
}: {
  label: string;
  value: number | null;
  hint: string;
  weight: 'open' | 'settled';
  active: boolean;
  onClick: () => void;
}) {
  const isOpen = weight === 'open';
  return (
    <button
      type="button"
      aria-pressed={active}
      title={hint}
      onClick={onClick}
      className={cn(
        'flex min-w-[9.5rem] flex-1 flex-col items-start gap-0.5 border-r border-gray-200 px-3 py-1.5 text-left transition-colors last:border-r-0',
        active ? 'bg-brand-50' : 'hover:bg-gray-50',
      )}
    >
      <span className="flex items-baseline gap-1.5">
        <span
          className={cn(
            'cisne-type-object leading-none font-semibold tabular-nums',
            value === null
              ? 'text-gray-300'
              : isOpen
                ? 'text-gray-900'
                : 'text-gray-500',
          )}
        >
          {value === null ? 'n/d' : value}
        </span>
        <span
          className={cn(
            'cisne-type-helper font-medium tracking-wide uppercase',
            isOpen ? 'text-gray-700' : 'text-gray-400',
          )}
        >
          {label}
        </span>
      </span>
      <span className="cisne-type-helper truncate">{hint}</span>
    </button>
  );
}

/**
 * LINHA DE PROCESSAMENTO — identidade primeiro, decisao segundo, metadado depois.
 *
 * A barra de acento a esquerda codifica PESO: trabalho aberto tem acento; resolvido nao.
 * Nao existe coluna de acoes: a linha inteira abre o contexto e o codigo leva a ficha.
 */
function ProcessingRow({
  item,
  now,
  selected,
  onSelect,
}: {
  item: ServiceRequestListItem;
  now: Date;
  selected: boolean;
  onSelect: () => void;
}) {
  const workload = WORKLOAD_BY_STATUS[item.status];
  const isOpen = workload === 'open';
  /*
   * EXCEPTION-FIRST sem repetir coluna: prioridade e janela ja tem lugar proprio na linha,
   * entao a faixa de decisao carrega SOMENTE o que aquelas colunas nao dizem — dado
   * ausente que muda a leitura (cliente nao identificado, periodo nao informado). Sem
   * excecao propria, a linha nao ganha ruido.
   */
  const exceptions = describeServiceRequestAttention(item, now).filter(
    (fact) => fact.code === 'CLIENT_UNIDENTIFIED' || fact.code === 'DESIRED_WINDOW_MISSING',
  );
  const timing = describeDesiredWindowTiming(item.desiredStartAt, now);
  const age = formatRelativePast(item.createdAt, now);
  const location = [item.location?.label, item.location?.city, item.location?.state]
    .filter(Boolean)
    .join(' · ');
  const demand = summarizeServiceRequestDescription(item.description);

  return (
    <li
      onClick={onSelect}
      className={cn(
        'relative grid cursor-pointer grid-cols-1 gap-x-3 gap-y-0 border-b border-gray-100 py-1 pr-2 pl-3 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_9.5rem_7rem]',
        'before:absolute before:top-1.5 before:bottom-1.5 before:left-0 before:w-[3px] before:content-[""]',
        selected
          ? 'bg-brand-50 before:bg-brand-700'
          : isOpen
            ? 'before:bg-amber-400 hover:bg-gray-50/70'
            : 'before:bg-transparent hover:bg-gray-50/70',
      )}
    >
      {/* IDENTIDADE — o operador reconhece a linha por aqui. */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <Link
            to={`/app/requests/${item.id}`}
            onClick={(event) => event.stopPropagation()}
            className="cisne-type-primary text-brand-800 no-underline hover:underline"
          >
            {item.requestCode}
          </Link>
          <span className="cisne-type-meta text-gray-800">{item.clientName ?? 'Cliente não identificado'}</span>
          <span className="cisne-type-helper text-gray-400">
            {formatServiceRequestOrigin(item.originSource)}
          </span>
        </div>
        <p className="mt-0.5 line-clamp-1 cisne-type-meta text-gray-500">{demand}</p>
        <p className="mt-0.5 truncate cisne-type-helper text-gray-400">
          {[location, `criada ${age ?? 'sem data'}`].filter(Boolean).join(' · ')}
        </p>
      </div>

      {/* DECISÃO — estado e próximo passo, o que muda a leitura da linha. */}
      <div className="min-w-0">
        <span
          className={cn(
            'cisne-type-body font-semibold',
            isOpen ? 'text-gray-900' : 'text-gray-500',
          )}
        >
          {formatServiceRequestStatus(item.status)}
        </span>
        <p
          className={cn(
            'mt-0.5 truncate cisne-type-meta',
            isOpen ? 'font-medium text-gray-800' : 'text-gray-400',
          )}
        >
          {NEXT_STEP_BY_STATUS[item.status]}
        </p>
        {exceptions.length > 0 ? (
          <p className="mt-0.5 flex flex-wrap gap-x-3 cisne-type-helper">
            {exceptions.map((fact) => (
              <span key={fact.code} className={ATTENTION_TONE_CLASS[fact.tone]}>
                {fact.text}
              </span>
            ))}
          </p>
        ) : null}
      </div>

      {/* METADADO — prioridade e janela: qualificam a decisao, nao a antecedem. */}
      <div className="min-w-0 lg:text-right">
        <span
          className={cn(
            'cisne-type-body font-medium',
            item.priority === SERVICE_REQUEST_PRIORITIES.Urgent
              ? 'text-red-700'
              : item.priority === SERVICE_REQUEST_PRIORITIES.High
                ? 'text-amber-700'
                : 'text-gray-500',
          )}
        >
          {formatServiceRequestPriority(item.priority)}
        </span>
        {/*
          JANELA DESEJADA como fato temporal. Quando o inicio desejado ja passou, o fato ja
          foi dito na faixa de DECISAO (com o tom de atencao) — repetir aqui seria a mesma
          informacao duas vezes na mesma linha. A janela COMPLETA (com data) fica no painel
          de contexto.
        */}
        <p
          className={cn(
            'mt-0.5 truncate cisne-type-helper tabular-nums',
            timing?.tone === 'today'
              ? 'font-medium text-amber-700'
              : timing?.tone === 'past'
                ? 'text-gray-400'
                : 'text-gray-400',
          )}
        >
          {timing && timing.tone !== 'past' ? timing.text : age ?? 'sem data de criação'}
        </p>
        <span className="sr-only">Última atualização: {age ?? 'sem data'}</span>
      </div>
    </li>
  );
}

/**
 * ACAO SEMANTICA — so quando existe capacidade real.
 *
 * O destino da acao principal e a object page, que executa a transicao com o contrato de
 * escrita (rowVersion, idempotencia, autorizacao). Sem capability, o painel declara a
 * ausencia em vez de oferecer um botao que o servidor negaria.
 */

/** Recorte ativo, em uma linha — o cabecalho declara sobre o que a fila esta recortada. */
function describeScope(filters: QueueFilters, hasRelationScope: boolean): string {
  const parts: string[] = [];
  if (filters.status) {
    parts.push(formatServiceRequestStatus(filters.status));
  }
  if (filters.priority) {
    parts.push(formatServiceRequestPriority(filters.priority));
  }
  if (filters.originSource) {
    parts.push(formatServiceRequestOrigin(filters.originSource));
  }
  if (filters.search.trim()) {
    parts.push(`busca "${filters.search.trim()}"`);
  }
  if (hasRelationScope) {
    parts.push('cliente no escopo');
  }
  return parts.length > 0 ? `recorte: ${parts.join(' · ')}` : 'fila completa';
}

/** Timestamp mais recente da PAGINA carregada — declarado como "nesta página". */
function latestTimestamp(items: ServiceRequestListItem[]): string | null {
  let latest: number | null = null;
  for (const item of items) {
    const value = new Date(item.updatedAt).getTime();
    if (!Number.isNaN(value) && (latest === null || value > latest)) {
      latest = value;
    }
  }
  return latest === null ? null : new Date(latest).toISOString();
}

/**
 * Referencias do painel de contexto, a partir do payload da LINHA.
 *
 * Cada item entra so quando o campo existe; a ausencia e DECLARADA, nunca preenchida com
 * zero ou com identificador tecnico.
 */
function requestContextRows(
  item: ServiceRequestListItem,
  now: Date,
): CrossReference[] {
  const references: CrossReference[] = [];
  references.push({
    label: 'Demanda',
    detail: summarizeServiceRequestDescription(item.description),
  });
  references.push({
    label: 'Cliente',
    detail: item.clientName ?? 'Cliente não identificado',
  });
  references.push({
    label: 'Origem',
    detail: formatServiceRequestOrigin(item.originSource),
  });
  if (item.externalContact?.name) {
    references.push({ label: 'Solicitante', detail: item.externalContact.name });
  }
  references.push({
    label: 'Situação',
    detail: formatServiceRequestStatus(item.status),
  });
  references.push({
    label: 'Prioridade',
    detail: formatServiceRequestPriority(item.priority),
  });
  references.push({
    label: 'Próximo passo',
    detail: NEXT_STEP_BY_STATUS[item.status],
  });
  references.push({
    label: 'Janela desejada',
    detail: formatDesiredWindow(item.desiredStartAt, item.desiredEndAt),
  });
  const created = formatRelativePast(item.createdAt, now);
  if (created) {
    references.push({ label: 'Criada', detail: created });
  }
  const updated = formatRelativePast(item.updatedAt, now);
  if (updated) {
    references.push({ label: 'Atualizada', detail: updated });
  }
  if (item.serviceLabel) {
    references.push({ label: 'Serviço', detail: item.serviceLabel });
  }
  return references;
}

/**
 * Peso do estado — exportado para leitura em teste; nao amplia a superficie da pagina.
 */
export const __workloadByStatus = WORKLOAD_BY_STATUS;
