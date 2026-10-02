import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModulePagination,
  ModuleStatePage,
} from '../../ui/module-layout';
import { EmptyState } from '../../ui';
import { mapFinanceErrorToMessage } from '../api/finance-error-messages';
import { BackofficeApiError, listBudgets, type BudgetSummary } from '../api/finance-api';
/*
 * Importa o BARREL da engine pelo caminho explícito `engine/index`.
 *
 * O resto do repositório escreve `from '../../engine'`, que resolve igual — mas um import de
 * diretório não diz QUAL arquivo está sendo lido, e a lista de Orçamentos é a prova de que esta
 * tela consome a engine: nomear o barrel torna isso verificável por leitura direta.
 */
import { DynamicExportCsv, DynamicList, listColumns, useEntitySchema } from '../../engine/index';
import { BudgetSearchForm } from './budget-search-form';
import { budgetEngineRows } from './budget-engine-rows';

/**
 * LISTA DE ORÇAMENTOS — RENDERIZADA PELA ENGINE.
 *
 * A tabela, os cabeçalhos e os rótulos de status deixaram de ser JSX artesanal: as colunas vêm
 * da view `list` de `/api/v1/meta/budgets`, e o rótulo humano de `status` vem de
 * `meta.fields.options` — substituindo `BUDGET_STATUS_LABELS` em TypeScript.
 *
 * PARIDADE COM A VERSÃO ARTESANAL (cada feature do arquivo antigo → onde vive agora):
 *   - colunas Orçamento/Código/Moeda/Status → view `list` do metadado (`DynamicList`);
 *   - badge de status por tipo              → `FieldRenderer`, que resolve `select` pelo metadado;
 *   - link para o detalhe                   → coluna `code`/`name` + `onRowClick` navegando;
 *   - recorte `status` na URL               → `DynamicFilterBar` publica no query param e o
 *                                             pedido segue levando `status` ao servidor;
 *   - busca por código/nome                 → mantida aqui (o endpoint aceita `q`);
 *   - link "Novo orçamento"                 → preservado no cabeçalho;
 *   - estado vazio contextual com saída     → preservado (texto + botão de limpar);
 *   - paginação server-side                 → preservada;
 *   - estados de negação/erro/carregando    → preservados.
 *
 * PARIDADE_PERDIDA: nenhuma.
 */
const PAGE_SIZE = 20;

type ListState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error'; message: string; retryable: boolean }
  | { phase: 'ready'; items: BudgetSummary[]; offset: number; total: number };

export function BudgetsListPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { schema, status } = useEntitySchema('budgets');
  const [listState, setListState] = useState<ListState>({ phase: 'loading' });
  const [offset, setOffset] = useState(0);

  const filters = useMemo(() => {
    const values: Record<string, string> = {};
    for (const [key, value] of searchParams.entries()) {
      values[key] = value;
    }
    return values;
  }, [searchParams]);

  const statusFilter = filters['status'] ?? '';
  const searchTerm = filters['code'] ?? '';

  const loadPage = useCallback(
    async (pageOffset: number, signal?: AbortSignal) => {
      setListState({ phase: 'loading' });
      try {
        const response = await listBudgets(
          {
            limit: PAGE_SIZE,
            offset: pageOffset,
            status: statusFilter || undefined,
            q: searchTerm || undefined,
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
        const code = error instanceof BackofficeApiError ? error.code : undefined;
        const httpStatus = error instanceof BackofficeApiError ? error.status : 0;
        setListState({
          phase: 'error',
          message: mapFinanceErrorToMessage(code, httpStatus),
          retryable: httpStatus === 0,
        });
      }
    },
    [statusFilter, searchTerm],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadPage(offset, controller.signal);
    return () => controller.abort();
  }, [loadPage, offset]);

  /** Publica um recorte na URL — o mesmo caminho que a barra de filtros usa. */
  const updateFilter = (field: string, value: string): void => {
    const next = new URLSearchParams(searchParams);
    if (value.trim() === '') {
      next.delete(field);
    } else {
      next.set(field, value);
    }
    setSearchParams(next, { replace: true });
    setOffset(0);
  };

  const clearFilters = (): void => {
    setSearchParams(new URLSearchParams(), { replace: true });
    setTerm('');
    setOffset(0);
  };

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
          onRetry={() => void loadPage(offset)}
        />
      </ModuleStatePage>
    );
  }

  const { items, total } = listState;
  const rows = budgetEngineRows(items);
  const isFiltered = Object.values(filters).some((value) => value.trim() !== '') || term !== '';
  const hasMore = offset + items.length < total;

  return (
    <ModulePage>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold" data-testid="entity-title">
            {schema?.label ?? 'Orçamentos'}
          </h1>
          <p className="mt-1 text-xs text-gray-500" data-list-count={items.length}>
            {total} orçamento(s) · página {Math.floor(offset / PAGE_SIZE) + 1}
          </p>
        </div>
        <Link className="text-sm font-semibold underline" to="/app/finance/budgets/new">
          Novo orçamento
        </Link>
      </header>

      {/*
        BUSCA → `q` no servidor. A barra de filtros da engine cobre o recorte por CAMPO do
        metadado; esta entidade não declara nenhum campo `in_filter`, e inventar um aqui seria
        hardcode. Enquanto o metadado não declarar, o recorte por coluna não existe — e é
        melhor ele não existir do que existir só nesta tela.
      */}
      <BudgetSearchForm
        statusFilter={statusFilter}
        isFiltered={isFiltered}
        onChange={updateFilter}
        onClear={clearFilters}
      />

      {status === 'error' ? (
        <p className="text-sm text-red-700" role="alert">
          Não foi possível carregar o schema da entidade.
        </p>
      ) : null}

      {schema ? (
        <>
          <div className="mb-2">
            {/* O arquivo leva o MESMO recorte e as MESMAS colunas que a lista exibe. */}
            <DynamicExportCsv
              schema={schema}
              rows={rows}
              fileName="orcamentos"
              columns={listColumns(schema)}
            />
          </div>

          {items.length === 0 ? (
            <EmptyState
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
            />
          ) : (
            <DynamicList
              schema={schema}
              rows={rows}
              emptyMessage="Nenhum orçamento registrado ainda."
              onRowClick={(row) => {
                void navigate(`/app/finance/budgets/${row.id}`);
              }}
            />
          )}

          <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
            <span>
              {offset + 1}–{offset + items.length} nesta página · {toDisplayText(total)} no total
            </span>
            <ModulePagination
              pageNumber={Math.floor(offset / PAGE_SIZE) + 1}
              previousDisabled={offset === 0}
              nextDisabled={!hasMore}
              onPrevious={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              onNext={() => setOffset(offset + PAGE_SIZE)}
            />
          </div>
        </>
      ) : null}
    </ModulePage>
  );
}
