import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ClientsApiError, listClients } from '../api/clients-api';
import { mapClientErrorToMessage } from '../api/client-error-messages';
import { ClientStatusBadge } from '../components/ClientStatusBadge';
import { useClientCapabilities } from '../hooks/useClientCapabilities';
import {
  CLIENT_LIST_SORTS,
  CLIENT_STATUSES,
  PURCHASE_ORDER_REQUIREMENTS,
  type ClientListResponse,
  type ClientListSort,
  type ClientSummary,
} from '../types/client.types';
import { formatCnpjDisplay } from '../utils/format-cnpj';
import {
  buildClientListSearchParams,
  CLIENT_SEARCH_MIN_LENGTH,
  EMPTY_CLIENT_LIST_PARAMS,
  hasActiveClientListFilters,
  isApplicableClientSearchTerm,
  parseClientListParams,
  toggleClientListSort,
  type ClientListParams,
} from '../utils/client-list-params';
import { useSavedViews, SavedViewsBar } from '../../operator';
import { ContextDrawer, useContextPreview, type ContextPreviewBody } from '../../operator';
import {
  CLIENTS_ALLOWED_FILTERS,
  clientViewConfig,
  clientViewToParams,
  hasSavableViewConfig,
} from '../utils/client-view-config';
import {
  formatClientCount,
  formatClientListDateTime,
  formatClientListRelative,
  formatClientRangeLabel,
  formatPurchaseOrderRequirement,
} from '../utils/client-list-labels';
import {
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModuleStatePage,
  ModulePagination,
  ModulePrimaryLink,
} from '../../ui/module-layout';
import { WorklistStatePanel } from '../../ui/enterprise-list';
import { cn } from '../../ui/utils/cn';

const PAGE_SIZE = 20;

const SEARCH_DEBOUNCE_MS = 300;

type ListState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error'; message: string; retryable: boolean }
  | { phase: 'ready'; response: ClientListResponse };

type SortColumn = ClientListSort;

function ariaSortFor(
  filters: ClientListParams,
  column: SortColumn,
): 'ascending' | 'descending' | 'none' {
  if (filters.sort !== column) {
    return 'none';
  }
  return filters.direction === 'asc' ? 'ascending' : 'descending';
}

function sortIndicator(filters: ClientListParams, column: SortColumn): string {
  if (filters.sort !== column) {
    return '';
  }
  return filters.direction === 'asc' ? '↑' : '↓';
}

/** Rotulo humano da situacao — o MESMO usado pelo badge, sem o pill. */
function clientStatusLabel(status: ClientSummary['status']): string {
  return status === CLIENT_STATUSES.Active ? 'Ativo' : 'Inativo';
}

/**
 * PROXIMA ACAO de um cadastro, derivada do ESTADO real e da CAPABILITY real.
 *
 * Cadastro ativo e a condicao normal da carteira: nao ha trabalho pendente, entao a acao e a
 * leitura do objeto. Cadastro inativo e a EXCECAO — ele nao pode ser usado em novas
 * solicitacoes, propostas, pedidos nem faturamento, e por isso pede o operador.
 *
 * O destino e a object page, e nao uma transicao disparada da linha: a projecao de listagem
 * (`ClientSummary`) NAO publica `version`, e `deactivate`/`activate` exigem `version` para
 * preservar concorrencia otimista. Executar daqui exigiria uma busca extra por linha — entao a
 * linha faz DRILLBACK para onde o comando real roda com o contrato de escrita intacto.
 * PARK registrado: publicar `version` na listagem para habilitar o comando em linha.
 */
function clientNextAction(
  client: ClientSummary,
  capabilities: { canActivate: boolean; canDeactivate: boolean; canRead: boolean },
): { label: string; pending: boolean } {
  if (client.status === CLIENT_STATUSES.Inactive) {
    return capabilities.canActivate
      ? { label: 'Reativar cadastro', pending: true }
      : { label: 'Cadastro inativo', pending: false };
  }
  if (capabilities.canDeactivate) {
    return { label: 'Abrir cadastro', pending: false };
  }
  return { label: capabilities.canRead ? 'Abrir cadastro' : 'Sem ação disponível', pending: false };
}

