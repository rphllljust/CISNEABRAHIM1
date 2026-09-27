import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FilterCard,
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModulePageHeader,
  ModulePagination,
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
import { BUDGET_STATUS_LABELS } from '../../financial-ui/labels';
import { FinanceStatusBadge } from '../components/FinanceStatusBadge';
import { mapFinanceErrorToMessage } from '../api/finance-error-messages';
import { BackofficeApiError, listBudgets, type BudgetSummary } from '../api/finance-api';

const PAGE_SIZE = 20;

type ListState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error'; message: string; retryable: boolean }
  | { phase: 'ready'; items: BudgetSummary[]; offset: number; total: number };

/**
 * Lista de Orçamentos. Existia serviço, criação e comparação, mas NENHUMA rota: o orçamento só era
 * alcançável digitando o identificador. Aqui ele é encontrado por código e nome.
 */
export function BudgetsListPage() {
  const [term, setTerm] = useState('');
  const [appliedTerm, setAppliedTerm] = useState('');
  const [listState, setListState] = useState<ListState>({ phase: 'loading' });

  const loadPage = useCallback(
    async (offset: number, signal?: AbortSignal) => {
      setListState({ phase: 'loading' });
      try {
        const response = await listBudgets(
          { limit: PAGE_SIZE, offset, q: appliedTerm || undefined },
          signal,
        );
        setListState({ phase: 'ready', items: response.items, offset: response.offset, total: response.total });
      } catch (error) {
        if (error instanceof BackofficeApiError && (error.status === 403 || error.status === 401)) {
          setListState({ phase: 'denied' });
          return;
        }
        const status = error instanceof BackofficeApiError ? error.status : 0;
        const code = error instanceof BackofficeApiError ? error.code : undefined;
        setListState({
          phase: 'error',
          message: mapFinanceErrorToMessage(code, status),
          retryable: status === 0,
        });
      }
    },
    [appliedTerm],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadPage(0, controller.signal);
    return () => controller.abort();
  }, [loadPage]);

  if (listState.phase === 'loading') {
    return (
      <ModulePage>
        <ModuleLoadingState title="Orçamentos" message="Carregando Orçamentos…" />
      </ModulePage>
    );
  }

  if (listState.phase === 'denied') {
    return (
      <ModulePage>
        <ModuleDeniedState title="Orçamentos" message="Você não tem permissão para listar Orçamentos." />
      </ModulePage>
    );
  }

  if (listState.phase === 'error') {
    return (
      <ModulePage>
        <ModuleErrorState
          title="Orçamentos"
          message={listState.message}
          retryable={listState.retryable}
          onRetry={() => void loadPage(0)}
        />
      </ModulePage>
    );
  }

  const { items, offset, total } = listState;
  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1;
  const hasMore = offset + items.length < total;

  return (
    <ModulePage>
      <ModulePageHeader
        title="Orçamentos"
        description="Orçamentos por código, nome e estado. Comparação e versões permanecem no detalhe."
        action={
          <Link className="text-sm font-semibold text-gray-700 hover:text-gray-900" to="/app/finance/budgets/new">
            Novo orçamento
          </Link>
        }
      />

      <FilterCard>
        <form
          className="flex flex-wrap items-end gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setAppliedTerm(term.trim());
          }}
        >
          <div>
            <label className={filterLabelClass} htmlFor="budget-search">
              Buscar
            </label>
            <input
              id="budget-search"
              type="search"
              className={`${filterControlClass} w-72`}
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Código ou nome"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
          >
            Buscar
          </button>
        </form>
      </FilterCard>

      {items.length === 0 ? (
        <p className="text-sm text-gray-500" role="status">
          Nenhum orçamento encontrado para os filtros selecionados.
        </p>
      ) : (
        <ModuleTableCard>
          <table className={moduleTableClass} aria-label="Lista de Orçamentos">
            <thead className={moduleTableHeadClass}>
              <tr>
                <th scope="col" className={moduleTableHeaderCellClass}>Orçamento</th>
                <th scope="col" className={moduleTableHeaderCellClass}>Código</th>
                <th scope="col" className={moduleTableHeaderCellClass}>Moeda</th>
                <th scope="col" className={moduleTableHeaderCellClass}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((budget) => (
                <tr key={budget.id} className={moduleTableRowClass}>
                  <td className={moduleTableCellClass}>
                    <ModuleTableLink to={`/app/finance/budgets/${budget.id}`}>{budget.name}</ModuleTableLink>
                  </td>
                  <td className={`${moduleTableCellClass} font-mono tabular-nums text-gray-600`}>
                    {budget.code}
                  </td>
                  <td className={moduleTableCellClass}>{budget.currencyCode}</td>
                  <td className={moduleTableCellClass}>
                    <FinanceStatusBadge status={budget.status} labels={BUDGET_STATUS_LABELS} />
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
      <p className="mt-2 text-xs text-gray-500" role="status">
        {total} orçamento(s) no total.
      </p>
    </ModulePage>
  );
}
