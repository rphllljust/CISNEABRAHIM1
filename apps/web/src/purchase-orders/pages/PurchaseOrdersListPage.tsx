import { useCallback, useEffect, useState } from 'react';
import { RELATION_SCOPE_KEYS, useRelationScope } from '../../enterprise-object';
import { listPurchaseOrders, PurchaseOrdersApiError } from '../api/purchase-orders-api';
import { mapPurchaseOrderErrorToMessage } from '../api/purchase-order-error-messages';
import { PurchaseOrderStatusBadge } from '../components/PurchaseOrderStatusBadge';
import { usePurchaseOrderCapabilities } from '../hooks/usePurchaseOrderCapabilities';
import type { PurchaseOrder } from '../types/purchase-order.types';
import { PURCHASE_ORDER_STATUSES } from '../types/purchase-order.types';
import { formatClientSnapshot, formatDate, formatMoney } from '../utils/purchase-order-labels';
import {
  purchaseOrderNextAction,
  purchaseOrderNotice,
} from '../utils/purchase-order-list-presentation';
import { HumanLookupField } from '../../financial-ui/HumanLookupField';
import { searchClientOptions } from '../../financial-ui/client-lookup';
import {
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
  worklistTableCardClass,
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
  | { phase: 'ready'; items: PurchaseOrder[]; offset: number; hasMore: boolean };

export function PurchaseOrdersListPage() {
  const { capabilities } = usePurchaseOrderCapabilities();
  // RELATION CONTRACT: o recorte vindo da URL (clique em "Pedidos de compra N" na object page
  // do cliente) precisa chegar a consulta autorizada. Sem isto o numero da relacao abriria a
  // lista completa, afirmando um recorte que nao existe.
  const relationScope = useRelationScope(RELATION_SCOPE_KEYS);
  const [clientFilter, setClientFilter] = useState(relationScope.clientId ?? '');
  const [unitFilter, setUnitFilter] = useState('');
  const [listState, setListState] = useState<ListState>({ phase: 'loading' });

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
  }, [loadPage]);

  if (listState.phase === 'loading') {
    return (
      <ModuleStatePage title="Pedidos de compra">`r`n        <ModuleLoadingState message="Carregando pedidos…" />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'denied') {
    return (
      <ModuleStatePage title="Pedidos de compra">`r`n        <ModuleDeniedState
        message="Você não tem permissão para listar pedidos de compra."
      />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'error') {
    return (
      <ModuleStatePage title="Pedidos de compra">`r`n        <ModuleErrorState
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

  return (
    <ModulePage>
      <WorklistHeader
        title="Pedidos de compra"
        count={items.length}
        context="Carteira de pedidos recebidos dos clientes, com o consumo autorizado de cada um."
        action={
          capabilities.canCreate ? (
            <ModulePrimaryLink to="/app/purchase-orders/new">Novo pedido</ModulePrimaryLink>
          ) : null
        }
      />

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
        <div className={worklistTableCardClass}>
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
                  Consumido
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
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className={worklistRowClass}>
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
                  <td className={worklistCellRaisedClass}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <PurchaseOrderStatusBadge status={item.status} />
                      {purchaseOrderNotice(item) ? (
                        <WorklistException
                          tone={
                            item.status === PURCHASE_ORDER_STATUSES.Cancelled
                              ? 'critical'
                              : 'warning'
                          }
                        >
                          {purchaseOrderNotice(item)}
                        </WorklistException>
                      ) : null}
                    </div>
                  </td>
                  <td className={worklistNumericCellClass}>
                    {/* Valor do pedido = valor AUTORIZADO, que o dominio calcula. Em pedidos
                        com precificacao por itens (`LINE_ITEMS`) o `totalAmount` do cabecalho e
                        legitimamente nulo: o valor do pedido e a soma das linhas. Exibir o campo
                        cru deixaria a coluna vazia ao lado de um saldo preenchido. */}
                    {item.balance
                      ? formatMoney(item.balance.authorizedAmount, item.currencyCode)
                      : formatMoney(item.totalAmount, item.currencyCode)}
                  </td>
                  <td className={worklistNumericCellClass}>
                    {formatMoney(item.consumedAmount, item.currencyCode)}
                  </td>
                  <td className={worklistNumericCellClass}>
                    {/* Saldo vem da regra de dominio. Quando ela recusa apurar, a celula
                        declara a indisponibilidade em vez de mostrar zero. */}
                    {item.balance ? (
                      formatMoney(item.balance.availableBalance, item.currencyCode)
                    ) : (
                      <span className="text-[11px] text-gray-500">Não apurável</span>
                    )}
                  </td>
                  <td className={worklistCellRaisedClass}>
                    <span className="whitespace-nowrap">
                      {item.issueDate ? formatDate(item.issueDate) : 'Sem data'}
                    </span>
                  </td>
                  <td className={worklistCellRaisedClass}>
                    <span className="text-[12px] text-gray-600">
                      {purchaseOrderNextAction(item.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <WorklistFooter rangeLabel={`${offset + 1}–${offset + items.length} nesta página`}>
        <ModulePagination
          pageNumber={pageNumber}
          previousDisabled={offset === 0}
          nextDisabled={!hasMore}
          onPrevious={() => void loadPage(Math.max(0, offset - PAGE_SIZE))}
          onNext={() => void loadPage(offset + PAGE_SIZE)}
        />
      </WorklistFooter>
    </ModulePage>
  );
}
