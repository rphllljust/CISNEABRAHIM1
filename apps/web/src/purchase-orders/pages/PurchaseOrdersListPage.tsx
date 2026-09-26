import { useCallback, useEffect, useState } from 'react';
import { listPurchaseOrders, PurchaseOrdersApiError } from '../api/purchase-orders-api';
import { mapPurchaseOrderErrorToMessage } from '../api/purchase-order-error-messages';
import { PurchaseOrderStatusBadge } from '../components/PurchaseOrderStatusBadge';
import { usePurchaseOrderCapabilities } from '../hooks/usePurchaseOrderCapabilities';
import type { PurchaseOrder } from '../types/purchase-order.types';
import { formatDate, formatMoney } from '../utils/purchase-order-labels';
import {
  purchaseOrderNextAction,
  purchaseOrderNotice,
} from '../utils/purchase-order-list-presentation';
import { Button } from '../../ui/Button';
import {
  FilterCard,
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModulePageHeader,
  ModulePagination,
  ModulePrimaryLink,
  ModuleTableCard,
  ModuleTableLink,
  filterControlClass,
  filterLabelClass,
  moduleTableCellClass,
  moduleTableClass,
  moduleTableHeadClass,
  moduleTableHeaderCellClass,
  moduleTableRowClass,
} from '../../ui/module-layout';

const PAGE_SIZE = 20;

type ListState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error'; message: string; retryable: boolean }
  | { phase: 'ready'; items: PurchaseOrder[]; offset: number; hasMore: boolean };

export function PurchaseOrdersListPage() {
  const { capabilities } = usePurchaseOrderCapabilities();
  const [clientFilter, setClientFilter] = useState('');
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

  useEffect(() => {
    const controller = new AbortController();
    void loadPage(0, controller.signal);
    return () => controller.abort();
  }, [loadPage]);

  if (listState.phase === 'loading') {
    return (
      <ModulePage>
        <ModuleLoadingState title="Pedidos de compra" message="Carregando pedidos…" />
      </ModulePage>
    );
  }

  if (listState.phase === 'denied') {
    return (
      <ModulePage>
        <ModuleDeniedState
        title="Pedidos de compra"
        message="Você não tem permissão para listar pedidos de compra."
      />
      </ModulePage>
    );
  }

  if (listState.phase === 'error') {
    return (
      <ModulePage>
        <ModuleErrorState
        title="Pedidos de compra"
        message={listState.message}
        retryable={listState.retryable}
        onRetry={() => void loadPage(0)}
      />
      </ModulePage>
    );
  }

  const { items, offset, hasMore } = listState;
  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1;
  const hasActiveFilters = Boolean(clientFilter.trim() || unitFilter.trim());

  return (
    <ModulePage>
      <ModulePageHeader
        title="Pedidos de compra"
        action={
          capabilities.canCreate ? (
            <ModulePrimaryLink to="/app/purchase-orders/new">Novo pedido</ModulePrimaryLink>
          ) : null
        }
      />

      <FilterCard>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className={filterLabelClass} htmlFor="po-client-filter">
              Cliente (ID)
            </label>
            <input
              id="po-client-filter"
              type="search"
              className={filterControlClass}
              value={clientFilter}
              onChange={(event) => setClientFilter(event.target.value)}
              placeholder="UUID do cliente"
            />
          </div>
          <div>
            <label className={filterLabelClass} htmlFor="po-unit-filter">
              Unidade
            </label>
            <input
              id="po-unit-filter"
              type="search"
              className={filterControlClass}
              value={unitFilter}
              onChange={(event) => setUnitFilter(event.target.value)}
              placeholder="Filtrar por unidade"
            />
          </div>
        </div>
        {hasActiveFilters ? (
          <div className="mt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setClientFilter('');
                setUnitFilter('');
              }}
            >
              Limpar filtros
            </Button>
          </div>
        ) : null}
      </FilterCard>

      {items.length === 0 ? (
        <p className="text-sm text-gray-500" role="status">
          Nenhum pedido de compra encontrado.
        </p>
      ) : (
        <ModuleTableCard>
          <table className={moduleTableClass} aria-label="Lista de pedidos de compra">
            <thead className={moduleTableHeadClass}>
              <tr>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Pedido
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Situação
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Valor
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Consumido
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Saldo
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Emissão
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Próxima ação
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item) => (
                <tr key={item.id} className={moduleTableRowClass}>
                  <td className={moduleTableCellClass}>
                    <ModuleTableLink to={`/app/purchase-orders/${item.id}`}>
                      {item.poNumber}
                    </ModuleTableLink>
                    <span className="mt-1 block font-mono text-xs text-gray-500">
                      {item.internalCode}
                    </span>
                  </td>
                  <td className={moduleTableCellClass}>
                    <div className="flex flex-col items-start gap-1">
                      <PurchaseOrderStatusBadge status={item.status} />
                      {purchaseOrderNotice(item) ? (
                        <span className="text-xs font-medium text-amber-700">
                          {purchaseOrderNotice(item)}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className={`${moduleTableCellClass} tabular-nums`}>
                    {/* Valor do pedido = valor AUTORIZADO, que o dominio calcula. Em pedidos
                        com precificacao por itens (`LINE_ITEMS`) o `totalAmount` do cabecalho e
                        legitimamente nulo: o valor do pedido e a soma das linhas. Exibir o campo
                        cru deixaria a coluna vazia ao lado de um saldo preenchido. */}
                    {item.balance
                      ? formatMoney(item.balance.authorizedAmount, item.currencyCode)
                      : formatMoney(item.totalAmount, item.currencyCode)}
                  </td>
                  <td className={`${moduleTableCellClass} tabular-nums`}>
                    {formatMoney(item.consumedAmount, item.currencyCode)}
                  </td>
                  <td className={`${moduleTableCellClass} tabular-nums`}>
                    {/* Saldo vem da regra de dominio. Quando ela recusa apurar, a celula
                        declara a indisponibilidade em vez de mostrar zero. */}
                    {item.balance ? (
                      formatMoney(item.balance.availableBalance, item.currencyCode)
                    ) : (
                      <span className="text-xs text-gray-500">Não apurável</span>
                    )}
                  </td>
                  <td className={moduleTableCellClass}>
                    {item.issueDate ? formatDate(item.issueDate) : '—'}
                  </td>
                  <td className={moduleTableCellClass}>
                    <ModuleTableLink to={`/app/purchase-orders/${item.id}`}>
                      {purchaseOrderNextAction(item.status)}
                    </ModuleTableLink>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ModuleTableCard>
      )}

      <ModulePagination
        pageNumber={pageNumber}
        previousDisabled={offset === 0}
        nextDisabled={!hasMore}
        onPrevious={() => void loadPage(Math.max(0, offset - PAGE_SIZE))}
        onNext={() => void loadPage(offset + PAGE_SIZE)}
      />
    </ModulePage>
  );
}
