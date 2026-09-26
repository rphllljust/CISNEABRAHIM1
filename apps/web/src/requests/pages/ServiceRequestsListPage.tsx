import { useCallback, useEffect, useState } from 'react';
import {
  getServiceRequestSummary,
  listServiceRequests,
  ServiceRequestsApiError,
} from '../api/service-requests-api';
import { mapRequestErrorToMessage } from '../api/request-error-messages';
import { ServiceRequestStatusBadge } from '../components/ServiceRequestStatusBadge';
import { ServiceRequestSummaryCards } from '../components/ServiceRequestSummaryCards';
import { useServiceRequestCapabilities } from '../hooks/useServiceRequestCapabilities';
import {
  SERVICE_REQUEST_STATUSES,
  type ServiceRequest,
  type ServiceRequestListSummary,
  type ServiceRequestStatus,
} from '../types/service-request.types';
import {
  formatDateTime,
  formatServiceRequestOrigin,
  formatServiceRequestStatus,
} from '../utils/service-request-labels';
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
  | { phase: 'ready'; items: ServiceRequest[]; offset: number; hasMore: boolean };

export function ServiceRequestsListPage() {
  const { capabilities } = useServiceRequestCapabilities();
  const [statusFilter, setStatusFilter] = useState<'' | ServiceRequestStatus>('');
  const [unitFilter, setUnitFilter] = useState('');
  const [listState, setListState] = useState<ListState>({ phase: 'loading' });
  const [summary, setSummary] = useState<ServiceRequestListSummary | null>(null);

  const loadPage = useCallback(
    async (offset: number, signal?: AbortSignal) => {
      setListState({ phase: 'loading' });
      try {
        const scopedFilters = {
          unitId: unitFilter.trim() || undefined,
        };
        const [response, summaryResponse] = await Promise.all([
          listServiceRequests(
            {
              limit: PAGE_SIZE,
              offset,
              status: statusFilter || undefined,
              ...scopedFilters,
            },
            signal,
          ),
          getServiceRequestSummary(scopedFilters, signal),
        ]);
        setSummary(summaryResponse);
        setListState({
          phase: 'ready',
          items: response.items,
          offset: response.offset,
          hasMore: response.items.length === response.limit,
        });
      } catch (error) {
        if (error instanceof ServiceRequestsApiError) {
          if (error.kind === 'denied') {
            setListState({ phase: 'denied' });
            return;
          }
          setListState({
            phase: 'error',
            message: mapRequestErrorToMessage(error.code, error.status),
            retryable: error.kind === 'network' || error.kind === 'unknown',
          });
          return;
        }
        setListState({
          phase: 'error',
          message: 'Não foi possível carregar as solicitações.',
          retryable: true,
        });
      }
    },
    [statusFilter, unitFilter],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadPage(0, controller.signal);
    return () => controller.abort();
  }, [loadPage]);

  if (listState.phase === 'loading') {
    return (
      <ModulePage>
        <ModuleLoadingState title="Solicitações de serviço" message="Carregando solicitações…" />
      </ModulePage>
    );
  }

  if (listState.phase === 'denied') {
    return (
      <ModulePage>
        <ModuleDeniedState
        title="Solicitações de serviço"
        message="Você não tem permissão para listar solicitações."
      />
      </ModulePage>
    );
  }

  if (listState.phase === 'error') {
    return (
      <ModulePage>
        <ModuleErrorState
        title="Solicitações de serviço"
        message={listState.message}
        retryable={listState.retryable}
        onRetry={() => void loadPage(0)}
      />
      </ModulePage>
    );
  }

  const { items, offset, hasMore } = listState;
  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <ModulePage>
      <ModulePageHeader
        title="Solicitações de serviço"
        action={
          capabilities.canCreate ? (
            <ModulePrimaryLink to="/app/requests/new">Nova solicitação</ModulePrimaryLink>
          ) : null
        }
      />

      <ServiceRequestSummaryCards
        summary={summary}
        activeStatusFilter={statusFilter}
        onSelectStatus={setStatusFilter}
      />

      <FilterCard>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className={filterLabelClass} htmlFor="request-status-filter">
              Status
            </label>
            <select
              id="request-status-filter"
              className={filterControlClass}
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as '' | ServiceRequestStatus)
              }
            >
              <option value="">Todos</option>
              {Object.values(SERVICE_REQUEST_STATUSES).map((status) => (
                <option key={status} value={status}>
                  {formatServiceRequestStatus(status)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={filterLabelClass} htmlFor="request-unit-filter">
              Unidade
            </label>
            <input
              id="request-unit-filter"
              type="search"
              className={filterControlClass}
              value={unitFilter}
              onChange={(event) => setUnitFilter(event.target.value)}
              placeholder="Filtrar por unidade"
            />
          </div>
        </div>
      </FilterCard>

      {items.length === 0 ? (
        <p className="text-sm text-gray-500" role="status">
          Nenhuma solicitação encontrada.
        </p>
      ) : (
        <ModuleTableCard>
          <table className={moduleTableClass} aria-label="Lista de solicitações de serviço">
            <thead className={moduleTableHeadClass}>
              <tr>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Código
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Origem
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Status
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Unidade
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Atualizada em
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item) => (
                <tr key={item.id} className={moduleTableRowClass}>
                  <td className={moduleTableCellClass}>
                    <ModuleTableLink to={`/app/requests/${item.id}`}>
                      {item.requestCode}
                    </ModuleTableLink>
                  </td>
                  <td className={moduleTableCellClass}>
                    {formatServiceRequestOrigin(item.originSource)}
                  </td>
                  <td className={moduleTableCellClass}>
                    <ServiceRequestStatusBadge status={item.status} />
                  </td>
                  <td className={moduleTableCellClass}>{item.unitId}</td>
                  <td className={moduleTableCellClass}>{formatDateTime(item.updatedAt)}</td>
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
