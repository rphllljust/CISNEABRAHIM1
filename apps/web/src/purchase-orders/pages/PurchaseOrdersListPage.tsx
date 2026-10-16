import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { RELATION_SCOPE_KEYS, useRelationScope } from '../../enterprise-object';
import {
  cancelPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  registerPurchaseOrder,
  PurchaseOrdersApiError,
} from '../api/purchase-orders-api';
import { mapPurchaseOrderErrorToMessage } from '../api/purchase-order-error-messages';
import { PurchaseOrderStatusBadge } from '../components/PurchaseOrderStatusBadge';
import { usePurchaseOrderCapabilities } from '../hooks/usePurchaseOrderCapabilities';
import type {
  PurchaseOrder,
  PurchaseOrderDetail,
  PurchaseOrderListResponse,
} from '../types/purchase-order.types';
import { Button } from '../../ui/Button';
import { Skeleton } from '../../ui/Skeleton';
import { PURCHASE_ORDER_STATUSES } from '../types/purchase-order.types';
import { formatClientSnapshot, formatDate, formatMoney } from '../utils/purchase-order-labels';
import {
  purchaseOrderAuthorizedAmount,
  purchaseOrderNextAction,
  purchaseOrderNotice,
  purchaseOrderUsage,
} from '../utils/purchase-order-list-presentation';
import { HumanLookupField } from '../../financial-ui/HumanLookupField';
import { searchClientOptions } from '../../financial-ui/client-lookup';
import {
  DynamicContextDrawer,
  DynamicFilterBuilder,
  DynamicSavedViewsBar,
  FILTER_PARAM,
  advancedFilterFromGroup,
  filterGroupToQuery,
  readFilterGroup,
  useEntitySchema,
  useSavedViews,
  type AdvancedFilterFieldSpec,
  type FilterGroup,
} from '../../engine';

/**
 * CAMPOS DO FILTRO AVANÇADO PARA O CONVERSOR COMPARTILHADO.
 *
 * Allow-list idêntico ao publicado por `buildPurchaseOrderListWhere`
 * (`apps/api/src/commercial/repositories/purchase-order-list-sql.ts`).
 * `consumed_amount` e `authorized_overrun_amount` NÃO entram: são saldo derivado, e filtrá-los
 * exigiria decidir o que "consumido" significa sob cada regra de faturamento.
 */
const PURCHASE_ORDER_FILTER_SPECS: AdvancedFilterFieldSpec[] = [
  { field: 'internal_code', contractField: 'internalCode', kind: 'text' },
  { field: 'po_number', contractField: 'poNumber', kind: 'text' },
  { field: 'rc_number', contractField: 'rcNumber', kind: 'text' },
  { field: 'currency_code', contractField: 'currencyCode', kind: 'text' },
  { field: 'status', contractField: 'status', kind: 'enum' },
  { field: 'issue_date', contractField: 'issueDate', kind: 'date' },
  { field: 'created_at', contractField: 'createdAt', kind: 'date' },
  { field: 'updated_at', contractField: 'updatedAt', kind: 'date' },
];
import { useAuth } from '../../auth/context/AuthProvider';
import {
  WorklistClearFilters,
  WorklistException,
  WorklistField,
  WorklistRowLink,
  worklistControlClass,
  worklistSelectClass,
  worklistTableClass,
} from '../../ui/enterprise-list';
import {
  WorkspaceBody,
  WorkspaceEmpty,
  WorkspaceHeader,
  WorkspacePane,
  WorkspaceStatusLine,
  WorkspaceToolbar,
  workspaceCellClass,
  workspaceCellRaisedClass,
  workspaceHeadCellClass,
  workspaceNumericCellClass,
  workspaceNumericHeadCellClass,
  workspaceRowClass,
} from '../../ui/workspace-frame';
import {
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModuleStatePage,
  ModulePagination,
  ModulePrimaryLink,
} from '../../ui/module-layout';
import { cn } from '../../ui/utils/cn';

const PAGE_SIZE = 20;

/**
 * Cliente do pedido a partir do snapshot comercial ja entregue pela listagem.
 *
 * O nome comercial vem primeiro porque e assim que o operador reconhece o cliente no dia a dia;
 * a razao social e o fallback quando o snapshot nao traz o nome fantasia. Sem snapshot, a linha
 * declara a ausencia em vez de mostrar um identificador tecnico.
 */
function clientLabel(order: PurchaseOrder): string {
  return formatClientSnapshot(order.clientSnapshot) || 'Cliente não informado';
}

