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
import { RECEIVABLE_STATUS_LABELS } from '../../financial-ui/labels';
import { sliceTablePage, tablePageCount } from '../../financial-ui/table-slice';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import {
  BulkActionBar,
  BusinessChain,
  ContextDrawer,
  DrilldownMetric,
  DrilldownRow,
  SavedViewsBar,
  exportSelectionToCsv,
  useSelection,
  useSmartList,
  type ChainLink,
  type ContextPreviewBody,
} from '../../operator';
import { listReceivables } from '../api/finance-api';
import { mapFinanceErrorToMessage } from '../api/finance-error-messages';
import { FinanceStatusBadge } from '../components/FinanceStatusBadge';
import { RECEIVABLES_ALLOWED_FILTERS, RECEIVABLES_BUILT_IN_VIEWS } from './finance-smart-list';
import type { ReceivableDetail } from '../types/finance.types';

const SCOPE = 'finance.receivables';

/**
 * Contas a receber — MESA DE TRABALHO.
 *
 * Responde o que está pendente, o que está atrasado, o que o operador pode fazer
 * e qual registro precisa dele. Todos os números vêm do payload já autorizado;
 * a tela não recalcula título, saldo nem aging.
 *
 * Bulk aqui é deliberadamente limitado: exportar selecionados e abrir registro.
 * Liquidar, baixar, cancelar ou reconciliar em massa estão PARK — exigem prova de
 * segregação de funções e idempotência por título.
 */
