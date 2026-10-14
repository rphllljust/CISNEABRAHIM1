import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DateTime, Money } from '../../ui';
import { ModulePage, ModulePagination } from '../../ui/module-layout';
import {
  BulkActionBar,
  BusinessChain,
  ContextDrawer,
  SavedViewsBar,
  exportSelectionToCsv,
  useSelection,
  useSmartList,
  type ChainLink,
  type ContextPreviewBody,
} from '../../operator';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { WorklistHeader, worklistGroupClass } from '../../ui/enterprise-list';
import { RECEIVABLE_STATUS_LABELS } from '../../financial-ui/labels';
import { BACKOFFICE_TABLE_PAGE_SIZE } from '../../financial-ui/table-slice';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { DynamicList, useEntitySchema } from '../../engine';
import {
  DynamicFilterBuilder,
  emptyFilterGroup,
  type FilterGroup,
} from '../../engine/DynamicFilterBuilder';
import { advancedFilterFromGroup } from '../../engine';
import {
  ContextFacts,
  ContextSection,
  WorkspaceActiveFilters,
  WorkspaceBody,
  WorkspaceEmpty,
  WorkspacePane,
  WorkspacePaneHeader,
  WorkspaceSkeletonRows,
} from '../../ui/workspace-frame';
import { FINANCE_TITLE_FILTER_SPECS } from './finance-title-filter-specs';
import {
  getReceivablesSummary,
  listReceivables,
  type FinanceTitlePage,
  type FinanceTitleSummary,
} from '../api/finance-api';
import { mapFinanceErrorToMessage } from '../api/finance-error-messages';
import { FinanceStatusBadge } from '../components/FinanceStatusBadge';
import { FinanceSituationStrip, formatSummaryAmounts, publishedCount } from '../components/FinanceSituation';
import {
  FinanceWorklistToolbar,
  financeControlClass,
} from '../components/FinanceWorklistToolbar';
import { FinanceTitleContext } from '../components/FinanceTitleContext';
import { RECEIVABLES_ALLOWED_FILTERS, RECEIVABLES_BUILT_IN_VIEWS } from './finance-smart-list';
import { receivableEngineRow } from '../utils/finance-engine-rows';
import {
  FINANCE_DEFAULT_SORT,
  daysPastDue,
  dueLabel,
  overdueLabel,
  sortTitles,
  type FinanceSortState,
  type FinanceSortableTitle,
} from '../utils/finance-aging';
import type { ReceivableDetail } from '../types/finance.types';

const SCOPE = 'finance.receivables';

/**
 * CONTAS A RECEBER — WORKLIST FINANCEIRA TIER-1.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * O QUE ESTA TELA PASSOU A SER
 *
 * A versao anterior era uma mesa de trabalho competente mas INCOMPLETA: grade paginada do servidor,
 * indicadores autoritativos, visoes salvas, selecao em lote. O que faltava era exatamente o que
 * separa uma lista de uma bancada:
 *
 *   - BUSCA. O contrato publica `q` (`buildFinanceTitleQuery`) e a tela nao oferecia campo. O
 *     operador via 50 linhas e nenhum caminho para achar o titulo que ele ja sabia existir.
 *   - JANELA DE VENCIMENTO. `dueFrom`/`dueTo` estao no contrato e nao tinham controle.
 *   - ORDENACAO DECLARADA. Havia ordenacao local sem lugar que a nomeasse.
 *   - ATRASO. Nao existia coluna de atraso. "Vencido" e um status persistido; QUANTO atrasado e a
 *     informacao que prioriza a cobranca, e ela e leitura do vencimento persistido.
 *   - COLUNA DE CONTEXTO. O painel lateral so aparecia com titulo selecionado e, sem selecao, a
 *     direita ficava vazia — o "oceano branco" que a area de trabalho nao pode ter.
 *   - SITUACAO NO TOPO. Os indicadores eram caixas de drill-down. Viraram uma FAIXA de situacao
 *     que responde, antes da grade, "o que esta vencido / o que vence / quanto ja entrou".
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * O QUE NAO MUDOU, E NAO PODE MUDAR
 *
 * - NENHUM AGREGADO E CALCULADO NO NAVEGADOR. Os numeros da faixa vem de
 *   `/finance/receivables/summary`, que agrega o recorte COMPLETO no servidor. A pagina e uma amostra
 *   de 50; somar `items` e chamar de posicao do dominio seria inventar financa.
 * - A BUSCA, O VENCIMENTO E O STATUS VÃO AO SERVIDOR. O que a tela reordena localmente e a pagina ja
 *   recebida, e ela DECLARA isso ("nesta página") em vez de sugerir que reordenou o dominio.
 * - O AGING PERSISTIDO NAO E RECALCULADO. `ReceivableDetail` nao publica `agingBucket`; inventar a
 *   faixa a partir da data seria criar uma segunda verdade para um fato do dominio. A coluna de
 *   atraso e leitura HUMANA do vencimento persistido — outra coisa, e dita como tal.
 * - BULK CONTINUA PARK. Liquidar, baixar, cancelar e reconciliar em lote exigem prova de segregacao
 *   de funcoes e idempotencia por titulo. A barra so organiza trabalho.
 */

