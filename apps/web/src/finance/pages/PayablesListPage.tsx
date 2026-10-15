import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DateTime, Money } from '../../ui';
import { ModulePage, ModulePagination } from '../../ui/module-layout';
import {
  BulkActionBar,
  ContextDrawer,
  SavedViewsBar,
  exportSelectionToCsv,
  useSelection,
  useSmartList,
  type ContextPreviewBody,
} from '../../operator';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { WorklistHeader, worklistGroupClass } from '../../ui/enterprise-list';
import { AGING_BUCKET_LABELS, PAYABLE_STATUS_LABELS } from '../../financial-ui/labels';
import { BACKOFFICE_TABLE_PAGE_SIZE } from '../../financial-ui/table-slice';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { DynamicList, useEntitySchema } from '../../engine';
import {
  DynamicFilterBuilder,
  emptyFilterGroup,
  isFilterGroupActive,
  type FilterGroup,
} from '../../engine/DynamicFilterBuilder';
import { advancedFilterFromGroup } from '../../engine';
import {
  WorkspaceActiveFilters,
  WorkspaceBody,
  WorkspaceEmpty,
  WorkspacePane,
  WorkspacePaneHeader,
  WorkspaceSkeletonRows,
} from '../../ui/workspace-frame';
import { PAYABLE_TITLE_FILTER_SPECS } from './finance-title-filter-specs';
import {
  getPayablesSummary,
  listPayables,
  type FinanceTitlePage,
  type FinanceTitleSummary,
} from '../api/finance-api';
import { mapFinanceErrorToMessage } from '../api/finance-error-messages';
import { FinanceStatusBadge } from '../components/FinanceStatusBadge';
import {
  FinanceSituationStrip,
  formatSummaryAmounts,
  publishedCount,
} from '../components/FinanceSituation';
import { FinanceWorklistToolbar, financeControlClass } from '../components/FinanceWorklistToolbar';
import { PAYABLES_ALLOWED_FILTERS, PAYABLES_BUILT_IN_VIEWS } from './finance-smart-list';
import { payableEngineRow } from '../utils/finance-engine-rows';
import {
  FINANCE_DEFAULT_SORT,
  daysPastDue,
  dueLabel,
  overdueLabel,
  sortTitles,
  type FinanceSortState,
  type FinanceSortableTitle,
} from '../utils/finance-aging';
import type { PayableDetail } from '../types/finance.types';

const SCOPE = 'finance.payables';

/**
 * CONTAS A PAGAR — WORKLIST FINANCEIRA TIER-1.
 *
 * Mesmo padrao operacional de Contas a Receber, e deliberadamente o MESMO codigo: a unica diferenca
 * real entre as duas carteiras e o que o DTO publica. Aqui o titulo tem `agingBucket` PERSISTIDO e
 * `paidAmount`; la ele tem `settledAmount` e nao tem faixa. Todo o resto — busca no servidor, janela
 * de vencimento, ordenacao declarada, coluna de atraso, faixa de situacao, coluna de contexto — e a
 * mesma superficie, para que o operador nao reaprenda a tela ao trocar de lado do razao.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * AGING PERSISTIDO x ATRASO CALCULADO — as duas coisas, e sem confundi-las
 *
 * `agingBucket` e FATO DO DOMINIO: coluna do titulo, calculada e congelada pelo servidor, base das
 * visoes de sistema ("Aging 90+") e do aging agregado. Ele aparece na coluna de faixa e nas visoes,
 * e NUNCA e recalculado aqui.
 *
 * A coluna de ATRASO e outra leitura: dias corridos entre o vencimento persistido e hoje. Ela existe
 * porque "vencido" e um estado e a decisao de pagamento precisa da MAGNITUDE do atraso. E a mesma
 * excecao que a Central de trabalho ja afirma, e ela e dita como leitura humana — nao como faixa.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * O QUE NAO MUDOU
 *
 * - Nenhum agregado no navegador: a faixa de situacao le `/finance/payables/summary`.
 * - Status, busca e janela de vencimento vao ao SERVIDOR.
 * - O recorte de aging continua LOCAL, e a tela diz isso: o servidor nao aceita `agingBucket` como
 *   parametro de lista. Esconde-lo faria o operador supor que o conjunto foi recortado no dominio.
 * - Bulk continua PARK: pagamento, aprovacao e cancelamento em lote exigem aprovacao, segregacao de
 *   funcoes e idempotencia por titulo.
 */

