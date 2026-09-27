import { useCallback, useEffect, useState } from 'react';
import { FilterCard, ModuleDeniedState, ModuleErrorState, ModuleLoadingState, ModulePage, ModulePageHeader, ModulePagination, ModulePrimaryLink, ModuleTableCard, ModuleTableLink, filterControlClass, filterLabelClass, moduleTableCellClass, moduleTableClass, moduleTableHeadClass, moduleTableHeaderCellClass, moduleTableRowClass } from '../../ui/module-layout';
import { BackofficeApiError } from '../../financial-ui/enterprise-api';
import { formatCnpjDisplay } from '../../clients/utils/format-cnpj';
import { FinanceStatusBadge } from '../../finance/components/FinanceStatusBadge';
import { SUPPLIER_STATUS_LABELS } from '../../financial-ui/labels';
import { mapSupplierErrorToMessage } from '../api/supplier-error-messages';
import { listSuppliers } from '../api/suppliers-api';
import type { SupplierSummary } from '../types/supplier.types';

const PAGE_SIZE = 20;

type ListState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error'; message: string; retryable: boolean }
  | { phase: 'ready'; items: SupplierSummary[]; offset: number; hasMore: boolean; total: number };

export function SuppliersListPage() {
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'ACTIVE' | 'INACTIVE'>('');
  const [listState, setListState] = useState<ListState>({ phase: 'loading' });

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
      <ModulePage>
        <ModuleLoadingState title="Fornecedores" message="Carregando Fornecedores…" />
      </ModulePage>
    );
  }

  if (listState.phase === 'denied') {
    return (
      <ModulePage>
        <ModuleDeniedState
          title="Fornecedores"
          message="Você não tem permissão para listar Fornecedores."
        />
      </ModulePage>
    );
  }

  if (listState.phase === 'error') {
    return (
      <ModulePage>
        <ModuleErrorState
          title="Fornecedores"
          message={listState.message}
          retryable={listState.retryable}
          onRetry={() => void loadPage(0)}
        />
      </ModulePage>
    );
  }

  const { items, offset, hasMore, total } = listState;
  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <ModulePage>
      <ModulePageHeader
        title="Fornecedores"
        description="Lista de fornecedores por razão social, nome fantasia e CNPJ."
        action={<ModulePrimaryLink to="/app/suppliers/new">Novo fornecedor</ModulePrimaryLink>}
      />

      <FilterCard>
        <form
          className="flex flex-wrap items-end gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setAppliedQuery(query.trim());
          }}
        >
          <div>
            <label className={filterLabelClass} htmlFor="supplier-search">
              Buscar
            </label>
            <input
              id="supplier-search"
              className={`${filterControlClass} w-72`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Razão social, nome fantasia ou CNPJ"
              type="search"
            />
          </div>
          <div>
            <label className={filterLabelClass} htmlFor="supplier-status-filter">
              Status
            </label>
            <select
              id="supplier-status-filter"
              className={`${filterControlClass} max-w-xs`}
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as '' | 'ACTIVE' | 'INACTIVE')}
            >
              <option value="">Todos</option>
              <option value="ACTIVE">Ativos</option>
              <option value="INACTIVE">Inativos</option>
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
          Nenhum fornecedor encontrado para os filtros selecionados.
        </p>
      ) : (
        <ModuleTableCard>
          <table className={moduleTableClass} aria-label="Lista de Fornecedores">
            <thead className={moduleTableHeadClass}>
              <tr>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Fornecedor
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  CNPJ
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Condição de pagamento
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Moeda
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((supplier) => (
                <tr key={supplier.id} className={moduleTableRowClass}>
                  <td className={moduleTableCellClass}>
                    <ModuleTableLink to={`/app/suppliers/${supplier.id}`}>
                      {supplier.tradeName ?? supplier.legalName}
                    </ModuleTableLink>
                    {supplier.tradeName ? (
                      <span className="block text-xs text-gray-500">{supplier.legalName}</span>
                    ) : null}
                  </td>
                  <td className={`${moduleTableCellClass} font-mono tabular-nums text-gray-600`}>
                    {formatCnpjDisplay(supplier.taxId)}
                  </td>
                  <td className={moduleTableCellClass}>{supplier.paymentTerms ?? '—'}</td>
                  <td className={moduleTableCellClass}>{supplier.currencyCode}</td>
                  <td className={moduleTableCellClass}>
                    <FinanceStatusBadge status={supplier.status} labels={SUPPLIER_STATUS_LABELS} />
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
        {total} fornecedor(es) no total.
      </p>
    </ModulePage>
  );
}
