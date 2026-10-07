import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import type { PurchaseOrder, PurchaseOrderDetail } from '../types/purchase-order.types';
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
  DynamicSavedViewsBar,
  useSavedViews,
} from '../../engine';
import { useAuth } from '../../auth/context/AuthProvider';
import {
  EnterpriseMetric,
  WorklistClearFilters,
  WorklistException,
  WorklistField,
  WorklistFilterBar,
  WorklistFooter,
  WorklistHeader,
  WorklistRowLink,
  WorklistStatePanel,
  worklistCellClass,
  worklistCellRaisedClass,
  worklistHeadCellClass,
  worklistNumericCellClass,
  worklistNumericHeadCellClass,
  worklistRowClass,
  worklistSelectClass,
  worklistTableClass,
} from '../../ui/enterprise-list';
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

/**
 * SOMA DOS VALORES AUTORIZADOS DA PAGINA — leitura apenas dos valores ja publicados pela lista.
 *
 * Nao e uma agregacao nova do dominio: e a soma do papel que a pagina esta mostrando, para o
 * operador dimensionar a carteira sem somar linha a linha. Pedido cujo saldo a regra de dominio
 * recusou apurar entra por `totalAmount` e, quando nem isso existe, fica FORA da soma e e
 * CONTADO — o resumo declara "N sem valor apuravel" em vez de diluir um zero falso no total.
 */
function summarizeAuthorized(items: PurchaseOrder[]) {
  let total = 0;
  let withoutAmount = 0;
  for (const item of items) {
    const amount = purchaseOrderAuthorizedAmount(item);
    const numeric = amount === null ? Number.NaN : Number.parseFloat(amount);
    if (Number.isNaN(numeric)) {
      withoutAmount += 1;
      continue;
    }
    total += numeric;
  }
  return { total, withoutAmount };
}

/**
 * SOMA DO CONSUMIDO E DO SALDO — mesmo principio da soma autorizada: so o que o ledger publicou.
 *
 * O saldo NAO e recalculado: quando existe `balance`, ele vem da regra de dominio
 * (`availableBalance`). Quando nao existe, a pagina nao estima saldo nenhum.
 */
function summarizeLedger(items: PurchaseOrder[]) {
  let consumed = 0;
  let balance = 0;
  for (const item of items) {
    const consumedValue = Number.parseFloat(item.consumedAmount);
    if (!Number.isNaN(consumedValue)) {
      consumed += consumedValue;
    }
    if (item.balance) {
      const balanceValue = Number.parseFloat(item.balance.availableBalance);
      if (!Number.isNaN(balanceValue)) {
        balance += balanceValue;
      }
    }
  }
  return { consumed, balance };
}

