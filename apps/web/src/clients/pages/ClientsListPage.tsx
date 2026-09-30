import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
import {
  CLIENTS_ALLOWED_FILTERS,
  clientViewConfig,
  clientViewToParams,
  hasSavableViewConfig,
} from '../utils/client-view-config';
import {
  formatClientCount,
  formatClientListDateTime,
  formatClientRangeLabel,
  formatPurchaseOrderRequirement,
} from '../utils/client-list-labels';
import { Button } from '../../ui/Button';
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
} from '../../ui/DataTable';
import {
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModuleStatePage,
  ModulePageHeader,
  ModulePagination,
  ModulePrimaryLink,
  ModuleTableLink,
  filterControlClass,
  filterLabelClass,
} from '../../ui/module-layout';

const PAGE_SIZE = 20;

/**
 * Atraso da busca digitada. Sem ele, cada tecla dispararia uma requisição server-side; com ele, a
 * lista continua parecendo instantânea sem transformar a digitação em carga de rede.
 */
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

export function ClientsListPage() {
  const { capabilities } = useClientCapabilities();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  /**
   * Visões salvas do Comercial. Guardam apenas status, coluna de ordenação e
   * direção — nunca o termo de busca, que é texto livre do operador e poderia
   * conter razão social ou CNPJ (ver `client-view-config`).
   */
  const savedViews = useSavedViews('commercial.clients', [], CLIENTS_ALLOWED_FILTERS);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);

  // Busca, filtros, ordenação e página vivem na URL: recarregar não perde contexto, o botão
  // voltar funciona e o endereço é compartilhável.
  const filters = useMemo(() => parseClientListParams(searchParams), [searchParams]);
  const offset = useMemo(() => {
    const raw = Number(searchParams.get('offset') ?? '0');
    return Number.isInteger(raw) && raw > 0 ? raw : 0;
  }, [searchParams]);

  const [listState, setListState] = useState<ListState>({ phase: 'loading' });
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Recarga pedida pelo usuário (retry) percorre o MESMO ciclo de vida do efeito de carga: assim a
  // requisição do retry também é cancelável por uma mudança de filtro seguinte.
  const [reloadToken, setReloadToken] = useState(0);
  const [searchInput, setSearchInput] = useState(filters.q);
  const [showMoreFilters, setShowMoreFilters] = useState(
    () => filters.purchaseOrderRequirement !== '',
  );
  const searchInputId = useId();
  const searchHintId = useId();
  const statusFilterId = useId();
  const requirementFilterId = useId();

  // Rascunho abaixo do piso publicado: ainda não é busca, então não vira requisição — a barra
  // explica o motivo em vez de a lista responder com uma tela de erro.
  const searchDraftTooShort =
    searchInput.trim().length > 0 && !isApplicableClientSearchTerm(searchInput);

  // O campo de busca é local para responder à digitação; a URL é atualizada depois do debounce.
  // Sincroniza quando a URL muda por fora (voltar/avançar, link colado).
  useEffect(() => {
    setSearchInput(filters.q);
  }, [filters.q]);

  const applyFilters = useCallback(
    (next: Partial<ClientListParams>) => {
      const merged = { ...filters, ...next };
      // Toda mudança de filtro/ordenação volta para a primeira página, e substitui a entrada de
      // histórico para que ajustar filtros não encha o botão voltar.
      setSearchParams(buildClientListSearchParams(merged, 0), { replace: true });
    },
    [filters, setSearchParams],
  );

  useEffect(() => {
    if (searchInput === filters.q) {
      return;
    }
    // Abaixo do piso o termo ainda não é busca: não entra na URL nem na requisição. A URL continua
    // descrevendo apenas o que o backend aceita (ver CLIENT_SEARCH_MIN_LENGTH).
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
      // Uma recarga preserva o resultado anterior: trocar a página inteira por "Carregando…"
      // desmontaria a própria barra de busca durante a digitação, perdendo o foco e as teclas
      // seguintes. Só a primeira carga não tem resultado anterior para preservar.
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
        // Requisição superada (outro filtro/página já assumiu) não escreve no estado: uma resposta
        // lenta sobrescreveria o resultado mais novo com o anterior.
        if (signal?.aborted) {
          return;
        }
        setListState({ phase: 'ready', response });
      } catch (error) {
        // O cancelamento do próprio efeito não é falha de carga. Sem esta guarda, cada busca
        // digitada trocava a lista por uma tela de erro enquanto a nova requisição não respondia.
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
        <ModuleDeniedState
          message="Você não tem permissão para listar Clientes."
        />
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
  // Página além do fim: o cadastro tem Clientes, mas a página pedida não existe mais (filtro
  // aplicado em outra aba, link antigo). Não é "nenhum resultado" — é página inexistente.
  const isOutOfRange = items.length === 0 && total > 0;
  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1;
  const isEmptyCatalogue = items.length === 0 && total === 0 && !hasFilters;
  const isNoResults = items.length === 0 && total === 0 && hasFilters;

  const navigateToClient = capabilities.canRead
    ? (client: ClientSummary) => `/app/clients/${client.id}`
    : null;

  return (
    <ModulePage>
      <ModulePageHeader
        title="Clientes"
        description={
          hasCatalog
            ? `${formatClientCount(total)} ${total === 1 ? 'Cliente' : 'Clientes'} no seu escopo autorizado${hasFilters ? ' para os filtros aplicados' : ''}.`
            : 'Cadastro de Clientes do CISNE.'
        }
        action={
          capabilities.canCreate ? (
            <ModulePrimaryLink to="/app/clients/new">Novo Cliente</ModulePrimaryLink>
          ) : null
        }
      />

      {/* Barra de filtros compacta: a busca fica junto da lista, e não dentro de um card largo
          ocupado apenas por um seletor de status. */}
      <div
        role="search"
        aria-label="Busca e filtros de Clientes"
        className="mb-4 flex flex-wrap items-end gap-3"
      >
        <div className="min-w-64 flex-1">
          <label className={filterLabelClass} htmlFor={searchInputId}>
            Buscar
          </label>
          <input
            id={searchInputId}
            type="search"
            className={filterControlClass}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Razão social, nome fantasia ou CNPJ"
            autoComplete="off"
            aria-describedby={searchDraftTooShort ? searchHintId : undefined}
          />
          {searchDraftTooShort ? (
            <p id={searchHintId} className="mt-1 text-xs text-gray-500">
              Digite pelo menos {CLIENT_SEARCH_MIN_LENGTH} caracteres para buscar.
            </p>
          ) : null}
        </div>

        <div className="w-44">
          <label className={filterLabelClass} htmlFor={statusFilterId}>
            Status
          </label>
          <select
            id={statusFilterId}
            className={filterControlClass}
            value={filters.status}
            onChange={(event) =>
              applyFilters({ status: event.target.value as ClientListParams['status'] })
            }
          >
            <option value="">Todos</option>
            <option value={CLIENT_STATUSES.Active}>Ativos</option>
            <option value={CLIENT_STATUSES.Inactive}>Inativos</option>
          </select>
        </div>

        <Button
          type="button"
          variant="secondary"
          aria-expanded={showMoreFilters}
          onClick={() => setShowMoreFilters((current) => !current)}
        >
          {showMoreFilters ? 'Menos filtros' : 'Mais filtros'}
        </Button>

        {hasFilters || searchInput.trim() !== '' ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setSearchInput('');
              setSearchParams(buildClientListSearchParams(EMPTY_CLIENT_LIST_PARAMS), {
                replace: true,
              });
            }}
          >
            Limpar
          </Button>
        ) : null}

        {isRefreshing ? (
          <p role="status" className="text-xs text-gray-500">
            Atualizando…
          </p>
        ) : null}
      </div>

      <SavedViewsBar
        views={savedViews.views}
        builtInViews={[]}
        activeViewId={activeViewId}
        onApply={(view) => {
          setActiveViewId(view.id === '__all__' ? null : view.id);
          applyFilters(clientViewToParams(view.config));
        }}
        onSave={savedViews.saveView}
        onRename={savedViews.renameView}
        onRemove={savedViews.removeView}
        currentConfig={clientViewConfig(filters)}
        canSave={hasSavableViewConfig(filters)}
        allLabel="Todos"
        className="mb-4"
      />

      {showMoreFilters ? (
        <div className="mb-4 w-full max-w-md">
          <label className={filterLabelClass} htmlFor={requirementFilterId}>
            Exigência de pedido de compra
          </label>
          <select
            id={requirementFilterId}
            className={filterControlClass}
            value={filters.purchaseOrderRequirement}
            onChange={(event) =>
              applyFilters({
                purchaseOrderRequirement: event.target
                  .value as ClientListParams['purchaseOrderRequirement'],
              })
            }
          >
            <option value="">Todas</option>
            {Object.values(PURCHASE_ORDER_REQUIREMENTS).map((requirement) => (
              <option key={requirement} value={requirement}>
                {formatPurchaseOrderRequirement(requirement)}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {isEmptyCatalogue ? (
        <div
          className="rounded-xl bg-white p-6 text-sm text-gray-600 shadow-sm ring-1 ring-gray-900/5"
          role="status"
        >
          <p className="font-semibold text-gray-900">Nenhum Cliente cadastrado ainda.</p>
          <p className="mt-2">
            Os Clientes são a contraparte comercial usada por solicitações, propostas, pedidos de
            compra, ordens de serviço e faturamento. Cadastre o primeiro para começar.
          </p>
          {capabilities.canCreate ? (
            <p className="mt-4">
              <ModulePrimaryLink to="/app/clients/new">Cadastrar Cliente</ModulePrimaryLink>
            </p>
          ) : null}
        </div>
      ) : null}

      {isNoResults ? (
        <div
          className="rounded-xl bg-white p-6 text-sm text-gray-600 shadow-sm ring-1 ring-gray-900/5"
          role="status"
        >
          <p className="font-semibold text-gray-900">
            Nenhum Cliente corresponde aos filtros aplicados.
          </p>
          <p className="mt-2">
            Ajuste o termo de busca ou limpe os filtros para ver o cadastro completo.
          </p>
          <p className="mt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setSearchInput('');
                setSearchParams(buildClientListSearchParams(EMPTY_CLIENT_LIST_PARAMS), {
                  replace: true,
                });
              }}
            >
              Limpar filtros
            </Button>
          </p>
        </div>
      ) : null}

      {isOutOfRange ? (
        <div
          className="rounded-xl bg-white p-6 text-sm text-gray-600 shadow-sm ring-1 ring-gray-900/5"
          role="status"
        >
          <p className="font-semibold text-gray-900">
            Esta página não existe mais para os filtros aplicados.
          </p>
          <p className="mt-2">
            Existem {formatClientCount(total)} {total === 1 ? 'Cliente' : 'Clientes'} no total, em{' '}
            {formatClientCount(totalPages)} {totalPages === 1 ? 'página' : 'páginas'}.
          </p>
          <p className="mt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setSearchParams(buildClientListSearchParams(filters, 0))}
            >
              Ir para a primeira página
            </Button>
          </p>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div
          className="mb-6 overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-gray-900/5"
          aria-busy={isRefreshing}
        >
          <DataTable aria-label="Lista de Clientes">
            <DataTableHead>
              <DataTableRow>
                <DataTableHeaderCell
                  scope="col"
                  aria-sort={ariaSortFor(filters, CLIENT_LIST_SORTS.LegalName)}
                >
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 font-semibold uppercase hover:text-gray-700"
                    onClick={() =>
                      applyFilters(toggleClientListSort(filters, CLIENT_LIST_SORTS.LegalName))
                    }
                  >
                    Cliente
                    <span aria-hidden="true">
                      {sortIndicator(filters, CLIENT_LIST_SORTS.LegalName)}
                    </span>
                  </button>
                </DataTableHeaderCell>
                <DataTableHeaderCell scope="col">Documento</DataTableHeaderCell>
                <DataTableHeaderCell scope="col">Status</DataTableHeaderCell>
                <DataTableHeaderCell
                  scope="col"
                  aria-sort={ariaSortFor(filters, CLIENT_LIST_SORTS.UpdatedAt)}
                >
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 font-semibold uppercase hover:text-gray-700"
                    onClick={() =>
                      applyFilters(toggleClientListSort(filters, CLIENT_LIST_SORTS.UpdatedAt))
                    }
                  >
                    Última atualização
                    <span aria-hidden="true">
                      {sortIndicator(filters, CLIENT_LIST_SORTS.UpdatedAt)}
                    </span>
                  </button>
                </DataTableHeaderCell>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {items.map((client) => {
                const href = navigateToClient ? navigateToClient(client) : null;
                return (
                  <DataTableRow
                    key={client.id}
                    className={href ? 'cursor-pointer' : undefined}
                    onClick={
                      href
                        ? (event) => {
                            // Cliques em elementos interativos internos seguem seu próprio
                            // comportamento; o resto da linha abre o Cliente. O link do nome
                            // permanece como caminho de teclado e de tecnologia assistiva.
                            if ((event.target as HTMLElement).closest('a, button, select, input')) {
                              return;
                            }
                            void navigate(href);
                          }
                        : undefined
                    }
                  >
                    <DataTableCell>
                      <div className="flex flex-col">
                        {href ? (
                          <ModuleTableLink to={href}>{client.legalName}</ModuleTableLink>
                        ) : (
                          <span className="text-sm font-semibold text-gray-900">
                            {client.legalName}
                          </span>
                        )}
                        {client.tradeName ? (
                          <span className="text-xs text-gray-500">{client.tradeName}</span>
                        ) : null}
                      </div>
                    </DataTableCell>
                    <DataTableCell className="font-mono tabular-nums text-gray-600">
                      {formatCnpjDisplay(client.taxId)}
                    </DataTableCell>
                    <DataTableCell>
                      <ClientStatusBadge status={client.status} />
                    </DataTableCell>
                    <DataTableCell className="whitespace-nowrap text-gray-600">
                      {formatClientListDateTime(client.updatedAt)}
                    </DataTableCell>
                  </DataTableRow>
                );
              })}
            </DataTableBody>
          </DataTable>
        </div>
      ) : null}

      {hasCatalog || offset > 0 ? (
        <ModulePagination
          pageNumber={pageNumber}
          rangeLabel={`Clientes ${formatClientRangeLabel(offset, items.length, total)}`}
          previousDisabled={offset === 0}
          // "Existe próxima página" vem do total informado pelo backend, e não da heurística
          // "a página veio cheia" — que oferecia uma página fantasma quando o total era múltiplo
          // exato do tamanho da página.
          nextDisabled={offset + items.length >= total}
          onPrevious={() =>
            setSearchParams(
              buildClientListSearchParams(filters, Math.max(0, offset - PAGE_SIZE)),
            )
          }
          onNext={() => setSearchParams(buildClientListSearchParams(filters, offset + PAGE_SIZE))}
        />
      ) : null}
    </ModulePage>
  );
}
