import { useCallback, useEffect, useState } from 'react';
import { PeopleApiError, listPeople } from '../api/people-api';
import { mapPersonErrorToMessage } from '../api/person-error-messages';
import { PersonStatusBadge } from '../components/PersonStatusBadge';
import { usePersonCapabilities } from '../hooks/usePersonCapabilities';
import { PERSON_STATUSES, type Person, type PersonStatus } from '../types/person.types';
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
  | { phase: 'ready'; items: Person[]; offset: number; hasMore: boolean };

export function PeopleListPage() {
  const { capabilities } = usePersonCapabilities();
  const [statusFilter, setStatusFilter] = useState<'' | PersonStatus>('');
  const [listState, setListState] = useState<ListState>({ phase: 'loading' });

  const loadPage = useCallback(
    async (offset: number, signal?: AbortSignal) => {
      setListState({ phase: 'loading' });
      try {
        const response = await listPeople(
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
        if (error instanceof PeopleApiError) {
          if (error.kind === 'denied') {
            setListState({ phase: 'denied' });
            return;
          }
          setListState({
            phase: 'error',
            message: mapPersonErrorToMessage(error.code, error.status),
            retryable: error.kind === 'network' || error.kind === 'unknown',
          });
          return;
        }
        setListState({
          phase: 'error',
          message: 'Não foi possível carregar as Pessoas.',
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
        <ModuleLoadingState title="Pessoas" message="Carregando Pessoas…" />
      </ModulePage>
    );
  }

  if (listState.phase === 'denied') {
    return (
      <ModulePage>
        <ModuleDeniedState
        title="Pessoas"
        message="Você não tem permissão para listar Pessoas."
      />
      </ModulePage>
    );
  }

  if (listState.phase === 'error') {
    return (
      <ModulePage>
        <ModuleErrorState
        title="Pessoas"
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
        title="Pessoas"
        action={
          capabilities.canCreate ? (
            <ModulePrimaryLink to="/app/people/new">Nova Pessoa</ModulePrimaryLink>
          ) : null
        }
      />

      <FilterCard>
        <label className={filterLabelClass} htmlFor="person-status-filter">
          Status
        </label>
        <select
          id="person-status-filter"
          className={`${filterControlClass} max-w-xs`}
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as '' | PersonStatus)}
        >
          <option value="">Todos</option>
          <option value={PERSON_STATUSES.Active}>Ativas</option>
          <option value={PERSON_STATUSES.Inactive}>Inativas</option>
        </select>
      </FilterCard>

      {items.length === 0 ? (
        <p className="text-sm text-gray-500" role="status">
          Nenhuma Pessoa encontrada para os filtros selecionados.
        </p>
      ) : (
        <ModuleTableCard>
          <table className={moduleTableClass} aria-label="Lista de Pessoas">
            <thead className={moduleTableHeadClass}>
              <tr>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Código
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Nome
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Função operacional
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((person) => (
                <tr key={person.id} className={moduleTableRowClass}>
                  <td className={`${moduleTableCellClass} font-mono tabular-nums text-gray-600`}>
                    {person.memberCode}
                  </td>
                  <td className={moduleTableCellClass}>
                    <ModuleTableLink to={`/app/people/${person.id}`}>
                      {person.preferredName ?? person.legalName}
                    </ModuleTableLink>
                  </td>
                  <td className={moduleTableCellClass}>
                    {person.defaultLaborTypeName ?? person.defaultLaborTypeCode ?? '—'}
                  </td>
                  <td className={moduleTableCellClass}>
                    <PersonStatusBadge status={person.status} />
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
