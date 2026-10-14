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
import { useClientExtendedContext } from '../hooks/useClientExtendedContext';
import {
  ClientFinancialSummary,
  ClientNextActionStrip,
  ClientQualitySummary,
  ClientSituationStrip,
} from '../components/ClientWorkspacePanels';
import {
  deriveClientAttention,
  hierarchyLabel,
} from '../utils/client-workspace-presentation';
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
import {
  WorklistClearFilters,
  WorklistField,
  worklistControlClass,
  worklistSelectClass,
} from '../../ui/enterprise-list';
import {
  workspaceCellClass,
  workspaceHeadCellClass,
} from '../../ui/workspace-frame';
import { StatusBadge } from '../../ui/StatusBadge';
import { Button } from '../../ui/Button';
import { Skeleton } from '../../ui/Skeleton';
import {
  ContextFacts,
  ContextSection,
  WorkspaceBody,
  WorkspaceEmpty,
  WorkspaceHeader,
  WorkspacePane,
  WorkspacePaneHeader,
  WorkspaceStatusLine,
  WorkspaceToolbar,
} from '../../ui/workspace-frame';
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
   * CONTEXTO AMPLIADO DO REGISTRO SELECIONADO — qualidade e financeiro.
   *
   * Carregados SOMENTE para o Cliente aberto (nunca para a página inteira): buscar qualidade e
   * financeiro de 20 linhas seria N+1 no caminho de leitura mais usado do módulo.
   */
  const extended = useClientExtendedContext(previewId);

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

  /**
   * CORPO DO CONTEXTO — UMA implementação, DOIS enquadramentos.
   *
   * A coluna do workspace (>= xl) e o drawer (abaixo de xl) renderizam ESTE MESMO conteúdo. Duas
   * cópias divergiriam no primeiro ajuste, e a tela passaria a mostrar coisas diferentes conforme
   * a largura — o defeito clássico de "versão mobile esquecida".
   */
  const contextBody = (
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

                {/*
                  CONTEXTO AMPLIADO — o que o operador precisa ANTES de decidir sair da fila.
                  Quatro seções curtas e reais, na ordem de decisão: o que exige ação, o que o
                  servidor avalia do cadastro, quanto está em aberto, e para onde ir em seguida.
                  Nenhuma delas busca dado para a PÁGINA inteira: só para o registro aberto.
                */}
                <div className="mt-3 flex flex-col gap-2.5" data-region="context-extended">
                  <ContextSection title="Situações publicadas">
                    <ClientSituationStrip
                      status={detail.client.status}
                      quality={extended.quality}
                      financial={extended.financial}
                    />
                  </ContextSection>

                  <ContextSection title="Qualidade do cadastro">
                    {extended.qualityPhase === 'loading' ? (
                      <Skeleton lines={2} />
                    ) : extended.qualityPhase === 'denied' ? (
                      <p className="cisne-type-helper m-0">
                        Sem permissão para avaliar a qualidade deste cadastro.
                      </p>
                    ) : extended.qualityPhase === 'error' ? (
                      <p className="cisne-type-helper m-0 text-red-700">
                        Não foi possível avaliar a qualidade do cadastro.
                      </p>
                    ) : (
                      <ClientQualitySummary quality={extended.quality} />
                    )}
                  </ContextSection>

                  {/*
                    FINANCEIRO — a seção só existe quando a leitura foi TENTADA. Um ator sem
                    `finance:receivable:list` recebe 403, e a seção declara a restrição em vez de
                    sumir em silêncio: sumir faria o operador achar que o Cliente não tem títulos.
                  */}
                  <ContextSection title="Financeiro">
                    {extended.financialPhase === 'loading' ? (
                      <Skeleton lines={2} />
                    ) : extended.financialPhase === 'denied' ? (
                      <p className="cisne-type-helper m-0" data-region="context-financial-forbidden">
                        Você não tem permissão para consultar títulos a receber.
                      </p>
                    ) : extended.financialPhase === 'error' ? (
                      <p className="cisne-type-helper m-0 text-red-700">
                        Não foi possível carregar o contexto financeiro.
                      </p>
                    ) : (
                      <ClientFinancialSummary context={extended.financial} />
                    )}
                  </ContextSection>

                  <ClientNextActionStrip
                    client={{
                      ...preview.previewRow!,
                      status: detail.client.status,
                    }}
                    capabilities={capabilities}
                    href={`/app/clients/${detail.client.id}`}
                  />
                </div>
              </>
            ) : null}
          </div>

  );

  return (
    <ModulePage layout="workspace">
      {/*
        CUSTOMER WORKSPACE — A BANCADA DE CARTEIRA.

        ─────────────────────────────────────────────────────────────────────────────────────────
        O QUE ESTA TELA ERA, MEDIDO

        Em 1600×900, com cinco clientes publicados:

          cabeçalho + toolbar   139px   (uma faixa fixa `sticky`)
          tabela                225px   (5 linhas de 44px)
          coluna de contexto     84px   (!!)
          conteúdo terminava    y=497
          canvas vazio abaixo   403px   — 45% da viewport, branco, sem função

        A coluna de contexto media 84 PIXELADOS: o painel "Contexto do cliente" era uma caixa com
        uma frase de instrução, porque sem seleção ele não tinha o que mostrar e o layout o deixava
        encolher até o conteúdo. A tela lia como ADMINISTRATIVE LIST PAGE — cabeçalho, filtros,
        tabela, um boxezinho e um vazio no fim.

        ─────────────────────────────────────────────────────────────────────────────────────────
        O QUE ELA É AGORA

        Uma bancada de CUSTOMER OPERATIONS com a gramática de workspace do produto:

          WorkspaceHeader   Clientes + situação da carteira em UMA linha de metadata
          WorkspaceToolbar  visões + busca + filtros numa faixa só
          WorkspaceBody     grade da carteira + coluna de contexto, AMBAS com altura de viewport

        A mudança estrutural que produz a diferença: o corpo da bancada é uma GRADE DE ALTURA TOTAL.
        A coluna de contexto passa a ter ~600px de altura em vez de 84px, e a silhueta da tela não
        depende mais de quantos registros existem — dois clientes ou duzentos ocupam o mesmo quadro.

        ─────────────────────────────────────────────────────────────────────────────────────────
        O QUE NÃO MUDOU (e não podia mudar)

        Nenhuma chamada de API, nenhum filtro, nenhuma rota, nenhuma capability, nenhuma regra de
        domínio. `AUSÊNCIA ≠ ZERO` continua valendo: sem carteira autorizada o total não é afirmado.
        A seleção de linha, o comando em lote, a coluna de contexto abaixo de `xl` (drawer) e todos
        os `data-testid` permanecem exatamente onde estavam.
      */}
      <WorkspaceHeader
        title="Clientes"
        identity="Carteira autorizada e relacionamento"
        scope={isRefreshing ? `${scope} · atualizando…` : scope}
        status={
          hasCatalog ? (
            /*
              SITUAÇÃO DA CARTEIRA COMO METADATA OPERACIONAL — não como três cartões.

              Eram três caixas contornadas, cada uma com número e legenda, ocupando uma faixa de
              ~40px acima da grade. São três números que cabem numa linha de texto e que NÃO são a
              tarefa do operador: são contexto. Aqui eles ficam na linha de identidade, com o número
              em peso e o rótulo em muted.

              EXCEPTION-FIRST continua: só "fora de operação" carrega sinal, e só quando existe
              trabalho nele. "19 ativos" é o estado normal da carteira e não pode gritar.
            */
            <WorkspaceStatusLine
              items={[
                {
                  value: formatClientCount(total),
                  label: hasFilters ? 'no recorte' : 'na carteira',
                  onClick: () => applyFilters({ status: '' }),
                },
                {
                  value: formatClientCount(activeOnPage),
                  label: 'ativos nesta página',
                  onClick: () => applyFilters({ status: CLIENT_STATUSES.Active }),
                },
                {
                  value: formatClientCount(inactiveOnPage),
                  label: 'fora de operação',
                  tone: inactiveOnPage > 0 ? 'alert' : 'neutral',
                  onClick: () => applyFilters({ status: CLIENT_STATUSES.Inactive }),
                },
              ]}
            />
          ) : undefined
        }
        action={
          /*
            COMANDO PRIMÁRIO ÚNICO. Com a carteira vazia a criação desce para o estado vazio (que
            já explica o que um Cliente é) e o cabeçalho não a repete — duas CTAs primárias na mesma
            dobra deixam o operador sem saber qual é a ação.
          */
          capabilities.canCreate && !isEmptyCatalogue ? (
            <ModulePrimaryLink to="/app/clients/new">Novo cliente</ModulePrimaryLink>
          ) : null
        }
      />

      {hasCatalog ? (
        <WorkspaceToolbar
          views={
            <>
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
            </>
          }
        >
          <input
            id={searchInputId}
            type="search"
            aria-label="Buscar"
            className={cn(worklistControlClass, 'w-[280px] max-w-full')}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Razão social, nome fantasia ou CNPJ"
            autoComplete="off"
            aria-describedby={searchDraftTooShort ? searchHintId : undefined}
          />

          <select
            id={statusFilterId}
            aria-label="Situação"
            className={worklistSelectClass}
            value={filters.status}
            onChange={(event) =>
              applyFilters({ status: event.target.value as ClientListParams['status'] })
            }
          >
            <option value="">Todas as situações</option>
            <option value={CLIENT_STATUSES.Active}>Ativos</option>
            <option value={CLIENT_STATUSES.Inactive}>Inativos</option>
          </select>

          {/*
            FILTROS AVANÇADOS EM BOTÃO, NÃO EM TEXTO.
            O construtor de metadado fica ATRÁS deste controle e só é renderizado quando o operador
            o abre — um construtor de filtro composto aberto por padrão custa altura permanente para
            uma tarefa ocasional.
          */}
          <button
            id={moreFiltersId}
            type="button"
            aria-expanded={showMoreFilters}
            data-testid="clients-more-filters"
            className={cn(
              'cisne-type-action inline-flex min-h-[var(--control-height)] items-center gap-1 rounded-[4px] border px-2',
              isFilterGroupActive(advancedGroup)
                ? 'border-brand-300 bg-brand-50 text-brand-800'
                : 'border-[color:var(--color-border-default)] bg-white text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-surface-hover)]',
            )}
            onClick={() => setShowMoreFilters((current) => !current)}
          >
            Filtros
            {isFilterGroupActive(advancedGroup) ? (
              <span aria-hidden="true" className="text-[10px]">
                ●
              </span>
            ) : null}
          </button>

          <WorklistClearFilters
            visible={hasFilters || searchInput.trim() !== '' || isFilterGroupActive(advancedGroup)}
            onClick={clearFilters}
          />
        </WorkspaceToolbar>
      ) : null}

      {searchDraftTooShort ? (
        <p id={searchHintId} className="cisne-type-helper m-0 mb-2">
          Digite pelo menos {CLIENT_SEARCH_MIN_LENGTH} caracteres para buscar.
        </p>
      ) : null}

      {/*
        SUPERFÍCIE DE FILTRO AVANÇADO — SOB DIVULGAÇÃO PROGRESSIVA.

        Os filtros secundários (exigência de pedido de compra) e o construtor dirigido por metadado
        aparecem SOMENTE quando abertos. Antes, o construtor era renderizado sempre que havia
        carteira: uma faixa permanente para uma tarefa ocasional.
      */}
      {hasCatalog && showMoreFilters ? (
        <div
          className="cisne-divider mb-2 flex flex-col gap-1 border-b border-[color:var(--color-divider)] py-1.5"
          data-region="advanced-filter-surface"
        >
          <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
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
          </div>

          {/*
            O construtor é o MESMO da engine (`DynamicFilterBuilder`): ele lê `meta.fields` da
            entidade `client` e oferece apenas os campos marcados `in_filter` — exatamente os que
            o predicado server-side executa.
          */}
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
          className="mb-2 flex flex-wrap items-center gap-2 rounded-[4px] border border-[color:var(--color-brand-200)] border-l-[3px] border-l-[color:var(--color-brand-600)] bg-[color:var(--color-brand-50)] px-2.5 py-1.5"
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
            className="cisne-type-action ml-auto inline-flex min-h-[var(--control-height)] items-center rounded-[4px] px-2 text-[color:var(--color-text-secondary)] hover:bg-white"
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
            <p className="cisne-type-body m-0 w-full text-red-700" role="alert">
              {bulkMessage}
            </p>
          ) : null}
        </div>
      ) : null}

      {/*
        CORPO DA BANCADA — GRADE DA CARTEIRA + CONTEXTO DO CLIENTE, ALTURA DE VIEWPORT.

        As duas colunas têm a MESMA altura, que é a altura que o shell deixou. Consequências
        diretas, medidas: a coluna de contexto passa de 84px para ~600px, a grade recebe a altura
        restante em vez de encolher até o último registro, e não existe mais "metade branca" abaixo
        do conteúdo — a superfície ocupa o quadro inteiro.
      */}
      <WorkspaceBody
        context={
          <div className="hidden min-w-0 xl:block" data-region="context-column">
            {preview.previewRow === null ? (
              /*
                SEM SELEÇÃO, A COLUNA DE CONTEXTO NÃO É UM BOX VAZIO.

                Antes ela era uma caixa com uma frase e 84px de altura. Agora ela é uma SUPERFÍCIE DE
                LEITURA com o que o operador precisa para decidir qual registro abrir: o resumo do
                recorte que ele está vendo e a lista dos sinais que exigem atenção. Isso é valor
                operacional antes de qualquer clique — e a coluna continua estável, sem "salto"
                quando a primeira linha é selecionada.
              */
              <WorkspacePane
                surface="support"
                aria-label="Contexto do cliente"
                className="h-full overflow-auto"
              >
                <WorkspacePaneHeader title="Contexto do cliente" />
                <ContextSection title="Carteira neste recorte">
                  <ContextFacts
                    facts={[
                      {
                        label: 'Clientes',
                        value: hasCatalog ? formatClientCount(total) : 'Sem carteira autorizada',
                      },
                      { label: 'Nesta página', value: formatClientCount(items.length) },
                      { label: 'Ativos', value: formatClientCount(activeOnPage) },
                      {
                        label: 'Fora de operação',
                        value: formatClientCount(inactiveOnPage),
                      },
                      { label: 'Recorte', value: scope },
                    ]}
                  />
                </ContextSection>

                <ContextSection title="Requer atenção">
                  {inactiveOnPage > 0 ? (
                    <p className="cisne-type-body m-0">
                      <strong className="font-semibold">{inactiveOnPage}</strong>{' '}
                      {inactiveOnPage === 1 ? 'cliente está' : 'clientes estão'} fora de operação
                      nesta página. Cadastros inativos não entram em novos documentos.
                    </p>
                  ) : (
                    <p className="cisne-type-body m-0">
                      Nenhum cliente fora de operação nesta página.
                    </p>
                  )}
                </ContextSection>

                {/*
                  CONTEXTO E DADO DE NEGOCIO, NAO TUTORIAL.

                  Aqui havia uma secao "Como usar" com tres instrucoes de interface ("clique numa
                  linha para abrir o contexto...", "marque as caixas a esquerda..."). Um ERP nao
                  ensina o proprio produto dentro da coluna de contexto: essa coluna existe para
                  responder "o que e este trabalho", e cada pixel gasto explicando a tela e um dado
                  que o operador nao ve.

                  O que fica no lugar e a ESTRUTURA DA CARTEIRA no recorte — o fato que a coluna
                  pode afirmar com o que foi publicado, sem inventar agregacao que o servidor nao
                  mandou.
                */}
                <ContextSection title="Estrutura da carteira">
                  <ContextFacts
                    facts={[
                      { label: 'Recorte', value: scope },
                      {
                        label: 'Operação',
                        value:
                          inactiveOnPage > 0
                            ? `${formatClientCount(inactiveOnPage)} fora de operação`
                            : 'Todos em operação',
                      },
                      {
                        label: 'Leitura',
                        value: hasCatalog ? 'Publicada pelo servidor' : 'Sem carteira autorizada',
                      },
                    ]}
                  />
                </ContextSection>
              </WorkspacePane>
            ) : (
              /*
               * A COLUNA É O PRÓPRIO PAINEL — sem `Drawer`.
               *
               * `ContextDrawer` (do operator) só aceita `preview` ESTRUTURADO e `DynamicContextDrawer`
               * é um `role="dialog"` fixo com scrim. Nenhum dos dois é a coluna de bancada: o
               * primeiro prenderia o conteúdo a um formato que a ficha do Cliente não cabe (ela tem
               * seções com comandos), e o segundo prenderia o FOCO, o que é errado para uma coluna
               * que convive com a grade.
               *
               * A coluna usa o corpo COMPARTILHADO (`contextBody`) sobre a superfície de contexto,
               * e o `DynamicContextDrawer` continua sendo usado abaixo de `xl`. Um conteúdo, dois
               * enquadramentos — nenhuma segunda implementação de contexto.
               */
              <section
                aria-label="Contexto do cliente"
                className="flex h-full min-h-0 flex-col overflow-hidden rounded-[4px] border border-[color:var(--color-border-default)] bg-[color:var(--color-surface-context)]"
              >
                <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[color:var(--color-divider)] px-3 py-2">
                  <h2 className="m-0 text-[13px] font-[650] text-[color:var(--color-text-primary)]">
                    Contexto do cliente
                  </h2>
                  <button
                    type="button"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-[3px] text-[color:var(--color-text-muted)] hover:bg-white hover:text-[color:var(--color-text-primary)]"
                    onClick={preview.closePreview}
                    aria-label="Fechar contexto"
                  >
                    ×
                  </button>
                </header>
                <div className="min-h-0 flex-1 overflow-auto px-3 py-2.5">{contextBody}</div>
              </section>
            )}
          </div>
        }
      >
        {/*
          A REGIAO DE TRABALHO E DECLARADA NO PROPRIO PAINEL — E NAO NUM WRAPPER INTERNO.

          DEFEITO MEDIDO, corrigido aqui. Em Clientes o `data-region="worklist-master"` estava num
          `<div>` TRANSPARENTE dentro do `WorkspacePane`:

              ANCESTOR[0]  region=worklist-master  bg=rgba(0, 0, 0, 0)   940x660   <- a regiao
              ANCESTOR[1]  region=-                bg=rgb(255, 255, 255)  942x662   <- a superficie

          Consequencia: a REGIAO publicada pela tela nao era a superficie de trabalho, e qualquer
          leitura de "qual e o fundo da area de trabalho em Clientes" media o wrapper e devolvia
          TRANSPARENTE. Foi exatamente o que a prova de contrato acusou — e a assimetria era real:
          em Contas a Receber a mesma regiao esta no painel, aqui estava num filho.

          A regiao passa a ser declarada pelo painel, igual as outras bancadas do produto. O wrapper
          interno continua existindo, porque ele e quem governa o flex da grade — so deixa de
          carregar a identidade da regiao.
        */}
        <WorkspacePane
          aria-busy={isRefreshing}
          className="h-full overflow-hidden"
          data-region="worklist-master"
        >
          {isEmptyCatalogue ? (
            <WorkspaceEmpty
              title="Nenhum Cliente cadastrado ainda."
              description="Os Clientes são a contraparte comercial usada por solicitações, propostas, pedidos de compra, ordens de serviço e faturamento. Cadastre o primeiro para começar."
              action={
                capabilities.canCreate ? (
                  <ModulePrimaryLink to="/app/clients/new">Cadastrar Cliente</ModulePrimaryLink>
                ) : null
              }
            />
          ) : null}

          {isNoResults ? (
            <WorkspaceEmpty
              title="Nenhum Cliente corresponde aos filtros aplicados."
              description="Ajuste o termo de busca ou limpe os filtros para ver o cadastro completo."
              action={
                <button
                  type="button"
                  className="cisne-type-action inline-flex min-h-[var(--control-height)] items-center rounded-[4px] border border-[color:var(--color-border-default)] bg-white px-2.5 text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-surface-hover)]"
                  onClick={clearFilters}
                >
                  Limpar filtros
                </button>
              }
            />
          ) : null}

          {isOutOfRange ? (
            <WorkspaceEmpty
              title="Esta página não existe mais para os filtros aplicados."
              description={`Existem ${formatClientCount(total)} ${
                total === 1 ? 'Cliente' : 'Clientes'
              } no total, em ${formatClientCount(totalPages)} ${
                totalPages === 1 ? 'página' : 'páginas'
              }.`}
              action={
                <button
                  type="button"
                  className="cisne-type-action inline-flex min-h-[var(--control-height)] items-center rounded-[4px] border border-[color:var(--color-border-default)] bg-white px-2.5 text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-surface-hover)]"
                  onClick={() => setSearchParams(buildClientListSearchParams(filters, 0))}
                >
                  Ir para a primeira página
                </button>
              }
            />
          ) : null}

          {items.length > 0 ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-auto">
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
                  className={cn(headCellClass, 'w-[34%]')}
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
                {/*
                  ESTRUTURA EMPRESARIAL — COLUNA DE DECISÃO, NÃO DE CADASTRO.

                  O grupo econômico é o que permite ao operador raciocinar por CONTA e não por
                  linha solta ("esta compra é do Grupo X"). Ele passou a existir no payload nesta
                  onda e por isso ganha coluna própria; sem dado publicado a célula fica vazia, e
                  nunca escreve "sem grupo", que soaria como pendência de cadastro.
                */}
                <th scope="col" className={cn(headCellClass, 'w-[20%]')}>
                  Estrutura
                </th>
                <th scope="col" className={cn(headCellClass, 'w-[16%]')}>
                  Situação
                </th>
                {/*
                  ATENÇÃO — A COLUNA QUE RESPONDE "EM QUEM EU MEXO AGORA".

                  Substitui o peso que "Próxima ação" ocupava como texto solto: agora o sinal de
                  exceção (bloqueio, atenção, sem avaliação) e o próximo passo vivem na mesma
                  célula, com o SINAL primeiro. `unknown` aparece como tal quando a qualidade não
                  foi carregada para a linha — não vira "em dia".
                */}
                <th scope="col" className={cn(headCellClass, 'w-[16%]')}>
                  Atenção
                </th>
                <th
                  scope="col"
                  className={cn(headCellClass, 'w-[14%]')}
                  aria-sort={ariaSortFor(filters, CLIENT_LIST_SORTS.UpdatedAt)}
                >
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-gray-900"
                    onClick={() =>
                      applyFilters(toggleClientListSort(filters, CLIENT_LIST_SORTS.UpdatedAt))
                    }
                  >
                    Atualização
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
                /*
                 * ESTRUTURA E ATENÇÃO SÃO DERIVADAS DO PAYLOAD DA LINHA.
                 *
                 * A qualidade NÃO é buscada por linha (seria N+1 na leitura mais usada do módulo),
                 * então `attention` cai em `unknown` quando não há dado carregado — e a coluna
                 * exibe isso em vez de afirmar "em dia". Quando o operador abre o contexto do
                 * registro, a qualidade real chega e o sinal passa a ser o do servidor.
                 */
                const structureLabel = hierarchyLabel(client);
                const attention = deriveClientAttention(
                  client,
                  preview.previewRow?.id === client.id ? extended.quality ?? undefined : undefined,
                );
                return (
                  <tr
                    key={client.id}
                    data-selected={preview.previewRow?.id === client.id}
                    className={cn(
                      'h-[44px] cursor-pointer transition-colors duration-100 hover:bg-[color:var(--color-grid-row-hover)] data-[selected=true]:bg-[color:var(--color-surface-selected)] data-[selected=true]:shadow-[inset_2px_0_0_0_var(--color-brand-600)]',
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
                      ESTRUTURA — grupo econômico / matriz / filiais DECLARADOS.
                      Célula vazia quando não há vínculo: o operador lê a ausência como ausência,
                      e não como pendência. É o que permite raciocinar por CONTA na fila.
                    */}
                    <td className={cn(cellClass, 'z-[1]')}>
                      {structureLabel ? (
                        <span className="cisne-type-meta block min-w-0 truncate" title={structureLabel}>
                          {client.groupName ?? structureLabel}
                        </span>
                      ) : null}
                      {client.childCount > 0 ? (
                        <span className="cisne-type-helper block truncate">
                          {client.childCount} {client.childCount === 1 ? 'filial' : 'filiais'}
                        </span>
                      ) : client.parentClientName ? (
                        <span className="cisne-type-helper block truncate">
                          Matriz: {client.parentClientName}
                        </span>
                      ) : null}
                    </td>

                    {/*
                      SITUAÇÃO — EXCEPTION-FIRST, não coloração do dataset.

                      Estado normal fica em TEXTO com baixo ruído; só a EXCEÇÃO recebe selo e cor.
                      O enum cru nunca aparece.
                    */}
                    <td className={cn(cellClass, 'z-[1]')}>
                      {isInactive ? (
                        <StatusBadge label={clientStatusLabel(client.status)} tone="error" />
                      ) : (
                        <span
                          aria-label={`Status: ${clientStatusLabel(client.status)}`}
                          className="cisne-type-meta"
                        >
                          {clientStatusLabel(client.status)}
                        </span>
                      )}
                    </td>

                    {/*
                      ATENÇÃO — SINAL PRIMEIRO, PRÓXIMO PASSO DEPOIS.

                      A coluna responde "em quem eu mexo agora": o nível vem da qualidade avaliada
                      pelo servidor quando existe, e `unknown` é exibido como tal quando não foi
                      carregada — nunca como "em dia", que afirmaria uma avaliação que ninguém fez.
                    */}
                    <td className={cn(cellClass, 'z-[1]')}>
                      <span className="flex min-w-0 flex-col gap-0.5">
                        {attention.level === 'blocking' ? (
                          <StatusBadge label="Bloqueio" tone="error" />
                        ) : attention.level === 'attention' ? (
                          <StatusBadge label="Atenção" tone="warning" />
                        ) : null}
                        <span
                          className={cn(
                            'cisne-type-helper min-w-0 truncate',
                            nextAction.pending ? 'font-medium text-brand-700' : 'text-gray-400',
                          )}
                        >
                          {attention.reason ?? nextAction.label}
                        </span>
                      </span>
                    </td>

                    {/*
                      TEMPO — a leitura relativa é a que decide ("há 12 dias" ordena a atenção); o
                      carimbo absoluto é a prova. A criação saiu da linha: é contexto de ficha, não
                      sinal de fila, e ocupava peso que a estrutura empresarial passou a usar.
                    */}
                    <td className={cn(cellClass, 'z-[1] pr-3')}>
                      <span className="cisne-type-meta whitespace-nowrap">
                        {formatClientListRelative(client.updatedAt, now)}
                      </span>
                      <span className="cisne-type-helper block truncate">
                        {formatClientListDateTime(client.updatedAt)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
                </table>
              </div>

              {hasCatalog || offset > 0 ? (
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[color:var(--color-divider)] px-3 py-1.5">
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
            </div>
          ) : null}
        </WorkspacePane>
      </WorkspaceBody>

      {/*
        CONTEXT REGION — MASTER/DETAIL EM VIEWPORT ESTREITO.

        Em telas abaixo de `xl` não há largura para duas colunas legíveis: a coluna de contexto
        daria ~200px e a tabela espremeria. Ali o contexto vira o drawer do próprio workspace, que
        já existe (`DynamicContextDrawer`) — o MESMO conteúdo, enquadramento diferente. Nenhuma
        segunda implementação de contexto: os dois caminhos chamam `buildContextPreview`.
      */}
      <div className="xl:hidden">
        <DynamicContextDrawer
          open={preview.previewRow !== null}
          title="Contexto do cliente"
          onClose={preview.closePreview}
          crossReferences={[]}
        >
          {contextBody}
        </DynamicContextDrawer>
      </div>
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
const headCellClass = workspaceHeadCellClass;

const cellClass = workspaceCellClass;

/**
 * RECORTE DA CARTEIRA — removido o componente `QueueStripCell`.
 *
 * Ele desenhava as três caixas contornadas ("no recorte / ativos / fora de operação") que ficavam
 * acima da grade. A informação continua exatamente a mesma — e continua sendo derivada dos MESMOS
 * números — mas agora vive em `WorkspaceStatusLine`, na linha de identidade do cabeçalho: três
 * números que são CONTEXTO da carteira não precisam de três caixas, de borda e de ~40px de altura
 * que a grade podia estar usando.
 */

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
