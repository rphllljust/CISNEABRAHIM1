import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DateTime, EmptyState, Money } from '../../ui';
import { ModulePage, ModulePagination } from '../../ui/module-layout';
import {
  DrilldownMetric,
  DrilldownRow,
  SavedViewsBar,
  ContextDrawer,
  BulkActionBar,
  exportSelectionToCsv,
  useSelection,
  useSmartList,
  type ContextPreviewBody,
} from '../../operator';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { AGING_BUCKET_LABELS, PAYABLE_STATUS_LABELS } from '../../financial-ui/labels';
import { BACKOFFICE_TABLE_PAGE_SIZE } from '../../financial-ui/table-slice';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { DynamicList, useEntitySchema } from '../../engine';
import {
  DynamicFilterBuilder,
  emptyFilterGroup,
  isFilterGroupActive,
  matchesFilterGroup,
  type FilterGroup,
} from '../../engine/DynamicFilterBuilder';
import { listPayables, type FinanceTitlePage } from '../api/finance-api';
import { mapFinanceErrorToMessage } from '../api/finance-error-messages';
import { FinanceStatusBadge } from '../components/FinanceStatusBadge';
import { PAYABLES_ALLOWED_FILTERS, PAYABLES_BUILT_IN_VIEWS } from './finance-smart-list';
import { payableEngineRow } from '../utils/finance-engine-rows';
import type { PayableDetail } from '../types/finance.types';

const SCOPE = 'finance.payables';

/**
 * CONTAS A PAGAR — MESA DE TRABALHO, renderizada pela engine.
 *
 * A tabela, os cabeçalhos e os rótulos de status deixaram de ser JSX artesanal: as colunas vêm da
 * view `list` de `/api/v1/meta/payables`. Aging, saldo e status continuam vindo do servidor — esta
 * tela não recalcula obrigação, não projeta caixa e não decide pagamento.
 *
 * PARIDADE COM A VERSÃO ARTESANAL (cada feature do arquivo antigo → onde vive agora):
 *   - tabela de títulos (Título/Vencimento/Status/Aging/Saldo) → view `list` + colunas extras
 *     desenhadas por `renderCell` (saldo e aging NÃO são coluna da view, são leitura da TELA);
 *   - ordenação por título/vencimento/status/aging/saldo → `useSmartList` + sortAccessors,
 *     PRESERVADA (a `DynamicList` continua ordenando o conjunto exibido);
 *   - indicadores de drill-down Vencidos/A vencer/Aging 90+/Obrigações → `DrilldownRow`, PRESERVADO;
 *   - filtros Status e Aging em uma linha → PRESERVADOS;
 *   - visões salvas (aplicar/salvar/renomear/remover) → `SavedViewsBar`, PRESERVADO;
 *   - barra de ações em lote (exportar CSV, abrir prévia) + nota PARK → `BulkActionBar`, PRESERVADO;
 *   - seleção múltipla por linha e "selecionar tudo visível" → `DynamicList` + `useSelection`;
 *   - prévia lateral → `ContextDrawer` + `buildPayablePreview`, PRESERVADO;
 *   - paginação server-side com faixa e totais → `ModulePagination` + `WorklistFooter`, PRESERVADO;
 *   - estados vazio-de-carteira vs. vazio-de-visão → PRESERVADOS, com o mesmo texto;
 *   - link da linha para o detalhe → `onRowClick`, PRESERVADO.
 *
 * PARIDADE_PERDIDA: nenhuma.
 *
 * AÇÕES EM LOTE continuam PARK e a nota foi preservada: pagamento, aprovação e cancelamento em
 * lote exigem aprovação, segregação de funções e idempotência por título. O bulk daqui só organiza
 * trabalho — exportar selecionados e abrir prévia.
 */
