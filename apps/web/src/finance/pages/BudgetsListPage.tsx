import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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
  worklistRowClass,
  worklistSelectClass,
  worklistTableCardClass,
  worklistTableClass,
} from '../../ui/enterprise-list';
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
    config: {
      filters: { status: 'DRAFT' },
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
      <ModuleStatePage title="Orçamentos">
        <ModuleLoadingState message="Carregando Orçamentos…" />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'denied') {
    return (
      <ModuleStatePage title="Orçamentos">
        <ModuleDeniedState message="Você não tem permissão para listar Orçamentos." />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'error') {
    return (
      <ModuleStatePage title="Orçamentos">
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
        GRAMATICA DA WORKLIST: cabecalho, barra de filtros em uma linha, grade densa, rodape e
        estados passam a usar os primitivos compartilhados. O recorte de status, a busca
        server-side e as visoes salvas permanecem exatamente os mesmos.
      */}
      <WorklistHeader
        title="Orçamentos"
        count={total}
        context="Orçamentos por código, nome e estado. Comparação e versões permanecem no detalhe."
        action={
          <Link
            className="text-sm font-semibold text-gray-700 hover:text-gray-900"
            to="/app/finance/budgets/new"
          >
            Novo orçamento
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
          <WorklistField label="Buscar" htmlFor="budget-search" grow>
            <input
              id="budget-search"
              type="search"
              className={worklistSelectClass}
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Código ou nome"
            />
          </WorklistField>
          <WorklistField label="Status" htmlFor="budget-status-filter">
            <select
              id="budget-status-filter"
              className={worklistSelectClass}
              value={statusFilter}
              onChange={(event) => smartList.setFilter('status', event.target.value)}
            >
              <option value="">Todos</option>
              <option value="DRAFT">Rascunho</option>
              <option value="APPROVED">Aprovado</option>
              <option value="SUPERSEDED">Substituído</option>
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
        allLabel="Todos"
        className="mb-2"
      />

      {items.length === 0 ? (
        <WorklistStatePanel
          title={
            isFiltered
              ? 'Nenhum orçamento encontrado para os filtros selecionados.'
              : 'Nenhum orçamento registrado ainda.'
          }
          description={
            isFiltered
              ? 'Ajuste ou limpe os filtros para ver o conjunto completo.'
              : 'Comece criando o primeiro orçamento para comparar previsto e realizado.'
          }
          action={
            smartList.isFiltered ? (
              <WorklistClearFilters
                visible
                label="Ver todos os orçamentos"
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
          <table className={worklistTableClass} aria-label="Lista de Orçamentos">
            <thead>
              <tr>
                <th scope="col" className={worklistHeadCellClass}>
                  Orçamento
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Código
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Moeda
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((budget) => (
                <tr key={budget.id} className={worklistRowClass}>
                  <td className={worklistCellClass}>
                    <WorklistRowLink href={`/app/finance/budgets/${budget.id}`}>
                      {budget.name}
                    </WorklistRowLink>
                  </td>
                  <td
                    className={`${worklistCellRaisedClass} font-mono text-[12px] text-gray-600 tabular-nums`}
                  >
                    {budget.code}
                  </td>
                  <td className={worklistCellRaisedClass}>{budget.currencyCode}</td>
                  <td className={worklistCellRaisedClass}>
                    <RecordStatusCell
                      badge={
                        <FinanceStatusBadge status={budget.status} labels={BUDGET_STATUS_LABELS} />
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
        extra={`${total} orçamento(s) no total`}
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
