import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FilterCard,
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModuleStatePage,
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
import { SavedViewsBar, useSmartList } from '../../operator';

const PAGE_SIZE = 20;

/** Escopo estavel de persistencia das visoes salvas desta lista. */
const SCOPE = 'finance.budgets';

/** Valores de status aceitos como visao/URL — os mesmos que a tela oferece. */
const BUDGETS_ALLOWED_FILTERS = {
  filters: { status: ['DRAFT', 'APPROVED', 'SUPERSEDED'] },
} as const;

/**
 * Visao embutida derivada do dominio real da tela: e o recorte que o Ctrl+K ja promete
 * (`view.budgets.draft`). Antes desta adocao o comando navegava para `?status=DRAFT`
 * e a tela ignorava a query string — o filtro nunca chegava ao servidor.
 */
const BUDGETS_BUILT_IN_VIEWS = [
  {
    id: 'builtin.budgets.draft',
    name: 'Em rascunho',
    description: 'Orçamentos ainda não aprovados.',
    config: { filters: { status: 'DRAFT' }, sortKey: null, sortDirection: 'asc' as const, groupKey: null },
  },
];

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

  // O status vive na URL e em visao salva: o Ctrl+K abre a lista JÁ recortada no
  // servidor e o endereço é compartilhável. Somente valores enumerados entram.
  const smartList = useSmartList({
    scope: SCOPE,
    builtInViews: BUDGETS_BUILT_IN_VIEWS,
    allowedFilters: BUDGETS_ALLOWED_FILTERS,
    urlSync: true,
  });
  const statusFilter = smartList.filters.status ?? '';

  const loadPage = useCallback(
    async (offset: number, signal?: AbortSignal) => {
      setListState({ phase: 'loading' });
      try {
        const response = await listBudgets(
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
      <ModuleStatePage title="Orçamentos">`r`n        <ModuleLoadingState message="Carregando Orçamentos…" />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'denied') {
    return (
      <ModuleStatePage title="Orçamentos">`r`n        <ModuleDeniedState message="Você não tem permissão para listar Orçamentos." />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'error') {
    return (
      <ModuleStatePage title="Orçamentos">`r`n        <ModuleErrorState
          message={listState.message}
          retryable={listState.retryable}
          onRetry={() => void loadPage(0)}
        />
      </ModuleStatePage>
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
          <div>
            <label className={filterLabelClass} htmlFor="budget-status-filter">
              Status
            </label>
            <select
              id="budget-status-filter"
              className={`${filterControlClass} max-w-xs`}
              value={statusFilter}
              onChange={(event) => smartList.setFilter('status', event.target.value)}
            >
              <option value="">Todos</option>
              <option value="DRAFT">Rascunho</option>
              <option value="APPROVED">Aprovado</option>
              <option value="SUPERSEDED">Substituído</option>
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
        allLabel="Todos"
        className="mb-4"
      />

      {items.length === 0 ? (
        <div className="rounded-md bg-white p-4 ring-1 ring-gray-900/5 ring-inset" role="status">
          <p className="text-sm font-medium text-gray-700">
            {smartList.isFiltered || appliedTerm
              ? 'Nenhum orçamento encontrado para os filtros selecionados.'
              : 'Nenhum orçamento registrado ainda.'}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {smartList.isFiltered || appliedTerm
              ? 'Ajuste ou limpe os filtros para ver o conjunto completo.'
              : 'Comece criando o primeiro orçamento para comparar previsto e realizado.'}
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
