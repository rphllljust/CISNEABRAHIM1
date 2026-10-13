import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DynamicContextDrawer } from '../../engine';
import {
  ClientsApiError,
  activateClient,
  deactivateClient,
  getClient,
  listClients,
} from '../api/clients-api';
import { mapClientErrorToMessage } from '../api/client-error-messages';
import { useClientCapabilities } from '../hooks/useClientCapabilities';
import {
  CLIENT_LIST_SORTS,
  CLIENT_STATUSES,
  PURCHASE_ORDER_REQUIREMENTS,
  type ClientListResponse,
  type ClientListSort,
  type Client,
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
import { useContextPreview } from '../../operator';
import { useClientRelatedRecords } from '../hooks/useClientRelatedRecords';
import { buildClientRelationSpecs } from '../utils/client-relations';
import { buildAuthorizedRelations, SmartRelationBar } from '../../enterprise-object';
import { BusinessChain, useBusinessChain } from '../../business-chain';
import {
  DynamicFilterBuilder,
  FILTER_PARAM,
  filterGroupToQuery,
  isFilterGroupActive,
  readFilterGroup,
  type FilterGroup,
} from '../../engine';
import { useEntitySchema } from '../../engine';
import { clientAdvancedFilterFromGroup } from '../utils/client-list-params';
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
import {
  WorklistClearFilters,
  WorklistField,
  WorklistFilterBar,
  WorklistHeader,
  worklistCellClass,
  worklistControlClass,
  worklistHeadCellClass,
  worklistSelectClass,
} from '../../ui/enterprise-list';
import { StatusBadge } from '../../ui/StatusBadge';
import { Button } from '../../ui/Button';
import { Skeleton } from '../../ui/Skeleton';
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

  /**
   * CONTEXTO REAL DO REGISTRO — carregado do endpoint de detalhe, não ecoado da linha.
   *
   * `GET /api/v1/clients/:id` existe e publica o que a LISTAGEM deliberadamente não traz:
   * contatos, endereços, exigência de pedido de compra, motivo e data de desativação e a
   * `version`. Sem isso o painel lateral só repetiria as três colunas da grade — que é
   * exatamente o "modal decorativo" que esta rodada existe para eliminar.
   *
   * CARREGAMENTO LOCALIZADO: só ESTE painel entra em `loading`. A fila, os filtros e a
   * paginação continuam utilizáveis enquanto o detalhe chega — a tela inteira nunca é bloqueada
   * por causa de um registro.
   */
  const [detail, setDetail] = useState<
    | { phase: 'idle' }
    | { phase: 'loading' }
    | { phase: 'denied' }
    | { phase: 'error'; message: string }
    | { phase: 'ready'; client: Client }
  >({ phase: 'idle' });
  const [commandBusy, setCommandBusy] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);

  /**
   * AÇÃO EM LOTE — estado próprio, isolado do contexto de um registro.
   *
   * Os comandos em lote são os MESMOS do domínio (`activate`/`deactivate`), despachados um a um
   * com a `version` que a listagem publica. Não existe catálogo paralelo de "ações em lote": uma
   * ação em lote é um comando de domínio aplicado a N registros.
   */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [bulkReason, setBulkReason] = useState('');
  const [bulkCommand, setBulkCommand] = useState('');

  const previewId = preview.previewRow?.id ?? null;

  /**
   * CADEIA COMERCIAL DO CLIENTE SELECIONADO — a MESMA leitura da object page.
   *
   * `useClientRelatedRecords` faz uma requisição por módulo que aceita `clientId`, e
   * `buildClientRelationSpecs` converte o resultado em relações AUTORIZADAS (módulo negado
   * desaparece por inteiro; contagem só entra quando o backend a comprovou). `useBusinessChain`
   * lê o read model do servidor, que devolve a cadeia já autorizada e ordenada a partir da
   * posição `CLIENT`.
   *
   * Os hooks ficam ANTES dos retornos antecipados de fase: hooks não podem ser condicionais, e
   * a lista precisa poder entrar em `loading`/`denied`/`error` sem quebrar a ordem das chamadas.
   */
  const related = useClientRelatedRecords(previewId);
  const businessChain = useBusinessChain('CLIENT', previewId ?? '');

  /**
   * FILTRO AVANÇADO — a MESMA engine de metadados do resto do produto.
   *
   * `useEntitySchema('client')` lê `meta.entities`/`meta.fields` (migration `0089`), e o
   * `DynamicFilterBuilder` monta a allow-list e os operadores por TIPO a partir desse metadado.
   * A árvore vive na URL pela chave `filter`, serializada por `filterGroupToQuery`.
   *
   * A conversão para o contrato do servidor (`clientAdvancedFilterFromGroup`) traduz operador e
   * nome de campo; o backend revalida tudo e responde 400 ao que não aceita.
   */
  const { schema: clientSchema } = useEntitySchema('client');
  const advancedGroup = useMemo<FilterGroup>(() => readFilterGroup(searchParams), [searchParams]);
  const advancedPayload = useMemo(
    () => clientAdvancedFilterFromGroup(advancedGroup),
    [advancedGroup],
  );

  useEffect(() => {
    if (!previewId) {
      setDetail({ phase: 'idle' });
      setCommandError(null);
      return;
    }
    const controller = new AbortController();
    setDetail({ phase: 'loading' });
    setCommandError(null);
    void getClient(previewId, controller.signal)
      .then((client) => {
        if (!controller.signal.aborted) {
          setDetail({ phase: 'ready', client });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        if (error instanceof ClientsApiError && error.kind === 'denied') {
          setDetail({ phase: 'denied' });
          return;
        }
        setDetail({ phase: 'error', message: 'Não foi possível carregar o contexto do Cliente.' });
      });
    return () => controller.abort();
  }, [previewId]);
  const searchInputId = useId();
  const searchHintId = useId();
  const statusFilterId = useId();
  const moreFiltersId = useId();
  const requirementFilterId = useId();
  const bulkCommandId = useId();
  const selectAllId = useId();

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
    setActiveViewId(null);
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
            advanced: advancedPayload,
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
    [advancedPayload],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadPage(filters, offset, controller.signal);
    return () => controller.abort();
  }, [filters, loadPage, offset, reloadToken]);

  /**
   * Executa um comando REAL de domínio a partir do contexto e recarrega a fila com a versão nova.
   * Falha não é escondida: `VERSION_CONFLICT` (outro operador alterou) e negação viram mensagem.
   */
  const runDetailCommand = useCallback(
    async (command: () => Promise<unknown>) => {
      setCommandBusy(true);
      setCommandError(null);
      try {
        await command();
        preview.closePreview();
        setReloadToken((current) => current + 1);
      } catch (error) {
        setCommandError(
          error instanceof ClientsApiError
            ? mapClientErrorToMessage(error.code, error.status)
            : mapClientErrorToMessage(undefined, 0),
        );
      } finally {
        setCommandBusy(false);
      }
    },
    [preview],
  );

  /**
   * EXECUTA UM COMANDO DE DOMÍNIO EM LOTE.
   *
   * `deactivate` exige `reason` — invariante do domínio. A tela NÃO fabrica um motivo padrão: sem
   * texto do operador o lote é RECUSADO aqui, com mensagem, em vez de gravar justificativa
   * inventada no registro de auditoria. Um lote sem motivo real é pior que um lote recusado.
   *
   * A falha de uma linha não interrompe as demais: o resultado informa quantas não puderam ser
   * concluídas, e a fila é recarregada com as versões novas. Conflito de versão em uma linha é
   * consequência legítima de outro operador ter agido antes, não erro de programação.
   */
  const runClientBulkCommand = useCallback(
    async (command: string, ids: string[], reason: string): Promise<void> => {
      if (command === 'deactivate' && reason.trim() === '') {
        setBulkMessage('Informe o motivo da desativação antes de executar a ação em lote.');
        return;
      }
      const rows = listState.phase === 'ready' ? listState.response.items : [];
      setBulkBusy(true);
      setBulkMessage(null);
      let failures = 0;
      for (const id of ids) {
        const row = rows.find((candidate) => candidate.id === id);
        if (!row) {
          failures += 1;
          continue;
        }
        try {
          if (command === 'activate') {
            await activateClient(id, row.version);
          } else if (command === 'deactivate') {
            await deactivateClient(id, row.version, reason.trim());
          }
        } catch {
          failures += 1;
        }
      }
      setBulkBusy(false);
      setSelectedIds([]);
      setBulkReason('');
      if (failures > 0) {
        setBulkMessage(`${failures} de ${ids.length} não puderam ser concluídos.`);
      }
      setReloadToken((current) => current + 1);
    },
    [listState],
  );

  if (listState.phase === 'loading') {    return (
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
    <ModulePage layout="wide">
      {/*
        SUPERFÍCIE DE TRABALHO FIXA — o contexto de operação não rola com a fila.

        Cabeçalho, faixa de estado, visões salvas e superfície de filtro ficam ESTÁVEIS; o que se
        move é a fila. É o que separa uma ferramenta de operação contínua de uma página que se
        rola para cima a cada troca de recorte: o operador nunca perde "onde estou" nem "qual
        recorte estou vendo".

        `data-region` em cada faixa existe para que a mudança de modelo seja MEDÍVEL por DOM, e
        não afirmada em prosa.
      */}
      <div className="sticky top-0 z-20 bg-white" data-region="work-surface">
        {/*
          OPERATING HEADER + STATE RAIL — uma faixa, não três cartões de KPI.

          A identidade, o total AUTORITATIVO, o recorte ativo, o comando primário e os recortes
          operacionais dividem a mesma faixa. `AUSÊNCIA ≠ ZERO`: sem carteira autorizada o total
          não é afirmado (`count` fica `undefined`) em vez de imprimir "0".
        */}
        <div data-region="operating-header">
          <WorklistHeader
            title="Clientes"
            count={hasCatalog ? total : undefined}
            context={
              isRefreshing ? (
                <>
                  {scope} <span role="status">atualizando…</span>
                </>
              ) : (
                scope
              )
            }
            action={
              /*
                COMANDO PRIMÁRIO ÚNICO. Com a carteira vazia a criação desce para o painel de
                estado vazio (que já explica o que um Cliente é) e o cabeçalho não a repete —
                duas CTAs primárias na mesma dobra deixam o operador sem saber qual é a ação.
              */
              capabilities.canCreate && !isEmptyCatalogue ? (
                <ModulePrimaryLink to="/app/clients/new">Novo cliente</ModulePrimaryLink>
              ) : null
            }
            metrics={
              hasCatalog ? (
                <>
                  <QueueStripCell
                    label="No recorte"
                    value={total}
                    hint={hasFilters ? 'sob os filtros aplicados' : 'carteira autorizada'}
                    weight="neutral"
                    active={filters.status === ''}
                    onClick={() => applyFilters({ status: '' })}
                  />
                  <QueueStripCell
                    label="Ativos"
                    value={activeOnPage}
                    hint="nesta página"
                    weight="neutral"
                    active={filters.status === CLIENT_STATUSES.Active}
                    onClick={() => applyFilters({ status: CLIENT_STATUSES.Active })}
                  />
                  {/*
                    EXCEPTION-FIRST: só o recorte que EXIGE o operador carrega sinal. "19 ativos"
                    é o estado normal da carteira e não pode gritar; "fora de operação" é o que
                    trava novos documentos, e só ganha peso quando existe trabalho nele.
                  */}
                  <QueueStripCell
                    label="Fora de operação"
                    value={inactiveOnPage}
                    hint="não entram em novos documentos"
                    weight={inactiveOnPage > 0 ? 'alert' : 'settled'}
                    active={filters.status === CLIENT_STATUSES.Inactive}
                    onClick={() => applyFilters({ status: CLIENT_STATUSES.Inactive })}
                  />
                </>
              ) : undefined
            }
          />
        </div>

        {/*
          SAVED VIEWS — FAIXA PRÓPRIA DA WORK AREA.

          Antes: um botão "Visões" que abria um dropdown — link solto, fora da área de trabalho.
          Agora é uma faixa própria, sempre visível, com a visão ATIVA evidente, as visões
          existentes acessíveis, salvar subordinado e remover no próprio item.

          A implementação é a MESMA (`operator/smart-list/SavedViewsBar`) e o MESMO store: nenhuma
          engine paralela foi criada e nenhuma visão já salva pelo operador se perde.
        */}
        {hasCatalog ? (
          <div className="cisne-divider py-0.5" data-region="saved-view-surface">
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
              className="mb-0 border-0 bg-transparent"
            />
          </div>
        ) : null}

        {/*
          COMMAND / FILTER SURFACE — UMA superfície, não um formulário web.

          Busca é o comando principal (ocupa a largura); situação é filtro frequente; exigência de
          pedido de compra é avançada e vive sob divulgação progressiva. O rodapé da superfície
          declara o recorte ativo e a saída — não há "label input label select botão" empilhados.
          Nada saiu do contrato: os três continuam indo ao SERVIDOR.
        */}
        <div data-region="command-filter-surface">
          <WorklistFilterBar
            meta={
              hasFilters ? `${items.length} nesta página · recorte ativo` : `${items.length} nesta página`
            }
            notice={
              searchDraftTooShort ? (
                <p id={searchHintId} className="cisne-type-helper m-0">
                  Digite pelo menos {CLIENT_SEARCH_MIN_LENGTH} caracteres para buscar.
                </p>
              ) : null
            }
          >
            <WorklistField label="Buscar" htmlFor={searchInputId} grow>
              <input
                id={searchInputId}
                type="search"
                className={worklistControlClass}
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Razão social, nome fantasia ou CNPJ"
                autoComplete="off"
                aria-describedby={searchDraftTooShort ? searchHintId : undefined}
              />
            </WorklistField>

            <WorklistField label="Situação" htmlFor={statusFilterId}>
              <select
                id={statusFilterId}
                className={worklistSelectClass}
                value={filters.status}
                onChange={(event) =>
                  applyFilters({ status: event.target.value as ClientListParams['status'] })
                }
              >
                <option value="">Todas</option>
                <option value={CLIENT_STATUSES.Active}>Ativos</option>
                <option value={CLIENT_STATUSES.Inactive}>Inativos</option>
              </select>
            </WorklistField>

            <button
              id={moreFiltersId}
              type="button"
              aria-expanded={showMoreFilters}
              className="cisne-type-action inline-flex min-h-[var(--control-height)] items-center rounded-md px-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              onClick={() => setShowMoreFilters((current) => !current)}
            >
              {showMoreFilters ? 'Menos filtros' : 'Mais filtros'}
            </button>

            {showMoreFilters ? (
              <WorklistField label="Exigência de pedido de compra" htmlFor={requirementFilterId}>
                <select
                  id={requirementFilterId}
                  className={worklistSelectClass}
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
              </WorklistField>
            ) : null}

            <WorklistClearFilters
              visible={hasFilters || searchInput.trim() !== '' || isFilterGroupActive(advancedGroup)}
              onClick={clearFilters}
            />
          </WorklistFilterBar>
        </div>

        {/*
          FILTRO AVANÇADO — a camada composta da superfície de filtro, dirigida por METADADO.

          O construtor é o MESMO do resto do produto (`DynamicFilterBuilder`): ele lê `meta.fields`
          da entidade `client` e oferece apenas os campos marcados `in_filter` — que são exatamente
          os que o predicado server-side executa. Um campo que o servidor não filtra não aparece
          aqui, porque oferecê-lo produziria um recorte que o operador lê como "lista vazia".

          A árvore é serializada na URL pela chave da engine (`filter`), e a conversão para o
          contrato do servidor acontece em `clientAdvancedFilterFromGroup`.
        */}
        {hasCatalog ? (
          <div className="px-1" data-region="advanced-filter-surface">
            <DynamicFilterBuilder
              schema={clientSchema}
              value={advancedGroup}
              onChange={(next) => {
                const params = new URLSearchParams(searchParams);
                const serialized = filterGroupToQuery(next).get(FILTER_PARAM);
                if (serialized) {
                  params.set(FILTER_PARAM, serialized);
                } else {
                  params.delete(FILTER_PARAM);
                }
                // Qualquer mudança de recorte volta à primeira página: manter o offset antigo
                // sobre um conjunto novo mostraria uma página que pode não existir.
                params.delete('offset');
                setSearchParams(params, { replace: true });
              }}
            />
          </div>
        ) : null}

        {/*
          BARRA DE COMANDO EM LOTE — aparece SÓ com seleção, e sobre uma superfície própria.

          Os comandos oferecidos são exatamente os que o domínio sustenta hoje: `activate` e
          `deactivate`. Não há ação de "editar em lote" porque não existe comando para isso, e
          `deactivate` carrega campo de motivo: o operador fornece o texto, a tela não o inventa.
        */}
        {selectedIds.length > 0 ? (
          <div
            data-region="bulk-command-surface"
            data-selected-count={selectedIds.length}
            className="cisne-divider flex flex-wrap items-center gap-2 border-l-[3px] border-l-brand-600 bg-brand-50/40 px-2.5 py-1.5"
          >
            <p className="cisne-type-body m-0">
              <strong className="cisne-type-primary">{selectedIds.length}</strong> cliente
              {selectedIds.length === 1 ? '' : 's'} selecionado
              {selectedIds.length === 1 ? '' : 's'}
            </p>

            <label className="cisne-meta-label" htmlFor={bulkCommandId}>
              Ação
            </label>
            <select
              id={bulkCommandId}
              data-testid="clients-bulk-command"
              className={worklistSelectClass}
              value={bulkCommand}
              disabled={bulkBusy}
              onChange={(event) => {
                setBulkCommand(event.target.value);
                setBulkMessage(null);
              }}
            >
              <option value="">—</option>
              {capabilities.canActivate ? <option value="activate">Reativar cadastros</option> : null}
              {capabilities.canDeactivate ? (
                <option value="deactivate">Desativar cadastros</option>
              ) : null}
            </select>

            {/*
              MOTIVO — exigido APENAS pelo comando que o domínio exige. Não é campo decorativo:
              `deactivate` grava `deactivationReason` em auditoria, então o texto vem do operador.
            */}
            {bulkCommand === 'deactivate' ? (
              <label className="flex items-center gap-1.5">
                <span className="cisne-meta-label">Motivo</span>
                <input
                  type="text"
                  data-testid="clients-bulk-reason"
                  aria-label="Motivo da desativação"
                  className={worklistControlClass}
                  value={bulkReason}
                  disabled={bulkBusy}
                  onChange={(event) => setBulkReason(event.target.value)}
                />
              </label>
            ) : null}

            <Button
              variant="primary"
              loading={bulkBusy}
              loadingText="Executando…"
              disabled={bulkCommand === ''}
              onClick={() => void runClientBulkCommand(bulkCommand, selectedIds, bulkReason)}
            >
              Aplicar
            </Button>

            <button
              type="button"
              data-testid="clients-bulk-clear"
              className="cisne-type-action ml-auto inline-flex min-h-[var(--control-height)] items-center rounded-md px-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              onClick={() => {
                setSelectedIds([]);
                setBulkReason('');
                setBulkCommand('');
                setBulkMessage(null);
              }}
            >
              Limpar seleção
            </button>

            {bulkMessage ? (
              <p className="m-0 w-full cisne-type-body text-red-700" role="alert">
                {bulkMessage}
              </p>
            ) : null}
          </div>
        ) : null}
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
                className="cisne-type-action inline-flex min-h-[var(--control-height)] items-center rounded-md px-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900"
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
                className="cisne-type-action inline-flex min-h-[var(--control-height)] items-center rounded-md px-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                onClick={() => setSearchParams(buildClientListSearchParams(filters, 0))}
              >
                Ir para a primeira página
              </button>
            }
          />
        </div>
      ) : null}

      {/*
        ZONA 4 — PROCESSING WORKLIST.

        A GRADE É DESENHADA POR FUNÇÃO OPERACIONAL, NÃO POR ESPELHAMENTO DO DTO.

        `ClientSummary` publica sete campos, mas DTO ≠ design de tela. As sete informações foram
        CLASSIFICADAS por papel e as que pertencem ao mesmo papel foram HIERARQUIZADAS dentro da
        mesma célula, em vez de virarem colunas independentes com o mesmo peso visual:

          IDENTIDADE  → razão social (principal)
                        ↳ nome fantasia (subordinado)
                        ↳ CNPJ (subordinado, mono)
          ESTADO      → situação (compacta, rotulada)
                        ↳ próximo passo (subordinado)
          TEMPO       → última atualização: leitura relativa + carimbo absoluto
                        ↳ criado em (subordinado)

        Três colunas funcionais, e não seis campos lado a lado. O ganho não é "mais colunas": é a
        linha ficar escaneável em 2–3 segundos — QUEM É, QUAL A SITUAÇÃO, QUANDO MUDOU, PRECISO
        AGIR — sem aumentar a altura da linha (o token de densidade continua mandando).
      */}
      {items.length > 0 ? (
        <section aria-busy={isRefreshing} data-region="worklist-master">
          <table
            className="w-full table-fixed border-separate border-spacing-0"
            aria-label="Lista de clientes"
          >
            <thead>
              <tr>
                {/*
                  SELEÇÃO POR LINHA — coluna própria, com "selecionar todos" da PÁGINA.

                  O estado vive na tela (não na engine): a worklist de Clientes não é governada
                  por metadado, então a seleção é do domínio, não do schema.
                */}
                <th scope="col" className={cn(headCellClass, 'w-[2.5rem]')}>
                  <input
                    id={selectAllId}
                    type="checkbox"
                    data-testid="clients-select-all"
                    aria-label="Selecionar todos os clientes desta página"
                    checked={items.length > 0 && selectedIds.length === items.length}
                    onChange={(event) =>
                      setSelectedIds(event.target.checked ? items.map((item) => item.id) : [])
                    }
                  />
                </th>
                <th
                  scope="col"
                  className={cn(headCellClass, 'w-[46%]')}
                  aria-sort={ariaSortFor(filters, CLIENT_LIST_SORTS.LegalName)}
                >
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-gray-900"
                    onClick={() =>
                      applyFilters(toggleClientListSort(filters, CLIENT_LIST_SORTS.LegalName))
                    }
                  >
                    Cliente
                    <span aria-hidden="true">{sortIndicator(filters, CLIENT_LIST_SORTS.LegalName)}</span>
                  </button>
                </th>
                <th scope="col" className={cn(headCellClass, 'w-[22%]')}>
                  Situação
                </th>
                <th
                  scope="col"
                  className={cn(headCellClass, 'w-[32%]')}
                  aria-sort={ariaSortFor(filters, CLIENT_LIST_SORTS.UpdatedAt)}
                >
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-gray-900"
                    onClick={() =>
                      applyFilters(toggleClientListSort(filters, CLIENT_LIST_SORTS.UpdatedAt))
                    }
                  >
                    Última atualização
                    <span aria-hidden="true">{sortIndicator(filters, CLIENT_LIST_SORTS.UpdatedAt)}</span>
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
                      'h-[var(--row-height)] cursor-pointer transition-colors hover:bg-brand-50/40',
                      /*
                        EXCEPTION-FIRST: só o cadastro que NÃO pode operar carrega sinal. Cliente
                        ativo é o estado normal da carteira e fica em silêncio — pintar 19 linhas
                        de "normal" é o que faz a exceção perder significado.
                      */
                      isInactive && 'bg-red-50/40',
                    )}
                    /*
                      A IDENTIDADE É O DRILLBACK. A linha inteira abre o CONTEXTO no painel lateral
                      e o nome é um link REAL — teclado, clique do meio, nova aba e leitor de tela
                      levam ao cadastro completo. NÃO existe botão "Abrir cadastro"/"Detalhes"
                      repetido em cada linha.
                    */
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest('a, button, select, input')) {
                        return;
                      }
                      preview.openPreview(client);
                    }}
                  >
                    {/*
                      CAIXA DE SELEÇÃO — `stopPropagation` para que marcar não abra o contexto.
                      O clique na LINHA continua abrindo o drawer; a caixa é um alvo próprio.
                    */}
                    <td className={cn(cellClass, 'w-[2.5rem]')}>
                      <input
                        type="checkbox"
                        data-testid="clients-select-row"
                        data-row-id={client.id}
                        aria-label={`Selecionar ${client.legalName}`}
                        checked={selectedIds.includes(client.id)}
                        onChange={(event) =>
                          setSelectedIds((current) =>
                            event.target.checked
                              ? [...current, client.id]
                              : current.filter((id) => id !== client.id),
                          )
                        }
                        onClick={(event) => event.stopPropagation()}
                      />
                    </td>
                    {/*
                      IDENTIDADE — três níveis numa coluna só.
                      A razão social é o que o operador procura; fantasia e documento são
                      CONFIRMAÇÃO de que achou o registro certo. Dar a cada um a sua coluna daria
                      o mesmo peso visual a três coisas de peso diferente.
                    */}
                    <td className={cn(cellClass, 'pl-3')}>
                      {isInactive ? (
                        <span
                          aria-hidden="true"
                          className="absolute top-1 bottom-1 left-0 w-[3px] bg-red-500"
                        />
                      ) : null}
                      <span className="flex min-w-0 items-baseline gap-x-2">
                        {href ? (
                          <Link
                            to={href}
                            onClick={(event) => event.stopPropagation()}
                            title={client.legalName}
                            className="cisne-type-primary min-w-0 truncate text-brand-800 no-underline hover:underline"
                          >
                            {client.legalName}
                          </Link>
                        ) : (
                          <span
                            className="cisne-type-primary min-w-0 truncate text-gray-900"
                            title={client.legalName}
                          >
                            {client.legalName}
                          </span>
                        )}
                        {client.tradeName ? (
                          <span className="cisne-type-meta min-w-0 truncate" title={client.tradeName}>
                            {client.tradeName}
                          </span>
                        ) : null}
                        <span className="cisne-type-helper hidden shrink-0 font-mono tabular-nums lg:inline">
                          {formatCnpjDisplay(client.taxId)}
                        </span>
                      </span>
                    </td>

                    {/*
                      ESTADO — EXCEPTION-FIRST, não coloração do dataset.

                      A coluna pintava um `StatusBadge` VERDE em cada cliente ativo: dezenove
                      selos idênticos que não dizem nada e fazem a única linha que importa
                      (fora de operação) desaparecer no meio. Estado normal fica em TEXTO com
                      baixo ruído; só a EXCEÇÃO recebe selo e cor. O enum cru nunca aparece.
                    */}
                    <td className={cn(cellClass, 'z-[1]')}>
                      {isInactive ? (
                        <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                          <StatusBadge label={clientStatusLabel(client.status)} tone="error" />
                          <span
                            className={cn(
                              'cisne-type-helper min-w-0 truncate',
                              nextAction.pending ? 'font-medium text-brand-700' : 'text-gray-400',
                            )}
                          >
                            {nextAction.label}
                          </span>
                        </span>
                      ) : (
                        <span className="flex min-w-0 items-baseline gap-x-1.5">
                          <span
                            aria-label={`Status: ${clientStatusLabel(client.status)}`}
                            className="cisne-type-meta shrink-0"
                          >
                            {clientStatusLabel(client.status)}
                          </span>
                          <span className="cisne-type-helper min-w-0 truncate text-gray-400">
                            {nextAction.label}
                          </span>
                        </span>
                      )}
                    </td>

                    {/*
                      TEMPO — a leitura relativa é a que decide ("há 12 dias" ordena a atenção); o
                      carimbo absoluto é a prova; a criação é contexto subordinado. Três datas
                      possíveis, uma coluna funcional.
                    */}
                    <td className={cn(cellClass, 'z-[1] pr-3')}>
                      <span className="cisne-type-meta whitespace-nowrap">
                        {formatClientListRelative(client.updatedAt, now)}
                        <span className="cisne-type-helper">
                          {' · '}
                          {formatClientListDateTime(client.updatedAt)}
                        </span>
                      </span>
                      <span className="cisne-type-helper block truncate">
                        criado em {formatClientListDateTime(client.createdAt)}
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
          <p className="cisne-type-helper m-0 tabular-nums">
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

      {/*
        CONTEXT REGION — MASTER/DETAIL SEM ABANDONAR A FILA.

        Selecionar a linha abre o contexto REAL do registro: identidade, situação, os fatos que a
        listagem não publica (exigência de pedido de compra, desativação) e as RELAÇÕES reais
        (contatos e endereços vêm do detalhe). Fechar o painel devolve o operador exatamente onde
        estava: filtros, ordenação, página e scroll intactos.

        Não existe "Abrir cadastro" repetido na grade: a identidade é o drillback e a linha abre o
        contexto. Comandos reais (`activate`/`deactivate`) ficam AQUI, no contexto do objeto — não
        como botões espalhados na tabela.
      */}
      <DynamicContextDrawer
        open={preview.previewRow !== null}
        title="Contexto do cliente"
        onClose={preview.closePreview}
        crossReferences={[]}
      >
        <div data-region="context-region">
          {/* Identidade humana do registro selecionado — nunca um identificador técnico. */}
          {preview.previewRow ? (
            <p className="cisne-type-primary m-0 mb-2 truncate">
              {preview.previewRow.tradeName ?? preview.previewRow.legalName}
            </p>
          ) : null}

          {detail.phase === 'loading' ? (
            /* SKELETON LOCALIZADO — só o painel espera; a worklist segue viva. */
            <div aria-busy="true" role="status" className="flex flex-col gap-1.5">
              <span className="cisne-type-helper">Carregando contexto…</span>
              <Skeleton lines={4} />
            </div>
          ) : null}

          {detail.phase === 'denied' ? (
            /* NEGAÇÃO ≠ VAZIO: sem permissão de detalhe, o painel diz isso — não mostra ficha em branco. */
            <p className="cisne-type-body m-0" role="alert">
              Você não tem permissão para ver a ficha deste Cliente.
            </p>
          ) : null}

          {detail.phase === 'error' ? (
            <p className="cisne-type-body m-0 text-red-700" role="alert">
              {detail.message}
            </p>
          ) : null}

          {detail.phase === 'ready' ? (
            <>
              <dl className="m-0 grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                <dt className="cisne-meta-label pt-0.5">Razão social</dt>
                <dd className="cisne-meta-value m-0">{detail.client.legalName}</dd>
                {detail.client.tradeName ? (
                  <>
                    <dt className="cisne-meta-label pt-0.5">Nome fantasia</dt>
                    <dd className="cisne-meta-value m-0">{detail.client.tradeName}</dd>
                  </>
                ) : null}
                <dt className="cisne-meta-label pt-0.5">CNPJ</dt>
                <dd className="cisne-meta-value m-0 font-mono">
                  {formatCnpjDisplay(detail.client.taxId)}
                </dd>
                <dt className="cisne-meta-label pt-0.5">Situação</dt>
                <dd className="cisne-meta-value m-0">{clientStatusLabel(detail.client.status)}</dd>
                <dt className="cisne-meta-label pt-0.5">Pedido de compra</dt>
                <dd className="cisne-meta-value m-0">
                  {formatPurchaseOrderRequirement(detail.client.purchaseOrderRequirement)}
                </dd>
                <dt className="cisne-meta-label pt-0.5">Atualizado</dt>
                <dd className="cisne-meta-value m-0">{formatClientListDateTime(detail.client.updatedAt)}</dd>
                {detail.client.deactivatedAt ? (
                  <>
                    <dt className="cisne-meta-label pt-0.5">Desativado</dt>
                    <dd className="cisne-meta-value m-0">
                      {formatClientListDateTime(detail.client.deactivatedAt)}
                    </dd>
                  </>
                ) : null}
                {detail.client.deactivationReason ? (
                  <>
                    <dt className="cisne-meta-label pt-0.5">Motivo</dt>
                    <dd className="cisne-meta-value m-0">{detail.client.deactivationReason}</dd>
                  </>
                ) : null}
              </dl>

              {/*
                COMANDOS REAIS DO DOMÍNIO — e SÓ os que o contrato permite executar daqui.

                `activate` exige apenas `version`, que SÓ o detalhe publica — por isso ele vive
                aqui e não na linha, e é enviado como INTENÇÃO: quem valida é o backend.

                `deactivate` exige `version` E `reason` (invariante do domínio). Não existe motivo
                padrão honesto para preencher no lugar do operador, então a desativação NÃO é
                oferecida como botão aqui: ela é um drillback para onde o motivo é capturado. Botão
                que inventa o motivo seria pior que a ausência do botão.
              */}
              <div className="cisne-divider--top mt-2 flex flex-wrap items-center gap-1.5 pt-2">
                {detail.client.status === CLIENT_STATUSES.Inactive && capabilities.canActivate ? (
                  <Button
                    variant="primary"
                    loading={commandBusy}
                    loadingText="Reativando…"
                    onClick={() => {
                      void runDetailCommand(() =>
                        activateClient(detail.client.id, detail.client.version),
                      );
                    }}
                  >
                    Reativar cadastro
                  </Button>
                ) : null}
                {/*
                  DRILLBACK ÚNICO — vive AQUI, uma vez por registro selecionado. A grade não
                  repete "Abrir cadastro" em cada linha: a identidade é o drillback da linha, e o
                  painel oferece o caminho para a ficha completa (onde o motivo da desativação é
                  capturado, já que `deactivate` exige `reason` e não há motivo padrão honesto).
                */}
                {capabilities.canRead ? (
                  <ModulePrimaryLink to={`/app/clients/${detail.client.id}`}>
                    Abrir cadastro completo
                  </ModulePrimaryLink>
                ) : null}
              </div>

              {commandError ? (
                <p className="cisne-type-helper m-0 mt-1.5 text-red-700" role="alert">
                  {commandError}
                </p>
              ) : null}

              {/*
                CADEIA COMERCIAL — o MESMO primitivo da object page, não uma segunda versão.

                Antes esta região montava à mão UMA referência ("Solicitações deste cliente"), o que
                jogava fora três módulos que o backend já responde e não mostrava a LIGAÇÃO entre os
                objetos. Agora a barra vem de `buildClientRelationSpecs` (que respeita `read A !=
                read B` e só publica contagem comprovada) e a cadeia vem do read model do servidor.
                O painel continua sem número inventado: módulo negado não é desenhado.
              */}
              <SmartRelationBar
                relations={buildAuthorizedRelations(
                  buildClientRelationSpecs(related, detail.client.id),
                )}
                className="mt-2"
              />
              <div className="mt-2">
                <BusinessChain chain={businessChain.chain} phase={businessChain.phase} />
              </div>
            </>
          ) : null}
        </div>
      </DynamicContextDrawer>
    </ModulePage>
  );
}

