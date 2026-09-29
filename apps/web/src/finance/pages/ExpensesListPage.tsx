import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Money } from '../../ui';
import { SavedViewsBar, useSmartList } from '../../operator';
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
  WorklistClearFilters,
  WorklistField,
  WorklistFilterBar,
  WorklistFooter,
  WorklistHeader,
  WorklistRowLink,
  WorklistStatePanel,
  worklistButtonClass,
  worklistCellClass,
  worklistCellRaisedClass,
  worklistHeadCellClass,
  worklistNumericCellClass,
  worklistNumericHeadCellClass,
  worklistRowClass,
  worklistSelectClass,
  worklistTableCardClass,
  worklistTableClass,
} from '../../ui/enterprise-list';
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
    config: {
      filters: { status: 'SUBMITTED' },
      sortKey: null,
      sortDirection: 'asc' as const,
      groupKey: null,
    },
  },
  {
    id: 'builtin.expenses.rejected',
    name: 'Rejeitadas',
    description: 'Despesas recusadas que voltaram para correção.',
    config: {
      filters: { status: 'REJECTED' },
      sortKey: null,
      sortDirection: 'asc' as const,
      groupKey: null,
    },
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
          {
            limit: PAGE_SIZE,
            offset,
            status: statusFilter || undefined,
            q: appliedTerm || undefined,
          },
          signal,
        );
        setListState({
          phase: 'ready',
          items: response.items,
          offset: response.offset,
          total: response.total,
        });
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
      <ModuleStatePage title="Despesas">
        <ModuleLoadingState message="Carregando Despesas…" />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'denied') {
    return (
      <ModuleStatePage title="Despesas">
        <ModuleDeniedState message="Você não tem permissão para listar Despesas." />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'error') {
    return (
      <ModuleStatePage title="Despesas">
        <ModuleErrorState
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
  const isFiltered = smartList.isFiltered || appliedTerm !== '';

  return (
    <ModulePage>
      {/*
        MESMA GRAMATICA DAS DEMAIS WORKLISTS. Cabecalho, barra de filtros em uma linha, grade
        densa, rodape e estados passam a ser os primitivos compartilhados; o filtro de status,
        a busca, as visoes salvas e a consulta ao servidor nao mudam.
      */}
      <WorklistHeader
        title="Despesas"
        count={total}
        context="Despesas por descrição, centro de custo, valor, vencimento e estado."
        action={
          <Link
            className="text-sm font-semibold text-gray-700 hover:text-gray-900"
            to="/app/finance/expenses/new"
          >
            Nova despesa
          </Link>
        }
      />

      <WorklistFilterBar>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setAppliedTerm(term.trim());
          }}
        >
          <WorklistField label="Buscar" htmlFor="expense-search" grow>
            <input
              id="expense-search"
              type="search"
              className={worklistSelectClass}
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Descrição ou centro de custo"
            />
          </WorklistField>
          <WorklistField label="Status" htmlFor="expense-status-filter">
            <select
              id="expense-status-filter"
              className={worklistSelectClass}
              value={statusFilter}
              onChange={(event) => smartList.setFilter('status', event.target.value)}
            >
              <option value="">Todos</option>
              <option value="DRAFT">Rascunho</option>
              <option value="SUBMITTED">Enviada</option>
              <option value="APPROVED">Aprovada</option>
              <option value="REJECTED">Rejeitada</option>
            </select>
          </WorklistField>
          <button type="submit" className={worklistButtonClass}>
            Buscar
          </button>
          <WorklistClearFilters
            visible={isFiltered}
            onClick={() => {
              smartList.clearFilters();
              setTerm('');
              setAppliedTerm('');
            }}
          />
        </form>
      </WorklistFilterBar>

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
        className="mb-2"
      />

      {items.length === 0 ? (
        <WorklistStatePanel
          title={
            isFiltered
              ? 'Nenhuma despesa encontrada para os filtros selecionados.'
              : 'Nenhuma despesa registrada ainda.'
          }
          description={
            isFiltered
              ? 'Ajuste ou limpe os filtros para ver o conjunto completo.'
              : 'Comece registrando a primeira despesa para acompanhar vencimento e aprovação.'
          }
          action={
            smartList.isFiltered ? (
              <WorklistClearFilters
                visible
                label="Ver todas as despesas"
                onClick={() => {
                  smartList.clearFilters();
                  setTerm('');
                  setAppliedTerm('');
                }}
              />
            ) : null
          }
        />
      ) : (
        <div className={worklistTableCardClass}>
          <table className={worklistTableClass} aria-label="Lista de Despesas">
            <thead>
              <tr>
                <th scope="col" className={worklistHeadCellClass}>
                  Descrição
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Centro de custo
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Vencimento
                </th>
                <th scope="col" className={worklistNumericHeadCellClass}>
                  Valor
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((expense) => (
                <tr key={expense.id} className={worklistRowClass}>
                  <td className={worklistCellClass}>
                    <WorklistRowLink href={`/app/finance/expenses/${expense.id}`}>
                      {expense.description}
                    </WorklistRowLink>
                  </td>
                  <td className={worklistCellRaisedClass}>{expense.costCenterCode}</td>
                  <td className={worklistCellRaisedClass}>
                    <span className="tabular-nums whitespace-nowrap">{expense.dueDate}</span>
                  </td>
                  <td className={worklistNumericCellClass}>
                    <Money value={expense.totalAmount} currencyCode={expense.currencyCode} />
                  </td>
                  <td className={worklistCellRaisedClass}>
                    <RecordStatusCell
                      badge={
                        <FinanceStatusBadge
                          status={expense.status}
                          labels={EXPENSE_STATUS_LABELS}
                        />
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <WorklistFooter
        rangeLabel={`${offset + 1}–${offset + items.length} nesta página`}
        extra={`${total} despesa(s) no total`}
      >
        <ModulePagination
          pageNumber={pageNumber}
          previousDisabled={offset === 0}
          nextDisabled={!hasMore}
          onPrevious={() => void loadPage(Math.max(0, offset - PAGE_SIZE))}
          onNext={() => void loadPage(offset + PAGE_SIZE)}
        />
      </WorklistFooter>
    </ModulePage>
  );
}