export function ClientsListPage() {
  const { capabilities } = useClientCapabilities();
  const [searchParams, setSearchParams] = useSearchParams();

  /**
   * Visões salvas do Comercial. Guardam apenas status, coluna de ordenação e
   * direção — nunca o termo de busca, que é texto livre do operador e poderia
   * conter razão social ou CNPJ (ver `client-view-config`).
   *
   * A BARRA NÃO É MAIS CHROME PERMANENTE: ela vive atrás do menu "Visões" da command surface,
   * para que o operador não leia um formulário de salvar antes de ver o primeiro Cliente.
   * A implementação é a MESMA (`operator/smart-list/SavedViewsBar`) — nenhuma engine paralela.
   */
  const savedViews = useSavedViews('commercial.clients', [], CLIENTS_ALLOWED_FILTERS);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [viewsOpen, setViewsOpen] = useState(false);

  // Busca, filtros, ordenação e página vivem na URL: recarregar não perde contexto, o botão
  // voltar funciona e o endereço é compartilhável.
  const filters = useMemo(() => parseClientListParams(searchParams), [searchParams]);
  const offset = useMemo(() => {
    const raw = Number(searchParams.get('offset') ?? '0');
    return Number.isInteger(raw) && raw > 0 ? raw : 0;
  }, [searchParams]);

  const [listState, setListState] = useState<ListState>({ phase: 'loading' });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [searchInput, setSearchInput] = useState(filters.q);
  const [showMoreFilters, setShowMoreFilters] = useState(
    () => filters.purchaseOrderRequirement !== '',
  );
  // CONTEXTO SEM SAIR DA FILA: selecionar o cliente abre o painel lateral com os fatos que o
  // payload da lista já traz e as relações que têm destino real. Nenhuma contagem de
  // solicitações/propostas/OS é exibida porque o contrato de listagem não a publica.
  const preview = useContextPreview<ClientSummary>();
  const searchInputId = useId();
  const searchHintId = useId();
  const statusFilterId = useId();
  const moreFiltersId = useId();
  const requirementFilterId = useId();

  const searchDraftTooShort =
    searchInput.trim().length > 0 && !isApplicableClientSearchTerm(searchInput);

  useEffect(() => {
    setSearchInput(filters.q);
  }, [filters.q]);

  const applyFilters = useCallback(
    (next: Partial<ClientListParams>) => {
      const merged = { ...filters, ...next };
      setSearchParams(buildClientListSearchParams(merged, 0), { replace: true });
    },
    [filters, setSearchParams],
  );

  const clearFilters = useCallback(() => {
    setSearchInput('');
    setViewsOpen(false);
    setSearchParams(buildClientListSearchParams(EMPTY_CLIENT_LIST_PARAMS), { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    if (searchInput === filters.q) {
      return;
    }
    if (!isApplicableClientSearchTerm(searchInput)) {
      return;
    }
    const timer = setTimeout(() => {
      applyFilters({ q: searchInput });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [applyFilters, filters.q, searchInput]);

  const loadPage = useCallback(
    async (activeFilters: ClientListParams, pageOffset: number, signal?: AbortSignal) => {
      setListState((previous) => (previous.phase === 'ready' ? previous : { phase: 'loading' }));
      setIsRefreshing(true);
      try {
        const response = await listClients(
          {
            limit: PAGE_SIZE,
            offset: pageOffset,
            q: activeFilters.q.trim() || undefined,
            status: activeFilters.status || undefined,
            purchaseOrderRequirement: activeFilters.purchaseOrderRequirement || undefined,
            sort: activeFilters.sort,
            direction: activeFilters.direction,
          },
          signal,
        );
        if (signal?.aborted) {
          return;
        }
        setListState({ phase: 'ready', response });
      } catch (error) {
        if (signal?.aborted) {
          return;
        }
        if (error instanceof ClientsApiError) {
          if (error.kind === 'denied') {
            setListState({ phase: 'denied' });
            return;
          }
          setListState({
            phase: 'error',
            message: mapClientErrorToMessage(error.code, error.status),
            retryable: error.kind === 'network' || error.kind === 'unknown',
          });
          return;
        }
        setListState({
          phase: 'error',
          message: 'Não foi possível carregar os Clientes.',
          retryable: true,
        });
      } finally {
        if (!signal?.aborted) {
          setIsRefreshing(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadPage(filters, offset, controller.signal);
    return () => controller.abort();
  }, [filters, loadPage, offset, reloadToken]);

  if (listState.phase === 'loading') {
    return (
      <ModuleStatePage title="Clientes">
        <ModuleLoadingState message="Carregando Clientes…" />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'denied') {
    return (
      <ModuleStatePage title="Clientes">
        <ModuleDeniedState message="Você não tem permissão para listar Clientes." />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'error') {
    return (
      <ModuleStatePage title="Clientes">
        <ModuleErrorState
          message={listState.message}
          retryable={listState.retryable}
          onRetry={() => setReloadToken((current) => current + 1)}
        />
      </ModuleStatePage>
    );
  }

  const { items, total, totalPages } = listState.response;
  const hasFilters = hasActiveClientListFilters(filters);
  const hasCatalog = total > 0;
  const isOutOfRange = items.length === 0 && total > 0;
  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1;
  const isEmptyCatalogue = items.length === 0 && total === 0 && !hasFilters;
  const isNoResults = items.length === 0 && total === 0 && hasFilters;

  const now = new Date();
  const navigateToClient = capabilities.canRead
    ? (client: ClientSummary) => `/app/clients/${client.id}`
    : null;

  /**
   * CONTEXTO DA CARTEIRA — contagens reais da PAGINA carregada, nunca estimadas.
   *
   * `total` e o total AUTORIZADO que o servidor informa sob os filtros atuais; ativos/inativos
   * sao contados sobre as linhas que voltaram e por isso sao rotulados "nesta página". Nenhum
   * numero e inventado: o que a faixa mostra e exatamente o que a consulta autorizada devolveu.
   */
  const activeOnPage = items.filter((client) => client.status === CLIENT_STATUSES.Active).length;
  const inactiveOnPage = items.length - activeOnPage;
  const scope = describeClientScope(filters);

  return (
    <ModulePage>
      {/*
        ZONA 1 — OPERATING HEADER. Uma faixa, nao uma pagina de abertura.

        A tela abria com titulo + PARAGRAFO explicando o modulo + TRES chips + barra de filtros +
        barra de visoes salvas: cinco blocos de chrome antes do primeiro Cliente. Agora a
        identidade, o total AUTORITATIVO, o recorte ativo e a acao primaria dividem UMA linha.
      */}
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-gray-200 px-1 pb-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="text-[17px] leading-tight font-semibold tracking-tight text-gray-900">
            Clientes
          </h1>
          {hasCatalog ? (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold text-gray-700 tabular-nums">
              {formatClientCount(total)}
            </span>
          ) : null}
          <span className="truncate text-[11px] text-gray-500">{scope}</span>
          {isRefreshing ? (
            <span role="status" className="text-[11px] text-gray-400">
              atualizando…
            </span>
          ) : null}
        </div>
        {capabilities.canCreate ? (
          <ModulePrimaryLink to="/app/clients/new" className="min-h-0 px-3 py-1 text-[13px]">
            Novo cliente
          </ModulePrimaryLink>
        ) : null}
      </header>

      {/*
        ZONA 2 — WORK QUEUE STRIP. A carteira tem UM eixo de decisao: cadastro que ainda pode
        operar e cadastro que nao pode. Trabalho ABERTO (inativo) tem peso; o resto e leitura.
        Cada celula APLICA o recorte — nao e um painel decorativo.
      */}
      {hasCatalog ? (
        <nav
          aria-label="Recortes da carteira"
          className="flex flex-wrap items-stretch border-b border-gray-200 bg-white px-1"
        >
          <QueueStripCell
            label="No resultado"
            value={total}
            hint={hasFilters ? 'sob os filtros aplicados' : 'carteira autorizada'}
            weight="open"
            active={filters.status === ''}
            onClick={() => applyFilters({ status: '' })}
          />
          <QueueStripCell
            label="Ativos"
            value={activeOnPage}
            hint="nesta página"
            weight="open"
            active={filters.status === CLIENT_STATUSES.Active}
            onClick={() => applyFilters({ status: CLIENT_STATUSES.Active })}
          />
          <QueueStripCell
            label="Inativos"
            value={inactiveOnPage}
            hint="não podem ser usados em novos documentos"
            weight={inactiveOnPage > 0 ? 'alert' : 'settled'}
            active={filters.status === CLIENT_STATUSES.Inactive}
            onClick={() => applyFilters({ status: CLIENT_STATUSES.Inactive })}
          />
        </nav>
      ) : null}

      {/*
        ZONA 3 — VIEW + COMMAND SURFACE. UMA barra: busca, situacao, filtros secundarios,
        limpeza, tamanho da pagina e visoes salvas goverrnadas. As tres barras empilhadas
        (filtros + visoes + bloco de filtro avancado) viraram uma.
      */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-gray-200 bg-gray-50/60 px-1 py-1.5">
        <div
          role="group"
          aria-label="Recorte de situação"
          className="flex items-center overflow-hidden rounded border border-gray-300 bg-white"
        >
          {(
            [
              ['all', 'Todos', ''],
              ['active', 'Ativos', CLIENT_STATUSES.Active],
              ['inactive', 'Inativos', CLIENT_STATUSES.Inactive],
            ] as const
          ).map(([key, label, value]) => {
            const active = filters.status === value;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                className={cn(
                  'border-r border-gray-200 px-2.5 py-1 text-[12px] font-medium last:border-r-0',
                  active
                    ? 'bg-brand-700 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                )}
                onClick={() => applyFilters({ status: value })}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="flex min-w-56 flex-1 items-center gap-1">
          <label className="sr-only" htmlFor={searchInputId}>
            Buscar
          </label>
          <input
            id={searchInputId}
            type="search"
            className="w-full min-w-0 rounded border border-gray-300 bg-white px-2 py-1 text-[13px] text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Buscar cliente…"
            autoComplete="off"
            aria-describedby={searchDraftTooShort ? searchHintId : undefined}
          />
        </div>

        <label htmlFor={statusFilterId} className="sr-only">
          Situação
        </label>
        <select
          id={statusFilterId}
          className="rounded border border-gray-300 bg-white px-2 py-1 text-[13px] text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
          value={filters.status}
          onChange={(event) =>
            applyFilters({ status: event.target.value as ClientListParams['status'] })
          }
        >
          <option value="">Situação: todas</option>
          <option value={CLIENT_STATUSES.Active}>Ativos</option>
          <option value={CLIENT_STATUSES.Inactive}>Inativos</option>
        </select>

        <button
          id={moreFiltersId}
          type="button"
          aria-expanded={showMoreFilters}
          className="rounded border border-gray-300 bg-white px-2 py-1 text-[12px] font-medium text-gray-700 hover:bg-gray-50"
          onClick={() => setShowMoreFilters((current) => !current)}
        >
          {showMoreFilters ? 'Menos filtros' : 'Mais filtros'}
        </button>

        {showMoreFilters ? (
          <>
            <label htmlFor={requirementFilterId} className="sr-only">
              Exigência de pedido de compra
            </label>
            <select
              id={requirementFilterId}
              aria-label="Exigência de pedido de compra"
              className="rounded border border-gray-300 bg-white px-2 py-1 text-[13px] text-gray-900"
              value={filters.purchaseOrderRequirement}
              onChange={(event) =>
                applyFilters({
                  purchaseOrderRequirement: event.target
                    .value as ClientListParams['purchaseOrderRequirement'],
                })
              }
            >
              <option value="">Pedido de compra: todos</option>
              {Object.values(PURCHASE_ORDER_REQUIREMENTS).map((requirement) => (
                <option key={requirement} value={requirement}>
                  {formatPurchaseOrderRequirement(requirement)}
                </option>
              ))}
            </select>
          </>
        ) : null}

        {hasFilters || searchInput.trim() !== '' ? (
          <button
            type="button"
            className="rounded border border-gray-300 bg-white px-2 py-1 text-[12px] font-medium text-gray-700 hover:bg-gray-50"
            onClick={clearFilters}
          >
            Limpar filtros
          </button>
        ) : null}

        {searchDraftTooShort ? (
          <p id={searchHintId} className="text-[11px] text-gray-500">
            Digite pelo menos {CLIENT_SEARCH_MIN_LENGTH} caracteres.
          </p>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-gray-500 tabular-nums">
            {items.length} nesta página
          </span>
          <div className="relative">
            <button
              type="button"
              aria-expanded={viewsOpen}
              className="rounded border border-gray-300 bg-white px-2 py-1 text-[12px] font-medium text-gray-700 hover:bg-gray-50"
              onClick={() => setViewsOpen((current) => !current)}
            >
              Visões
            </button>
            {viewsOpen ? (
              <div className="absolute right-0 z-30 mt-1 w-[26rem] rounded-md border border-gray-200 bg-white shadow-lg">
                {/*
                  Implementação REUTILIZADA (`operator/smart-list/SavedViewsBar`): nenhuma
                  engine paralela foi criada. O que mudou foi a GOVERNANÇA — a barra deixou de
                  ser um formulário permanente na primeira dobra e passou a ser sob demanda.
                */}
                <SavedViewsBar
                  views={savedViews.views}
                  builtInViews={[]}
                  activeViewId={activeViewId}
                  onApply={(view) => {
                    setActiveViewId(view.id === '__all__' ? null : view.id);
                    applyFilters(clientViewToParams(view.config));
                    setViewsOpen(false);
                  }}
                  onSave={savedViews.saveView}
                  onRename={savedViews.renameView}
                  onRemove={savedViews.removeView}
                  currentConfig={clientViewConfig(filters)}
                  canSave={hasSavableViewConfig(filters)}
                  allLabel="Todos"
                  className="mb-0 border-0 bg-transparent"
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {isEmptyCatalogue ? (
        <div className="px-1 pt-3">
          <WorklistStatePanel
            title="Nenhum Cliente cadastrado ainda."
            description="Os Clientes são a contraparte comercial usada por solicitações, propostas, pedidos de compra, ordens de serviço e faturamento. Cadastre o primeiro para começar."
            action={
              capabilities.canCreate ? (
                <ModulePrimaryLink to="/app/clients/new">Cadastrar Cliente</ModulePrimaryLink>
              ) : null
            }
          />
        </div>
      ) : null}

      {isNoResults ? (
        <div className="px-1 pt-3">
          <WorklistStatePanel
            title="Nenhum Cliente corresponde aos filtros aplicados."
            description="Ajuste o termo de busca ou limpe os filtros para ver o cadastro completo."
            action={
              <button
                type="button"
                className="rounded border border-gray-300 bg-white px-2 py-1 text-[12px] font-medium text-gray-700 hover:bg-gray-50"
                onClick={clearFilters}
              >
                Limpar filtros
              </button>
            }
          />
        </div>
      ) : null}

      {isOutOfRange ? (
        <div className="px-1 pt-3">
          <WorklistStatePanel
            title="Esta página não existe mais para os filtros aplicados."
            description={`Existem ${formatClientCount(total)} ${
              total === 1 ? 'Cliente' : 'Clientes'
            } no total, em ${formatClientCount(totalPages)} ${
              totalPages === 1 ? 'página' : 'páginas'
            }.`}
            action={
              <button
                type="button"
                className="rounded border border-gray-300 bg-white px-2 py-1 text-[12px] font-medium text-gray-700 hover:bg-gray-50"
                onClick={() => setSearchParams(buildClientListSearchParams(filters, 0))}
              >
                Ir para a primeira página
              </button>
            }
          />
        </div>
      ) : null}

      {/*
        ZONA 4 — MASTER DATA WORKLIST. Identidade primeiro (razao social + nome fantasia +
        documento no MESMO bloco, em vez de uma coluna inteira gasta com o CNPJ), decisao
        depois (situacao + proxima acao + excecao) e metadado por ultimo (atividade). A barra
        de acento a esquerda marca o cadastro que NAO pode operar.
      */}
      {items.length > 0 ? (
        <section
          aria-busy={isRefreshing}
          aria-label="Lista de clientes"
          className="border-b border-gray-200"
        >
          <table className="w-full border-separate border-spacing-0" aria-label="Lista de clientes">
            <thead>
              <tr>
                <th scope="col" className={headCellClass} aria-sort={ariaSortFor(filters, CLIENT_LIST_SORTS.LegalName)}>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-gray-700"
                    onClick={() =>
                      applyFilters(toggleClientListSort(filters, CLIENT_LIST_SORTS.LegalName))
                    }
                  >
                    Cliente
                    <span aria-hidden="true">
                      {sortIndicator(filters, CLIENT_LIST_SORTS.LegalName)}
                    </span>
                  </button>
                </th>
                <th scope="col" className={cn(headCellClass, 'w-[16rem]')}>
                  Situação
                </th>
                <th
                  scope="col"
                  className={cn(headCellClass, 'w-40 text-right')}
                  aria-sort={ariaSortFor(filters, CLIENT_LIST_SORTS.UpdatedAt)}
                >
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-gray-700"
                    onClick={() =>
                      applyFilters(toggleClientListSort(filters, CLIENT_LIST_SORTS.UpdatedAt))
                    }
                  >
                    Última atualização
                    <span aria-hidden="true">
                      {sortIndicator(filters, CLIENT_LIST_SORTS.UpdatedAt)}
                    </span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((client) => {
                const href = navigateToClient ? navigateToClient(client) : null;
                const isInactive = client.status === CLIENT_STATUSES.Inactive;
                const nextAction = clientNextAction(client, capabilities);
                return (
                  <tr
                    key={client.id}
                    className={cn(
                      'cursor-pointer transition-colors hover:bg-gray-50/70',
                      isInactive && 'bg-red-50/30',
                    )}
                    /*
                     * SELECAO abre o CONTEXTO do Cliente no painel lateral — o operador
                     * confere identidade, documento, situacao e relacoes sem sair da carteira.
                     * O nome continua sendo um link real: teclado, nova aba e leitor de tela
                     * seguem levando ao cadastro completo (drillback).
                     */
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest('a, button, select, input')) {
                        return;
                      }
                      preview.openPreview(client);
                    }}
                  >
                    <td className={cn(cellClass, 'pl-3')}>
                      <span
                        aria-hidden="true"
                        className={cn(
                          'absolute top-1.5 bottom-1.5 left-0 w-[3px]',
                          isInactive ? 'bg-red-500' : 'bg-transparent',
                        )}
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          {href ? (
                            <Link
                              to={href}
                              onClick={(event) => event.stopPropagation()}
                              className="text-[13px] font-semibold text-brand-800 no-underline hover:underline"
                            >
                              {client.legalName}
                            </Link>
                          ) : (
                            <span className="text-[13px] font-semibold text-gray-900">
                              {client.legalName}
                            </span>
                          )}
                          {client.tradeName ? (
                            <span className="text-[12px] text-gray-500">{client.tradeName}</span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 font-mono text-[11px] text-gray-400 tabular-nums">
                          {formatCnpjDisplay(client.taxId)}
                        </p>
                      </div>
                    </td>

                    <td className={cn(cellClass, 'z-[1]')}>
                      <span
                        aria-label={`Status: ${clientStatusLabel(client.status)}`}
                        className={cn(
                          'text-[12px] font-semibold',
                          isInactive ? 'text-red-700' : 'text-gray-900',
                        )}
                      >
                        {clientStatusLabel(client.status)}
                      </span>
                      <p
                        className={cn(
                          'mt-0.5 truncate text-[12px]',
                          nextAction.pending
                            ? 'font-medium text-brand-700'
                            : 'text-gray-400',
                        )}
                      >
                        {nextAction.label}
                      </p>
                      {isInactive ? (
                        <p className="mt-0.5 text-[11px] text-red-700">
                          Cadastro inativo não é aceito em novos documentos
                        </p>
                      ) : null}
                    </td>

                    <td className={cn(cellClass, 'z-[1] pr-3 text-right')}>
                      <span className="block text-[12px] text-gray-700 tabular-nums">
                        {formatClientListRelative(client.updatedAt, now)}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-gray-400 tabular-nums">
                        {formatClientListDateTime(client.updatedAt)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ) : null}

      {hasCatalog || offset > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-2">
          <p className="m-0 text-[11px] text-gray-500 tabular-nums">
            Clientes {formatClientRangeLabel(offset, items.length, total)}
          </p>
          <ModulePagination
            pageNumber={pageNumber}
            previousDisabled={offset === 0}
            nextDisabled={offset + items.length >= total}
            onPrevious={() =>
              setSearchParams(
                buildClientListSearchParams(filters, Math.max(0, offset - PAGE_SIZE)),
              )
            }
            onNext={() =>
              setSearchParams(buildClientListSearchParams(filters, offset + PAGE_SIZE))
            }
          />
        </div>
      ) : null}

      <ContextDrawer
        open={preview.previewRow !== null}
        title="Contexto do cliente"
        preview={preview.previewRow ? buildClientPreview(preview.previewRow, now) : null}
        onClose={preview.closePreview}
      />
    </ModulePage>
  );
}

/* ------------------------------------------------------------------ densidade */

/**
 * Cabecalho da worklist: mesma altura de uma linha, sem caixa alta com tracking largo — a
 * grade de Clientes era a unica do Comercial que ainda usava o cabecalho do `DataTable`.
 */
const headCellClass =
  'sticky top-0 z-10 border-b border-gray-200 bg-gray-50/80 px-2.5 py-1 text-left text-[10px] font-semibold tracking-[0.08em] text-gray-400 uppercase';

const cellClass = 'relative border-b border-gray-100 py-2 pr-2 align-top text-gray-700';

/**
 * CELULA DA FAIXA DE CARTEIRA — numero real + recorte em UM controle.
 *
 * O peso comunica o trabalho: `alert` marca o recorte que exige o operador (cadastro inativo),
 * `settled` o que e apenas leitura. Sem numero publicado, a celula declara a ausencia — `0`
 * afirmaria um recorte inexistente (`AUSÊNCIA ≠ ZERO`).
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
  weight: 'open' | 'settled' | 'alert';
  active: boolean;
  onClick: () => void;
}) {
  const numberClass =
    value === null
      ? 'text-gray-300'
      : weight === 'alert'
        ? 'text-red-700'
        : weight === 'open'
          ? 'text-gray-900'
          : 'text-gray-500';
  return (
    <button
      type="button"
      aria-pressed={active}
      title={hint}
      onClick={onClick}
      className={cn(
        'flex min-w-[10rem] flex-1 flex-col items-start gap-0.5 border-r border-gray-200 px-3 py-1.5 text-left transition-colors last:border-r-0',
        active ? 'bg-brand-50' : 'hover:bg-gray-50',
      )}
    >
      <span className="flex items-baseline gap-1.5">
        <span className={cn('text-[17px] leading-none font-semibold tabular-nums', numberClass)}>
          {value === null ? 'n/d' : formatClientCount(value)}
        </span>
        <span
          className={cn(
            'text-[11px] font-medium tracking-wide uppercase',
            weight === 'settled' ? 'text-gray-400' : 'text-gray-700',
          )}
        >
          {label}
        </span>
      </span>
      <span className="truncate text-[10px] text-gray-400">{hint}</span>
    </button>
  );
}

/** Recorte ativo em uma linha — o cabecalho declara sobre o que a carteira esta recortada. */
function describeClientScope(filters: ClientListParams): string {
  const parts: string[] = [];
  if (filters.status) {
    parts.push(filters.status === CLIENT_STATUSES.Active ? 'somente ativos' : 'somente inativos');
  }
  if (filters.q.trim()) {
    parts.push(`busca "${filters.q.trim()}"`);
  }
  if (filters.purchaseOrderRequirement) {
    parts.push(`pedido de compra ${formatPurchaseOrderRequirement(filters.purchaseOrderRequirement)}`);
  }
  return parts.length > 0 ? `recorte: ${parts.join(' · ')}` : 'carteira completa';
}

/**
 * Painel lateral do cliente — SOMENTE fatos que `ClientSummary` já publica e relações com
 * destino real. Não soma contagem de solicitações/propostas/pedidos/contratos/OS/recebíveis
 * porque a projeção de listagem não as traz (GAP de contrato registrado, não fabricado).
 */
function buildClientPreview(client: ClientSummary, now: Date): ContextPreviewBody {
  const isInactive = client.status === CLIENT_STATUSES.Inactive;
  return {
    identifier: client.legalName,
    subtitle: client.tradeName ?? null,
    status: <ClientStatusBadge status={client.status} />,
    facts: [
      { label: 'CNPJ', value: formatCnpjDisplay(client.taxId) },
      {
        label: 'Situação',
        value: isInactive
          ? 'Inativo — não é aceito em novos documentos'
          : 'Ativo — aceito em novos documentos',
      },
      {
        label: 'Última atualização',
        value: (
          <span className="tabular-nums">
            {formatClientListRelative(client.updatedAt, now)} ·{' '}
            {formatClientListDateTime(client.updatedAt)}
          </span>
        ),
      },
    ],
    relations: [
      {
        label: 'Solicitações deste cliente',
        value: 'Abrir fila filtrada',
        href: `/app/requests?clientId=${client.id}`,
      },
    ],
    /*
     * PROXIMA ACAO so quando existe trabalho: cadastro ATIVO e a condicao normal da carteira e
     * nao tem pendencia — oferecer um botao ali seria inventar uma tarefa. Cadastro INATIVO e a
     * excecao, e o comando real roda na object page (a listagem nao publica `version`).
     */
    nextAction: isInactive
      ? { label: 'Reativar cadastro', href: `/app/clients/${client.id}`, kind: 'primary' }
      : null,
    detailHref: `/app/clients/${client.id}`,
    detailLabel: 'Abrir cadastro completo',
  };
}
