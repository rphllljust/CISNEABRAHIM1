import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Money } from '../../ui';
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
import { EXPENSE_STATUS_LABELS } from '../../financial-ui/labels';
import { FinanceStatusBadge } from '../components/FinanceStatusBadge';
import { mapFinanceErrorToMessage } from '../api/finance-error-messages';
import { BackofficeApiError, listExpenses, type ExpenseSummary } from '../api/finance-api';

const PAGE_SIZE = 20;

type ListState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error'; message: string; retryable: boolean }
  | { phase: 'ready'; items: ExpenseSummary[]; offset: number; total: number };

/**
 * Lista de Despesas. Existia serviço, cadastro e detalhe, mas NENHUMA rota: a despesa só era
 * alcançável digitando o identificador. Aqui a despesa é encontrada por descrição, centro de
 * custo, valor, vencimento e estado.
 */
export function ExpensesListPage() {
  const [term, setTerm] = useState('');
  const [appliedTerm, setAppliedTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED'>('');
  const [listState, setListState] = useState<ListState>({ phase: 'loading' });

  const loadPage = useCallback(
    async (offset: number, signal?: AbortSignal) => {
      setListState({ phase: 'loading' });
      try {
        const response = await listExpenses(
          { limit: PAGE_SIZE, offset, status: statusFilter || undefined, q: appliedTerm || undefined },
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
    [appliedTerm, statusFilter],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadPage(0, controller.signal);
    return () => controller.abort();
  }, [loadPage]);

  if (listState.phase === 'loading') {
    return (
      <ModulePage>
        <ModuleLoadingState title="Despesas" message="Carregando Despesas…" />
      </ModulePage>
    );
  }

  if (listState.phase === 'denied') {
    return (
      <ModulePage>
        <ModuleDeniedState title="Despesas" message="Você não tem permissão para listar Despesas." />
      </ModulePage>
    );
  }

  if (listState.phase === 'error') {
    return (
      <ModulePage>
        <ModuleErrorState
          title="Despesas"
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
        title="Despesas"
        description="Despesas por descrição, centro de custo, valor, vencimento e estado."
        action={
          <Link className="text-sm font-semibold text-gray-700 hover:text-gray-900" to="/app/finance/expenses/new">
            Nova despesa
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
            <label className={filterLabelClass} htmlFor="expense-search">
              Buscar
            </label>
            <input
              id="expense-search"
              type="search"
              className={`${filterControlClass} w-72`}
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Descrição ou centro de custo"
            />
          </div>
          <div>
            <label className={filterLabelClass} htmlFor="expense-status-filter">
              Status
            </label>
            <select
              id="expense-status-filter"
              className={`${filterControlClass} max-w-xs`}
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as '' | 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED')
              }
            >
              <option value="">Todos</option>
              <option value="DRAFT">Rascunho</option>
              <option value="SUBMITTED">Enviada</option>
              <option value="APPROVED">Aprovada</option>
              <option value="REJECTED">Rejeitada</option>
            </select>
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
          Nenhuma despesa encontrada para os filtros selecionados.
        </p>
      ) : (
        <ModuleTableCard>
          <table className={moduleTableClass} aria-label="Lista de Despesas">
            <thead className={moduleTableHeadClass}>
              <tr>
                <th scope="col" className={moduleTableHeaderCellClass}>Descrição</th>
                <th scope="col" className={moduleTableHeaderCellClass}>Centro de custo</th>
                <th scope="col" className={moduleTableHeaderCellClass}>Vencimento</th>
                <th scope="col" className={`${moduleTableHeaderCellClass} text-right`}>Valor</th>
                <th scope="col" className={moduleTableHeaderCellClass}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((expense) => (
                <tr key={expense.id} className={moduleTableRowClass}>
                  <td className={moduleTableCellClass}>
                    <ModuleTableLink to={`/app/finance/expenses/${expense.id}`}>
                      {expense.description}
                    </ModuleTableLink>
                  </td>
                  <td className={moduleTableCellClass}>{expense.costCenterCode}</td>
                  <td className={moduleTableCellClass}>{expense.dueDate}</td>
                  <td className={`${moduleTableCellClass} text-right`}>
                    <Money value={expense.totalAmount} currencyCode={expense.currencyCode} />
                  </td>
                  <td className={moduleTableCellClass}>
                    <FinanceStatusBadge status={expense.status} labels={EXPENSE_STATUS_LABELS} />
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
        {total} despesa(s) no total.
      </p>
    </ModulePage>
  );
}
