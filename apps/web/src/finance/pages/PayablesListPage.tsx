import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DateTime, EmptyState, Money, Select } from '../../ui';
import { ModulePage, ModulePagination } from '../../ui/module-layout';
import {
  RecordStatusCell,
  RowActionCell,
  WorklistClearFilters,
  WorklistField,
  WorklistFilterBar,
  WorklistFooter,
  WorklistHeader,
  WorklistRowLink,
  WorklistStatePanel,
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
import { cn } from '../../ui/utils/cn';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { AGING_BUCKET_LABELS, PAYABLE_STATUS_LABELS } from '../../financial-ui/labels';
import { BACKOFFICE_TABLE_PAGE_SIZE } from '../../financial-ui/table-slice';
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
import { listPayables, type FinanceTitlePage } from '../api/finance-api';
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
  /*
   * PAGINACAO SERVER-SIDE, SIMETRICA A RECEBIVEIS: uma pagina por requisicao, com
   * `limit`/`offset`/`status` na consulta e `total`/`totalPages` contados no servidor sob o
   * mesmo escopo e filtro. O filtro do smart list vai ao servidor, nao mascara a pagina.
   */
  const offset = (pageNumber - 1) * BACKOFFICE_TABLE_PAGE_SIZE;
  const [statusForQuery, setStatusForQuery] = useState('');
  const loader = useCallback(
    (signal?: AbortSignal) =>
      listPayables(
        {
          limit: BACKOFFICE_TABLE_PAGE_SIZE,
          offset,
          status: statusForQuery || undefined,
          sortBy: 'due_date',
          sortDir: 'asc',
        },
        signal,
      ),
    [offset, statusForQuery],
  );
  const { state, reload, refreshing } = useBackofficeQuery<FinanceTitlePage<PayableDetail>>({
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

  /*
   * Status vai ao SERVIDOR (mesmo recorte dos dois lados do razao); aging segue local, porque
   * `agingBucket` e derivado do titulo e nao existe como filtro de lista na API.
   * O efeito fica ANTES dos retornos antecipados: hooks nao sao condicionais.
   */
  const statusFilter = smartList.filters.status ?? '';
  useEffect(() => {
    setPageNumber(1);
    setStatusForQuery(statusFilter);
  }, [statusFilter]);

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

  const page = state.data;
  const pageItems = page.items;
  const agingFilter = smartList.filters.agingBucket ?? '';
  const pageCount = Math.max(1, page.totalPages);
  const safePageNumber = Math.min(pageNumber, pageCount);

  const filtered = agingFilter
    ? pageItems.filter((item) => item.agingBucket === agingFilter)
    : pageItems;

  // Contadores reais derivados do payload carregado.
  const inFlight = pageItems.filter((item) => !['PAID', 'CANCELLED'].includes(item.status));
  const overdue = inFlight.filter((item) => item.status === 'OVERDUE');
  const notOverdue = inFlight.filter((item) => item.status !== 'OVERDUE');
  const aging90 = inFlight.filter((item) => item.agingBucket === '90_PLUS');
  const overdueTotal = overdue.reduce((sum, item) => sum + Number(item.remainingBalance), 0);
  const openTotal = notOverdue.reduce((sum, item) => sum + Number(item.remainingBalance), 0);

  const selectedRows = selection.selectedRows(filtered);
  const previewRow = pageItems.find((item) => item.id === previewId) ?? null;

  /**
   * CARTEIRA VAZIA — `200 + items=[]` e EMPTY DATA, nao negacao de acesso.
   *
   * O estado vazio e um ESTADO DA WORKLIST, nunca uma segunda estrutura de pagina. A primeira
   * versao desta correcao fazia RETORNO ANTECIPADO e trocava a tela inteira pelo painel: isso
   * apagava a barra de filtros, a barra de aging, as visoes salvas, os indicadores de drill-down
   * e a paginacao — o operador perdia os controles justamente quando precisava deles para
   * entender o recorte. Contas a pagar e Contas a receber passavam a ter DUAS gramaticas: uma
   * com dados, outra sem.
   *
   * Agora a pagina renderiza SEMPRE a mesma estrutura e so o CORPO decide entre tabela e painel.
   *
   * `page.total` conta o recorte ATIVO; por isso o painel distingue "carteira sem obrigacoes" de
   * "nada nesta visao" — o segundo caso ja tem o proprio estado humano dentro da tabela.
   */
  const portfolioEmpty = page.total === 0 && !smartList.isFiltered;

  return (
    <ModulePage>
      <WorklistHeader
        title="Contas a pagar"
        count={page.total}
        context="Aging e saldo restante são os informados pelo servidor. Esta tela não recalcula obrigações."
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

      {/* FILTROS EM UMA LINHA — mesma gramatica densa dos recebiveis. */}
      <WorklistFilterBar>
        <WorklistField label="Status" htmlFor="payable-status-filter">
          <Select
            id="payable-status-filter"
            className={cn(worklistSelectClass, 'cursor-pointer')}
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
        </WorklistField>

        <WorklistField label="Aging" htmlFor="payable-aging-filter">
          <Select
            id="payable-aging-filter"
            className={cn(worklistSelectClass, 'cursor-pointer')}
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
        </WorklistField>

        <WorklistClearFilters
          visible={smartList.isFiltered}
          onClick={() => {
            smartList.clearFilters();
            setPageNumber(1);
          }}
        />
      </WorklistFilterBar>

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

      {/*
        CORPO DA WORKLIST — a tabela e o estado vazio ocupam o MESMO lugar. A pagina em volta
        (cabecalho, indicadores, filtros, aging, visoes salvas, paginacao) e sempre a mesma.
      */}
      {filtered.length === 0 ? (
        portfolioEmpty ? (
          <WorklistStatePanel
            title="Nenhuma obrigação a pagar registrada."
            description="As obrigações nascem da compra: quando uma nota de fornecedor é registrada, o título aparece aqui com vencimento, aging, saldo e situação. Nada foi somado nem estimado nesta tela."
            action={
              <Link
                to="/app/procurement"
                className="text-xs font-semibold text-brand-700 no-underline"
              >
                Ver compras
              </Link>
            }
          />
        ) : (
          <EmptyState
            title={smartList.isFiltered ? 'Nenhum título nesta visão' : 'Nenhum título a pagar'}
            description={
              smartList.isFiltered
                ? 'Nenhum título corresponde ao recorte atual. Ajuste o filtro ou limpe a visão para ver todas as obrigações.'
                : 'Não há contas a pagar visíveis para o seu acesso.'
            }
          />
        )
      ) : (
        <>
          <div className={worklistTableCardClass}>
            <table className={worklistTableClass} aria-label="Lista de contas a pagar">
              <thead>
                <tr>
                  <th scope="col" className={cn(worklistHeadCellClass, 'w-8')}>
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
                  <th scope="col" className={cn(worklistHeadCellClass, 'w-16 text-right')}>
                    Ação
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((item) => (
                  <tr key={item.id} className={worklistRowClass}>
                    {/* Celula interativa FORA do alcance do link esticado da linha. */}
                    <td className={cn(worklistCellClass, 'z-[1] w-8')}>
                      <input
                        type="checkbox"
                        aria-label={`Selecionar ${
                          item.externalReference ?? item.origin.reference ?? item.id
                        }`}
                        checked={selection.isSelected(item.id)}
                        onChange={() => selection.toggle(item.id)}
                      />
                    </td>
                    <td className={worklistCellClass}>
                      <WorklistRowLink href={`/app/finance/payables/${item.id}`}>
                        {item.externalReference ?? item.origin.reference ?? item.id}
                      </WorklistRowLink>
                      <p className="text-[11px] text-gray-500">Origem: {item.origin.reference}</p>
                    </td>
                    <td className={worklistCellRaisedClass}>
                      <DateTime value={item.dueDate} mode="date" />
                    </td>
                    <td className={worklistCellRaisedClass}>
                      <RecordStatusCell
                        accent={item.status === 'OVERDUE' ? 'critical' : 'none'}
                        badge={<FinanceStatusBadge status={item.status} labels={PAYABLE_STATUS_LABELS} />}
                        context={item.status === 'OVERDUE' ? 'Exige decisão de pagamento' : null}
                      />
                    </td>
                    <td className={worklistCellRaisedClass}>
                      <FinanceStatusBadge status={item.agingBucket} labels={AGING_BUCKET_LABELS} />
                    </td>
                    <td className={worklistNumericCellClass}>
                      <Money
                        value={item.remainingBalance}
                        currencyCode={item.currencyCode}
                        emphasis
                      />
                    </td>
                    <RowActionCell className="w-16">
                      <button
                        type="button"
                        className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        onClick={() => setPreviewId(item.id)}
                        aria-label={`Prévia de ${
                          item.externalReference ?? item.origin.reference ?? item.id
                        }`}
                      >
                        Prévia
                      </button>
                    </RowActionCell>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <WorklistFooter
            rangeLabel={
              <span aria-live="polite">
                Página {safePageNumber} de {pageCount} · {filtered.length}{' '}
                {filtered.length === 1 ? 'título' : 'títulos'} no recorte atual
              </span>
            }
            extra={
              <>
                {statusFilter
                  ? `status: ${PAYABLE_STATUS_LABELS[statusFilter] ?? statusFilter}`
                  : null}
                {agingFilter ? ` · aging: ${AGING_BUCKET_LABELS[agingFilter] ?? agingFilter}` : ''}
                {overdue.length > 0 ? ` · ${overdue.length} vencido(s)` : ''}
                {refreshing ? ' · atualizando…' : ''}
              </>
            }
          >
            <ModulePagination
              pageNumber={safePageNumber}
              onPrevious={() => setPageNumber((current) => Math.max(1, current - 1))}
              onNext={() => setPageNumber((current) => Math.min(pageCount, current + 1))}
              previousDisabled={safePageNumber <= 1}
              nextDisabled={safePageNumber >= pageCount}
            />
          </WorklistFooter>
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
      className={numeric ? worklistNumericHeadCellClass : worklistHeadCellClass}
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
