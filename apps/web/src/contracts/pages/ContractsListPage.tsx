import { useCallback, useEffect, useState } from 'react';
import { ContractsApiError, listContracts } from '../api/contracts-api';
import { mapContractErrorToMessage } from '../api/contracts-error-messages';
import { ContractStatusBadge } from '../components/ContractStatusBadge';
import { useContractCapabilities } from '../hooks/useContractCapabilities';
import type { Contract } from '../types';
import { formatClientSnapshot, formatDate, formatDateTime } from '../utils/contract-status-labels';
import { Button } from '../../ui/Button';
import { HumanLookupField } from '../../financial-ui/HumanLookupField';
import { searchClientOptions } from '../../financial-ui/client-lookup';
import {
  FilterCard,
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModuleStatePage,
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
  | { phase: 'ready'; items: Contract[]; offset: number; hasMore: boolean };

export function ContractsListPage() {
  const { capabilities } = useContractCapabilities();
  const [clientFilter, setClientFilter] = useState('');
  const [unitFilter, setUnitFilter] = useState('');
  const [listState, setListState] = useState<ListState>({ phase: 'loading' });

  const loadPage = useCallback(
    async (offset: number, signal?: AbortSignal) => {
      setListState({ phase: 'loading' });
      try {
        const response = await listContracts(
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
        if (error instanceof ContractsApiError) {
          if (error.kind === 'denied') {
            setListState({ phase: 'denied' });
            return;
          }
          setListState({
            phase: 'error',
            message: mapContractErrorToMessage(error.code, error.status),
            retryable: error.kind === 'network' || error.kind === 'unknown',
          });
          return;
        }
        setListState({
          phase: 'error',
          message: 'Não foi possível carregar os contratos.',
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
      <ModuleStatePage title="Contratos">`r`n        <ModuleLoadingState message="Carregando contratos…" />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'denied') {
    return (
      <ModuleStatePage title="Contratos">`r`n        <ModuleDeniedState
        message="Você não tem permissão para listar contratos comerciais."
      />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'error') {
    return (
      <ModuleStatePage title="Contratos">`r`n        <ModuleErrorState
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
      <ModulePageHeader
        title="Contratos"
        action={
          capabilities.canCreate ? (
            <ModulePrimaryLink to="/app/contracts/new">Novo contrato</ModulePrimaryLink>
          ) : null
        }
      />

      <FilterCard>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="min-w-0">
            <HumanLookupField
              label="Cliente"
              htmlFor="contract-client-search"
              search={searchClientOptions}
              value={clientFilter}
              onChange={setClientFilter}
              emptyOptionLabel="Todos os clientes"
              emptyMessage="Nenhum cliente encontrado para a busca."
            />
          </div>
          <div>
            <label className={filterLabelClass} htmlFor="contract-unit-filter">
              Unidade
            </label>
            <input
              id="contract-unit-filter"
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
          Nenhum contrato encontrado.
        </p>
      ) : (
        <ModuleTableCard>
          <table className={moduleTableClass} aria-label="Lista de contratos">
            <thead className={moduleTableHeadClass}>
              <tr>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Contrato
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Código interno
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Status
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Cliente
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Vigência
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Unidade
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Atualizado em
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item) => (
                <tr key={item.id} className={moduleTableRowClass}>
                  <td className={moduleTableCellClass}>
                    <ModuleTableLink to={`/app/contracts/${item.id}`}>
                      {item.contractNumber}
                    </ModuleTableLink>
                  </td>
                  <td className={moduleTableCellClass}>{item.internalCode}</td>
                  <td className={moduleTableCellClass}>
                    <ContractStatusBadge status={item.status} />
                  </td>
                  <td className={moduleTableCellClass}>
                    {formatClientSnapshot(item.clientSnapshot)}
                  </td>
                  <td className={moduleTableCellClass}>
                    {formatDate(item.validFrom)}
                    {item.validTo ? ` → ${formatDate(item.validTo)}` : ''}
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