type ReceivableSortable = FinanceSortableTitle & { row: ReceivableDetail };

/** Projecao de ordenacao — o DTO vira as chaves que `sortTitles` compara. */
function toSortable(row: ReceivableDetail): ReceivableSortable {
  return {
    row,
    dueDate: row.dueDate,
    reference: row.externalReference ?? row.origin.billingDocumentId ?? null,
    amount: Number.isFinite(Number(row.principal)) ? Number(row.principal) : null,
    outstanding: Number.isFinite(Number(row.remainingBalance)) ? Number(row.remainingBalance) : null,
    // Atraso vem do modulo compartilhado: Recebiveis e Pagaveis leem o vencimento pela MESMA regra.
    overdueDays: daysPastDue(row.dueDate),
    status: row.status,
  };
}

export function ReceivablesListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [pageNumber, setPageNumber] = useState(1);
  const [previewId, setPreviewId] = useState<string | null>(null);
  /** O drawer so abre por intencao explicita ("Previa"); a selecao alimenta o contexto INLINE. */
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** Arvore do construtor visual. Estado da TELA — `useSmartList` nao a comporta. */
  const [filterGroup, setFilterGroup] = useState<FilterGroup>(() => emptyFilterGroup());
  const { schema } = useEntitySchema('receivables');

  /*
   * RECORTE NA URL — busca, janela de vencimento e status sobrevivem a refresh, back/forward,
   * bookmark e drillback. Antes o status vivia em estado de componente: o operador filtrava, mandava
   * o link para o colega, e o colega abria a carteira inteira.
   */
  const search = searchParams.get('q') ?? '';
  const dueFrom = searchParams.get('dueFrom') ?? '';
  const dueTo = searchParams.get('dueTo') ?? '';
  const statusForQuery = searchParams.get('status') ?? '';

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

  /*
   * DEBOUNCE DA BUSCA — 300ms.
   *
   * `q` vai ao SERVIDOR, e digitar "AR-1042" dispararia oito consultas ao dominio, das quais sete
   * seriam descartadas. O atraso existe para nao gastar leitura do dominio a cada tecla; ele nao
   * existe para "esconder" a busca, tanto que o CAMPO responde na hora e so a CONSULTA espera.
   */
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

  /** A URL manda quando ela muda por fora (voltar/avancar, visao salva aplicada). */
  useEffect(() => {
    setSearchDraft(search);
  }, [search]);

  useEffect(() => {
    setPageNumber(1);
  }, [dueFrom, dueTo, statusForQuery]);

  const [sort, setSort] = useState<FinanceSortState>(FINANCE_DEFAULT_SORT);

  const offset = (pageNumber - 1) * BACKOFFICE_TABLE_PAGE_SIZE;

  /*
   * A ARVORE DO CONSTRUTOR VAI AO SERVIDOR.
   * Recortar so no navegador faria "nenhum titulo" significar "nao esta entre os 20 carregados", e o
   * total ao lado continuaria contando o conjunto NAO filtrado.
   */
  const advancedPayload = useMemo(
    () => advancedFilterFromGroup(filterGroup, FINANCE_TITLE_FILTER_SPECS),
    [filterGroup],
  );

  const loader = useCallback(
    (signal?: AbortSignal) =>
      listReceivables(
        {
          limit: BACKOFFICE_TABLE_PAGE_SIZE,
          offset,
          status: statusForQuery || undefined,
          q: search || undefined,
          dueFrom: dueFrom || undefined,
          dueTo: dueTo || undefined,
          advanced: advancedPayload,
          // A ordenacao do SERVIDOR continua sendo o vencimento crescente: e a ordem natural de uma
          // carteira (o que vence primeiro, primeiro). Reordenar a pagina e acao local e declarada.
          sortBy: 'due_date',
          sortDir: 'asc',
        },
        signal,
      ),
    [advancedPayload, offset, statusForQuery, search, dueFrom, dueTo],
  );
  const { state, reload, refreshing } = useBackofficeQuery<FinanceTitlePage<ReceivableDetail>>({
    loader,
    mapError: mapFinanceErrorToMessage,
  });

  /*
   * RESUMO AUTORITATIVO — o recorte COMPLETO, agregado no servidor.
   * Ele acompanha o MESMO filtro de status/busca/janela da lista, para que a faixa de situacao e a
   * grade falem do mesmo conjunto. Se o resumo nao chegar, a faixa declara "nao publicado".
   */
  const summaryLoader = useCallback(
    (signal?: AbortSignal) =>
      getReceivablesSummary(
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

  const smartList = useSmartList<ReceivableDetail>({
    scope: SCOPE,
    builtInViews: RECEIVABLES_BUILT_IN_VIEWS,
    allowedFilters: RECEIVABLES_ALLOWED_FILTERS,
    urlSync: true,
    initialSort: { key: 'dueDate', direction: 'asc' },
    sortAccessors: {
      externalReference: (row: ReceivableDetail) => row.externalReference ?? row.id,
      dueDate: (row: ReceivableDetail) => new Date(row.dueDate).getTime(),
      status: (row: ReceivableDetail) => row.status,
      principal: (row: ReceivableDetail) => Number(row.principal),
      remainingBalance: (row: ReceivableDetail) => Number(row.remainingBalance),
    },
  });

  const selection = useSelection<ReceivableDetail>({ getId: (row) => row.id });

  /*
   * ORDENACAO DA PAGINA — o hook fica ANTES de qualquer retorno antecipado.
   *
   * A ordem dos hooks e parte do contrato do React: o gate de carregamento/negacao retorna cedo, e
   * um `useMemo` depois dele faria a contagem de hooks mudar entre a primeira renderizacao (gate) e
   * a segunda (pronta) — "Rendered more hooks than during the previous render". A ordenacao e
   * portanto calculada sobre o que existir, e a pagina vazia simplesmente ordena uma lista vazia.
   */
  const pageItems = state.phase === 'ready' ? state.data.items : [];
  const ordered = useMemo(() => sortTitles(pageItems.map(toSortable), sort), [pageItems, sort]);
  const orderedRows = ordered.map((entry) => entry.row);

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

  const page = state.phase === 'ready' ? state.data : null;
  const summary = summaryState.phase === 'ready' ? summaryState.data : null;

  const rows = orderedRows.map(receivableEngineRow);
  const selectedRows = selection.selectedRows(orderedRows);

  /*
   * SELECAO EFETIVA — derivada, sem effect nem setState automatico.
   * A selecao explicita prevalece enquanto o item ainda esta no recorte; quando o titulo selecionado
   * sai do recorte, a coluna de contexto nao troca sozinha para outro titulo: ela volta ao contexto
   * do RECORTE. Trocar de objeto sem o operador pedir e a pior forma de "ajuda" numa tela de cobranca.
   */
  const previewRow = pageItems.find((item) => item.id === previewId) ?? null;

  const pageCount = page ? Math.max(1, page.totalPages) : 1;
  const safePageNumber = Math.min(pageNumber, pageCount);

  /*
   * CARTEIRA VAZIA x RECORTE VAZIO — a distincao que a tela precisa declarar.
   * Sem filtro nenhum e zero titulos: a CARTEIRA esta vazia (fato do negocio).
   * Com filtro aplicado e zero titulos: o RECORTE nao achou nada (fato da leitura).
   */
  const hasActiveQuery = Boolean(search || dueFrom || dueTo || statusForQuery);
  const portfolioEmpty =
    page !== null && page.total === 0 && !smartList.isFiltered && !hasActiveQuery;
  const recorteEmpty = page !== null && page.total === 0 && (smartList.isFiltered || hasActiveQuery);

  const activeFilterChips = [
    ...(statusForQuery
      ? [
          {
            id: 'status',
            label: `Situação: ${RECEIVABLE_STATUS_LABELS[statusForQuery] ?? statusForQuery}`,
            onRemove: () => patchParams({ status: null }),
          },
        ]
      : []),
    ...(search ? [{ id: 'q', label: `Busca: ${search}`, onRemove: () => patchParams({ q: null }) }] : []),
    ...(dueFrom
      ? [{ id: 'dueFrom', label: `Vence de ${dueFrom}`, onRemove: () => patchParams({ dueFrom: null }) }]
      : []),
    ...(dueTo
      ? [{ id: 'dueTo', label: `Vence até ${dueTo}`, onRemove: () => patchParams({ dueTo: null }) }]
      : []),
  ];

  /*
   * FAIXA DE SITUACAO — quatro perguntas, todas respondidas pelo resumo do SERVIDOR.
   * Cada valor abre o conjunto exato que ele conta. `null` = nao publicado (nunca zero).
   */
  const situationItems = [
    {
      id: 'overdue',
      label: 'Vencido',
      value: publishedCount(summary?.overdueCount),
      note: formatSummaryAmounts(summary, 'overdueAmount') ?? 'valor não publicado',
      tone: (summary?.overdueCount ?? 0) > 0 ? ('critical' as const) : ('neutral' as const),
      to: '/app/finance/receivables?status=OVERDUE',
    },
    {
      id: 'due',
      label: 'A vencer',
      value: publishedCount(summary?.dueCount),
      note: formatSummaryAmounts(summary, 'dueAmount') ?? 'valor não publicado',
      tone: 'info' as const,
      to: '/app/finance/receivables?status=OPEN',
    },
    {
      id: 'open',
      label: 'Em aberto',
      value: publishedCount(summary?.openCount),
      note: formatSummaryAmounts(summary, 'openAmount') ?? 'valor não publicado',
      tone: 'warning' as const,
      to: '/app/finance/receivables',
    },
    {
      id: 'paid',
      label: 'Recebido',
      value: publishedCount(summary?.paidCount),
      note: 'títulos liquidados no recorte',
      tone: 'success' as const,
      to: '/app/finance/receivables?status=PAID',
    },
    {
      id: 'total',
      label: 'Recorte',
      value: publishedCount(summary?.total),
      note: 'títulos no conjunto filtrado',
      tone: 'neutral' as const,
    },
  ];

  return (
    <ModulePage layout="workspace">
      {/*
        GRAMATICA DE REGIOES — a MESMA das worklists Tier-1 do produto.
        `work-surface` agrupa a bancada; `operating-header` isola a faixa de orientacao para que a
        regua estrutural de `theme.css` separe "onde estou / qual recorte" de "o que a carteira
        mostra", em vez de deixar o cabecalho colado no primeiro bloco de dado.
      */}
      <div className="flex min-h-0 flex-1 flex-col" data-region="work-surface">
        <div data-region="operating-header">
          <WorklistHeader
            title="Contas a receber"
            count={page?.total}
            context="A carteira a receber: situação e valores vêm do servidor. Cada título abre a cadeia que o originou."
          />
        </div>

        {/*
          SITUACAO — antes da grade, e nao uma parede de cards.
          Uma faixa densa responde o que decide o dia; a grade logo abaixo entrega o trabalho.
        */}
        <div data-region="situation-surface" className="pt-2">
          <FinanceSituationStrip items={situationItems} />
        </div>

        <WorkspaceBody
          className="min-h-0 flex-1 pt-2"
          context={
            <WorkspacePane
              aria-label="Contexto do título"
              className="hidden h-full overflow-auto bg-[color:var(--color-surface-context)] xl:flex"
              data-region="context-region"
            >
              <WorkspacePaneHeader title="Contexto do título" />
              {previewRow ? (
                <FinanceTitleContext
                  reference={previewRow.externalReference ?? previewRow.id.slice(0, 8)}
                  status={previewRow.status}
                  statusLabels={RECEIVABLE_STATUS_LABELS}
                  dueDate={previewRow.dueDate}
                  principal={previewRow.principal}
                  remainingBalance={previewRow.remainingBalance}
                  settledAmount={previewRow.settledAmount}
                  currencyCode={previewRow.currencyCode}
                  paymentTerms={previewRow.paymentTerms}
                  originKind={formatOriginKind(previewRow.origin.kind)}
                  originReference={previewRow.origin.billingDocumentId || null}
                  installmentsCount={previewRow.installments.length}
                  settlementsCount={previewRow.settlements.length}
                  createdAt={previewRow.createdAt}
                  updatedAt={previewRow.updatedAt}
                  counterpartyLabel="Cliente"
                  counterpartyHref={`/app/clients/${previewRow.clientId}`}
                  relations={<ReceivableChain row={previewRow} />}
                  actions={
                    <>
                      <Link
                        to={`/app/finance/receivables/${previewRow.id}`}
                        className="inline-flex h-[var(--control-height)] items-center rounded-[3px] border border-[color:var(--color-brand-600)] bg-[color:var(--color-brand-600)] px-2.5 text-[12px] font-semibold text-white no-underline hover:bg-[color:var(--color-brand-700)]"
                      >
                        {previewRow.status === 'OVERDUE'
                          ? 'Abrir e tratar cobrança'
                          : 'Abrir título'}
                      </Link>
                      <button
                        type="button"
                        className={financeControlClass}
                        onClick={() => setDrawerOpen(true)}
                      >
                        Prévia
                      </button>
                    </>
                  }
                />
              ) : (
                /*
                  SEM SELECAO — A COLUNA DIZ O RECORTE, E NAO FICA VAZIA.
                  Uma coluna de contexto em branco e o defeito que faz a bancada parecer inacabada.
                  O que ela mostra aqui e FATO que a tela ja possui: qual conjunto foi lido, quantos
                  titulos ele tem, qual janela de vencimento esta aplicada.
                */
                <>
                  <ContextSection title="Recorte lido">
                    <ContextFacts
                      facts={[
                        { label: 'Títulos no recorte', value: publishedCount(page?.total) ?? 'Não lido' },
                        { label: 'Situação', value: statusForQuery ? (RECEIVABLE_STATUS_LABELS[statusForQuery] ?? statusForQuery) : 'Todas' },
                        { label: 'Busca', value: search || 'Sem termo' },
                        { label: 'Vence de', value: dueFrom || 'Sem início' },
                        { label: 'Vence até', value: dueTo || 'Sem fim' },
                        {
                          label: 'Nesta página',
                          value: state.phase === 'ready' ? String(orderedRows.length) : 'Não lido',
                        },
                      ]}
                    />
                  </ContextSection>
                  <ContextSection title="Como ler esta carteira">
                    <ul className="m-0 list-disc space-y-1 pl-4 text-[12px] text-[color:var(--color-text-secondary)]">
                      <li>Valores e contagens vêm do resumo do servidor sobre o recorte completo.</li>
                      <li>
                        A coluna de atraso é leitura do vencimento persistido — o domínio não publica
                        faixa de aging para títulos a receber.
                      </li>
                      <li>Selecione um título para ver origem, cadeia e valores aqui.</li>
                    </ul>
                  </ContextSection>
                </>
              )}
            </WorkspacePane>
          }
        >
          <WorkspacePane className="h-full overflow-hidden" data-region="worklist-master">
            <WorkspacePaneHeader
              title="Títulos a receber"
              count={page?.total}
              action={
                <button type="button" className={financeControlClass} onClick={() => void reload()}>
                  {refreshing ? 'Atualizando…' : 'Atualizar'}
                </button>
              }
            />

            {/*
              BARRA DE FERRAMENTAS — views a esquerda, consulta a direita.
              A busca vai ao SERVIDOR (o placeholder nao promete recorte local), e a ordenacao e
              declarada como "desta pagina" para nao sugerir que reordenou o dominio.
            */}
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
                      patchParams({
                        status: typeof nextStatus === 'string' && nextStatus ? nextStatus : null,
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
                  patchParams({ status: null, q: null, dueFrom: null, dueTo: null })
                }
              />
            </div>

            {/* FILTRO COMPOSTO — a arvore AND/OR da engine, aplicada no SERVIDOR. */}
            {schema ? (
              <div className="shrink-0 px-3 pt-2" data-region="command-filter-surface">
                <DynamicFilterBuilder schema={schema} value={filterGroup} onChange={setFilterGroup} />
              </div>
            ) : null}

            <div className="shrink-0 px-3 pt-2" data-region="bulk-command-surface">
              <BulkActionBar
                count={selection.count}
                visibleCount={orderedRows.length}
                selectedIds={[...selection.selectedIds]}
                onClear={selection.clear}
                onSelectAllVisible={() => selection.selectAll(orderedRows)}
                parkedNote="Liquidação, baixa, cancelamento e reconciliação em lote continuam PARK: exigem prova de segregação de funções e idempotência por título. A ação em lote daqui apenas organiza o trabalho."
                actions={[
                  {
                    id: 'export',
                    label: 'Exportar selecionados (CSV)',
                    run: (ids) =>
                      exportSelectionToCsv(
                        'contas-a-receber-selecionadas.csv',
                        ['Título', 'Vencimento', 'Situação', 'Atraso', 'Principal', 'Saldo', 'Moeda'],
                        orderedRows
                          .filter((row) => ids.includes(row.id))
                          .map((row) => [
                            row.externalReference ?? row.id,
                            row.dueDate,
                            RECEIVABLE_STATUS_LABELS[row.status] ?? row.status,
                            overdueLabel(row.dueDate) ?? 'sem atraso',
                            row.principal,
                            row.remainingBalance,
                            row.currencyCode,
                          ]),
                      ),
                  },
                  {
                    id: 'preview-single',
                    label: 'Abrir registro',
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

            {/*
              CORPO DA GRADE — cabecalho, rodape e coluna de contexto continuam montados em QUALQUER
              estado. Zero titulos nao desmonta a bancada: e justamente com a carteira vazia que o
              operador precisa da barra e do recorte para entender o que ele esta lendo.
            */}
            <section
              aria-label="Títulos a receber"
              aria-busy={state.phase === 'loading'}
              className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pt-2"
            >
              <p className="m-0 shrink-0 pb-1 text-[11px] text-[color:var(--color-text-muted)]">
                {state.phase === 'loading'
                  ? 'Lendo a carteira no servidor…'
                  : page
                    ? `${orderedRows.length} de ${page.total} títulos · ${safePageNumber} de ${pageCount} páginas${refreshing ? ' · atualizando…' : ''}`
                    : 'Leitura não publicada'}
              </p>

              <div className="min-h-0 flex-1 overflow-auto">
                {state.phase === 'loading' ? <WorkspaceSkeletonRows rows={10} columns={6} /> : null}

                {state.phase === 'error' ? (
                  <WorkspaceEmpty
                    title="Não foi possível ler a carteira"
                    description={state.message}
                    action={
                      <button type="button" className={financeControlClass} onClick={() => void reload()}>
                        Tentar novamente
                      </button>
                    }
                  />
                ) : null}

                {state.phase === 'ready' && portfolioEmpty ? (
                  <WorkspaceEmpty
                    title="Nenhum título a receber registrado."
                    description="Os títulos nascem do faturamento: quando um documento é emitido, ele aparece aqui com vencimento, saldo e situação. Nada foi somado nem estimado nesta tela."
                    action={
                      <Link className={financeControlClass} to="/app/billing">
                        Ver faturamento
                      </Link>
                    }
                  />
                ) : null}

                {state.phase === 'ready' && recorteEmpty ? (
                  <WorkspaceEmpty
                    title="Nenhum título neste recorte"
                    description="Nenhum título corresponde ao recorte atual. Ajuste o filtro ou limpe a visão para ver toda a carteira."
                    action={
                      <button
                        type="button"
                        className={financeControlClass}
                        onClick={() => {
                          patchParams({ status: null, q: null, dueFrom: null, dueTo: null });
                          setFilterGroup(emptyFilterGroup());
                        }}
                      >
                        Limpar recorte
                      </button>
                    }
                  />
                ) : null}

                {state.phase === 'ready' && !portfolioEmpty && !recorteEmpty && schema ? (
                  <DynamicList
                    schema={schema}
                    rows={rows}
                    ariaLabel="Lista de contas a receber"
                    emptyMessage="Nenhum título corresponde ao recorte atual."
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
                    /*
                      CELULAS TIPADAS — a engine reserva a coluna, a TELA escolhe o controle.
                      `due_date` ganha o prazo RELATIVO ao lado da data: a data diz QUANDO venceu, o
                      prazo diz se isso e problema hoje, e a decisao de cobranca precisa dos dois.
                    */
                    renderCell={(field, row) => {
                      const currency = text(row['currency_code']);
                      if (field.name === 'lifecycle') {
                        return (
                          <FinanceStatusBadge
                            status={text(row['lifecycle'])}
                            labels={RECEIVABLE_STATUS_LABELS}
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
                        CLIENTE — o DTO publica apenas `clientId` (UUID).
                        A celula DECLARA a ausencia em vez de imprimir o identificador tecnico; o
                        caminho para o cadastro vive na coluna de contexto, onde ele e do REGISTRO e
                        nao da repeticao em todas as linhas.
                      */
                      if (field.name === 'client_id') {
                        return text(row['client_id']) ? (
                          <span className="cisne-type-meta">Cliente não publicado</span>
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
                    {page.offset + 1}–{Math.min(page.offset + page.limit, page.total)} de {page.total}
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

      {/*
        DRAWER — mesma leitura em viewport estreita, onde duas colunas nao cabem.
        O conteudo e IDENTICO ao da coluna de contexto: um unico lugar monta a previa.
      */}
      <ContextDrawer
        open={drawerOpen && previewRow !== null}
        title="Contexto do título"
        preview={previewRow ? buildReceivablePreview(previewRow) : null}
        onClose={() => setDrawerOpen(false)}
      />
    </ModulePage>
  );
}

/** Valor de celula como texto, nunca `String(valor)` direto — `String(undefined)` viraria "undefined". */
function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

/** Origem humana do recebível — apresentação, não domínio (o token persiste intacto). */
const RECEIVABLE_ORIGIN_LABELS: Record<string, string> = {
  BILLING_DOCUMENT: 'Nota de Fatura',
  BILLING_RECORD: 'Faturamento',
  SERVICE_ORDER: 'Ordem de serviço',
  MEASUREMENT: 'Medição',
};

function formatOriginKind(kind: string): string {
  return RECEIVABLE_ORIGIN_LABELS[kind] ?? (kind || '—');
}

/**
 * Cadeia empresarial montada SOMENTE com vínculos que já existem no payload
 * (`origin.serviceOrderId`, `origin.measurementId`, `clientId`). Nenhum degrau é afirmado sem
 * lastro: se um id não vier, o degrau não aparece.
 */
export function receivableChainLinks(row: ReceivableDetail): ChainLink[] {
  const origin = row.origin;
  const links: ChainLink[] = [];
  if (row.clientId) {
    links.push({ step: 'CLIENTE', label: 'Cliente', href: `/app/clients/${row.clientId}` });
  }
  if (origin.serviceOrderId) {
    links.push({
      step: 'OS',
      label: 'Ordem de serviço',
      // A OS nao tem rota raiz publicada: o ponto de entrada real e o planejamento, que e a
      // object page mae do dominio. Sem o sufixo o link nao resolvia rota.
      href: `/app/service-orders/${origin.serviceOrderId}/planning`,
    });
  }
  if (origin.measurementId) {
    links.push({
      step: 'MEDICAO',
      label: 'Medição',
      href: `/app/service-orders/${origin.serviceOrderId}/measurement`,
    });
  }
  if (origin.billingRecordId) {
    links.push({
      step: 'FATURAMENTO',
      label: 'Faturamento',
      href: `/app/service-orders/${origin.serviceOrderId}/billing`,
    });
  }
  links.push({ step: 'RECEBIVEL', label: row.externalReference ?? 'Recebível' });
  return links;
}

/** Cadeia exibida onde o vínculo já está disponível. Feature exclusiva desta tela. */
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
      { label: 'Atraso', value: overdueLabel(row.dueDate) ?? 'sem atraso' },
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
      /*
       * Relacao sem rotulo humano NAO exibe o identificador tecnico: o vinculo existe (e navega,
       * quando ha destino real), mas o valor mostrado e o nome do objeto.
       */
      { label: 'Cliente', value: 'Abrir cadastro do cliente', href: `/app/clients/${row.clientId}` },
      {
        label: 'Ordem de serviço',
        value: 'Abrir planejamento da ordem',
        href: `/app/service-orders/${origin.serviceOrderId}/planning`,
      },
      {
        label: 'Documento de faturamento',
        value: origin.billingRecordId ? 'Gerado pelo faturamento' : '',
      },
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
