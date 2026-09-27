import { useCallback, useState } from 'react';
import { DateTime, EmptyState, Money, Select } from '../../ui';
import {
  FilterCard,
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
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { RECEIVABLE_STATUS_LABELS } from '../../financial-ui/labels';
import { sliceTablePage, tablePageCount } from '../../financial-ui/table-slice';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { listReceivables } from '../api/finance-api';
import { mapFinanceErrorToMessage } from '../api/finance-error-messages';
import { FinanceStatusBadge } from '../components/FinanceStatusBadge';
import { ReceivablesDecisionStrip } from '../components/ReceivablesDecisionStrip';
import type { ReceivableDetail } from '../types/finance.types';

export function ReceivablesListPage() {
  const [statusFilter, setStatusFilter] = useState('');
  const [pageNumber, setPageNumber] = useState(1);
  const loader = useCallback((signal?: AbortSignal) => listReceivables(signal), []);
  const { state, reload } = useBackofficeQuery<ReceivableDetail[]>({
    loader,
    mapError: mapFinanceErrorToMessage,
  });

  const gate = renderQueryGate(
    'Contas a receber',
    'Carregando contas a receber…',
    'Você não tem permissão para listar contas a receber.',
    state,
    () => void reload(),
  );
  if (gate) {
    return gate;
  }
  if (state.phase !== 'ready') {
    return null;
  }

  const filtered = state.data.filter((item) => (statusFilter ? item.status === statusFilter : true));
  const pageCount = tablePageCount(filtered.length);
  const pageItems = sliceTablePage(filtered, Math.min(pageNumber, pageCount));

  return (
    <ModulePage>
      <ModulePageHeader
        title="Contas a receber"
        description="Saldos e status são os informados pelo servidor. Esta tela não recalcula títulos."
      />
      <ReceivablesDecisionStrip items={state.data} />
      <FilterCard>
        <label className={filterLabelClass} htmlFor="receivable-status-filter">
          Status
        </label>
        <Select
          id="receivable-status-filter"
          className={`${filterControlClass} max-w-xs`}
          value={statusFilter}
          onChange={(event) => {
            setStatusFilter(event.target.value);
            setPageNumber(1);
          }}
        >
          <option value="">Todos</option>
          {Object.entries(RECEIVABLE_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </FilterCard>

      {filtered.length === 0 ? (
        <EmptyState
          title="Nenhum título a receber"
          description="Não há contas a receber visíveis para o filtro selecionado."
        />
      ) : (
        <>
          <ModuleTableCard>
            <table className={moduleTableClass} aria-label="Lista de contas a receber">
              <thead className={moduleTableHeadClass}>
                <tr>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Título
                  </th>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Vencimento
                  </th>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Status
                  </th>
                  <th scope="col" className={`${moduleTableHeaderCellClass} text-right`}>
                    Principal
                  </th>
                  <th scope="col" className={`${moduleTableHeaderCellClass} text-right`}>
                    Saldo
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((item) => (
                  <tr key={item.id} className={moduleTableRowClass}>
                    <td className={moduleTableCellClass}>
                      <ModuleTableLink to={`/app/finance/receivables/${item.id}`}>
                        {item.externalReference ?? item.id}
                      </ModuleTableLink>
                    </td>
                    <td className={moduleTableCellClass}>
                      <DateTime value={item.dueDate} mode="date" />
                    </td>
                    <td className={moduleTableCellClass}>
                      <FinanceStatusBadge status={item.status} labels={RECEIVABLE_STATUS_LABELS} />
                    </td>
                    <td className={`${moduleTableCellClass} text-right`}>
                      <Money value={item.principal} currencyCode={item.currencyCode} />
                    </td>
                    <td className={`${moduleTableCellClass} text-right`}>
                      <Money value={item.remainingBalance} currencyCode={item.currencyCode} emphasis />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ModuleTableCard>
          <ModulePagination
            pageNumber={Math.min(pageNumber, pageCount)}
            rangeLabel={`Página ${Math.min(pageNumber, pageCount)} de ${pageCount} · ${filtered.length} títulos`}
            onPrevious={() => setPageNumber((current) => Math.max(1, current - 1))}
            onNext={() => setPageNumber((current) => Math.min(pageCount, current + 1))}
            previousDisabled={pageNumber <= 1}
            nextDisabled={pageNumber >= pageCount}
          />
        </>
      )}
    </ModulePage>
  );
}