/* ------------------------------------------------------------------ densidade */

/**
 * Células da grade — densidade e tipografia GOVERNADAS pelos tokens da foundation.
 *
 * Antes: `py-2` com `align-top`, `text-[10px]` no cabeçalho e `text-[11px..13px]` nas células —
 * cinco tamanhos crus que não vinham de escala nenhuma. Medido no DOM real: linhas de 61 a 96px
 * contra o token de 28px, e só 8 registros na primeira dobra.
 *
 * Agora a altura da linha vem de `--row-height`, o cabeçalho usa o papel `label` e as células usam
 * `body`/`meta`/`helper`. A grade de Clientes passa a ter a MESMA gramática das demais worklists.
 */
/*
 * AS CLASSES DA GRADE VEM DO PRIMITIVO COMPARTILHADO.
 *
 * Este arquivo declarava `headCellClass`/`cellClass` proprios, com `border-gray-300`, `bg-gray-50` e
 * `text-gray-600` — a MESMA grade do produto com quatro hex que nao existem na paleta CISNE. O
 * efeito medido no DOM: o cabecalho de Clientes saia em `#EEF3F8` com tinta `#52647A`, enquanto o
 * painel operacional usava `#EAF0F6` com `#31455C`. Mesma funcao, duas cores.
 *
 * As constantes continuam existindo como ALIAS — as 40 referencias desta tela nao mudam — mas agora
 * apontam para a unica definicao de cabecalho/celula de worklist do sistema. Corrigir a gramatica em
 * um lugar passa a corrigir todas as telas.
 */