type ListState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error'; message: string; retryable: boolean }
  | {
      phase: 'ready';
      items: PurchaseOrder[];
      offset: number;
      hasMore: boolean;
      summary: NonNullable<PurchaseOrderListResponse['summary']> | null;
    };

export function PurchaseOrdersListPage() {
  const { capabilities } = usePurchaseOrderCapabilities();
  /*
   * VISÕES SALVAS + PALETA DE COMANDOS — capacidades da engine que a tela ainda nao usava.
   *
   * O filtro desta worklist e "cliente + unidade": e exatamente esse recorte que o operador
   * reconstroi todo dia. Salva-lo e o que a engine ja oferece (`useSavedViews`), persistido por
   * identidade e DECLARADO como local enquanto nao existe endpoint de visoes salvas.
  */
  const navigate = useNavigate();
  const { identityId } = useAuth();
  /* SEM IDENTIDADE, NÃO PERSISTE: `null` em vez do namespace compartilhado `'anonymous'`. */
  const savedViews = useSavedViews(identityId ?? null, 'purchase-orders');
  // RELATION CONTRACT: o recorte vindo da URL (clique em "Pedidos de compra N" na object page
  // do cliente) precisa chegar a consulta autorizada. Sem isto o numero da relacao abriria a
  // lista completa, afirmando um recorte que nao existe.
  const relationScope = useRelationScope(RELATION_SCOPE_KEYS);
  const [clientFilter, setClientFilter] = useState(relationScope.clientId ?? '');
  const [unitFilter, setUnitFilter] = useState('');
  /**
   * RECORTES QUE O CONTRATO DO SERVIDOR JÁ EXECUTAVA E A TELA NÃO OFERECIA.
   *
   * `GET /purchase-orders` aceita `status`, `q`, `issueFrom`/`issueTo`, ordenação e filtro
   * avançado desde a camada implementada em `purchase-order-list-sql` — e nada disso chegava ao
   * operador, que só podia recortar por cliente e unidade. Capacidade existente e invisível é
   * entrega incompleta.
   */
  const [statusFilter, setStatusFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [issueFrom, setIssueFrom] = useState('');
  const [issueTo, setIssueTo] = useState('');
  const [listState, setListState] = useState<ListState>({ phase: 'loading' });

  /*
   * CONTEXT REGION — o pedido selecionado, com o detalhe REAL.
   *
   * `GET /purchase-orders/:id` publica o que a listagem não traz: itens, regras de faturamento,
   * documentos vinculados e a CADEIA relacionada (solicitação, OS, medição, faturamento). É o que
   * permite conferir e agir SEM abrir a ficha e voltar — o vaivém que a ordem elimina.
   * Carregamento LOCALIZADO: só o painel espera.
   */
  const [selected, setSelected] = useState<PurchaseOrder | null>(null);
  const [detailState, setDetailState] = useState<
    | { phase: 'idle' }
    | { phase: 'loading' }
    | { phase: 'error'; message: string }
    | { phase: 'ready'; detail: PurchaseOrderDetail }
  >({ phase: 'idle' });
  /**
   * MOTIVO DO CANCELAMENTO — informado pelo OPERADOR.
   * No contrato deste domínio `cancellationReason` é OPCIONAL: enviamos o que o operador escrever
   * e NÃO inventamos texto fixo. Forçar um motivo que o backend não exige seria criar regra nova
   * no frontend; preenchê-lo sozinho seria fabricar registro de auditoria.
   */
  const [commandReason, setCommandReason] = useState('');
  const [commandBusy, setCommandBusy] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const selectedId = selected?.id ?? null;

  /**
   * FILTRO AVANÇADO — a MESMA engine de metadados do resto do produto.
   *
   * A árvore vive na URL pela chave da engine (`filter`) e é convertida pelo conversor
   * COMPARTILHADO. O mapa abaixo é o allow-list que `buildPurchaseOrderListWhere` executa; oferecer
   * um campo fora dele produziria um recorte que o servidor ignora.
   */
  const [urlParams, setUrlParams] = useSearchParams();
  const urlQuery: string = urlParams.toString();
  const { schema: poSchema } = useEntitySchema('purchase-order');
  const advancedGroup = useMemo<FilterGroup>(() => readFilterGroup(urlQuery), [urlQuery]);
  const advancedPayload = useMemo(
    () => advancedFilterFromGroup(advancedGroup, PURCHASE_ORDER_FILTER_SPECS),
    [advancedGroup],
  );

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
    void getPurchaseOrder(selectedId, controller.signal)
      .then((detail) => {
        if (!controller.signal.aborted) {
          setDetailState({ phase: 'ready', detail });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setDetailState({
            phase: 'error',
            message: 'Não foi possível carregar o contexto do pedido.',
          });
        }
      });
    return () => controller.abort();
  }, [selectedId]);

  /** COMANDO REAL a partir do contexto. Envia intenção + `rowVersion`; o backend decide. */
  const runContextCommand = useCallback(
    async (command: 'register' | 'cancel') => {
      if (!selected) {
        return;
      }
      const rowVersion = selected.rowVersion;
      setCommandBusy(true);
      setCommandError(null);
      try {
        if (command === 'register') {
          await registerPurchaseOrder(selected.id, rowVersion);
        } else {
          await cancelPurchaseOrder(selected.id, {
            rowVersion,
            ...(commandReason.trim() === '' ? {} : { cancellationReason: commandReason.trim() }),
          });
        }
        setSelected(null);
        setReloadToken((current) => current + 1);
      } catch (error) {
        setCommandError(
          error instanceof PurchaseOrdersApiError
            ? mapPurchaseOrderErrorToMessage(error.code, error.status)
            : 'Não foi possível executar o comando.',
        );
      } finally {
        setCommandBusy(false);
      }
    },
    [commandReason, selected],
  );

  const loadPage = useCallback(
    async (offset: number, signal?: AbortSignal) => {
      setListState({ phase: 'loading' });
      try {
        const response = await listPurchaseOrders(
          {
            limit: PAGE_SIZE,
            offset,
            clientId: clientFilter.trim() || undefined,
            unitId: unitFilter.trim() || undefined,
            status: statusFilter || undefined,
            search: search.trim() || undefined,
            issueFrom: issueFrom ? new Date(issueFrom).toISOString() : undefined,
            issueTo: issueTo ? new Date(issueTo).toISOString() : undefined,
            advanced: advancedPayload,
          },
          signal,
        );
        setListState({
          phase: 'ready',
          items: response.items,
          offset: response.offset,
          hasMore: response.summary
            ? response.offset + response.items.length < response.summary.recordCount
            : response.items.length === response.limit,
          summary: response.summary ?? null,
        });
      } catch (error) {
        if (error instanceof PurchaseOrdersApiError) {
          if (error.kind === 'denied') {
            setListState({ phase: 'denied' });
            return;
          }
          setListState({
            phase: 'error',
            message: mapPurchaseOrderErrorToMessage(error.code, error.status),
            retryable: error.kind === 'network' || error.kind === 'unknown',
          });
          return;
        }
        setListState({
          phase: 'error',
          message: 'Não foi possível carregar os pedidos de compra.',
          retryable: true,
        });
      }
    },
    [advancedPayload, clientFilter, issueFrom, issueTo, search, statusFilter, unitFilter],
  );

  // Navegar de uma relacao para outra (mesma rota, outro cliente) precisa refiltrar sem
  // remontar a pagina.
  useEffect(() => {
    if (relationScope.clientId) {
      setClientFilter(relationScope.clientId);
    }
  }, [relationScope.clientId]);

  useEffect(() => {
    const controller = new AbortController();
    void loadPage(0, controller.signal);
    return () => controller.abort();
  }, [loadPage, reloadToken]);

  if (listState.phase === 'loading') {
    return (
      <ModuleStatePage title="Pedidos de compra">
        <ModuleLoadingState message="Carregando pedidos…" />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'denied') {
    return (
      <ModuleStatePage title="Pedidos de compra">
        <ModuleDeniedState message="Você não tem permissão para listar pedidos de compra." />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'error') {
    return (
      <ModuleStatePage title="Pedidos de compra">
        <ModuleErrorState
          message={listState.message}
          retryable={listState.retryable}
          onRetry={() => void loadPage(0)}
        />
      </ModuleStatePage>
    );
  }

  const { items, offset, hasMore, summary } = listState;
  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1;
  const hasActiveFilters = Boolean(clientFilter.trim() || unitFilter.trim());

  /**
   * LEITURA DA CARTEIRA — derivada exclusivamente das linhas que a propria pagina recebeu.
   *
   * Contagem, valor autorizado, consumido e saldo sao SOMAS dos campos que o servidor ja
   * publicou; "exigindo atenção" reusa a MESMA excecao booleana que a linha exibe. Nada aqui
   * cria metrica de dominio, percentual de risco ou estimativa.
   */
  const draftCount = items.filter(
    (item) => item.status === PURCHASE_ORDER_STATUSES.Draft,
  ).length;
  const registeredCount = items.filter(
    (item) => item.status === PURCHASE_ORDER_STATUSES.Registered,
  ).length;
  const cancelledCount = items.filter(
    (item) => item.status === PURCHASE_ORDER_STATUSES.Cancelled,
  ).length;
  const attentionCount = items.filter((item) => purchaseOrderNotice(item) !== null).length;
  const portfolioAmounts = (summary?.currencies ?? []).flatMap((currency) => [
    {
      value:
        currency.authorizedAmount === null
          ? `Não apurado (${currency.authorizedAmountUnavailableCount})`
          : formatMoney(currency.authorizedAmount, currency.currencyCode),
      label: `autorizado · ${currency.currencyCode}`,
    },
    {
      value:
        currency.consumedAmount === null
          ? 'Não publicado'
          : formatMoney(currency.consumedAmount, currency.currencyCode),
      label: `consumido · ${currency.currencyCode}`,
    },
    {
      value:
        currency.availableBalance === null
          ? `Não apurado (${currency.balanceUnavailableCount})`
          : formatMoney(currency.availableBalance, currency.currencyCode),
      label: `saldo · ${currency.currencyCode}`,
    },
  ]);

  return (
    <ModulePage layout="workspace">
      {/*
        PEDIDOS DE COMPRA — BANCADA DE CARTEIRA NA MOLDURA DE WORKSPACE.

        Antes: `layout="wide"` — a pagina media a altura do proprio conteudo. Medido em 1600x900 com
        a carteira publicada: o conteudo terminava em y=448 de 900, deixando 452px de canvas branco
        abaixo da ultima linha. A tela era um cabecalho, duas faixas de filtro e uma grade curta.

        Agora a superficie declara `workspace`: a grade e elastica e a bancada ocupa a tela — a mesma
        silhueta de Clientes, Solicitacoes e Propostas.

        Os sinais usam contagem e totais publicados pelo servidor para todo o recorte autorizado;
        recortes locais da página permanecem explicitamente rotulados como "nesta página".
      */}
      <WorkspaceHeader
        title="Pedidos de compra"
        identity="Carteira de pedidos recebidos dos clientes, com o consumo autorizado de cada um."
        scope={summary ? `${summary.recordCount} pedidos no recorte` : 'Contagem não publicada'}
        status={
          <WorkspaceStatusLine
            items={[
              { value: summary?.recordCount ?? '—', label: 'pedidos no recorte' },
              ...(draftCount > 0
                ? [{ value: draftCount, label: 'rascunhos nesta página' as const }]
                : []),
              ...(registeredCount > 0
                ? [{ value: registeredCount, label: 'registrados nesta página' as const }]
                : []),
              ...(cancelledCount > 0
                ? [{ value: cancelledCount, label: 'cancelados nesta página' as const }]
                : []),
              ...portfolioAmounts,
              ...(attentionCount > 0
                ? [
                    {
                      value: attentionCount,
                      label: 'exigindo atenção nesta página',
                      tone: 'alert' as const,
                    },
                  ]
                : []),
            ]}
          />
        }
        action={
          capabilities.canCreate && (items.length > 0 || hasActiveFilters) ? (
            <ModulePrimaryLink to="/app/purchase-orders/new">Novo pedido</ModulePrimaryLink>
          ) : null
        }
      />

      {/*
        BARRA DE FERRAMENTAS — VISÕES E CONSULTA NUMA FAIXA SÓ.

        Antes eram DUAS faixas empilhadas (visões salvas, depois a barra de filtro) mais uma terceira
        para o construtor composto: três réguas para a mesma pergunta ("qual recorte estou lendo"),
        ~90px que a grade pagava em toda dobra.
      */}
      <div className="cisne-query-deck mb-2">
      <WorkspaceToolbar
        views={
          <div data-region="saved-view-surface">
            <DynamicSavedViewsBar
              views={savedViews.views}
              persistedLocally={savedViews.persistedLocally}
              onSave={(name) => savedViews.save(name, { clientFilter, unitFilter }, 'list')}
              onDelete={savedViews.remove}
              onApply={(view) => {
                setClientFilter(view.filters['clientFilter'] ?? '');
                setUnitFilter(view.filters['unitFilter'] ?? '');
              }}
            />
          </div>
        }
      >
        <div
          data-region="command-filter-surface"
          className="flex min-w-0 flex-wrap items-center gap-1.5"
        >
          <WorklistField label="Buscar" htmlFor="po-search" grow>
            <input
              id="po-search"
              type="search"
              className={worklistControlClass}
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  setSearch(searchInput);
                }
              }}
              placeholder="Número do pedido, código interno ou RC"
              autoComplete="off"
            />
          </WorklistField>

          <WorklistField label="Situação" htmlFor="po-status">
            <select
              id="po-status"
              className={worklistSelectClass}
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="">Todas</option>
              <option value={PURCHASE_ORDER_STATUSES.Draft}>Rascunho</option>
              <option value={PURCHASE_ORDER_STATUSES.Registered}>Registrado</option>
              <option value={PURCHASE_ORDER_STATUSES.Cancelled}>Cancelado</option>
            </select>
          </WorklistField>

          <WorklistField label="Emissão" htmlFor="po-issue-from">
            <input
              id="po-issue-from"
              type="date"
              className={worklistControlClass}
              value={issueFrom}
              onChange={(event) => setIssueFrom(event.target.value)}
            />
          </WorklistField>
          <WorklistField label="até" htmlFor="po-issue-to">
            <input
              id="po-issue-to"
              type="date"
              className={worklistControlClass}
              value={issueTo}
              onChange={(event) => setIssueTo(event.target.value)}
            />
          </WorklistField>

          <WorklistField label="Cliente" htmlFor="po-client-search" grow>
            <span className="min-w-[22rem] flex-1">
            <HumanLookupField
              variant="compact"
              label="Cliente"
              htmlFor="po-client-search"
              search={searchClientOptions}
              value={clientFilter}
              onChange={setClientFilter}
              emptyOptionLabel="Todos os clientes"
              emptyMessage="Nenhum cliente encontrado para a busca."
            />
            </span>
          </WorklistField>
          <WorklistField label="Unidade" htmlFor="po-unit-filter">
            <input
              id="po-unit-filter"
              type="search"
              className={worklistControlClass}
              value={unitFilter}
              onChange={(event) => setUnitFilter(event.target.value)}
              placeholder="Filtrar por unidade"
            />
          </WorklistField>
          <WorklistClearFilters
            visible={hasActiveFilters}
            onClick={() => {
              setClientFilter('');
              setUnitFilter('');
              setStatusFilter('');
              setSearchInput('');
              setSearch('');
              setIssueFrom('');
              setIssueTo('');
              const params = new URLSearchParams(urlQuery);
              params.delete(FILTER_PARAM);
              params.delete('offset');
              setUrlParams(params, { replace: true });
            }}
          />
        </div>
      </WorkspaceToolbar>

      {/*
        FILTRO AVANÇADO COMPOSTO — área própria, dirigida por METADADO.

        A faixa acima recorta UM campo por vez. O construtor monta predicado COMBINADO (grupos
        AND/OR) sobre os mesmos campos e o envia na mesma consulta.
      */}
      <div data-region="advanced-filter-surface">
        <DynamicFilterBuilder
          schema={poSchema}
          value={advancedGroup}
          onChange={(next) => {
            const params = new URLSearchParams(urlQuery);
            const serialized = filterGroupToQuery(next).get(FILTER_PARAM);
            if (serialized) {
              params.set(FILTER_PARAM, serialized);
            } else {
              params.delete(FILTER_PARAM);
            }
            params.delete('offset');
            setUrlParams(params, { replace: true });
          }}
        />
      </div>
      </div>

      {/*
        ÁREA DE TRABALHO — a grade é elástica e ocupa a altura que o shell deixou.
        Zero pedidos NÃO desmonta a bancada: cabeçalho, visões e filtros continuam montados e o
        estado vazio explica o que um pedido de compra é.
      */}
      <WorkspaceBody>
        <WorkspacePane className="h-full overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col" data-region="worklist-master">
            {items.length === 0 ? (
              <WorkspaceEmpty
                title={
                  hasActiveFilters
                    ? 'Nenhum pedido de compra corresponde aos filtros aplicados.'
                    : 'Nenhum pedido de compra encontrado.'
                }
                description={
                  hasActiveFilters
                    ? 'Ajuste o cliente ou a unidade, ou limpe os filtros para ver a carteira completa.'
                    : 'Os pedidos chegam ao CISNE registrados pelos clientes; quando o primeiro for emitido ele aparece aqui.'
                }
                action={
                  hasActiveFilters ? (
                    <WorklistClearFilters
                      visible
                      onClick={() => {
                        setClientFilter('');
                        setUnitFilter('');
                      }}
                    />
                  ) : capabilities.canCreate ? (
                    <ModulePrimaryLink to="/app/purchase-orders/new">Novo pedido</ModulePrimaryLink>
                  ) : null
                }
              />
            ) : (
              <div className="min-h-0 flex-1 overflow-auto">
                <table className={worklistTableClass} aria-label="Lista de pedidos de compra">
            <thead>
              <tr>
                <th scope="col" className={workspaceHeadCellClass}>
                  Pedido
                </th>
                <th scope="col" className={workspaceHeadCellClass}>
                  Cliente
                </th>
                <th scope="col" className={workspaceHeadCellClass}>
                  Situação
                </th>
                <th scope="col" className={workspaceNumericHeadCellClass}>
                  Valor autorizado
                </th>
                <th scope="col" className={workspaceNumericHeadCellClass}>
                  Consumido / consumo
                </th>
                <th scope="col" className={workspaceNumericHeadCellClass}>
                  Saldo
                </th>
                <th scope="col" className={workspaceHeadCellClass}>
                  Emissão
                </th>
                <th scope="col" className={workspaceHeadCellClass}>
                  Próxima ação
                </th>
                <th scope="col" className={workspaceHeadCellClass}>
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                /**
                 * Acoes reais da linha, derivadas de estado + capability. `register` e a acao
                 * primaria quando existe (e o proximo passo do pedido); as demais vao para o
                 * menu "•••" para nao competir com ela.
                 */
                const notice = purchaseOrderNotice(item);
                // Leitura do consumo: percentual puramente apresentacional. Sem `balance` a regra
                // de dominio recusou apurar, e a celula declara isso em vez de estimar.
                const usage = purchaseOrderUsage(item.balance);
                const authorizedAmount = purchaseOrderAuthorizedAmount(item);
                const nextAction = purchaseOrderNextAction(item.status);
                const hasPendingStep =
                  item.status === PURCHASE_ORDER_STATUSES.Draft ||
                  item.status === PURCHASE_ORDER_STATUSES.Registered;

                return (
                  <tr
                    key={item.id}
                    className={cn(workspaceRowClass, 'cursor-pointer')}
                    /*
                      SELEÇÃO abre o CONTEXTO; a IDENTIDADE (`poNumber`) continua um link real para
                      a ficha completa. São TRÊS gestos distintos e não misturados: a linha abre o
                      contexto lateral, o código faz o drillback, e o comando é executado dentro do
                      painel. Cliques em elementos interativos internos seguem seu próprio caminho.
                    */
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest('a, button, select, input')) {
                        return;
                      }
                      setSelected(item);
                    }}
                  >
                  {/*
                    COLUNA PRINCIPAL = alvo de clique da linha. O `internalCode` saiu: ele e o
                    codigo INTERNO do ERP, e o operador trabalha com o numero do cliente
                    (`poNumber`). Dois codigos na mesma celula so criavam duvida sobre qual
                    procurar no documento impresso.
                  */}
                  <td className={workspaceCellClass}>
                    <WorklistRowLink href={`/app/purchase-orders/${item.id}`}>
                      {item.poNumber}
                    </WorklistRowLink>
                  </td>
                  <td className={workspaceCellRaisedClass}>
                    <div className="min-w-0">
                      <p className="max-w-[32ch] truncate text-gray-800" title={clientLabel(item)}>
                        {clientLabel(item)}
                      </p>
                      {item.rcNumber ? (
                        <p className="text-[11px] text-gray-500">Requisição {item.rcNumber}</p>
                      ) : null}
                    </div>
                  </td>
                  {/*
                    SITUACAO = status + a excecao REAL que exige acao. A excecao acompanha o
                    status porque e ela que decide se a linha precisa do operador agora; sem fato
                    que a sustente, a celula mostra so o status.
                  */}
                  <td className={workspaceCellRaisedClass}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <PurchaseOrderStatusBadge status={item.status} />
                      {notice ? (
                        <WorklistException
                          tone={
                            item.status === PURCHASE_ORDER_STATUSES.Cancelled
                              ? 'critical'
                              : 'warning'
                          }
                        >
                          {notice}
                        </WorklistException>
                      ) : null}
                    </div>
                  </td>
                  {/*
                    VALOR AUTORIZADO — o teto do pedido, quando a regra de dominio o publica.
                    Em pedidos com precificacao por itens o `totalAmount` do cabecalho e
                    legitimamente nulo e o valor do pedido mora em `balance.authorizedAmount`.
                  */}
                  <td className={workspaceNumericCellClass}>
                    {formatMoney(authorizedAmount, item.currencyCode)}
                  </td>
                  {/*
                    CONSUMIDO + MICROBAR DE CONSUMO — o numero responde "quanto ja foi usado"; a
                    barra responde "quanto isso representa" sem exigir que o operador leia dois
                    valores e divida de cabeca.

                    A barra existe SOMENTE quando o dominio publicou os DOIS lados da razao
                    (autorizado e consumido). Sem apuracao, o texto declara a indisponibilidade —
                    nenhuma barra e desenhada a partir de estimativa. O percentual e apresentacao
                    sobre dois fatos do contrato: nao cria regra, status nem persistencia. Acima do
                    autorizado a barra satura em 100% e o fato e dito em palavras na coluna ao lado.
                  */}
                  <td className={workspaceNumericCellClass}>
                    <span className="block leading-tight">
                      {formatMoney(item.consumedAmount, item.currencyCode)}
                    </span>
                    {usage ? (
                      <>
                        <span
                          className="mt-1 block h-1 w-full max-w-[7rem] overflow-hidden rounded-full bg-gray-200"
                          role="img"
                          aria-label={`Consumido ${usage.percent.toFixed(0)}% do valor autorizado`}
                        >
                          <span
                            className={cn(
                              'block h-full rounded-full',
                              usage.overAuthorized ? 'bg-amber-500' : 'bg-brand-600',
                            )}
                            style={{ width: `${Math.min(100, Math.max(0, usage.percent))}%` }}
                          />
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-tight text-gray-500 tabular-nums">
                          {usage.percent.toFixed(0)}% do autorizado
                        </span>
                      </>
                    ) : (
                      <span className="mt-0.5 block text-[11px] leading-tight text-gray-500">
                        Sem apuração
                      </span>
                    )}
                  </td>
                  <td className={workspaceNumericCellClass}>
                    {/* Saldo vem da regra de dominio. Quando ela recusa apurar, a celula
                        declara a indisponibilidade em vez de mostrar zero. */}
                    {item.balance ? (
                      <>
                        <span className="block leading-tight">
                          {formatMoney(item.balance.availableBalance, item.currencyCode)}
                        </span>
                        {usage?.overAuthorized ? (
                          <span className="mt-0.5 block text-[11px] leading-tight font-medium text-amber-700">
                            Consumo acima do autorizado
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-[11px] text-gray-500">Não apurável</span>
                    )}
                  </td>
                  <td className={workspaceCellRaisedClass}>
                    <span className="whitespace-nowrap">
                      {item.issueDate ? formatDate(item.issueDate) : 'Sem data'}
                    </span>
                  </td>
                  {/*
                    PROXIMA ACAO — a informacao que o operador procura depois do estado. Ganha
                    peso tipografico proprio porque e ela que diz onde agir; pedido encerrado
                    declara a propria condicao em vez de oferecer um passo que nao existe.
                  */}
                  <td className={workspaceCellRaisedClass}>
                    <span
                      className={
                        hasPendingStep
                          ? 'text-[12px] font-medium text-gray-800'
                          : 'text-[12px] text-gray-500'
                      }
                    >
                      {nextAction}
                    </span>
                  </td>
                </tr>
                );
              })}
                </tbody>
              </table>
              </div>
            )}

            {/*
              RODAPÉ — só existe quando há pedido na página. Com zero registros ele dizia "1–0 nesta
              página", o que não descreve nada e sugere um dataset inexistente.
            */}
            {items.length > 0 ? (
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[color:var(--color-divider)] px-3 py-1.5">
                <p className="m-0 text-[11px] text-[color:var(--color-text-muted)] tabular-nums">
                  {summary
                    ? `${offset + 1}–${offset + items.length} de ${summary.recordCount} pedidos no recorte`
                    : `${offset + 1}–${offset + items.length} nesta página · total não publicado`}
                </p>
                <ModulePagination
                  pageNumber={pageNumber}
                  previousDisabled={offset === 0}
                  nextDisabled={!hasMore}
                  onPrevious={() => void loadPage(Math.max(0, offset - PAGE_SIZE))}
                  onNext={() => void loadPage(offset + PAGE_SIZE)}
                />
              </div>
            ) : null}
          </div>
        </WorkspacePane>
      </WorkspaceBody>

      {/*
        CONTEXT REGION — decidir sem abandonar a fila.

        O painel carrega o DETALHE real do pedido e executa os comandos reais do domínio
        (`register` / `cancel`). Antes, registrar ou cancelar exigia abrir a ficha, achar a ação e
        voltar — e as "ações" da linha eram apenas links para essa mesma ficha.

        O motivo do cancelamento é digitado pelo operador e enviado SÓ quando existe: no contrato
        deste domínio ele é opcional, e a tela não inventa texto de auditoria.
      */}
      <DynamicContextDrawer
        open={selected !== null}
        title="Contexto do pedido de compra"
        onClose={() => setSelected(null)}
        crossReferences={[]}
      >
        <div data-region="context-region">
          {selected ? (
            <p className="cisne-type-primary m-0 mb-2 truncate">{selected.poNumber}</p>
          ) : null}

          {detailState.phase === 'loading' ? (
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
              <dl className="m-0 grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                <dt className="cisne-meta-label pt-0.5">Cliente</dt>
                <dd className="cisne-meta-value m-0 truncate">
                  {formatClientSnapshot(detailState.detail.purchaseOrder.clientSnapshot)}
                </dd>
                <dt className="cisne-meta-label pt-0.5">Situação</dt>
                <dd className="cisne-meta-value m-0">
                  <PurchaseOrderStatusBadge status={detailState.detail.purchaseOrder.status} />
                </dd>
                <dt className="cisne-meta-label pt-0.5">Itens</dt>
                <dd className="cisne-meta-value m-0">{detailState.detail.items.length}</dd>
                <dt className="cisne-meta-label pt-0.5">Documentos</dt>
                <dd className="cisne-meta-value m-0">{detailState.detail.documentLinks.length}</dd>
              </dl>

              {/* CADEIA REAL — só os degraus que o detalhe publica. */}
              {detailState.detail.linked && detailState.detail.linked.length > 0 ? (
                <div className="cisne-divider--top mb-2 mt-2 pt-2">
                  <h3 className="cisne-section-title m-0 mb-1">Linhagem</h3>
                  <ul className="m-0 flex list-none flex-col gap-0 p-0">
                    {detailState.detail.linked.map((node) => (
                      <li key={`${node.kind}:${node.id}`} className="cisne-type-meta truncate">
                        {node.kind}
                        {node.label ? ` · ${node.label}` : ''}
                        {node.status ? ` · ${node.status}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="cisne-divider--top mt-2 pt-2">
                <label className="mb-1 block">
                  <span className="cisne-meta-label mb-0.5 block">
                    Motivo do cancelamento (opcional neste contrato)
                  </span>
                  <input
                    type="text"
                    className="min-h-[var(--control-height)] w-full rounded-md border-0 bg-white px-1.5 text-[length:var(--type-body-size)] ring-1 ring-gray-300 ring-inset outline-none focus:ring-2 focus:ring-brand-500"
                    value={commandReason}
                    onChange={(event) => setCommandReason(event.target.value)}
                    placeholder="Informe o motivo, se houver"
                  />
                </label>

                <div className="flex flex-wrap items-center gap-1.5">
                  {capabilities.canRegister ? (
                    <Button
                      variant="primary"
                      loading={commandBusy}
                      onClick={() => void runContextCommand('register')}
                    >
                      Registrar
                    </Button>
                  ) : null}
                  {capabilities.canCancel ? (
                    <Button
                      variant="secondary"
                      loading={commandBusy}
                      onClick={() => void runContextCommand('cancel')}
                    >
                      Cancelar
                    </Button>
                  ) : null}
                  {!capabilities.canRegister && !capabilities.canCancel ? (
                    <p className="cisne-type-helper m-0">
                      Nenhum comando disponível para o seu acesso.
                    </p>
                  ) : null}
                </div>

                {commandError ? (
                  <p className="cisne-type-helper m-0 mt-1.5 text-red-700" role="alert">
                    {commandError}
                  </p>
                ) : null}
              </div>

              {/* DRILLBACK ÚNICO — uma vez por registro selecionado, nunca por linha. */}
              <div className="cisne-divider--top mt-2 pt-2">
                <Button
                  variant="secondary"
                  onClick={() => void navigate(`/app/purchase-orders/${detailState.detail.purchaseOrder.id}`)}
                >
                  Abrir ficha completa
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </DynamicContextDrawer>
    </ModulePage>
  );
}
