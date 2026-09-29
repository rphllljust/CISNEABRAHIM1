import { useCallback, useEffect, useState } from 'react';
import { listTransportServiceOrders } from '../api/transport-api';
import { ServiceOrdersApiError } from '../../service-orders/api/service-orders-api';
import { mapServiceOrdersErrorToMessage } from '../../service-orders/api/service-orders-error-messages';
import { ServiceOrderStatusBadge } from '../../service-orders/components/ServiceOrderStatusBadge';
import { formatClientLabel, formatDateTime } from '../../service-orders/utils/service-order-labels';
import {
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModuleStatePage,
  ModulePagination,
} from '../../ui/module-layout';
import {
  RecordStatusCell,
  WorklistFooter,
  WorklistHeader,
  WorklistRowLink,
  WorklistStatePanel,
  worklistCellClass,
  worklistCellRaisedClass,
  worklistHeadCellClass,
  worklistRowClass,
  worklistTableCardClass,
  worklistTableClass,
} from '../../ui/enterprise-list';

const PAGE_SIZE = 20;

type ListState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error'; message: string; retryable: boolean }
  | {
      phase: 'ready';
      items: Awaited<ReturnType<typeof listTransportServiceOrders>>['items'];
      offset: number;
      hasMore: boolean;
    };

function readTransportRouteLabel(location: Record<string, unknown> | null | undefined): string | null {
  const origin = typeof location?.origin === 'string' ? location.origin.trim() : '';
  const destination = typeof location?.destination === 'string' ? location.destination.trim() : '';
  if (!origin || !destination) {
    return null;
  }
  return `${origin} -> ${destination}`;
}

export function TransportListPage() {
  const [offset, setOffset] = useState(0);
  const [listState, setListState] = useState<ListState>({ phase: 'loading' });

  const loadPage = useCallback(async (pageOffset: number, signal?: AbortSignal) => {
    setListState({ phase: 'loading' });
    try {
      const response = await listTransportServiceOrders(
        { limit: PAGE_SIZE, offset: pageOffset },
        signal,
      );
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
      setListState({
        phase: 'error',
        message: 'Não foi possível carregar os transportes.',
        retryable: true,
      });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadPage(offset, controller.signal);
    return () => controller.abort();
  }, [loadPage, offset]);

  if (listState.phase === 'loading') {
    return (
      <ModuleStatePage title="Transporte">
        <ModuleLoadingState message="Carregando ordens de transporte..." />
      </ModuleStatePage>
    );
  }
  if (listState.phase === 'denied') {
    return (
      <ModuleStatePage title="Transporte">
        <ModuleDeniedState message="Você não tem permissão para listar transportes." />
      </ModuleStatePage>
    );
  }
  if (listState.phase === 'error') {
    return (
      <ModuleStatePage title="Transporte">
        <ModuleErrorState
          message={listState.message}
          retryable={listState.retryable}
          onRetry={() => void loadPage(offset)}
        />
      </ModuleStatePage>
    );
  }

  const { items, hasMore } = listState;
  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <ModulePage>
      {/*
        MESMA GRAMATICA DA CENTRAL DE OS. Transporte e um RECORTE da mesma fila (ordens de
        servico com arquetipo TRANSPORT) e ainda usava a grade legada `px-6 py-3.5` dentro de um
        cartao com sombra — parecia outro modulo. Aqui entram o cabecalho da worklist, a grade
        densa e o drilldown por link real, sem tocar na consulta nem no escopo.
        A tela nao tem filtro publicado pelo contrato, entao nao ha barra de filtros vazia.
      */}
      <WorklistHeader
        title="Transporte"
        count={items.length}
        context="Ordens de serviço com arquétipo TRANSPORT. Origem, destino, veículo, cliente e pedido permanecem nos módulos existentes."
      />

      {items.length === 0 ? (
        <WorklistStatePanel
          title="Nenhum transporte encontrado."
          description="Nenhuma ordem de serviço com arquétipo TRANSPORT no seu escopo autorizado."
        />
      ) : (
        <div className={worklistTableCardClass}>
          <table className={worklistTableClass} aria-label="Lista de transportes">
            <thead>
              <tr>
                <th scope="col" className={worklistHeadCellClass}>
                  OS
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Cliente
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Trecho
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Status
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Atualizado
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((order) => (
                <tr key={order.id} className={worklistRowClass}>
                  <td className={worklistCellClass}>
                    <WorklistRowLink href={`/app/service-orders/${order.id}/planning`}>
                      {order.orderNumber}
                    </WorklistRowLink>
                  </td>
                  <td className={worklistCellRaisedClass}>
                    {formatClientLabel(order.clientSnapshot, order.clientId)}
                  </td>
                  <td className={worklistCellRaisedClass}>
                    {readTransportRouteLabel(order.location) ?? '—'}
                  </td>
                  <td className={worklistCellRaisedClass}>
                    <RecordStatusCell badge={<ServiceOrderStatusBadge status={order.status} />} />
                  </td>
                  <td className={worklistCellRaisedClass}>
                    <span className="whitespace-nowrap">{formatDateTime(order.updatedAt)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {items.length > 0 ? (
        <WorklistFooter rangeLabel={`${offset + 1}–${offset + items.length} nesta página`}>
          <ModulePagination
            pageNumber={pageNumber}
            previousDisabled={offset === 0}
            nextDisabled={!hasMore}
            onPrevious={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            onNext={() => setOffset(offset + PAGE_SIZE)}
          />
        </WorklistFooter>
      ) : null}
    </ModulePage>
  );
}
