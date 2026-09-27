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
import { AGING_BUCKET_LABELS, PAYABLE_STATUS_LABELS } from '../../financial-ui/labels';
import { sliceTablePage, tablePageCount } from '../../financial-ui/table-slice';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { listPayables } from '../api/finance-api';
import { mapFinanceErrorToMessage } from '../api/finance-error-messages';
import { FinanceStatusBadge } from '../components/FinanceStatusBadge';
import { PayablesDecisionStrip } from '../components/PayablesDecisionStrip';
import type { PayableDetail } from '../types/finance.types';

export function PayablesListPage() {
  const [statusFilter, setStatusFilter] = useState('');
  const [pageNumber, setPageNumber] = useState(1);
  const loader = useCallback((signal?: AbortSignal) => listPayables(signal), []);
  const { state, reload } = useBackofficeQuery<PayableDetail[]>({
    loader,
    mapError: mapFinanceErrorToMessage,
  });

  const gate = renderQueryGate(
    'Contas a pagar',
    'Carregando contas a pagar…',
    'Você não tem permissão para listar contas a pagar.',
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
        title="Contas a pagar"
        description="Aging e saldo restante são os informados pelo servidor."
      />
      <PayablesDecisionStrip items={state.data} />
      <FilterCard>
        <label className={filterLabelClass} htmlFor="payable-status-filter">
          Status
        </label>
        <Select
          id="payable-status-filter"
          className={`${filterControlClass} max-w-xs`}
          value={statusFilter}
          onChange={(event) => {
            setStatusFilter(event.target.value);
            setPageNumber(1);
          }}
        >
          <option value="">Todos</option>
          {Object.entries(PAYABLE_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </FilterCard>

      {filtered.length === 0 ? (
        <EmptyState title="Nenhum título a pagar" description="Não há contas a pagar visíveis para o filtro." />
      ) : (
        <>
          <ModuleTableCard>
            <table className={moduleTableClass} aria-label="Lista de contas a pagar">
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
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Aging
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
                      <ModuleTableLink to={`/app/finance/payables/${item.id}`}>
                        {item.externalReference ?? item.origin.reference ?? item.id}
                      </ModuleTableLink>
                    </td>
                    <td className={moduleTableCellClass}>
                      <DateTime value={item.dueDate} mode="date" />
                    </td>
                    <td className={moduleTableCellClass}>
                      <FinanceStatusBadge status={item.status} labels={PAYABLE_STATUS_LABELS} />
                    </td>
                    <td className={moduleTableCellClass}>
                      <FinanceStatusBadge status={item.agingBucket} labels={AGING_BUCKET_LABELS} />
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