export function PayablesListPage() {
  const navigate = useNavigate();
  const [pageNumber, setPageNumber] = useState(1);
  const [previewId, setPreviewId] = useState<string | null>(null);
  /** O drawer só abre por intenção explícita ("Prévia"); a seleção automática alimenta o contexto inline. */
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** Árvore do construtor visual de filtros. Estado da TELA — `useSmartList` não a comporta. */
  const [filterGroup, setFilterGroup] = useState<FilterGroup>(() => emptyFilterGroup());
  const { schema } = useEntitySchema('payables');
  /*
   * PAGINACAO SERVER-SIDE: uma pagina por requisicao, com `limit`/`offset`/`status` na consulta e
   * `total`/`totalPages` contados no servidor sob o mesmo escopo e filtro. O filtro do smart list
   * vai ao servidor, nao mascara a pagina.
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
  const { state, reload } = useBackofficeQuery<FinanceTitlePage<PayableDetail>>({
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

  /*
   * RECORTE EM DUAS CAMADAS, na ordem em que o operador as compôs:
   *   1. o construtor visual (árvore AND/OR) sobre os títulos da página;
   *   2. o filtro de aging do smart list, que o servidor não aceita como parâmetro.
   * Aplicar a árvore sobre o conjunto já recortado por aging mantém os dois recortes
   * CONJUNTIVOS, que é a leitura correta de dois filtros ativos ao mesmo tempo.
   */
  const byBuilder = isFilterGroupActive(filterGroup)
    ? filtered.filter((item) => matchesFilterGroup(filterGroup, payableEngineRow(item)))
    : filtered;

  const rows = byBuilder.map(payableEngineRow);
  const selectedRows = selection.selectedRows(filtered);
  // SELEÇÃO EFETIVA — derivada, sem effect/setState automático (mesma regra de Receivables).
  const effectiveSelectedId = previewId && pageItems.some((item) => item.id === previewId)
    ? previewId
    : pageItems[0]?.id ?? null;
  const previewRow = pageItems.find((item) => item.id === effectiveSelectedId) ?? null;

  /**
   * CARTEIRA VAZIA — `200 + items=[]` e EMPTY DATA, nao negacao de acesso.
   *
   * O estado vazio e um ESTADO DA WORKLIST, nunca uma segunda estrutura de pagina: a barra de
   * filtros, os indicadores, as visoes salvas e a paginacao continuam na tela, porque e justamente
   * quando a carteira esta vazia que o operador precisa deles para entender o recorte.
   *
   * `page.total` conta o recorte ATIVO; por isso o painel distingue "carteira sem obrigacoes" de
   * "nada nesta visao" — o segundo caso ja tem o proprio estado humano dentro da tabela.
   */
  const portfolioEmpty = page.total === 0 && !smartList.isFiltered;

  return (
    <ModulePage>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold" data-testid="entity-title">
            {schema?.label ?? 'Contas a pagar'}
          </h1>
          <p className="mt-1 text-xs text-gray-500">
            Aging e saldo restante são os informados pelo servidor. Esta tela não recalcula
            obrigações.
          </p>
        </div>
        <span className="text-xs text-gray-500" data-list-total={page.total}>
          {page.total} título(s)
        </span>
      </header>

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

      {/*
        FILTRO VISUAL — o construtor AND/OR aninhável da engine, espelhando o domain de `ir.filters`
        do Odoo. O recorte que ele compõe é aplicado LOCALMENTE sobre a página carregada; o caminho
        oficial de recorte continua sendo `status` na consulta ao servidor, que o smart list já
        publica. A árvore vive em estado próprio porque `useSmartList` filtra por valores
        enumerados por chave — um domain aninhado não cabe nesse contrato, e forçá-lo lá dentro
        mudaria o smart list inteiro para atender uma tela.
      */}
      {schema ? (
        <DynamicFilterBuilder schema={schema} value={filterGroup} onChange={setFilterGroup} />
      ) : null}

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
        (cabecalho, indicadores, filtros, visoes salvas, paginacao) e sempre a mesma.

        O painel de estado vazio e reservado para CARTEIRA VAZIA (nada existe) e para o recorte do
        smart list (que ja tem texto proprio). Quando e o CONSTRUTOR VISUAL que zera o conjunto, a
        TABELA CONTINUA MONTADA e mostra a mensagem dentro do proprio grid — apagar a tabela ali
        tiraria do operador a coluna que ele acabou de filtrar, e ele perderia a referencia do que
        esta recortando. E o comportamento de grid do Odoo/ERPNext: o filtro sem resultado mostra
        "nenhum registro" NA grade, nunca troca a grade por outra tela.
      */}
      {portfolioEmpty ? (
        <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
          <EmptyState
            title="Nenhuma obrigação a pagar registrada."
            description="As obrigações nascem da compra: quando uma nota de fornecedor é registrada, o título aparece aqui com vencimento, aging, saldo e situação. Nada foi somado nem estimado nesta tela."
          />
          <Link to="/app/procurement" className="mt-3 inline-block text-xs font-semibold text-brand-700 no-underline">
            Ver compras
          </Link>
        </div>
      ) : byBuilder.length === 0 && smartList.isFiltered && !isFilterGroupActive(filterGroup) ? (
        <EmptyState
          title="Nenhum título nesta visão"
          description="Nenhum título corresponde ao recorte atual. Ajuste o filtro ou limpe a visão para ver todas as obrigações."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
            <div className="min-w-0">
              <DynamicList
            schema={schema}
            rows={rows}
            emptyMessage="Nenhum título corresponde ao recorte atual. Ajuste o filtro ou limpe a visão para ver todas as obrigações."
            selectedIds={selection.selectedIds}
            /*
             * RECONCILIAÇÃO com a API existente do `useSelection`.
             *
             * A `DynamicList` PUBLIC A LISTA COMPLETA de selecionados (é o que o "selecionar
             * todos" dela produz), enquanto `useSelection` expõe `toggle`/`clear`/`selectAll` — não
             * um "defina esta lista". Reconciliar por diferença evita alterar `useSelection`, que
             * está fora do escopo desta migração autorizada, e preserva o teto de seleção
             * (`maxSelection`) que só o hook conhece.
             */
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
            onRowClick={(row) => {
              void navigate(`/app/finance/payables/${row.id}`);
            }}
            renderRowActions={(row) => (
              <button
                type="button"
                className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                onClick={() => {
                  setPreviewId(String(row.id));
                  setDrawerOpen(true);
                }}
                aria-label={`Prévia de ${String(row['external_reference'])}`}
              >
                Prévia
              </button>
            )}
            showTotals
            /* Saldo e aging NÃO são coluna da view `list`: a TELA desenha a célula. */
            renderCell={(field, row) => {
              const currency = text(row['currency_code']);
              if (field.name === 'lifecycle') {
                return <FinanceStatusBadge status={text(row['lifecycle'])} labels={PAYABLE_STATUS_LABELS} />;
              }
              if (field.name === 'due_date') {
                return <DateTime value={text(row['due_date'])} mode="date" />;
              }
              if (field.name === 'principal') {
                return <Money value={text(row['principal'])} currencyCode={currency} />;
              }
              /*
               * CONTRAPARTE — o DTO publica `counterpartyId` (UUID); declara ausência de nome do
               * credor e mantém drilldown real para o fornecedor, sem expor UUID nem inventar nome.
               */
              if (field.name === 'counterparty_id') {
                const counterpartyId = text(row['counterparty_id']);
                return counterpartyId ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-xs text-gray-500">Credor não publicado</span>
                    <Link
                      to={`/app/suppliers/${counterpartyId}`}
                      className="text-xs font-medium text-brand-700 no-underline hover:text-brand-800"
                    >
                      Abrir fornecedor
                    </Link>
                  </span>
                ) : (
                  <span className="text-xs text-gray-400">—</span>
                );
              }
              return undefined;
            }}
          />

          <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
            <span aria-live="polite">
              Página {safePageNumber} de {pageCount} · {filtered.length}{' '}
              {filtered.length === 1 ? 'título' : 'títulos'} no recorte atual
              {statusFilter
                ? ` · status: ${PAYABLE_STATUS_LABELS[statusFilter] ?? statusFilter}`
                : ''}
              {agingFilter ? ` · aging: ${AGING_BUCKET_LABELS[agingFilter] ?? agingFilter}` : ''}
              {overdue.length > 0 ? ` · ${overdue.length} vencido(s)` : ''}
            </span>
            <ModulePagination
              pageNumber={safePageNumber}
              onPrevious={() => setPageNumber((current) => Math.max(1, current - 1))}
              onNext={() => setPageNumber((current) => Math.min(pageCount, current + 1))}
              previousDisabled={safePageNumber <= 1}
              nextDisabled={safePageNumber >= pageCount}
            />
          </div>
            </div>

            {previewRow ? (
              <aside
                className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-900/5 lg:sticky lg:top-4 lg:self-start"
                aria-label="Contexto da obrigação selecionada"
              >
                <header className="border-b border-gray-100 pb-3">
                  <p className="text-sm font-semibold text-gray-900">
                    {previewRow.externalReference ?? previewRow.origin.reference ?? 'Obrigação'}
                  </p>
                  <div className="mt-1.5">
                    <FinanceStatusBadge status={previewRow.status} labels={PAYABLE_STATUS_LABELS} />
                  </div>
                </header>
                <dl className="my-3 grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-3 gap-y-2">
                  <dt className="text-xs text-gray-500">Credor</dt>
                  <dd className="m-0 text-[13px] text-gray-800">
                    <span className="text-gray-500">Credor não publicado · </span>
                    <Link to={`/app/suppliers/${previewRow.counterpartyId}`} className="text-brand-700 no-underline hover:text-brand-800">
                      Abrir fornecedor
                    </Link>
                  </dd>
                  <dt className="text-xs text-gray-500">Valor original</dt>
                  <dd className="m-0 text-[13px] text-gray-800 tabular-nums">
                    <Money value={previewRow.principal} currencyCode={previewRow.currencyCode} />
                  </dd>
                  <dt className="text-xs text-gray-500">Saldo</dt>
                  <dd className="m-0 text-[13px] font-semibold text-gray-900 tabular-nums">
                    <Money value={previewRow.remainingBalance} currencyCode={previewRow.currencyCode} emphasis />
                  </dd>
                  <dt className="text-xs text-gray-500">Vencimento</dt>
                  <dd className="m-0 text-[13px] text-gray-800">
                    <DateTime value={previewRow.dueDate} mode="date" />
                  </dd>
                  <dt className="text-xs text-gray-500">Aging</dt>
                  <dd className="m-0 text-[13px] text-gray-800">
                    {AGING_BUCKET_LABELS[previewRow.agingBucket] ?? previewRow.agingBucket}
                  </dd>
                  <dt className="text-xs text-gray-500">Pagamentos</dt>
                  <dd className="m-0 text-[13px] text-gray-800 tabular-nums">
                    {previewRow.payments.length}
                  </dd>
                  <dt className="text-xs text-gray-500">Centro de custo</dt>
                  <dd className="m-0 text-[13px] text-gray-800">{previewRow.costCenter.code}</dd>
                </dl>
              </aside>
            ) : null}
          </div>
        </>
      )}

      <ContextDrawer
        open={drawerOpen && previewRow !== null}
        title="Contexto da obrigação"
        preview={previewRow ? buildPayablePreview(previewRow) : null}
        onClose={() => setDrawerOpen(false)}
      />
    </ModulePage>
  );
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

/**
 * Valor de célula como texto, nunca `String(valor)` direto.
 *
 * `String(undefined)` produziria a string `"undefined"` na tela — um dado que parece dado e não é.
 * Vazio explícito é o que o `FieldRenderer` já trata como ausência.
 */
function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

/**
 * Prévia lateral com o payload já carregado.
 *
 * Não há BusinessChain aqui de propósito: o payload de contas a pagar expõe apenas `origin`
 * (kind/id/reference) e `counterpartyId`, sem os degraus intermediários da cadeia comercial.
 * Montar uma cadeia exigiria inventar vínculo — o que está PARK até o backend expor a relação.
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
      { label: 'Aging', value: AGING_BUCKET_LABELS[row.agingBucket] ?? row.agingBucket },
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
