import { useCallback, useEffect, useState } from 'react';
import { ClientsApiError, listClients } from '../api/clients-api';
import { mapClientErrorToMessage } from '../api/client-error-messages';
import { ClientStatusBadge } from '../components/ClientStatusBadge';
import { useClientCapabilities } from '../hooks/useClientCapabilities';
import { CLIENT_STATUSES, type Client, type ClientStatus } from '../types/client.types';
import { formatCnpjDisplay } from '../utils/format-cnpj';
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
  | { phase: 'ready'; items: Client[]; offset: number; hasMore: boolean };

export function ClientsListPage() {
  const { capabilities } = useClientCapabilities();
  const [statusFilter, setStatusFilter] = useState<'' | ClientStatus>('');
  const [listState, setListState] = useState<ListState>({ phase: 'loading' });

  const loadPage = useCallback(
    async (offset: number, signal?: AbortSignal) => {
      setListState({ phase: 'loading' });
      try {
        const response = await listClients(
          {
            limit: PAGE_SIZE,
            offset,
            status: statusFilter || undefined,
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
      }
    },
    [statusFilter],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadPage(0, controller.signal);
    return () => controller.abort();
  }, [loadPage]);

  if (listState.phase === 'loading') {
    return (
      <ModulePage>
        <ModuleLoadingState title="Clientes" message="Carregando Clientes…" />
      </ModulePage>
    );
  }

  if (listState.phase === 'denied') {
    return (
      <ModulePage>
        <ModuleDeniedState
        title="Clientes"
        message="Você não tem permissão para listar Clientes."
      />
      </ModulePage>
    );
  }

  if (listState.phase === 'error') {
    return (
      <ModulePage>
        <ModuleErrorState
        title="Clientes"
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
        title="Clientes"
        action={
          capabilities.canCreate ? (
            <ModulePrimaryLink to="/app/clients/new">Novo Cliente</ModulePrimaryLink>
          ) : null
        }
      />

      <FilterCard>
        <label className={filterLabelClass} htmlFor="client-status-filter">
          Status
        </label>
        <select
          id="client-status-filter"
          className={`${filterControlClass} max-w-xs`}
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as '' | ClientStatus)}
        >
          <option value="">Todos</option>
          <option value={CLIENT_STATUSES.Active}>Ativos</option>
          <option value={CLIENT_STATUSES.Inactive}>Inativos</option>
        </select>
      </FilterCard>

      {items.length === 0 ? (
        <p className="text-sm text-gray-500" role="status">
          Nenhum Cliente encontrado para os filtros selecionados.
        </p>
      ) : (
        <ModuleTableCard>
          <table className={moduleTableClass} aria-label="Lista de Clientes">
            <thead className={moduleTableHeadClass}>
              <tr>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Razão social
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  CNPJ
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((client) => (
                <tr key={client.id} className={moduleTableRowClass}>
                  <td className={moduleTableCellClass}>
                    <ModuleTableLink to={`/app/clients/${client.id}`}>
                      {client.legalName}
                    </ModuleTableLink>
                  </td>
                  <td className={`${moduleTableCellClass} font-mono tabular-nums text-gray-600`}>
                    {formatCnpjDisplay(client.taxId)}
                  </td>
                  <td className={moduleTableCellClass}>
                    <ClientStatusBadge status={client.status} />
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
