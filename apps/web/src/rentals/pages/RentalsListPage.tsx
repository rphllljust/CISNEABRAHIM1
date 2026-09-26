import { useCallback, useEffect, useState } from 'react';
import { listRentalServiceOrders } from '../api/rentals-api';
import { ServiceOrdersApiError } from '../../service-orders/api/service-orders-api';
import { mapServiceOrdersErrorToMessage } from '../../service-orders/api/service-orders-error-messages';
import { ServiceOrderStatusBadge } from '../../service-orders/components/ServiceOrderStatusBadge';
import { formatClientLabel, formatDateTime } from '../../service-orders/utils/service-order-labels';
import {
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModulePageHeader,
  ModulePagination,
  ModuleTableCard,
  ModuleTableLink,
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
  | { phase: 'ready'; items: Awaited<ReturnType<typeof listRentalServiceOrders>>['items']; offset: number; hasMore: boolean };

export function RentalsListPage() {
  const [offset, setOffset] = useState(0);
  const [listState, setListState] = useState<ListState>({ phase: 'loading' });

  const loadPage = useCallback(async (pageOffset: number, signal?: AbortSignal) => {
    setListState({ phase: 'loading' });
    try {
      const response = await listRentalServiceOrders({ limit: PAGE_SIZE, offset: pageOffset }, signal);
      setListState({
        phase: 'ready',
        items: response.items,
        offset: response.offset,
        hasMore: response.items.length === response.limit,
      });
    } catch (error) {
      if (error instanceof ServiceOrdersApiError) {
        if (error.kind === 'denied') {
          setListState({ phase: 'denied' });
          return;
        }
        setListState({
          phase: 'error',
          message: mapServiceOrdersErrorToMessage(error.code, error.status),
          retryable: error.kind === 'network' || error.kind === 'unknown',
        });
        return;
      }
      setListState({ phase: 'error', message: 'Não foi possível carregar as locações.', retryable: true });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadPage(offset, controller.signal);
    return () => controller.abort();
  }, [loadPage, offset]);

  if (listState.phase === 'loading') {
    return (
      <ModulePage>
        <ModuleLoadingState title="Locações" message="Carregando ordens de locação…" />
      </ModulePage>
    );
  }
  if (listState.phase === 'denied') {
    return (
      <ModulePage>
        <ModuleDeniedState title="Locações" message="Você não tem permissão para listar locações." />
      </ModulePage>
    );
  }
  if (listState.phase === 'error') {
    return (
      <ModulePage>
        <ModuleErrorState
        title="Locações"
        message={listState.message}
        retryable={listState.retryable}
        onRetry={() => void loadPage(offset)}
      />
      </ModulePage>
    );
  }

  const { items, hasMore } = listState;
  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <ModulePage>
      <ModulePageHeader
        title="Locações"
        description="Ordens de serviço com arquétipo RENTAL. Cliente, contrato, pedido, ativo, alocação, execução e medição permanecem nos módulos existentes."
      />
      {items.length === 0 ? (
        <p className="text-sm text-gray-500">Nenhuma locação encontrada.</p>
      ) : (
        <ModuleTableCard>
          <table className={moduleTableClass} aria-label="Lista de locações">
            <thead className={moduleTableHeadClass}>
              <tr>
                <th scope="col" className={moduleTableHeaderCellClass}>OS</th>
                <th scope="col" className={moduleTableHeaderCellClass}>Cliente</th>
                <th scope="col" className={moduleTableHeaderCellClass}>Status</th>
                <th scope="col" className={moduleTableHeaderCellClass}>Atualizado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((order) => (
                <tr key={order.id} className={moduleTableRowClass}>
                  <td className={moduleTableCellClass}>
                    <ModuleTableLink to={`/app/service-orders/${order.id}/planning`}>{order.orderNumber}</ModuleTableLink>
                  </td>
                  <td className={moduleTableCellClass}>
                    {formatClientLabel(order.clientSnapshot, order.clientId)}
                  </td>
                  <td className={moduleTableCellClass}>
                    <ServiceOrderStatusBadge status={order.status} />
                  </td>
                  <td className={moduleTableCellClass}>{formatDateTime(order.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ModuleTableCard>
      )}
      {items.length > 0 ? (
        <ModulePagination
          pageNumber={pageNumber}
          rangeLabel={`${offset + 1}–${offset + items.length}`}
          previousDisabled={offset === 0}
          nextDisabled={!hasMore}
          onPrevious={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          onNext={() => setOffset(offset + PAGE_SIZE)}
        />
      ) : null}
    </ModulePage>
  );
}