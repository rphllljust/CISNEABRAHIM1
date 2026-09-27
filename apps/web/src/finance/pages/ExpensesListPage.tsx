import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Money } from '../../ui';
import { SavedViewsBar, useSmartList } from '../../operator';
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

/** Escopo estavel de persistencia das visoes salvas desta lista. */
const SCOPE = 'finance.expenses';

/** Valores de status aceitos como visao/URL — os mesmos que a tela oferece. */
const EXPENSES_ALLOWED_FILTERS = {
  filters: { status: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'] },
} as const;

/**
 * Visoes embutidas derivadas do dominio real da tela: sao exatamente os recortes que o
 * Ctrl+K ja promete (`view.expenses.submitted`, `view.expenses.rejected`). Antes desta
 * adocao o comando navegava para `?status=...` e a tela IGNORAVA a query string — o
 * filtro era prometido no comando e descartado em silencio na chegada.
 */
const EXPENSES_BUILT_IN_VIEWS = [
  {
    id: 'builtin.expenses.submitted',
    name: 'Aguardando aprovação',
    description: 'Despesas enviadas e ainda não decididas.',
    config: { filters: { status: 'SUBMITTED' }, sortKey: null, sortDirection: 'asc' as const, groupKey: null },
  },
  {
    id: 'builtin.expenses.rejected',
    name: 'Rejeitadas',
    description: 'Despesas recusadas que voltaram para correção.',
    config: { filters: { status: 'REJECTED' }, sortKey: null, sortDirection: 'asc' as const, groupKey: null },
  },
];

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
  const [listState, setListState] = useState<ListState>({ phase: 'loading' });

  // O status vive na URL e em visao salva: o Ctrl+K abre a lista JÁ recortada e o
  // endereço é compartilhável. Somente valores enumerados entram (allow-list abaixo).
  const smartList = useSmartList({
    scope: SCOPE,
    builtInViews: EXPENSES_BUILT_IN_VIEWS,
    allowedFilters: EXPENSES_ALLOWED_FILTERS,
    urlSync: true,
  });
  const statusFilter = smartList.filters.status ?? '';

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
              onChange={(event) => smartList.setFilter('status', event.target.value)}
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

      <SavedViewsBar
        views={smartList.savedViews.views}
        builtInViews={smartList.savedViews.builtInViews}
        activeViewId={smartList.activeViewId}
        onApply={(view) => {
          setAppliedTerm(term.trim());
          smartList.applyView(view);
        }}
        onSave={smartList.savedViews.saveView}
        onRename={smartList.savedViews.renameView}
        onRemove={smartList.savedViews.removeView}
        currentConfig={smartList.currentConfig}
        canSave={Object.keys(smartList.filters).length > 0}
        allLabel="Todas"
        className="mb-4"
      />

      {items.length === 0 ? (
        <div className="rounded-md bg-white p-4 ring-1 ring-gray-900/5 ring-inset" role="status">
          <p className="text-sm font-medium text-gray-700">
            {smartList.isFiltered || appliedTerm
              ? 'Nenhuma despesa encontrada para os filtros selecionados.'
              : 'Nenhuma despesa registrada ainda.'}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {smartList.isFiltered || appliedTerm
              ? 'Ajuste ou limpe os filtros para ver o conjunto completo.'
              : 'Comece registrando a primeira despesa para acompanhar vencimento e aprovação.'}
          </p>
          {smartList.isFiltered ? (
            <button
              type="button"
              className="mt-2 text-xs font-semibold text-brand-600 hover:text-brand-700"
              onClick={() => {
                smartList.clearFilters();
                setTerm('');
                setAppliedTerm('');
              }}
            >
              Limpar filtros
            </button>
          ) : null}
        </div>
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