const headCellClass = worklistHeadCellClass;

const cellClass = worklistCellClass;

/**
 * CÉLULA DA FAIXA DE TRABALHO — recorte REAL em UM controle.
 *
 * O peso comunica o trabalho, e EXCEPTION-FIRST é a regra: `neutral` é o estado normal da
 * carteira (baixo ruído — 19 ativos não podem gritar), `alert` marca o recorte que exige o
 * operador, `settled` o que já está resolvido. Sem número publicado a célula declara `n/d` em vez
 * de `0`, porque zero afirmaria um recorte inexistente (`AUSÊNCIA ≠ ZERO`).
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
  weight: 'neutral' | 'settled' | 'alert';
  active: boolean;
  onClick: () => void;
}) {
  const numberClass =
    value === null
      ? 'text-gray-300'
      : weight === 'alert'
        ? 'text-red-700'
        : weight === 'neutral'
          ? 'text-gray-900'
          : 'text-gray-500';
  return (
    <button
      type="button"
      aria-pressed={active}
      title={hint}
      onClick={onClick}
      className={cn(
        'flex min-w-[10rem] flex-1 flex-col items-start gap-0 border-r border-gray-200 px-3 py-1 text-left transition-colors last:border-r-0',
        active ? 'bg-brand-50' : 'hover:bg-gray-50',
      )}
    >
      <span className="flex items-baseline gap-1.5">
        <span className={cn('cisne-type-object leading-none tabular-nums', numberClass)}>
          {value === null ? 'n/d' : formatClientCount(value)}
        </span>
        <span
          className={cn(
            'cisne-meta-label',
            weight === 'settled' ? 'text-gray-400' : 'text-gray-700',
          )}
        >
          {label}
        </span>
      </span>
      <span className="cisne-type-helper truncate">{hint}</span>
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
 * RELAÇÕES REAIS DO CLIENTE — removida.
 *
 * Existia aqui uma montagem artesanal que publicava UMA referência ("Solicitações deste cliente")
 * e descartava os outros três módulos que o backend já responde para o mesmo `clientId`. A fonte
 * única passou a ser `buildClientRelationSpecs` + `buildAuthorizedRelations`, os MESMOS usados pela
 * object page — sem segunda implementação da mesma leitura.
 */