type PayableSortable = FinanceSortableTitle & { row: PayableDetail };

function toSortable(row: PayableDetail): PayableSortable {
  return {
    row,
    dueDate: row.dueDate,
    reference: row.externalReference ?? row.origin.reference ?? null,
    amount: Number.isFinite(Number(row.principal)) ? Number(row.principal) : null,
    outstanding: Number.isFinite(Number(row.remainingBalance))
      ? Number(row.remainingBalance)
      : null,
    overdueDays: daysPastDue(row.dueDate),
    status: row.status,
  };
}

export function PayablesListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [pageNumber, setPageNumber] = useState(1);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filterGroup, setFilterGroup] = useState<FilterGroup>(() => emptyFilterGroup());
  const { schema } = useEntitySchema('payables');

  /*
   * RECORTE NA URL — a mesma regra de Recebiveis. O aging entra como parametro de URL porque, mesmo
   * sendo recorte LOCAL sobre a pagina, ele precisa sobreviver a refresh e ao drillback que a propria
   * tela publica (`?agingBucket=90_PLUS`).
   */
  const search = searchParams.get('q') ?? '';
  const dueFrom = searchParams.get('dueFrom') ?? '';
  const dueTo = searchParams.get('dueTo') ?? '';
  const statusForQuery = searchParams.get('status') ?? '';
  const agingFilter = searchParams.get('agingBucket') ?? '';

  const patchParams = useCallback(
    (patch: Record<string, string | null>) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(patch)) {
            if (value) next.set(key, value);
            else next.delete(key);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  /** Debounce de 300ms: `q` vai ao servidor e cada tecla nao pode virar uma consulta ao dominio. */
  const [searchDraft, setSearchDraft] = useState(search);
  useEffect(() => {
    if (searchDraft === search) {
      return;
    }
    const timer = setTimeout(() => {
      patchParams({ q: searchDraft || null });
      setPageNumber(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchDraft, search, patchParams]);

  useEffect(() => {
    setSearchDraft(search);
  }, [search]);

  useEffect(() => {
    setPageNumber(1);
  }, [dueFrom, dueTo, statusForQuery]);

  const [sort, setSort] = useState<FinanceSortState>(FINANCE_DEFAULT_SORT);

  const offset = (pageNumber - 1) * BACKOFFICE_TABLE_PAGE_SIZE;

  const advancedPayload = useMemo(
    () => advancedFilterFromGroup(filterGroup, PAYABLE_TITLE_FILTER_SPECS),
    [filterGroup],
  );

  const loader = useCallback(
    (signal?: AbortSignal) =>
      listPayables(
        {
          limit: BACKOFFICE_TABLE_PAGE_SIZE,
          offset,
          status: statusForQuery || undefined,
          q: search || undefined,
          dueFrom: dueFrom || undefined,
          dueTo: dueTo || undefined,
          advanced: advancedPayload,
          sortBy: 'due_date',
          sortDir: 'asc',
        },
        signal,
      ),
    [advancedPayload, offset, statusForQuery, search, dueFrom, dueTo],
  );
  const { state, reload, refreshing } = useBackofficeQuery<FinanceTitlePage<PayableDetail>>({
    loader,
    mapError: mapFinanceErrorToMessage,
  });

  const summaryLoader = useCallback(
    (signal?: AbortSignal) =>
      getPayablesSummary(
        {
          status: statusForQuery || undefined,
          q: search || undefined,
          dueFrom: dueFrom || undefined,
          dueTo: dueTo || undefined,
          advanced: advancedPayload,
        },
        signal,
      ),
    [statusForQuery, search, dueFrom, dueTo, advancedPayload],
  );
  const { state: summaryState } = useBackofficeQuery<FinanceTitleSummary>({
    loader: summaryLoader,
    mapError: mapFinanceErrorToMessage,
  });

  const smartList = useSmartList<PayableDetail>({
    scope: SCOPE,
    builtInViews: PAYABLES_BUILT_IN_VIEWS,
    allowedFilters: PAYABLES_ALLOWED_FILTERS,
    urlSync: true,
    initialSort: { key: 'dueDate', direction: 'asc' },
    sortAccessors: {
      externalReference: (row: PayableDetail) =>
        row.externalReference ?? row.origin.reference ?? row.id,
      dueDate: (row: PayableDetail) => new Date(row.dueDate).getTime(),
      status: (row: PayableDetail) => row.status,
      agingBucket: (row: PayableDetail) => row.agingBucket,
      principal: (row: PayableDetail) => Number(row.principal),
      remainingBalance: (row: PayableDetail) => Number(row.remainingBalance),
    },
  });

  const selection = useSelection<PayableDetail>({ getId: (row) => row.id });

  /*
   * ORDENACAO — o `useMemo` fica ANTES de qualquer retorno antecipado.
   * A ordem dos hooks e parte do contrato do React: um hook depois do `return gate` faria a contagem
   * mudar entre a renderizacao do gate e a da tela pronta.
   */
  const pageItems = state.phase === 'ready' ? state.data.items : [];

  /*
   * RECORTE DE AGING — LOCAL, e a tela DECLARA isso.
   * O servidor nao aceita `agingBucket` como parametro de lista; o smart list aplica a visao de
   * sistema sobre a pagina. Aplicar aqui mantem a mesma semantica das visoes salvas e deixa o
   * recorte visivel na URL e nos chips — em vez de esconder que o conjunto exibido e menor que o lido.
   */
  const agingScoped = useMemo(
    () => (agingFilter ? pageItems.filter((item) => item.agingBucket === agingFilter) : pageItems),
    [pageItems, agingFilter],
  );

  const ordered = useMemo(() => sortTitles(agingScoped.map(toSortable), sort), [agingScoped, sort]);
  const orderedRows = ordered.map((entry) => entry.row);

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

  const page = state.phase === 'ready' ? state.data : null;
  const summary = summaryState.phase === 'ready' ? summaryState.data : null;

  const rows = orderedRows.map(payableEngineRow);
  const selectedRows = selection.selectedRows(orderedRows);

  const previewRow = pageItems.find((item) => item.id === previewId) ?? null;

  const pageCount = page ? Math.max(1, page.totalPages) : 1;
  const safePageNumber = Math.min(pageNumber, pageCount);

  const hasActiveQuery = Boolean(search || dueFrom || dueTo || statusForQuery || agingFilter);
  const portfolioEmpty =
    page !== null &&
    page.total === 0 &&
    !smartList.isFiltered &&
    !hasActiveQuery &&
    !isFilterGroupActive(filterGroup);
  const recorteEmpty =
    page !== null && page.total === 0 && (smartList.isFiltered || hasActiveQuery);

  const activeFilterChips = [
    ...(statusForQuery
      ? [
          {
            id: 'status',
            label: `Situação: ${PAYABLE_STATUS_LABELS[statusForQuery] ?? statusForQuery}`,
            onRemove: () => patchParams({ status: null }),
          },
        ]
      : []),
    ...(agingFilter
      ? [
          {
            id: 'agingBucket',
            label: `Faixa: ${AGING_BUCKET_LABELS[agingFilter] ?? agingFilter}`,
            onRemove: () => patchParams({ agingBucket: null }),
          },
        ]
      : []),
    ...(search
      ? [{ id: 'q', label: `Busca: ${search}`, onRemove: () => patchParams({ q: null }) }]
      : []),
    ...(dueFrom
      ? [
          {
            id: 'dueFrom',
            label: `Vence de ${dueFrom}`,
            onRemove: () => patchParams({ dueFrom: null }),
          },
        ]
      : []),
    ...(dueTo
      ? [{ id: 'dueTo', label: `Vence até ${dueTo}`, onRemove: () => patchParams({ dueTo: null }) }]
      : []),
  ];

  /*
   * FAIXA DE SITUACAO — as perguntas do lado a pagar.
   * "Aging 90+" aparece porque ELE EXISTE no resumo (`aging90PlusCount`) e no dominio (faixa
   * persistida). Onde ele nao existe — recebiveis — a faixa nao e oferecida: ausencia nao vira zero.
   */
  const situationItems = [
    {
      id: 'overdue',
      label: 'Vencido',
      value: publishedCount(summary?.overdueCount),
      note: formatSummaryAmounts(summary, 'overdueAmount') ?? 'valor não publicado',
      tone: (summary?.overdueCount ?? 0) > 0 ? ('critical' as const) : ('neutral' as const),
      to: '/app/finance/payables?status=OVERDUE',
    },
    {
      id: 'due',
      label: 'A vencer',
      value: publishedCount(summary?.dueCount),
      note: formatSummaryAmounts(summary, 'dueAmount') ?? 'valor não publicado',
      tone: 'info' as const,
      to: '/app/finance/payables?status=OPEN',
    },
    {
      id: 'open',
      label: 'Em aberto',
      value: publishedCount(summary?.openCount),
      note: formatSummaryAmounts(summary, 'openAmount') ?? 'valor não publicado',
      tone: 'warning' as const,
      to: '/app/finance/payables',
    },
    {
      id: 'aging90',
      label: 'Aging 90+',
      value: publishedCount(summary?.aging90PlusCount),
      note: 'faixa persistida no título',
      tone: (summary?.aging90PlusCount ?? 0) > 0 ? ('critical' as const) : ('neutral' as const),
      to: '/app/finance/payables?agingBucket=90_PLUS',
    },
    {
      id: 'paid',
      label: 'Pago',
      value: publishedCount(summary?.paidCount),
      note: 'títulos liquidados no recorte',
      tone: 'success' as const,
      to: '/app/finance/payables?status=PAID',
    },
  ];

  return (
    <ModulePage layout="workspace">
      <div className="flex min-h-0 flex-1 flex-col" data-region="work-surface">
        <div data-region="operating-header">
          <WorklistHeader
            title="Contas a pagar"
            count={page?.total}
            context="As obrigações a pagar: vencimento, faixa e saldo vêm do servidor. Cada título abre o lançamento que o originou."
          />
        </div>

        <div data-region="situation-surface" className="pt-2">
          <FinanceSituationStrip items={situationItems} />
        </div>

        <WorkspaceBody className="min-h-0 flex-1 pt-2">
          <WorkspacePane className="h-full overflow-hidden" data-region="worklist-master">
            <WorkspacePaneHeader
              title="Títulos a pagar"
              count={page?.total}
              action={
                <button type="button" className={financeControlClass} onClick={() => void reload()}>
                  {refreshing ? 'Atualizando…' : 'Atualizar'}
                </button>
              }
            />

            <div className="shrink-0 px-3 pt-2">
              <FinanceWorklistToolbar
                views={
                  <SavedViewsBar
                    views={smartList.savedViews.views}
                    builtInViews={smartList.savedViews.builtInViews}
                    activeViewId={smartList.activeViewId}
                    onApply={(view) => {
                      smartList.applyView(view);
                      setPageNumber(1);
                      const nextStatus = view.config.filters.status;
                      const nextAging = view.config.filters.agingBucket;
                      patchParams({
                        status: typeof nextStatus === 'string' && nextStatus ? nextStatus : null,
                        agingBucket: typeof nextAging === 'string' && nextAging ? nextAging : null,
                      });
                    }}
                    onSave={smartList.savedViews.saveView}
                    onRename={smartList.savedViews.renameView}
                    onRemove={smartList.savedViews.removeView}
                    currentConfig={smartList.currentConfig}
                    canSave={smartList.isFiltered || hasActiveQuery}
                    allLabel="Tudo"
                  />
                }
                search={searchDraft}
                onSearchChange={setSearchDraft}
                dueFrom={dueFrom}
                dueTo={dueTo}
                onDueFromChange={(value) => patchParams({ dueFrom: value || null })}
                onDueToChange={(value) => patchParams({ dueTo: value || null })}
                sort={sort}
                onSortChange={setSort}
              >
                <span className="cisne-type-helper">Ordenação desta página</span>
              </FinanceWorklistToolbar>

              <WorkspaceActiveFilters
                filters={activeFilterChips}
                onClearAll={() =>
                  patchParams({
                    status: null,
                    agingBucket: null,
                    q: null,
                    dueFrom: null,
                    dueTo: null,
                  })
                }
              />
            </div>

            {schema ? (
              <div className="shrink-0 px-3 pt-2" data-region="command-filter-surface">
                <DynamicFilterBuilder
                  schema={schema}
                  value={filterGroup}
                  onChange={setFilterGroup}
                />
              </div>
            ) : null}

            <div className="shrink-0 px-3 pt-2" data-region="bulk-command-surface">
              <BulkActionBar
                count={selection.count}
                visibleCount={orderedRows.length}
                selectedIds={[...selection.selectedIds]}
                onClear={selection.clear}
                onSelectAllVisible={() => selection.selectAll(orderedRows)}
                parkedNote="Pagamento, aprovação e cancelamento em lote continuam PARK: exigem aprovação, segregação de funções e idempotência por título. A ação em lote daqui apenas organiza o trabalho."
                actions={[
                  {
                    id: 'export',
                    label: 'Exportar selecionados (CSV)',
                    run: (ids) =>
                      exportSelectionToCsv(
                        'contas-a-pagar-selecionadas.csv',
                        [
                          'Referência',
                          'Origem',
                          'Vencimento',
                          'Atraso',
                          'Situação',
                          'Faixa',
                          'Saldo',
                          'Moeda',
                        ],
                        orderedRows
                          .filter((row) => ids.includes(row.id))
                          .map((row) => [
                            row.externalReference ?? row.origin.reference ?? row.id,
                            row.origin.reference,
                            row.dueDate,
                            overdueLabel(row.dueDate) ?? 'sem atraso',
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
                    run: (ids) => {
                      const [only] = orderedRows.filter((row) => ids.includes(row.id));
                      if (only) {
                        setPreviewId(only.id);
                        setDrawerOpen(true);
                      }
                    },
                  },
                ]}
              />
            </div>

            <section
              aria-label="Títulos a pagar"
              aria-busy={state.phase === 'loading'}
              className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pt-2"
            >
              <p className="m-0 shrink-0 pb-1 text-[11px] text-[color:var(--color-text-muted)]">
                {state.phase === 'loading'
                  ? 'Lendo a carteira no servidor…'
                  : page
                    ? `${orderedRows.length} de ${page.total} títulos · ${safePageNumber} de ${pageCount} páginas${agingFilter ? ' · recorte por faixa aplicado nesta página' : ''}${refreshing ? ' · atualizando…' : ''}`
                    : 'Leitura não publicada'}
              </p>

              <div className="min-h-0 flex-1 overflow-auto">
                {state.phase === 'loading' ? <WorkspaceSkeletonRows rows={10} columns={6} /> : null}

                {state.phase === 'error' ? (
                  <WorkspaceEmpty
                    title="Não foi possível ler a carteira"
                    description={state.message}
                    action={
                      <button
                        type="button"
                        className={financeControlClass}
                        onClick={() => void reload()}
                      >
                        Tentar novamente
                      </button>
                    }
                  />
                ) : null}

                {state.phase === 'ready' && portfolioEmpty ? (
                  <WorkspaceEmpty
                    title="Nenhuma obrigação a pagar registrada."
                    description="As obrigações nascem da compra: quando uma nota de fornecedor é registrada, o título aparece aqui com vencimento, faixa, saldo e situação. Nada foi somado nem estimado nesta tela."
                    action={
                      <Link className={financeControlClass} to="/app/procurement">
                        Ver compras
                      </Link>
                    }
                  />
                ) : null}

                {state.phase === 'ready' && recorteEmpty ? (
                  <WorkspaceEmpty
                    title="Nenhum título neste recorte"
                    description="Nenhuma obrigação corresponde ao recorte atual. Ajuste o filtro ou limpe a visão para ver toda a carteira."
                    action={
                      <button
                        type="button"
                        className={financeControlClass}
                        onClick={() => {
                          patchParams({
                            status: null,
                            agingBucket: null,
                            q: null,
                            dueFrom: null,
                            dueTo: null,
                          });
                          setFilterGroup(emptyFilterGroup());
                        }}
                      >
                        Limpar recorte
                      </button>
                    }
                  />
                ) : null}

                {/*
                  RECORTE POR FAIXA SEM RESULTADO NA PAGINA — estado PRÓPRIO.
                  A carteira tem títulos e o filtro de faixa zerou a pagina. Sem esta distincao o
                  operador leria "nenhum título neste recorte" e concluiria que a faixa nao existe no
                  dominio, quando o que existe e uma pagina que nao a contem.
                */}
                {state.phase === 'ready' &&
                !portfolioEmpty &&
                !recorteEmpty &&
                orderedRows.length === 0 ? (
                  <WorkspaceEmpty
                    title="Nenhum título desta faixa nesta página"
                    description={`O recorte por faixa é aplicado sobre as ${pageItems.length} linhas carregadas — o servidor não filtra por faixa. Navegue pelas páginas ou abra a visão "Aging 90+" para o conjunto completo.`}
                    action={
                      <button
                        type="button"
                        className={financeControlClass}
                        onClick={() => patchParams({ agingBucket: null })}
                      >
                        Remover recorte de faixa
                      </button>
                    }
                  />
                ) : null}

                {state.phase === 'ready' &&
                !portfolioEmpty &&
                !recorteEmpty &&
                orderedRows.length > 0 &&
                schema ? (
                  <DynamicList
                    schema={schema}
                    rows={rows}
                    ariaLabel="Lista de contas a pagar"
                    emptyMessage="Nenhuma obrigação corresponde ao recorte atual."
                    selectedIds={selection.selectedIds}
                    onSelectionChange={(ids) => {
                      const next = new Set(ids);
                      if (next.size === 0) {
                        selection.clear();
                        return;
                      }
                      for (const row of rows) {
                        const id = String(row.id);
                        if (next.has(id) !== selection.isSelected(id)) {
                          selection.toggle(id);
                        }
                      }
                    }}
                    onRowClick={(row) => setPreviewId(String(row.id))}
                    renderRowActions={(row) => (
                      <button
                        type="button"
                        className={financeControlClass}
                        onClick={() => {
                          setPreviewId(String(row.id));
                          setDrawerOpen(true);
                        }}
                        aria-label={`Prévia de ${text(row['external_reference'])}`}
                      >
                        Prévia
                      </button>
                    )}
                    showTotals
                    renderCell={(field, row) => {
                      const currency = text(row['currency_code']);
                      if (field.name === 'lifecycle') {
                        return (
                          <FinanceStatusBadge
                            status={text(row['lifecycle'])}
                            labels={PAYABLE_STATUS_LABELS}
                          />
                        );
                      }
                      if (field.name === 'due_date') {
                        const value = text(row['due_date']);
                        const late = overdueLabel(value);
                        return (
                          <span className="flex flex-col leading-tight">
                            <DateTime value={value} mode="date" />
                            <span
                              className={
                                late
                                  ? 'text-[10px] font-semibold text-[color:var(--color-red-700)]'
                                  : 'text-[10px] text-[color:var(--color-text-muted)]'
                              }
                            >
                              {late ?? dueLabel(value)}
                            </span>
                          </span>
                        );
                      }
                      if (field.name === 'principal') {
                        return <Money value={text(row['principal'])} currencyCode={currency} />;
                      }
                      /*
                        FAIXA DE AGING — FATO PERSISTIDO do título, exibido como badge.
                        Ela nao e recalculada a partir da data: o servidor decidiu a faixa, e a tela
                        apenas a apresenta. Ausencia de faixa publicada cai em "—", nunca em "A vencer".
                      */
                      if (field.name === 'aging_bucket') {
                        const bucket = text(row['aging_bucket']);
                        return bucket ? (
                          <span className="cisne-type-meta">
                            {AGING_BUCKET_LABELS[bucket] ?? bucket}
                          </span>
                        ) : (
                          <span className="cisne-type-helper">—</span>
                        );
                      }
                      if (field.name === 'remaining_balance') {
                        return (
                          <Money
                            value={text(row['remaining_balance'])}
                            currencyCode={currency}
                            emphasis
                          />
                        );
                      }
                      /*
                        FORNECEDOR — o DTO publica apenas `counterpartyId` (UUID).
                        A celula declara a ausencia; o caminho para o cadastro vive na coluna de
                        contexto, onde ele e do REGISTRO e nao da repeticao em todas as linhas.
                      */
                      if (field.name === 'counterparty_id') {
                        return text(row['counterparty_id']) ? (
                          <span className="cisne-type-meta">Fornecedor não publicado</span>
                        ) : (
                          <span className="cisne-type-helper">—</span>
                        );
                      }
                      return undefined;
                    }}
                  />
                ) : null}
              </div>

              {page && pageCount > 1 ? (
                <div
                  className={`flex shrink-0 items-center justify-between py-1.5 text-[11px] text-[color:var(--color-text-secondary)] ${worklistGroupClass}`}
                >
                  <span aria-live="polite" className="tabular-nums">
                    {page.offset + 1}–{Math.min(page.offset + page.limit, page.total)} de{' '}
                    {page.total}
                  </span>
                  <ModulePagination
                    pageNumber={safePageNumber}
                    onPrevious={() => setPageNumber((current) => Math.max(1, current - 1))}
                    onNext={() => setPageNumber((current) => Math.min(pageCount, current + 1))}
                    previousDisabled={safePageNumber <= 1}
                    nextDisabled={safePageNumber >= pageCount}
                  />
                </div>
              ) : null}
            </section>
          </WorkspacePane>
        </WorkspaceBody>
      </div>

      <ContextDrawer
        open={drawerOpen && previewRow !== null}
        title="Contexto do título"
        preview={previewRow ? buildPayablePreview(previewRow) : null}
        onClose={() => setDrawerOpen(false)}
      />
    </ModulePage>
  );
}

/** Valor de célula como texto, nunca `String(valor)` direto — `String(undefined)` viraria "undefined". */
function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

/**
 * Prévia lateral montada SOMENTE com o payload já recebido pela lista.
 * Se o detalhe completo exigisse API nova, aqui não faríamos: oferecemos o atalho.
 */
export function buildPayablePreview(row: PayableDetail): ContextPreviewBody {
  return {
    identifier: row.externalReference ?? row.origin.reference ?? row.id,
    subtitle: `Origem: ${row.origin.kind}`,
    status: <FinanceStatusBadge status={row.status} labels={PAYABLE_STATUS_LABELS} />,
    facts: [
      { label: 'Vencimento', value: <DateTime value={row.dueDate} mode="date" /> },
      { label: 'Atraso', value: overdueLabel(row.dueDate) ?? 'sem atraso' },
      { label: 'Faixa', value: AGING_BUCKET_LABELS[row.agingBucket] ?? row.agingBucket },
      {
        label: 'Principal',
        value: <Money value={row.principal} currencyCode={row.currencyCode} />,
      },
      {
        label: 'Saldo',
        value: <Money value={row.remainingBalance} currencyCode={row.currencyCode} emphasis />,
        emphasis: true,
      },
      { label: 'Pago', value: <Money value={row.paidAmount} currencyCode={row.currencyCode} /> },
      { label: 'Parcelas', value: String(row.installments.length) },
      { label: 'Pagamentos', value: String(row.payments.length) },
      { label: 'Condição de pagamento', value: row.paymentTerms },
      { label: 'Criado em', value: <DateTime value={row.createdAt} mode="datetime" /> },
      { label: 'Atualizado em', value: <DateTime value={row.updatedAt} mode="datetime" /> },
    ],
    relations: [
      /*
       * Relacao sem rotulo humano NAO exibe o identificador tecnico: o vinculo existe (e navega,
       * quando ha destino real), mas o valor mostrado e o nome do objeto.
       */
      {
        label: 'Fornecedor',
        value: 'Abrir cadastro do fornecedor',
        href: `/app/suppliers/${row.counterpartyId}`,
      },
      { label: 'Origem', value: row.origin.reference },
    ],
    nextAction: {
      label:
        row.status === 'OVERDUE'
          ? 'Abrir o título e regularizar o pagamento'
          : 'Abrir o título para registrar pagamento',
      href: `/app/finance/payables/${row.id}`,
    },
    detailHref: `/app/finance/payables/${row.id}`,
    detailLabel: 'Abrir título completo',
  };
}
