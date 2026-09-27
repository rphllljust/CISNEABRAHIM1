import { useCallback, useMemo, useState } from 'react';
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
import {
  BulkActionBar,
  ContextDrawer,
  DrilldownMetric,
  DrilldownRow,
  SavedViewsBar,
  exportSelectionToCsv,
  useSelection,
  useSmartList,
  type ContextPreviewBody,
} from '../../operator';
import { listPayables } from '../api/finance-api';
import { mapFinanceErrorToMessage } from '../api/finance-error-messages';
import { FinanceStatusBadge } from '../components/FinanceStatusBadge';
import { PAYABLES_ALLOWED_FILTERS, PAYABLES_BUILT_IN_VIEWS } from './finance-smart-list';
import type { PayableDetail } from '../types/finance.types';

const SCOPE = 'finance.payables';

/**
 * Contas a pagar — MESA DE TRABALHO.
 *
 * Aging, saldo e status vêm do servidor. Esta tela não recalcula aging, não
 * projeta caixa e não decide pagamento.
 *
 * Liquidação, aprovação e cancelamento em lote estão PARK: são transições que
 * dependem de aprovação, segregação de funções e idempotência por título. O bulk
 * daqui só organiza trabalho (exportar selecionados e abrir prévia).
 */
export function PayablesListPage() {
  const [pageNumber, setPageNumber] = useState(1);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const loader = useCallback((signal?: AbortSignal) => listPayables(signal), []);
  const { state, reload, refreshing } = useBackofficeQuery<PayableDetail[]>({
    loader,
    mapError: mapFinanceErrorToMessage,
  });

  const sortAccessors = useMemo(
    () => ({
      externalReference: (row: PayableDetail) => row.externalReference ?? row.origin.reference ?? row.id,
      dueDate: (row: PayableDetail) => new Date(row.dueDate).getTime(),
      status: (row: PayableDetail) => row.status,
      agingBucket: (row: PayableDetail) => row.agingBucket,
      principal: (row: PayableDetail) => Number(row.principal),
      remainingBalance: (row: PayableDetail) => Number(row.remainingBalance),
    }),
    [],
  );

  const smartList = useSmartList<PayableDetail>({
    scope: SCOPE,
    builtInViews: PAYABLES_BUILT_IN_VIEWS,
    allowedFilters: PAYABLES_ALLOWED_FILTERS,
    urlSync: true,
    initialSort: { key: 'dueDate', direction: 'asc' },
    sortAccessors,
  });

  const selection = useSelection<PayableDetail>({ getId: (row) => row.id });

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

  const all = state.data;
  const statusFilter = smartList.filters.status ?? '';
  const agingFilter = smartList.filters.agingBucket ?? '';
  const filtered = smartList.sortRows(
    all.filter(
      (item) =>
        (statusFilter ? item.status === statusFilter : true) &&
        (agingFilter ? item.agingBucket === agingFilter : true),
    ),
  );
  const pageCount = tablePageCount(filtered.length);
  const safePageNumber = Math.min(pageNumber, pageCount);
  const pageItems = sliceTablePage(filtered, safePageNumber);

  // Contadores reais derivados do payload carregado.
  const inFlight = all.filter((item) => !['PAID', 'CANCELLED'].includes(item.status));
  const overdue = inFlight.filter((item) => item.status === 'OVERDUE');
  const notOverdue = inFlight.filter((item) => item.status !== 'OVERDUE');
  const aging90 = inFlight.filter((item) => item.agingBucket === '90_PLUS');
  const overdueTotal = overdue.reduce((sum, item) => sum + Number(item.remainingBalance), 0);
  const openTotal = notOverdue.reduce((sum, item) => sum + Number(item.remainingBalance), 0);

  const selectedRows = selection.selectedRows(filtered);
  const previewRow = all.find((item) => item.id === previewId) ?? null;

  return (
    <ModulePage>
      <ModulePageHeader
        title="Contas a pagar"
        description="Aging e saldo restante são os informados pelo servidor. Esta tela não recalcula obrigações."
      />

      {/* DRILL-DOWN: todo indicador abre a lista filtrada que o originou. */}
      <DrilldownRow>
        <DrilldownMetric
          label="Vencidos"
          value={overdue.length}
          hint={`${formatCurrency(overdueTotal)} · ver lista filtrada`}
          tone={overdue.length > 0 ? 'critical' : 'neutral'}
          to="/app/finance/payables?status=OVERDUE"
        />
        <DrilldownMetric
          label="A vencer"
          value={notOverdue.length}
          hint={`${formatCurrency(openTotal)} · ver lista filtrada`}
          tone="info"
          to="/app/finance/payables?status=OPEN"
        />
        <DrilldownMetric
          label="Aging 90+"
          value={aging90.length}
          hint="ver lista filtrada"
          tone={aging90.length > 0 ? 'warning' : 'neutral'}
          muted={aging90.length === 0}
          to="/app/finance/payables?agingBucket=90_PLUS"
        />
        <DrilldownMetric
          label="Obrigações em aberto"
          value={inFlight.length}
          hint={`${formatCurrency(overdueTotal + openTotal)} sob acompanhamento`}
          to="/app/finance/payables"
        />
      </DrilldownRow>

      <FilterCard>
        <label className={filterLabelClass} htmlFor="payable-status-filter">
          Status
        </label>
        <Select
          id="payable-status-filter"
          className={`${filterControlClass} max-w-xs`}
          value={statusFilter}
          onChange={(event) => {
            smartList.setFilter('status', event.target.value);
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

        <label className={filterLabelClass} htmlFor="payable-aging-filter">
          Aging
        </label>
        <Select
          id="payable-aging-filter"
          className={`${filterControlClass} max-w-xs`}
          value={agingFilter}
          onChange={(event) => {
            smartList.setFilter('agingBucket', event.target.value);
            setPageNumber(1);
          }}
        >
          <option value="">Todos</option>
          {Object.entries(AGING_BUCKET_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>

        {smartList.isFiltered ? (
          <button
            type="button"
            className="ml-2 self-end rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
            onClick={() => {
              smartList.clearFilters();
              setPageNumber(1);
            }}
          >
            Limpar filtros
          </button>
        ) : null}
      </FilterCard>

      <SavedViewsBar
        views={smartList.savedViews.views}
        builtInViews={smartList.savedViews.builtInViews}
        activeViewId={smartList.activeViewId}
        onApply={(view) => {
          smartList.applyView(view);
          setPageNumber(1);
        }}
        onSave={smartList.savedViews.saveView}
        onRename={smartList.savedViews.renameView}
        onRemove={smartList.savedViews.removeView}
        currentConfig={smartList.currentConfig}
        canSave={smartList.isFiltered}
        allLabel="Tudo"
      />

      <BulkActionBar
        count={selection.count}
        visibleCount={filtered.length}
        onClear={selection.clear}
        onSelectAllVisible={() => selection.selectAll(filtered)}
        parkedNote="Pagamento, aprovação e cancelamento em lote continuam PARK: exigem aprovação, segregação de funções e idempotência por título. A ação em lote daqui apenas organiza o trabalho."
        actions={[
          {
            id: 'export',
            label: 'Exportar selecionados (CSV)',
            run: () =>
              exportSelectionToCsv(
                'contas-a-pagar-selecionadas.csv',
                ['Referência', 'Origem', 'Vencimento', 'Status', 'Aging', 'Saldo', 'Moeda'],
                selectedRows.map((row) => [
                  row.externalReference ?? row.origin.reference ?? row.id,
                  row.origin.reference,
                  row.dueDate,
                  PAYABLE_STATUS_LABELS[row.status] ?? row.status,
                  AGING_BUCKET_LABELS[row.agingBucket] ?? row.agingBucket,
                  row.remainingBalance,
                  row.currencyCode,
                ]),
              ),
          },
          {
            id: 'preview-single',
            label: 'Abrir prévia',
            disabled: selectedRows.length !== 1,
            disabledReason: 'Selecione exatamente um título para abrir a prévia.',
            run: () => {
              const [only] = selectedRows;
              if (only) {
                setPreviewId(only.id);
              }
            },
          },
        ]}
      />

      {filtered.length === 0 ? (
        <EmptyState
          title={smartList.isFiltered ? 'Nenhum título nesta visão' : 'Nenhum título a pagar'}
          description={
            smartList.isFiltered
              ? 'Nenhum título corresponde ao recorte atual. Ajuste o filtro ou limpe a visão para ver todas as obrigações.'
              : 'Não há contas a pagar visíveis para o seu acesso.'
          }
        />
      ) : (
        <>
          <p className="mb-2 text-xs text-gray-500" aria-live="polite">
            {filtered.length} {filtered.length === 1 ? 'título' : 'títulos'} no recorte atual
            {statusFilter
              ? ` · status: ${PAYABLE_STATUS_LABELS[statusFilter] ?? statusFilter}`
              : ''}
            {agingFilter ? ` · aging: ${AGING_BUCKET_LABELS[agingFilter] ?? agingFilter}` : ''}
            {overdue.length > 0 ? ` · ${overdue.length} vencido(s)` : ''}
            {refreshing ? ' · atualizando…' : ''}
          </p>
          <ModuleTableCard>
            <table className={moduleTableClass} aria-label="Lista de contas a pagar">
              <thead className={moduleTableHeadClass}>
                <tr>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    <span className="cisne-sr-only">Selecionar</span>
                  </th>
                  <SortableHead
                    label="Título"
                    sortKey="externalReference"
                    sort={smartList.sort}
                    onToggle={smartList.toggleSort}
                  />
                  <SortableHead
                    label="Vencimento"
                    sortKey="dueDate"
                    sort={smartList.sort}
                    onToggle={smartList.toggleSort}
                  />
                  <SortableHead
                    label="Status"
                    sortKey="status"
                    sort={smartList.sort}
                    onToggle={smartList.toggleSort}
                  />
                  <SortableHead
                    label="Aging"
                    sortKey="agingBucket"
                    sort={smartList.sort}
                    onToggle={smartList.toggleSort}
                  />
                  <SortableHead
                    label="Saldo"
                    sortKey="remainingBalance"
                    sort={smartList.sort}
                    onToggle={smartList.toggleSort}
                    numeric
                  />
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Ação
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((item) => (
                  <tr key={item.id} className={moduleTableRowClass}>
                    <td className={moduleTableCellClass}>
                      <input
                        type="checkbox"
                        aria-label={`Selecionar ${
                          item.externalReference ?? item.origin.reference ?? item.id
                        }`}
                        checked={selection.isSelected(item.id)}
                        onChange={() => selection.toggle(item.id)}
                      />
                    </td>
                    <td className={moduleTableCellClass}>
                      <ModuleTableLink to={`/app/finance/payables/${item.id}`}>
                        {item.externalReference ?? item.origin.reference ?? item.id}
                      </ModuleTableLink>
                      <p className="mt-0.5 text-[11px] text-gray-500">
                        Origem: {item.origin.reference}
                      </p>
                    </td>
                    <td className={moduleTableCellClass}>
                      <DateTime value={item.dueDate} mode="date" />
                    </td>
                    <td className={moduleTableCellClass}>
                      <div className="flex flex-col items-start gap-1">
                        <FinanceStatusBadge status={item.status} labels={PAYABLE_STATUS_LABELS} />
                        {item.status === 'OVERDUE' ? (
                          <span className="text-[11px] font-medium text-red-700">
                            Exige decisão de pagamento
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className={moduleTableCellClass}>
                      <FinanceStatusBadge
                        status={item.agingBucket}
                        labels={AGING_BUCKET_LABELS}
                      />
                    </td>
                    <td className={`${moduleTableCellClass} text-right`}>
                      <Money
                        value={item.remainingBalance}
                        currencyCode={item.currencyCode}
                        emphasis
                      />
                    </td>
                    <td className={moduleTableCellClass}>
                      <button
                        type="button"
                        className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        onClick={() => setPreviewId(item.id)}
                        aria-label={`Prévia de ${
                          item.externalReference ?? item.origin.reference ?? item.id
                        }`}
                      >
                        Prévia
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ModuleTableCard>
          <ModulePagination
            pageNumber={safePageNumber}
            rangeLabel={`Página ${safePageNumber} de ${pageCount} · ${filtered.length} títulos`}
            onPrevious={() => setPageNumber((current) => Math.max(1, current - 1))}
            onNext={() => setPageNumber((current) => Math.min(pageCount, current + 1))}
            previousDisabled={safePageNumber <= 1}
            nextDisabled={safePageNumber >= pageCount}
          />
        </>
      )}

      <ContextDrawer
        open={previewRow !== null}
        title="Contexto da obrigação"
        preview={previewRow ? buildPayablePreview(previewRow) : null}
        onClose={() => setPreviewId(null)}
      />
    </ModulePage>
  );
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function sortIndicator(
  sort: { key: string | null; direction: 'asc' | 'desc' },
  key: string,
): string {
  if (sort.key !== key) {
    return '';
  }
  return sort.direction === 'asc' ? '▲' : '▼';
}

function SortableHead({
  label,
  sortKey,
  sort,
  onToggle,
  numeric = false,
}: {
  label: string;
  sortKey: string;
  sort: { key: string | null; direction: 'asc' | 'desc' };
  onToggle: (key: string) => void;
  numeric?: boolean;
}) {
  const active = sort.key === sortKey;
  return (
    <th
      scope="col"
      className={numeric ? `${moduleTableHeaderCellClass} text-right` : moduleTableHeaderCellClass}
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className="font-semibold tracking-wider uppercase"
        onClick={() => onToggle(sortKey)}
      >
        {label} <span aria-hidden>{sortIndicator(sort, sortKey)}</span>
      </button>
    </th>
  );
}

/**
 * Prévia lateral com o payload já carregado.
 *
 * Não há BusinessChain aqui de propósito: o payload de contas a pagar expõe
 * apenas `origin` (kind/id/reference) e `counterpartyId`, sem os degraus
 * intermediários da cadeia comercial. Montar uma cadeia exigiria inventar
 * vínculo — o que está PARK até o backend expor a relação.
 */
export function buildPayablePreview(row: PayableDetail): ContextPreviewBody {
  return {
    identifier: row.externalReference ?? row.origin.reference ?? row.id,
    subtitle: `Origem: ${row.origin.kind} · ${row.origin.reference}`,
    status: <FinanceStatusBadge status={row.status} labels={PAYABLE_STATUS_LABELS} />,
    facts: [
      { label: 'Vencimento', value: <DateTime value={row.dueDate} mode="date" /> },
      { label: 'Principal', value: <Money value={row.principal} currencyCode={row.currencyCode} /> },
      {
        label: 'Saldo',
        value: <Money value={row.remainingBalance} currencyCode={row.currencyCode} emphasis />,
        emphasis: true,
      },
      { label: 'Pago', value: <Money value={row.paidAmount} currencyCode={row.currencyCode} /> },
      {
        label: 'Aging',
        value: AGING_BUCKET_LABELS[row.agingBucket] ?? row.agingBucket,
      },
      { label: 'Centro de custo', value: row.costCenter.code },
      { label: 'Parcelas', value: String(row.installments.length) },
      { label: 'Pagamentos', value: String(row.payments.length) },
      { label: 'Condição de pagamento', value: row.paymentTerms },
      { label: 'Criado em', value: <DateTime value={row.createdAt} mode="datetime" /> },
      { label: 'Atualizado em', value: <DateTime value={row.updatedAt} mode="datetime" /> },
    ],
    relations: [
      { label: 'Contraparte', value: row.counterpartyId },
      { label: 'Origem', value: row.origin.reference },
    ],
    nextAction: {
      label:
        row.status === 'OVERDUE'
          ? 'Abrir a obrigação e decidir o pagamento'
          : 'Abrir a obrigação para acompanhar vencimento',
      href: `/app/finance/payables/${row.id}`,
    },
    detailHref: `/app/finance/payables/${row.id}`,
    detailLabel: 'Abrir obrigação completa',
  };
}
