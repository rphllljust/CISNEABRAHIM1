import { useCallback, useEffect, useState } from 'react';
import {
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModulePagination,
  ModulePrimaryLink,
  ModuleStatePage,
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
import { BackofficeApiError } from '../../financial-ui/enterprise-api';
import { formatCnpjDisplay } from '../../clients/utils/format-cnpj';
import { FinanceStatusBadge } from '../../finance/components/FinanceStatusBadge';
import { SUPPLIER_STATUS_LABELS } from '../../financial-ui/labels';
import { mapSupplierErrorToMessage } from '../api/supplier-error-messages';
import { listSuppliers } from '../api/suppliers-api';
import type { SupplierSummary } from '../types/supplier.types';
import { SavedViewsBar, useSmartList } from '../../operator';

const PAGE_SIZE = 20;

/** Escopo estavel de persistencia das visoes salvas desta lista. */
const SCOPE = 'suppliers.list';

/** Valores enumerados aceitos em visao/URL — os mesmos que a tela oferece. */
const SUPPLIERS_ALLOWED_FILTERS = {
  filters: { status: ['ACTIVE', 'INACTIVE'] },
} as const;

/**
 * Visoes embutidas derivadas do dominio real: ativos sao a base cotidiana de compra e
 * inativos sao a fila de manutencao cadastral. Nada aqui inventa estado.
 */
const SUPPLIERS_BUILT_IN_VIEWS = [
  {
    id: 'builtin.suppliers.active',
    name: 'Ativos',
    description: 'Fornecedores aptos a receber pedido.',
    config: {
      filters: { status: 'ACTIVE' },
      sortKey: null,
      sortDirection: 'asc' as const,
      groupKey: null,
    },
  },
  {
    id: 'builtin.suppliers.inactive',
    name: 'Inativos',
    description: 'Cadastros fora de operação.',
    config: {
      filters: { status: 'INACTIVE' },
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
  | { phase: 'ready'; items: SupplierSummary[]; offset: number; hasMore: boolean; total: number };

export function SuppliersListPage() {
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [listState, setListState] = useState<ListState>({ phase: 'loading' });

  // ADOCAO DE SAVED VIEWS: o status sai do estado local e passa a viver na URL e na
  // visao salva, com o mesmo mecanismo ja usado em Clientes, Despesas, Orcamentos,
  // Recebiveis e Contas a pagar. Somente valores enumerados entram (allow-list).
  const smartList = useSmartList({
    scope: SCOPE,
    builtInViews: SUPPLIERS_BUILT_IN_VIEWS,
    allowedFilters: SUPPLIERS_ALLOWED_FILTERS,
    urlSync: true,
  });
  const statusFilter = smartList.filters.status ?? '';

  const loadPage = useCallback(
    async (offset: number, signal?: AbortSignal) => {
      setListState({ phase: 'loading' });
      try {
        const response = await listSuppliers(
          {
            limit: PAGE_SIZE,
            offset,
            status: statusFilter || undefined,
            q: appliedQuery || undefined,
          },
          signal,
        );
        setListState({
          phase: 'ready',
          items: response.items,
          offset: response.offset,
          hasMore: response.offset + response.items.length < response.total,
          total: response.total,
        });
      } catch (error) {
        if (error instanceof BackofficeApiError) {
          if (error.kind === 'denied') {
            setListState({ phase: 'denied' });
            return;
          }
          setListState({
            phase: 'error',
            message: mapSupplierErrorToMessage(error.code, error.status),
            retryable: error.kind === 'network' || error.kind === 'unknown',
          });
          return;
        }
        setListState({
          phase: 'error',
          message: 'Não foi possível carregar os Fornecedores.',
          retryable: true,
        });
      }
    },
    [appliedQuery, statusFilter],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadPage(0, controller.signal);
    return () => controller.abort();
  }, [loadPage]);

  if (listState.phase === 'loading') {
    return (
      <ModuleStatePage title="Fornecedores">
        <ModuleLoadingState message="Carregando Fornecedores…" />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'denied') {
    return (
      <ModuleStatePage title="Fornecedores">
        <ModuleDeniedState message="Você não tem permissão para listar Fornecedores." />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'error') {
    return (
      <ModuleStatePage title="Fornecedores">
        <ModuleErrorState
          message={listState.message}
          retryable={listState.retryable}
          onRetry={() => void loadPage(0)}
        />
      </ModuleStatePage>
    );
  }

  const { items, offset, hasMore, total } = listState;
  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1;
  const isFiltered = smartList.isFiltered || appliedQuery !== '';

  return (
    <ModulePage>
      {/*
        GRAMATICA DA WORKLIST: o cabecalho, a barra de filtros e a grade desta lista passam a
        ser os mesmos de Frota/Pessoas/OS. Antes o filtro era um `FilterCard` e a grade a tabela
        legada `px-6 py-3.5`, enquanto as cinco telas ja convertidas usavam a grade densa — o
        operador via dois produtos diferentes no mesmo backoffice. Busca, status, visoes salvas,
        consulta ao backend e permissao seguem exatamente iguais.
      */}
      <WorklistHeader
        title="Fornecedores"
        count={total}
        context="Fornecedores por razão social, nome fantasia e CNPJ."
        action={<ModulePrimaryLink to="/app/suppliers/new">Novo fornecedor</ModulePrimaryLink>}
      />

      <WorklistFilterBar>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setAppliedQuery(query.trim());
          }}
        >
          <WorklistField label="Buscar" htmlFor="supplier-search" grow>
            <input
              id="supplier-search"
              className={worklistSelectClass}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Razão social, nome fantasia ou CNPJ"
              type="search"
            />
          </WorklistField>
          <WorklistField label="Status" htmlFor="supplier-status-filter">
            <select
              id="supplier-status-filter"
              className={worklistSelectClass}
              value={statusFilter}
              onChange={(event) => smartList.setFilter('status', event.target.value)}
            >
              <option value="">Todos</option>
              <option value="ACTIVE">Ativos</option>
              <option value="INACTIVE">Inativos</option>
            </select>
          </WorklistField>
          <button type="submit" className={worklistButtonClass}>
            Buscar
          </button>
          <WorklistClearFilters
            visible={isFiltered}
            onClick={() => {
              smartList.clearFilters();
              setQuery('');
              setAppliedQuery('');
            }}
          />
        </form>
      </WorklistFilterBar>

      <SavedViewsBar
        views={smartList.savedViews.views}
        builtInViews={smartList.savedViews.builtInViews}
        activeViewId={smartList.activeViewId}
        onApply={(view) => {
          setAppliedQuery(query.trim());
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
              ? 'Nenhum fornecedor encontrado para os filtros selecionados.'
              : 'Nenhum fornecedor cadastrado ainda.'
          }
          description={
            isFiltered
              ? 'Ajuste ou limpe os filtros para ver o conjunto completo.'
              : 'Cadastre o primeiro fornecedor para poder emitir pedidos de compra.'
          }
          action={
            smartList.isFiltered ? (
              <WorklistClearFilters
                visible
                label="Ver todos os fornecedores"
                onClick={() => {
                  smartList.clearFilters();
                  setQuery('');
                  setAppliedQuery('');
                }}
              />
            ) : null
          }
        />
      ) : (
        <div className={worklistTableCardClass}>
          <table className={worklistTableClass} aria-label="Lista de Fornecedores">
            <thead>
              <tr>
                <th scope="col" className={worklistHeadCellClass}>
                  Fornecedor
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  CNPJ
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Condição de pagamento
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
              {items.map((supplier) => (
                <tr key={supplier.id} className={worklistRowClass}>
                  <td className={worklistCellClass}>
                    {/* Link real esticado: a linha inteira e o drilldown do cadastro. */}
                    <WorklistRowLink href={`/app/suppliers/${supplier.id}`}>
                      {supplier.tradeName ?? supplier.legalName}
                    </WorklistRowLink>
                    {supplier.tradeName ? (
                      <p className="text-[11px] text-gray-500">{supplier.legalName}</p>
                    ) : null}
                  </td>
                  <td
                    className={`${worklistCellRaisedClass} font-mono text-[12px] text-gray-600 tabular-nums`}
                  >
                    {formatCnpjDisplay(supplier.taxId)}
                  </td>
                  <td className={worklistCellRaisedClass}>{supplier.paymentTerms ?? '—'}</td>
                  <td className={worklistCellRaisedClass}>{supplier.currencyCode}</td>
                  <td className={worklistCellRaisedClass}>
                    <RecordStatusCell
                      badge={
                        <FinanceStatusBadge status={supplier.status} labels={SUPPLIER_STATUS_LABELS} />
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
        extra={`${total} fornecedor(es) no total`}
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