export function ReceivablesListPage() {
  const [pageNumber, setPageNumber] = useState(1);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const loader = useCallback((signal?: AbortSignal) => listReceivables(signal), []);
  const { state, reload, refreshing } = useBackofficeQuery<ReceivableDetail[]>({
    loader,
    mapError: mapFinanceErrorToMessage,
  });

  const sortAccessors = useMemo(
    () => ({
      externalReference: (row: ReceivableDetail) => row.externalReference ?? row.id,
      dueDate: (row: ReceivableDetail) => new Date(row.dueDate).getTime(),
      status: (row: ReceivableDetail) => row.status,
      principal: (row: ReceivableDetail) => Number(row.principal),
      remainingBalance: (row: ReceivableDetail) => Number(row.remainingBalance),
    }),
    [],
  );

  const smartList = useSmartList<ReceivableDetail>({
    scope: SCOPE,
    builtInViews: RECEIVABLES_BUILT_IN_VIEWS,
    allowedFilters: RECEIVABLES_ALLOWED_FILTERS,
    urlSync: true,
    initialSort: { key: 'dueDate', direction: 'asc' },
    sortAccessors,
  });

  const selection = useSelection<ReceivableDetail>({ getId: (row) => row.id });

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

  const all = state.data;
  const statusFilter = smartList.filters.status ?? '';
  const filtered = smartList.sortRows(
    all.filter((item) => (statusFilter ? item.status === statusFilter : true)),
  );
  const pageCount = tablePageCount(filtered.length);
  const safePageNumber = Math.min(pageNumber, pageCount);
  const pageItems = sliceTablePage(filtered, safePageNumber);

  // Contadores reais — derivados do payload carregado, nunca estimados.
  const inFlight = all.filter((item) => !['PAID', 'CANCELLED'].includes(item.status));
  const overdue = inFlight.filter((item) => item.status === 'OVERDUE');
  const notOverdue = inFlight.filter((item) => item.status !== 'OVERDUE');
  const overdueTotal = overdue.reduce((sum, item) => sum + Number(item.remainingBalance), 0);
  const openTotal = notOverdue.reduce((sum, item) => sum + Number(item.remainingBalance), 0);

  const selectedRows = selection.selectedRows(filtered);
  const previewRow = all.find((item) => item.id === previewId) ?? null;

  return (
    <ModulePage>
      <ModulePageHeader
        title="Contas a receber"
        description="Saldos e status são os informados pelo servidor. Esta tela não recalcula títulos."
      />

      {/*
        DRILL-DOWN: cada indicador leva à lista já filtrada que o produziu.
        Nenhum número importante fica órfão.
      */}
      <DrilldownRow>
        <DrilldownMetric
          label="Vencidos"
          value={overdue.length}
          hint={`${formatCurrency(overdueTotal)} · ver lista filtrada`}
          tone={overdue.length > 0 ? 'critical' : 'neutral'}
          to="/app/finance/receivables?status=OVERDUE"
        />
        <DrilldownMetric
          label="A vencer"
          value={notOverdue.length}
          hint={`${formatCurrency(openTotal)} · ver lista filtrada`}
          tone="info"
          to="/app/finance/receivables?status=OPEN"
        />
        <DrilldownMetric
          label="Recebidos"
          value={all.filter((item) => item.status === 'PAID').length}
          hint="ver lista filtrada"
          to="/app/finance/receivables?status=PAID"
        />
        <DrilldownMetric
          label="Carteira em aberto"
          value={inFlight.length}
          hint={`${formatCurrency(overdueTotal + openTotal)} sob acompanhamento`}
          to="/app/finance/receivables"
        />
      </DrilldownRow>

      <FilterCard>
        <label className={filterLabelClass} htmlFor="receivable-status-filter">
          Status
        </label>
        <Select
          id="receivable-status-filter"
          className={`${filterControlClass} max-w-xs`}
          value={statusFilter}
          onChange={(event) => {
            smartList.setFilter('status', event.target.value);
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
        parkedNote="Liquidação, baixa e cancelamento em lote continuam PARK: exigem prova de segregação de funções e idempotência por título. A ação em lote daqui apenas organiza o trabalho."
        actions={[
          {
            id: 'export',
            label: 'Exportar selecionados (CSV)',
            run: () =>
              exportSelectionToCsv(
                'contas-a-receber-selecionadas.csv',
                ['Referência', 'Vencimento', 'Status', 'Principal', 'Saldo', 'Moeda'],
                selectedRows.map((row) => [
                  row.externalReference ?? row.id,
                  row.dueDate,
                  RECEIVABLE_STATUS_LABELS[row.status] ?? row.status,
                  row.principal,
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
          title={smartList.isFiltered ? 'Nenhum título nesta visão' : 'Nenhum título a receber'}
          description={
            smartList.isFiltered
              ? 'Nenhum título corresponde ao recorte atual. Ajuste o filtro ou limpe a visão para ver a carteira completa.'
              : 'Não há contas a receber visíveis para o seu acesso.'
          }
        />
      ) : (
        <>
          <p className="mb-2 text-xs text-gray-500" aria-live="polite">
            {filtered.length} {filtered.length === 1 ? 'título' : 'títulos'} no recorte atual
            {statusFilter
              ? ` · filtro: ${RECEIVABLE_STATUS_LABELS[statusFilter] ?? statusFilter}`
              : ''}
            {overdue.length > 0 ? ` · ${overdue.length} vencido(s)` : ''}
            {refreshing ? ' · atualizando…' : ''}
          </p>
          <ModuleTableCard>
            <table className={moduleTableClass} aria-label="Lista de contas a receber">
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
                    label="Principal"
                    sortKey="principal"
                    sort={smartList.sort}
                    onToggle={smartList.toggleSort}
                    numeric
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
                        aria-label={`Selecionar ${item.externalReference ?? item.id}`}
                        checked={selection.isSelected(item.id)}
                        onChange={() => selection.toggle(item.id)}
                      />
                    </td>
                    <td className={moduleTableCellClass}>
                      <ModuleTableLink to={`/app/finance/receivables/${item.id}`}>
                        {item.externalReference ?? item.id}
                      </ModuleTableLink>
                    </td>
                    <td className={moduleTableCellClass}>
                      <DateTime value={item.dueDate} mode="date" />
                    </td>
                    <td className={moduleTableCellClass}>
                      <div className="flex flex-col items-start gap-1">
                        <FinanceStatusBadge status={item.status} labels={RECEIVABLE_STATUS_LABELS} />
                        {item.status === 'OVERDUE' ? (
                          <span className="text-[11px] font-medium text-red-700">
                            Requer cobrança
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className={`${moduleTableCellClass} text-right`}>
                      <Money value={item.principal} currencyCode={item.currencyCode} />
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
                        aria-label={`Prévia de ${item.externalReference ?? item.id}`}
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
        title="Contexto do título"
        preview={previewRow ? buildReceivablePreview(previewRow) : null}
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
 * Cadeia empresarial montada SOMENTE com vínculos que já existem no payload
 * (`origin.serviceOrderId`, `origin.measurementId`, `clientId`). Nenhum degrau é
 * afirmado sem lastro: se um id não vier, o degrau não aparece.
 */
export function receivableChainLinks(row: ReceivableDetail): ChainLink[] {
  const origin = row.origin;
  const links: ChainLink[] = [];
  if (row.clientId) {
    links.push({ step: 'CLIENTE', label: row.clientId, href: `/app/clients/${row.clientId}` });
  }
  if (origin.serviceOrderId) {
    links.push({
      step: 'OS',
      label: origin.serviceOrderId,
      href: `/app/service-orders/${origin.serviceOrderId}`,
    });
  }
  if (origin.measurementId) {
    links.push({
      step: 'MEDICAO',
      label: origin.measurementId,
      href: `/app/service-orders/${origin.serviceOrderId}/measurement`,
    });
  }
  if (origin.billingRecordId) {
    links.push({
      step: 'FATURAMENTO',
      label: origin.billingRecordId,
      href: `/app/service-orders/${origin.serviceOrderId}/billing`,
    });
  }
  links.push({ step: 'RECEBIVEL', label: row.externalReference ?? row.id });
  return links;
}

/** Cadeia exibida onde o vínculo já está disponível. */
export function ReceivableChain({ row }: { row: ReceivableDetail }) {
  return <BusinessChain current="RECEBIVEL" links={receivableChainLinks(row)} />;
}

/**
 * Prévia lateral montada SOMENTE com o payload já recebido pela lista.
 * Se o detalhe completo exigisse API nova, aqui não faríamos: oferecemos o atalho.
 */
export function buildReceivablePreview(row: ReceivableDetail): ContextPreviewBody {
  const origin = row.origin;

  return {
    identifier: row.externalReference ?? row.id,
    subtitle: `Origem: ${origin.kind}`,
    status: <FinanceStatusBadge status={row.status} labels={RECEIVABLE_STATUS_LABELS} />,
    facts: [
      { label: 'Vencimento', value: <DateTime value={row.dueDate} mode="date" /> },
      { label: 'Principal', value: <Money value={row.principal} currencyCode={row.currencyCode} /> },
      {
        label: 'Saldo',
        value: <Money value={row.remainingBalance} currencyCode={row.currencyCode} emphasis />,
        emphasis: true,
      },
      { label: 'Recebido', value: <Money value={row.settledAmount} currencyCode={row.currencyCode} /> },
      { label: 'Parcelas', value: String(row.installments.length) },
      { label: 'Liquidações', value: String(row.settlements.length) },
      { label: 'Condição de pagamento', value: row.paymentTerms },
      { label: 'Criado em', value: <DateTime value={row.createdAt} mode="datetime" /> },
      { label: 'Atualizado em', value: <DateTime value={row.updatedAt} mode="datetime" /> },
    ],
    relations: [
      { label: 'Cliente', value: row.clientId, href: `/app/clients/${row.clientId}` },
      {
        label: 'Ordem de serviço',
        value: origin.serviceOrderId,
        href: `/app/service-orders/${origin.serviceOrderId}`,
      },
      { label: 'Documento de faturamento', value: origin.billingDocumentId },
    ],
    nextAction: {
      label:
        row.status === 'OVERDUE'
          ? 'Abrir o título e tratar a cobrança'
          : 'Abrir o título para registrar recebimento',
      href: `/app/finance/receivables/${row.id}`,
    },
    detailHref: `/app/finance/receivables/${row.id}`,
    detailLabel: 'Abrir título completo',
  };
}
