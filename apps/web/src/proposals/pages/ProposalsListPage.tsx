import { useCallback, useEffect, useState } from 'react';
import { listProposals, ProposalsApiError } from '../api/proposals-api';
import { mapProposalErrorToMessage } from '../api/proposal-error-messages';
import { useProposalCapabilities } from '../hooks/useProposalCapabilities';
import type { Proposal } from '../types/proposal.types';
import { ProposalStatusBadge } from '../components/ProposalStatusBadge';
import {
  PROPOSAL_NO_VERSION_LABEL,
  formatProposalValidity,
  proposalNextAction,
} from '../utils/proposal-list-presentation';
import { formatMoneyBrl } from '../../ui/format/money';
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
  | { phase: 'ready'; items: Proposal[]; offset: number; hasMore: boolean };

export function ProposalsListPage() {
  const { capabilities } = useProposalCapabilities();
  const [clientFilter, setClientFilter] = useState('');
  const [unitFilter, setUnitFilter] = useState('');
  const [listState, setListState] = useState<ListState>({ phase: 'loading' });

  const loadPage = useCallback(
    async (offset: number, signal?: AbortSignal) => {
      setListState({ phase: 'loading' });
      try {
        const response = await listProposals(
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
        if (error instanceof ProposalsApiError) {
          if (error.kind === 'denied') {
            setListState({ phase: 'denied' });
            return;
          }
          setListState({
            phase: 'error',
            message: mapProposalErrorToMessage(error.code, error.status),
            retryable: error.kind === 'network' || error.kind === 'unknown',
          });
          return;
        }
        setListState({
          phase: 'error',
          message: 'Não foi possível carregar as propostas.',
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
        <ModuleLoadingState title="Propostas comerciais" message="Carregando propostas…" />
      </ModulePage>
    );
  }

  if (listState.phase === 'denied') {
    return (
      <ModulePage>
        <ModuleDeniedState
        title="Propostas comerciais"
        message="Você não tem permissão para listar propostas."
      />
      </ModulePage>
    );
  }

  if (listState.phase === 'error') {
    return (
      <ModulePage>
        <ModuleErrorState
        title="Propostas comerciais"
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
        title="Propostas comerciais"
        action={
          capabilities.canCreate ? (
            <ModulePrimaryLink to="/app/proposals/new">Nova proposta</ModulePrimaryLink>
          ) : null
        }
      />

      <FilterCard>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className={filterLabelClass} htmlFor="proposal-client-filter">
              Cliente (ID)
            </label>
            <input
              id="proposal-client-filter"
              type="search"
              className={filterControlClass}
              value={clientFilter}
              onChange={(event) => setClientFilter(event.target.value)}
              placeholder="UUID do cliente"
            />
          </div>
          <div>
            <label className={filterLabelClass} htmlFor="proposal-unit-filter">
              Unidade
            </label>
            <input
              id="proposal-unit-filter"
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
          Nenhuma proposta encontrada.
        </p>
      ) : (
        <ModuleTableCard>
          <table className={moduleTableClass} aria-label="Lista de propostas comerciais">
            <thead className={moduleTableHeadClass}>
              <tr>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Proposta
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Título
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Situação
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Revisão
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Valor
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Validade
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
                    <ModuleTableLink to={`/app/proposals/${item.id}`}>
                      {item.proposalCode}
                    </ModuleTableLink>
                  </td>
                  <td className={moduleTableCellClass}>{item.title}</td>
                  <td className={moduleTableCellClass}>
                    {/* Status REAL da versao corrente, vindo do backend. Sem versao nao ha
                        estado: a ausencia e declarada, nunca suposta. */}
                    {item.currentVersionStatus ? (
                      <ProposalStatusBadge status={item.currentVersionStatus} />
                    ) : (
                      <span className="text-sm text-gray-600">{PROPOSAL_NO_VERSION_LABEL}</span>
                    )}
                  </td>
                  <td className={moduleTableCellClass}>
                    {item.currentVersionNumber === null ? '—' : item.currentVersionNumber}
                  </td>
                  <td className={`${moduleTableCellClass} tabular-nums`}>
                    {item.saleTotal
                      ? formatMoneyBrl(item.saleTotal, item.currencyCode ?? 'BRL')
                      : '—'}
                  </td>
                  <td className={moduleTableCellClass}>
                    {formatProposalValidity(item.validUntil)}
                  </td>
                  <td className={moduleTableCellClass}>
                    <ModuleTableLink to={`/app/proposals/${item.id}`}>
                      {proposalNextAction(item.currentVersionStatus)}
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