type ListState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error'; message: string; retryable: boolean }
  | { phase: 'ready'; items: PurchaseOrder[]; offset: number; hasMore: boolean };

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
  const savedViews = useSavedViews(identityId ?? 'anonymous', 'purchase-orders');
  // RELATION CONTRACT: o recorte vindo da URL (clique em "Pedidos de compra N" na object page
  // do cliente) precisa chegar a consulta autorizada. Sem isto o numero da relacao abriria a
  // lista completa, afirmando um recorte que nao existe.
  const relationScope = useRelationScope(RELATION_SCOPE_KEYS);
  const [clientFilter, setClientFilter] = useState(relationScope.clientId ?? '');
  const [unitFilter, setUnitFilter] = useState('');
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
          },
          signal,
        );
        setListState({
          phase: 'ready',
          items: response.items,
          offset: response.offset,
          hasMore: response.items.length === response.limit,
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
    [clientFilter, unitFilter],
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

  const { items, offset, hasMore } = listState;
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
  const authorized = summarizeAuthorized(items);
  const ledger = summarizeLedger(items);
  const currencyCode = items[0]?.currencyCode ?? 'BRL';
  const moneyHint = `Soma dos valores autorizados apurados nesta página.${
    authorized.withoutAmount > 0
      ? ` ${authorized.withoutAmount} pedido(s) sem valor apurável ficaram fora da soma.`
      : ''
  }`;

  return (
    <ModulePage>
      <div data-region="operating-header">
      <WorklistHeader
        title="Pedidos de compra"
        count={items.length}
        context="Carteira de pedidos recebidos dos clientes, com o consumo autorizado de cada um."
        action={
          capabilities.canCreate ? (
            <ModulePrimaryLink to="/app/purchase-orders/new">Novo pedido</ModulePrimaryLink>
          ) : null
        }
        /*
          FAIXA DE INDICADORES — o operador responde "qual e o tamanho, o estado e o saldo desta
          pagina?" antes de ler a primeira linha. Cada valor e uma soma ou uma contagem do que a
          lista ja entregou; metricas de estado so aparecem quando existem linhas naquele estado.
        */
        metrics={
          <>
            {draftCount > 0 ? <EnterpriseMetric value={draftCount} label="rascunho(s)" /> : null}
            {registeredCount > 0 ? (
              <EnterpriseMetric value={registeredCount} label="registrado(s)" tone="info" />
            ) : null}
            {cancelledCount > 0 ? (
              <EnterpriseMetric value={cancelledCount} label="cancelado(s)" />
            ) : null}
            <span title={moneyHint}>
              <EnterpriseMetric
                value={formatMoney(String(authorized.total), currencyCode)}
                label="autorizado"
              />
            </span>
            <EnterpriseMetric
              value={formatMoney(String(ledger.consumed), currencyCode)}
              label="consumido"
            />
            <EnterpriseMetric
              value={formatMoney(String(ledger.balance), currencyCode)}
              label="saldo"
            />
            {attentionCount > 0 ? (
              <EnterpriseMetric value={attentionCount} label="exigindo atenção" tone="warning" />
            ) : null}
          </>
        }
      />
      </div>

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

      <div data-region="command-filter-surface">
      <WorklistFilterBar meta={`${items.length} nesta página`}>
        <WorklistField label="Cliente" htmlFor="po-client-search" grow>
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
        </WorklistField>
        <WorklistField label="Unidade" htmlFor="po-unit-filter">
          <input
            id="po-unit-filter"
            type="search"
            className={worklistSelectClass}
            value={unitFilter}
            onChange={(event) => setUnitFilter(event.target.value)}
            placeholder="Filtrar por unidade"
          />
        </WorklistField>
        {hasActiveFilters ? (
          <WorklistClearFilters
            visible={hasActiveFilters}
            onClick={() => {
              setClientFilter('');
              setUnitFilter('');
            }}
          />
        ) : null}
      </WorklistFilterBar>
      </div>

      {/*
        VISÕES SALVAS — faixa própria da work area, ANTES da superfície de filtro.
        Gramática: OPERATING HEADER -> SAVED VIEWS -> COMMAND/FILTER -> WORK QUEUE.
      */}

      <div data-region="worklist-master">
      {items.length === 0 ? (
        <WorklistStatePanel
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
        <div className="w-full min-w-0 max-w-full overflow-x-auto bg-white">
          <table className={worklistTableClass} aria-label="Lista de pedidos de compra">
            <thead>
              <tr>
                <th scope="col" className={worklistHeadCellClass}>
                  Pedido
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Cliente
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Situação
                </th>
                <th scope="col" className={worklistNumericHeadCellClass}>
                  Valor autorizado
                </th>
                <th scope="col" className={worklistNumericHeadCellClass}>
                  Consumido / consumo
                </th>
                <th scope="col" className={worklistNumericHeadCellClass}>
                  Saldo
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Emissão
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Próxima ação
                </th>
                <th scope="col" className={worklistHeadCellClass}>
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
                    className={cn(worklistRowClass, 'cursor-pointer')}
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
                  <td className={worklistCellClass}>
                    <WorklistRowLink href={`/app/purchase-orders/${item.id}`}>
                      {item.poNumber}
                    </WorklistRowLink>
                  </td>
                  <td className={worklistCellRaisedClass}>
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
                  <td className={worklistCellRaisedClass}>
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
                  <td className={worklistNumericCellClass}>
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
                  <td className={worklistNumericCellClass}>
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
                  <td className={worklistNumericCellClass}>
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
                  <td className={worklistCellRaisedClass}>
                    <span className="whitespace-nowrap">
                      {item.issueDate ? formatDate(item.issueDate) : 'Sem data'}
                    </span>
                  </td>
                  {/*
                    PROXIMA ACAO — a informacao que o operador procura depois do estado. Ganha
                    peso tipografico proprio porque e ela que diz onde agir; pedido encerrado
                    declara a propria condicao em vez de oferecer um passo que nao existe.
                  */}
                  <td className={worklistCellRaisedClass}>
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
        <WorklistFooter
          rangeLabel={`${offset + 1}–${offset + items.length} nesta página`}
          /*
            O recorte dos totais e DECLARADO, nao implicito: os valores acima somam a pagina, e a
            pagina lista um recorte filtrado. Sem isto, paginacao e indicadores poderiam se
            contradizer na mesma linha.
          */
          extra={
            hasActiveFilters
              ? 'Totais somam os pedidos filtrados desta página'
              : 'Totais somam os pedidos desta página'
          }
        >
          <ModulePagination
            pageNumber={pageNumber}
            previousDisabled={offset === 0}
            nextDisabled={!hasMore}
            onPrevious={() => void loadPage(Math.max(0, offset - PAGE_SIZE))}
            onNext={() => void loadPage(offset + PAGE_SIZE)}
          />
        </WorklistFooter>
      ) : null}
      </div>

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
