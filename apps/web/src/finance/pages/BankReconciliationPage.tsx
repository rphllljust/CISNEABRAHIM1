import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, DateTime, EmptyState, Field, Input, Money, Select, Textarea, VersionConflictBanner, worklistTableCardClass } from '../../ui';
import { ModuleDeniedState, ModuleErrorState, ModuleLoadingState, ModulePage, ModuleStatePage, ModulePagination, UnitScopeLabel, filterControlClass } from '../../ui/module-layout';
import { worklistCellClass, worklistTableClass, worklistHeadCellClass, worklistRowClass, WorklistHeader } from '../../ui/enterprise-list';
import { WorklistException, WorklistField, WorklistFilterBar, worklistSelectClass } from '../../ui/enterprise-list';
import {
  WorkbenchMetric,
  WorkbenchQueue,
  WorkbenchQueueItem,
  WorkbenchSummaryStrip,
  workbenchPrimaryActionClass,
  workbenchSecondaryActionClass,
} from '../../ui/workbench';
import { HumanLookupField, type HumanLookupOption } from '../../financial-ui/HumanLookupField';
import { SavedViewsBar, useSmartList } from '../../operator';
import { BackofficeApiError } from '../../financial-ui/enterprise-api';
import { createIdempotencyKey } from '../../financial-ui/idempotency';
import { MATCH_STATUS_LABELS, MOVEMENT_DIRECTION_LABELS, STATEMENT_STATUS_LABELS } from '../../financial-ui/labels';
import { ProcessingBanner } from '../../financial-ui/ProcessingBanner';
import { VersionedActionForm } from '../../financial-ui/VersionedActionForm';
import { sliceTablePage, tablePageCount } from '../../financial-ui/table-slice';
import {
  autoMatchStatement,
  confirmReconciliation,
  getBankStatement,
  importBankFile,
  listBankStatements,
  listTreasuryAccounts,
  matchBankStatementLine,
  unreconcileReconciliation,
} from '../api/finance-api';
import { mapFinanceErrorToMessage } from '../api/finance-error-messages';
import { FinanceStatusBadge } from '../components/FinanceStatusBadge';
import type {
  AutoMatchResult,
  BankStatement,
  BankStatementSummary,
  ReconciliationMatch,
} from '../types/finance.types';

type PageState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error'; message: string; retryable: boolean; conflict: boolean }
  | { phase: 'ready'; statement: BankStatement; autoMatch?: AutoMatchResult };

type ListState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error'; message: string; retryable: boolean }
  | { phase: 'ready'; items: BankStatementSummary[]; offset: number; total: number };

const PAGE_SIZE = 20;

/** Escopo estavel de persistencia das visoes salvas desta mesa de trabalho. */
const SCOPE = 'finance.bank-statements';

/**
 * Valores de status aceitos como visao/URL — os mesmos enumerados persistidos em
 * `fin.bank_statement_status`. A lista de extratos abre JÁ recortada quando o endereço traz o
 * filtro, e a API recebe o mesmo valor.
 */
const STATEMENTS_ALLOWED_FILTERS = {
  filters: { status: ['OPEN', 'CLOSED'] },
} as const;

const STATEMENTS_BUILT_IN_VIEWS = [
  {
    id: 'builtin.bank-statements.open',
    name: 'Extratos abertos',
    description: 'Extratos ainda em conciliação.',
    config: { filters: { status: 'OPEN' }, sortKey: null, sortDirection: 'asc' as const, groupKey: null },
  },
  {
    id: 'builtin.bank-statements.closed',
    name: 'Extratos fechados',
    description: 'Extratos já encerrados.',
    config: { filters: { status: 'CLOSED' }, sortKey: null, sortDirection: 'asc' as const, groupKey: null },
  },
];

const RECONCILIATION_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  CONFIRMED: 'Confirmada',
  UNRECONCILED: 'Desfeita',
};

/** Secao compacta do detalhe — densidade de linha de operacao, nao cartao de respiro. */
function WorkbenchSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-3 rounded-md border border-gray-200 bg-white px-3 py-2">
      <h2 className="mb-1.5 text-sm font-semibold text-gray-900">{title}</h2>
      {description ? <p className="mb-2 text-xs text-gray-500">{description}</p> : null}
      {children}
    </section>
  );
}

/**
 * Situação de conciliação do extrato, derivada APENAS das contagens persistidas que o servidor
 * devolve. Não existe score de IA, nem correspondência inventada nesta tela.
 */
function reconciliationSituation(statement: BankStatementSummary): string {
  if (statement.lineCount === 0) {
    return 'Sem linhas';
  }
  if (statement.unreconciledLineCount === 0) {
    return 'Todas conciliadas';
  }
  if (statement.matchedLineCount > 0) {
    return `${statement.matchedLineCount} conciliada(s) de ${statement.lineCount}`;
  }
  return `${statement.lineCount} linha(s) pendente(s)`;
}

/**
 * Exceção do extrato — o fato que coloca o extrato na fila de trabalho, dito com o número real
 * publicado pelo servidor. Nunca há marcador sem contagem que o sustente.
 */
function statementExceptionSeverity(statement: BankStatementSummary): {
  tone: 'neutral' | 'warning' | 'success';
  label: string;
} {
  if (statement.lineCount === 0) {
    return { tone: 'neutral', label: 'Sem linhas importadas' };
  }
  if (statement.unreconciledLineCount === 0) {
    return { tone: 'success', label: 'Todas conciliadas' };
  }
  return {
    tone: 'warning',
    label: `${statement.unreconciledLineCount} linha(s) sem vínculo`,
  };
}

/**
 * Busca de contas bancárias para escolha humana no filtro.
 *
 * Usa a listagem de tesouraria — a mesma autoridade que valida o vínculo — em vez de exigir que o
 * operador cole um identificador técnico. Se o ator não puder listar contas, a busca devolve vazio
 * e a tela continua funcionando pelo status e pelo período.
 */
async function searchBankAccountOptions(
  term: string,
  signal?: AbortSignal,
): Promise<HumanLookupOption[]> {
  const accounts = await listTreasuryAccounts(signal);
  const needle = term.trim().toLowerCase();
  return accounts
    .filter((account) => account.kind === 'BANK' || account.kind === 'CASH')
    .filter((account) =>
      needle.length === 0
        ? true
        : `${account.code} ${account.name}`.toLowerCase().includes(needle),
    )
    .slice(0, 20)
    .map((account) => ({
      id: account.id,
      label: `${account.code} — ${account.name}`,
      support: account.unitId,
    }));
}

function errorInfo(error: unknown): { message: string; retryable: boolean; conflict: boolean } {
  if (error instanceof BackofficeApiError) {
    return {
      message: mapFinanceErrorToMessage(error.code, error.status),
      retryable: error.kind === 'network' || error.kind === 'unknown',
      conflict: error.kind === 'version_conflict' || error.kind === 'closed_period',
    };
  }
  return { message: mapFinanceErrorToMessage(undefined, 0), retryable: true, conflict: false };
}

/**
 * MESA DE CONCILIAÇÃO BANCÁRIA — FILA DE EXCEÇÕES.
 *
 * A tela abre pela LISTA REAL de extratos (`GET /finance/bank-statements`), com filtros
 * server-side de status, conta e período. O operador escolhe um extrato pelo rótulo humano e a
 * seleção vive na URL (`/app/finance/reconciliation/:statementId`), então o endereço é
 * compartilhável. Nenhum identificador técnico precisa ser digitado.
 *
 * A lista deixou de ser apenas grade: cada extrato entra na fila com a EXCEÇÃO que o coloca lá
 * (linhas sem vínculo, lida de `unreconciledLineCount`), a situação persistida, o período real e a
 * próxima ação. Aberto o extrato, a MESMA superfície de trabalho de antes — auto-match, vínculo
 * manual, confirmar, desfazer, conflito de versão, idempotência e erros inline — continua sendo do
 * motor do servidor: o backend segue sendo a fonte de verdade. Nada de regra, rota ou permissão
 * mudou; o que mudou é que as exceções agora vêm primeiro.
 */
export function BankReconciliationPage() {
  const { statementId: routeStatementId } = useParams();
  const navigate = useNavigate();
  const statementId = routeStatementId ?? '';
  const [listState, setListState] = useState<ListState>({ phase: 'loading' });
  const [state, setState] = useState<PageState>({ phase: 'idle' });
  const [pageNumber, setPageNumber] = useState(1);
  const [actionError, setActionError] = useState<{ message: string; conflict: boolean } | null>(null);
  const [accountFilter, setAccountFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [appliedWindow, setAppliedWindow] = useState({ dateFrom: '', dateTo: '' });
  const [importOpen, setImportOpen] = useState(false);
  const [importFields, setImportFields] = useState({
    unitId: '',
    financialAccountId: '',
    fileName: 'extrato.json',
    content: '',
  });
  const [manualMatch, setManualMatch] = useState({ lineId: '', transactionId: '' });
  const [trackedReconciliations, setTrackedReconciliations] = useState<ReconciliationMatch[]>([]);
  const [selectedReconciliationId, setSelectedReconciliationId] = useState('');
  const [processing, setProcessing] = useState(false);
  const inflight = useRef(false);
  const idempotencyKey = useRef(createIdempotencyKey());

  // O status vive na URL e em visão salva: o endereço é compartilhável e o mesmo valor chega à API.
  const smartList = useSmartList({
    scope: SCOPE,
    builtInViews: STATEMENTS_BUILT_IN_VIEWS,
    allowedFilters: STATEMENTS_ALLOWED_FILTERS,
    urlSync: true,
  });
  const statusFilter = smartList.filters.status ?? '';

  const clearActionError = useCallback(() => setActionError(null), []);

  const loadList = useCallback(
    async (offset: number, signal?: AbortSignal) => {
      setListState({ phase: 'loading' });
      try {
        const response = await listBankStatements(
          {
            limit: PAGE_SIZE,
            offset,
            status: statusFilter || undefined,
            financialAccountId: accountFilter || undefined,
            dateFrom: appliedWindow.dateFrom || undefined,
            dateTo: appliedWindow.dateTo || undefined,
          },
          signal,
        );
        setListState({ phase: 'ready', items: response.items, offset: response.offset, total: response.total });
      } catch (error) {
        if (error instanceof BackofficeApiError && (error.status === 403 || error.status === 401)) {
          setListState({ phase: 'denied' });
          return;
        }
        const status = error instanceof BackofficeApiError ? error.status : 0;
        const code = error instanceof BackofficeApiError ? error.code : undefined;
        setListState({
          phase: 'error',
          message: mapFinanceErrorToMessage(code, status),
          retryable: status === 0,
        });
      }
    },
    [accountFilter, appliedWindow.dateFrom, appliedWindow.dateTo, statusFilter],
  );

  const loadStatement = useCallback(
    async (id: string, signal?: AbortSignal) => {
      setState({ phase: 'loading' });
      setActionError(null);
      setTrackedReconciliations([]);
      setSelectedReconciliationId('');
      try {
        const statement = await getBankStatement(id, signal);
        setPageNumber(1);
        setState({ phase: 'ready', statement });
      } catch (error) {
        if (error instanceof BackofficeApiError && error.kind === 'denied') {
          setState({ phase: 'denied' });
          return;
        }
        setState({ phase: 'error', ...errorInfo(error) });
      }
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadList(0, controller.signal);
    return () => controller.abort();
  }, [loadList]);

  useEffect(() => {
    if (!statementId) {
      setState({ phase: 'idle' });
      return;
    }
    const controller = new AbortController();
    void loadStatement(statementId, controller.signal);
    return () => controller.abort();
  }, [loadStatement, statementId]);

  function openStatement(id: string) {
    void navigate(`/app/finance/reconciliation/${id}`);
  }

  function clearFilters() {
    smartList.clearFilters();
    setAccountFilter('');
    setDateFrom('');
    setDateTo('');
    setAppliedWindow({ dateFrom: '', dateTo: '' });
  }

  async function handleImport() {
    if (inflight.current) {
      return;
    }
    inflight.current = true;
    setProcessing(true);
    setActionError(null);
    try {
      const statement = await importBankFile({
        ...importFields,
        idempotencyKey: idempotencyKey.current,
      });
      idempotencyKey.current = createIdempotencyKey();
      setImportOpen(false);
      setTrackedReconciliations([]);
      setSelectedReconciliationId('');
      await loadList(
        listState.phase === 'ready' ? listState.offset : 0,
      );
      openStatement(statement.id);
    } catch (error) {
      const failure = errorInfo(error);
      // A falha da importação nunca apaga um extrato já carregado.
      if (state.phase === 'ready') {
        setActionError({ message: failure.message, conflict: failure.conflict });
      } else {
        setState({ phase: 'error', ...failure });
      }
    } finally {
      inflight.current = false;
      setProcessing(false);
    }
  }

  function registerReconciliations(matches: ReconciliationMatch[]) {
    setTrackedReconciliations((current) => {
      const next = [...current];
      for (const match of matches) {
        const existingIndex = next.findIndex((item) => item.id === match.id);
        if (existingIndex >= 0) {
          next[existingIndex] = match;
        } else {
          next.push(match);
        }
      }
      return next;
    });
  }

  async function handleAutoMatch() {
    if (state.phase !== 'ready' || inflight.current) {
      return;
    }
    inflight.current = true;
    setProcessing(true);
    setActionError(null);
    const statement = state.statement;
    try {
      const autoMatch = await autoMatchStatement(statement.id);
      const reloaded = await getBankStatement(statement.id);
      registerReconciliations(autoMatch.suggested);
      setState({ phase: 'ready', statement: reloaded, autoMatch });
    } catch (error) {
      // Falha do auto-match mantém o extrato carregado e mostra o erro inline.
      const failure = errorInfo(error);
      setActionError({ message: failure.message, conflict: failure.conflict });
    } finally {
      inflight.current = false;
      setProcessing(false);
    }
  }

  async function handleManualMatch() {
    if (inflight.current || !manualMatch.lineId || !manualMatch.transactionId.trim()) {
      return;
    }
    inflight.current = true;
    setProcessing(true);
    setActionError(null);
    try {
      const created = await matchBankStatementLine({
        bankStatementLineId: manualMatch.lineId,
        financialTransactionId: manualMatch.transactionId.trim(),
      });
      setManualMatch({ lineId: '', transactionId: '' });
      setSelectedReconciliationId(created.id);
      registerReconciliations([created]);
      if (state.phase === 'ready') {
        const reloaded = await getBankStatement(state.statement.id);
        setState({ phase: 'ready', statement: reloaded });
      }
    } catch (error) {
      const failure = errorInfo(error);
      setActionError({ message: failure.message, conflict: failure.conflict });
    } finally {
      inflight.current = false;
      setProcessing(false);
    }
  }

  async function handleConfirm() {
    if (!selectedReconciliationId || inflight.current) {
      return;
    }
    const confirmed = await confirmReconciliation(selectedReconciliationId);
    registerReconciliations([confirmed]);
    if (state.phase === 'ready') {
      const reloaded = await getBankStatement(state.statement.id);
      setState({ phase: 'ready', statement: reloaded });
    }
  }

  async function handleUnreconcile() {
    if (!selectedReconciliationId || inflight.current) {
      return;
    }
    const unreconciled = await unreconcileReconciliation(selectedReconciliationId);
    registerReconciliations([unreconciled]);
    if (state.phase === 'ready') {
      const reloaded = await getBankStatement(state.statement.id);
      setState({ phase: 'ready', statement: reloaded });
    }
  }

  if (listState.phase === 'loading' && !statementId) {
    return (
      <ModuleStatePage title="Conciliação">
        <ModuleLoadingState message="Carregando extratos bancários…" />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'denied') {
    return (
      <ModuleStatePage title="Conciliação">
        <ModuleDeniedState message="Você não tem permissão para acessar conciliação bancária." />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'error') {
    return (
      <ModuleStatePage title="Conciliação">
        <ModuleErrorState
          message={listState.message}
          retryable={listState.retryable}
          onRetry={() => void loadList(0)}
        />
      </ModuleStatePage>
    );
  }

  const statements = listState.phase === 'ready' ? listState.items : [];
  const offset = listState.phase === 'ready' ? listState.offset : 0;
  const total = listState.phase === 'ready' ? listState.total : 0;
  const listReady = listState.phase === 'ready';
  const listPageNumber = Math.floor(offset / PAGE_SIZE) + 1;
  const hasMore = offset + statements.length < total;
  const pendingLinesOnPage = statements.reduce(
    (sum, item) => sum + item.unreconciledLineCount,
    0,
  );
  const hasListFilter = Boolean(
    smartList.isFiltered || accountFilter || appliedWindow.dateFrom || appliedWindow.dateTo,
  );

  const statement = state.phase === 'ready' ? state.statement : null;
  const lines = statement?.lines ?? [];
  const pageCount = tablePageCount(lines.length);
  const pageItems = sliceTablePage(lines, Math.min(pageNumber, pageCount));
  const unmatchedLines = lines.filter((line) => line.matchStatus !== 'MATCHED');
  const selectedReconciliation = trackedReconciliations.find(
    (item) => item.id === selectedReconciliationId,
  );

  return (
    <ModulePage>
      {/*
        GRAMATICA DE WORKLIST — `WorklistHeader` no lugar de `ModulePageHeader`, a mesma cabeca
        das demais listas. A contagem e o total AUTORIZADO pelo servidor sob o filtro vigente; os
        indicadores sao os mesmos numeros que a faixa de resumo ja publicava, agora na cabeca.
      */}
      <WorklistHeader
        title="Conciliação bancária"
        count={total}
        context="Mesa de trabalho dos extratos importados: a fila mostra primeiro o que ainda tem linha sem vínculo. Filtros, paginação e conciliação são resolvidos pelo servidor."
      />

      {/* BARRA COMPACTA — mesmos controles e mesmos valores enviados à API. */}
      <WorklistFilterBar
        meta={
          hasListFilter ? (
            <button
              type="button"
              className="text-[11px] font-semibold text-brand-600 hover:text-brand-700"
              onClick={clearFilters}
            >
              Limpar filtros
            </button>
          ) : null
        }
      >
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setAppliedWindow({ dateFrom, dateTo });
          }}
        >
          <WorklistField label="Status" htmlFor="statement-status-filter">
            <select
              id="statement-status-filter"
              className={worklistSelectClass}
              value={statusFilter}
              onChange={(event) => smartList.setFilter('status', event.target.value)}
            >
              <option value="">Todos</option>
              <option value="OPEN">Aberto</option>
              <option value="CLOSED">Fechado</option>
            </select>
          </WorklistField>
          <WorklistField label="Período de" htmlFor="statement-date-from">
            <input
              id="statement-date-from"
              type="date"
              className={worklistSelectClass}
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            />
          </WorklistField>
          <WorklistField label="Período até" htmlFor="statement-date-to">
            <input
              id="statement-date-to"
              type="date"
              className={worklistSelectClass}
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
            />
          </WorklistField>
          <HumanLookupField
            label="Conta financeira"
            htmlFor="statement-account"
            placeholder="Buscar por código ou nome da conta"
            search={searchBankAccountOptions}
            value={accountFilter}
            onChange={setAccountFilter}
            emptyOptionLabel="Todas"
            emptyMessage="Nenhuma conta encontrada para a busca."
            className="min-w-0 max-w-sm flex-1"
          />
          <button
            type="submit"
            className="rounded border border-gray-300 bg-white px-2 py-1 text-[13px] font-semibold text-gray-700 hover:bg-gray-50"
          >
            Aplicar período
          </button>
        </form>
      </WorklistFilterBar>

      <SavedViewsBar
        views={smartList.savedViews.views}
        builtInViews={smartList.savedViews.builtInViews}
        activeViewId={smartList.activeViewId}
        onApply={(view) => smartList.applyView(view)}
        onSave={smartList.savedViews.saveView}
        onRename={smartList.savedViews.renameView}
        onRemove={smartList.savedViews.removeView}
        currentConfig={smartList.currentConfig}
        canSave={Object.keys(smartList.filters).length > 0}
        allLabel="Todos"
        className="mb-2"
      />

      {/*
        RESUMO DA MESA — só números que o servidor publicou: o total do recorte, o tamanho desta
        página e a soma das linhas sem conciliação dos extratos exibidos (`unreconciledLineCount`).
      */}
      {listReady ? (
        <WorkbenchSummaryStrip>
          <WorkbenchMetric value={total} label="extratos no filtro" />
          <WorkbenchMetric value={statements.length} label="nesta página" />
          <WorkbenchMetric
            value={pendingLinesOnPage}
            label="linhas sem conciliação nesta página"
            tone={pendingLinesOnPage > 0 ? 'warning' : 'success'}
          />
        </WorkbenchSummaryStrip>
      ) : null}

      <WorkbenchQueue
        title="Extratos a conciliar"
        count={statements.length}
        description="A situação vem das contagens persistidas do servidor; não existe score de correspondência nesta tela."
        emptyTitle={
          hasListFilter ? 'Nenhum extrato no recorte selecionado' : 'Nenhum extrato importado ainda'
        }
        emptyDescription={
          hasListFilter
            ? 'Ajuste ou limpe os filtros para ver o conjunto completo.'
            : 'Importe um arquivo no formato autorizado para começar a conciliar.'
        }
        emptyAction={
          hasListFilter ? (
            <button
              type="button"
              className={workbenchSecondaryActionClass}
              onClick={clearFilters}
            >
              Limpar filtros
            </button>
          ) : null
        }
      >
        {statements.map((item) => {
          const exception = statementExceptionSeverity(item);
          return (
            <WorkbenchQueueItem
              key={item.id}
              severity={
                <WorklistException
                  tone={
                    exception.tone === 'success'
                      ? 'info'
                      : exception.tone === 'neutral'
                        ? 'info'
                        : 'warning'
                  }
                >
                  {exception.label}
                </WorklistException>
              }
              severityTone={exception.tone === 'success' ? 'success' : exception.tone}
              title={
                <Link
                  to={`/app/finance/reconciliation/${item.id}`}
                  className="text-[13px] font-semibold text-brand-700 no-underline hover:text-brand-800"
                >
                  {item.sourceReference}
                </Link>
              }
              reason={reconciliationSituation(item)}
              context={
                <>
                  <span>{item.financialAccount.label}</span>
                  <span className="ml-3">
                    <UnitScopeLabel unitId={item.unitId} />
                  </span>
                  <span className="ml-3">
                    <FinanceStatusBadge status={item.status} labels={STATEMENT_STATUS_LABELS} />
                  </span>
                </>
              }
              age={
                <>
                  <DateTime value={item.periodStartsOn} mode="date" /> —{' '}
                  <DateTime value={item.periodEndsOn} mode="date" />
                </>
              }
              action={
                <button
                  type="button"
                  className={workbenchPrimaryActionClass}
                  onClick={() => openStatement(item.id)}
                >
                  Abrir conciliação
                </button>
              }
              drilldown={
                item.unreconciledLineCount > 0 ? (
                  <span className="text-xs text-gray-500">
                    {item.unreconciledLineCount} linha(s) aguardando vínculo
                  </span>
                ) : null
              }
            />
          );
        })}
      </WorkbenchQueue>

      <ModulePagination
        pageNumber={listPageNumber}
        previousDisabled={offset === 0}
        nextDisabled={!hasMore}
        onPrevious={() => void loadList(Math.max(0, offset - PAGE_SIZE))}
        onNext={() => void loadList(offset + PAGE_SIZE)}
      />
      <p className="mt-2 text-xs text-gray-500" role="status">
        {total} extrato(s) no total.
      </p>

      {!statementId ? (
        <EmptyState
          title="Nenhum extrato selecionado"
          description="Escolha um extrato na fila acima para abrir a mesa de conciliação."
        />
      ) : null}

      {statement ? (
        <>
          {/* IDENTIDADE DO EXTRATO ABERTO + AÇÃO REAL DO SERVIDOR. */}
          <section className="mb-2 flex flex-wrap items-center gap-3 rounded-md border border-gray-200 bg-white px-3 py-2">
            <h2 className="m-0 text-sm font-semibold text-gray-900">
              {statement.sourceReference}
            </h2>
            <FinanceStatusBadge status={statement.status} labels={STATEMENT_STATUS_LABELS} />
            <span className="text-sm text-gray-500">
              <DateTime value={statement.periodStartsOn} mode="date" /> —{' '}
              <DateTime value={statement.periodEndsOn} mode="date" />
            </span>
            <Button type="button" variant="secondary" onClick={() => void handleAutoMatch()} disabled={processing}>
              Sugerir vínculos
            </Button>
            <button
              type="button"
              className="text-sm font-semibold text-gray-700 hover:text-gray-900"
              onClick={() => void navigate('/app/finance/reconciliation')}
            >
              Fechar extrato
            </button>
          </section>

          {/*
            RESUMO DAS EXCEÇÕES. `Sugerir vínculos` devolve contagens do PRÓPRIO servidor
            (`suggested`, `unmatched`, `reviewRequired`): elas são exibidas como vieram.
          */}
          <WorkbenchSummaryStrip>
            <WorkbenchMetric value={lines.length} label="linhas no extrato" />
            <WorkbenchMetric
              value={unmatchedLines.length}
              label="sem vínculo"
              tone={unmatchedLines.length > 0 ? 'critical' : 'success'}
            />
            <WorkbenchMetric
              value={trackedReconciliations.length}
              label="conciliações nesta sessão"
              tone="info"
            />
            {state.phase === 'ready' && state.autoMatch ? (
              <>
                <WorkbenchMetric
                  value={state.autoMatch.suggested.length}
                  label="sugeridos pelo servidor"
                  tone="info"
                />
                <WorkbenchMetric
                  value={state.autoMatch.unmatched.length}
                  label="sem correspondência"
                  tone="warning"
                />
                <WorkbenchMetric
                  value={state.autoMatch.reviewRequired.length}
                  label="em revisão"
                  tone="warning"
                />
              </>
            ) : null}
          </WorkbenchSummaryStrip>

          {state.phase === 'ready' && state.autoMatch ? (
            <p className="mb-2 text-sm text-gray-600" role="status">
              Servidor sugeriu {state.autoMatch.suggested.length} vínculos, {state.autoMatch.unmatched.length} sem
              correspondência e {state.autoMatch.reviewRequired.length} em revisão.
            </p>
          ) : null}

          {/* A FILA DA MESA: cada linha do extrato que ainda exige vínculo. */}
          <WorkbenchQueue
            title="Exceções do extrato"
            count={unmatchedLines.length}
            description={
              lines.length === 0
                ? 'O extrato não tem linhas importadas.'
                : `${unmatchedLines.length} de ${lines.length} linha(s) ainda sem vínculo. O servidor exige correspondência exata (conta, valor, direção e data) para conciliar — nada é correspondido no navegador.`
            }
            emptyTitle="Nenhuma linha sem vínculo"
            emptyDescription="Todas as linhas deste extrato têm conciliação registrada."
            action={
              unmatchedLines.length === 0 ? null : (
                <Button type="button" variant="secondary" onClick={() => void handleAutoMatch()} disabled={processing}>
                  Sugerir vínculos
                </Button>
              )
            }
          >
            {unmatchedLines.map((line) => (
              <WorkbenchQueueItem
                key={line.id}
                severity={
                  <WorklistException
                    tone={line.matchStatus === 'REVIEW_REQUIRED' ? 'warning' : 'critical'}
                  >
                    {MATCH_STATUS_LABELS[line.matchStatus] ?? line.matchStatus}
                  </WorklistException>
                }
                severityTone={line.matchStatus === 'REVIEW_REQUIRED' ? 'warning' : 'critical'}
                title={`Linha ${line.lineNumber} · ${line.description}`}
                reason="Linha do extrato sem conciliação persistida: exige vínculo com um movimento financeiro."
                context={
                  <>
                    {MOVEMENT_DIRECTION_LABELS[line.direction] ?? line.direction} ·{' '}
                    <Money value={line.amount} />
                  </>
                }
                age={<DateTime value={line.occurredOn} mode="date" />}
                action={
                  <button
                    type="button"
                    className={workbenchPrimaryActionClass}
                    onClick={() =>
                      setManualMatch((current) => ({ ...current, lineId: line.id }))
                    }
                  >
                    Vincular esta linha
                  </button>
                }
                drilldown={
                  manualMatch.lineId === line.id ? (
                    <span className="text-xs font-semibold text-brand-700">
                      Selecionada para vínculo manual
                    </span>
                  ) : null
                }
              />
            ))}
          </WorkbenchQueue>

          {trackedReconciliations.length > 0 ? (
            <WorkbenchQueue
              title="Conciliações desta sessão"
              count={trackedReconciliations.length}
              description="Rastreadas nesta sessão: sugestionadas pelo servidor ou criadas no vínculo manual. Confirmar é ato imutável do backend."
            >
              {trackedReconciliations.map((reconciliation) => (
                <WorkbenchQueueItem
                  key={reconciliation.id}
                  severity={
                    <WorklistException
                      tone={reconciliation.status === 'CONFIRMED' ? 'info' : 'warning'}
                    >
                      {reconciliation.status === 'DRAFT'
                        ? 'Sugerido pelo servidor'
                        : (RECONCILIATION_STATUS_LABELS[reconciliation.status] ?? reconciliation.status)}
                    </WorklistException>
                  }
                  severityTone={reconciliation.status === 'CONFIRMED' ? 'success' : 'warning'}
                  title={`Linha ${
                    lines.find((line) => line.id === reconciliation.bankStatementLineId)?.lineNumber ?? '—'
                  }`}
                  context={
                    reconciliation.match
                      ? `${reconciliation.match.targetKind} ${reconciliation.match.targetId}`
                      : 'Sem alvo de correspondência publicado'
                  }
                  action={
                    <button
                      type="button"
                      className={workbenchSecondaryActionClass}
                      onClick={() => setSelectedReconciliationId(reconciliation.id)}
                    >
                      Selecionar para confirmar
                    </button>
                  }
                  drilldown={
                    selectedReconciliationId === reconciliation.id ? (
                      <span className="text-xs font-semibold text-brand-700">Selecionada</span>
                    ) : null
                  }
                />
              ))}
            </WorkbenchQueue>
          ) : null}

          {/* VÍNCULO MANUAL — mesma regra do servidor, mesmos campos e mesmos identificadores. */}
          <WorkbenchSection
            title="Vínculo manual"
            description="O servidor exige correspondência exata (conta, valor, direção e data) entre a linha e o movimento. Somente linhas ainda sem conciliação aparecem aqui."
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Linha do extrato" htmlFor="match-line" required>
                <Select
                  id="match-line"
                  className={filterControlClass}
                  value={manualMatch.lineId}
                  onChange={(event) => setManualMatch((current) => ({ ...current, lineId: event.target.value }))}
                  disabled={unmatchedLines.length === 0}
                  required
                >
                  <option value="">Selecione…</option>
                  {unmatchedLines.map((line) => (
                    <option key={line.id} value={line.id}>
                      Linha {line.lineNumber} · {line.description}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Identificador do movimento financeiro" htmlFor="match-transaction" required>
                <Input
                  id="match-transaction"
                  className={filterControlClass}
                  value={manualMatch.transactionId}
                  onChange={(event) =>
                    setManualMatch((current) => ({ ...current, transactionId: event.target.value }))
                  }
                  required
                />
              </Field>
            </div>
            <div className="mt-3">
              <Button type="button" onClick={() => void handleManualMatch()} loading={processing} disabled={processing}>
                Vincular manualmente
              </Button>
            </div>
          </WorkbenchSection>

          {trackedReconciliations.length > 0 ? (
            <WorkbenchSection title="Confirmar ou desfazer conciliação">
              <Field label="Conciliação" htmlFor="reconciliation-select">
                <Select
                  id="reconciliation-select"
                  className={`${filterControlClass} max-w-xl`}
                  value={selectedReconciliationId}
                  onChange={(event) => setSelectedReconciliationId(event.target.value)}
                >
                  <option value="">Selecione…</option>
                  {trackedReconciliations.map((reconciliation) => (
                    <option key={reconciliation.id} value={reconciliation.id}>
                      Linha{' '}
                      {lines.find((line) => line.id === reconciliation.bankStatementLineId)?.lineNumber ?? '—'} ·{' '}
                      {RECONCILIATION_STATUS_LABELS[reconciliation.status] ?? reconciliation.status}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <VersionedActionForm
                  title="Confirmar conciliação"
                  description="Confirmação imutável: depois de confirmada só é revertida por desfazer autorizado."
                  confirmTitle="Confirmar conciliação"
                  confirmDescription="O backend valida que a conciliação ainda é rascunho."
                  confirmLabel="Confirmar"
                  disabled={!selectedReconciliation || selectedReconciliation.status !== 'DRAFT'}
                  mapError={mapFinanceErrorToMessage}
                  onReload={() => (statement ? void loadStatement(statement.id) : undefined)}
                  onSubmit={handleConfirm}
                />
                <VersionedActionForm
                  title="Desfazer conciliação"
                  description="Reverte uma conciliação confirmada para o estado anterior."
                  confirmTitle="Desfazer conciliação"
                  confirmDescription="Somente conciliações confirmadas podem ser desfeitas."
                  confirmLabel="Desfazer conciliação"
                  variant="danger"
                  disabled={!selectedReconciliation || selectedReconciliation.status !== 'CONFIRMED'}
                  mapError={mapFinanceErrorToMessage}
                  onReload={() => (statement ? void loadStatement(statement.id) : undefined)}
                  onSubmit={handleUnreconcile}
                />
              </div>
            </WorkbenchSection>
          ) : null}

          {/* DETALHE COMPLETO — todas as linhas do extrato, com o vínculo persistido de cada uma. */}
          {lines.length === 0 ? (
            <EmptyState title="Extrato sem linhas" />
          ) : (
            <>
              <div className={worklistTableCardClass}>
                <table className={worklistTableClass} aria-label="Linhas do extrato bancário">
                  <thead className={worklistHeadCellClass}>
                    <tr>
                      <th scope="col" className={worklistHeadCellClass}>
                        Linha
                      </th>
                      <th scope="col" className={worklistHeadCellClass}>
                        Data
                      </th>
                      <th scope="col" className={worklistHeadCellClass}>
                        Descrição
                      </th>
                      <th scope="col" className={worklistHeadCellClass}>
                        Vínculo
                      </th>
                      <th scope="col" className={`${worklistHeadCellClass} text-right`}>
                        Valor
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map((line) => (
                      <tr key={line.id} className={worklistRowClass}>
                        <td className={worklistCellClass}>{line.lineNumber}</td>
                        <td className={worklistCellClass}>
                          <DateTime value={line.occurredOn} mode="date" />
                        </td>
                        <td className={`${worklistCellClass} max-w-xs whitespace-normal`}>
                          {line.description}
                          <span className="ml-2 text-xs text-gray-500">
                            {MOVEMENT_DIRECTION_LABELS[line.direction] ?? line.direction}
                          </span>
                        </td>
                        <td className={worklistCellClass}>
                          <FinanceStatusBadge status={line.matchStatus} labels={MATCH_STATUS_LABELS} />
                        </td>
                        <td className={`${worklistCellClass} text-right`}>
                          <Money value={line.amount} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ModulePagination
                pageNumber={Math.min(pageNumber, pageCount)}
                rangeLabel={`Página ${Math.min(pageNumber, pageCount)} de ${pageCount} · ${lines.length} linhas`}
                onPrevious={() => setPageNumber((current) => Math.max(1, current - 1))}
                onNext={() => setPageNumber((current) => Math.min(pageCount, current + 1))}
                previousDisabled={pageNumber <= 1}
                nextDisabled={pageNumber >= pageCount}
              />
            </>
          )}
        </>
      ) : null}

      {processing ? (
        <div className="mb-3">
          <ProcessingBanner />
        </div>
      ) : null}

      {actionError ? (
        actionError.conflict ? (
          <div className="mb-3">
            <VersionConflictBanner
              message={actionError.message}
              onReload={() => (statement ? void loadStatement(statement.id) : undefined)}
            />
          </div>
        ) : (
          <p className="mb-3 text-sm text-red-700" role="alert">
            {actionError.message}
          </p>
        )
      ) : null}

      {state.phase === 'error' ? (
        state.conflict ? (
          <div className="mb-3">
            <VersionConflictBanner message={state.message} onReload={clearActionError} reloadLabel="Entendido" />
          </div>
        ) : (
          <p className="mb-3 text-sm text-red-700" role="alert">
            {state.message}
          </p>
        )
      ) : null}

      <WorkbenchSection
        title="Importar arquivo autorizado"
        description="A importação é do servidor, com idempotência: nenhum arquivo é interpretado no navegador."
      >
        <div className="mb-2 flex flex-wrap items-center justify-end gap-3">
          <Button type="button" variant="secondary" onClick={() => setImportOpen((current) => !current)}>
            {importOpen ? 'Ocultar importação' : 'Importar extrato'}
          </Button>
        </div>
        {importOpen ? (
          <div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Unidade" htmlFor="import-unit" required>
                <Input
                  id="import-unit"
                  className={filterControlClass}
                  value={importFields.unitId}
                  onChange={(event) => setImportFields((current) => ({ ...current, unitId: event.target.value }))}
                  required
                />
              </Field>
              <Field label="Conta financeira" htmlFor="import-account" required>
                <Input
                  id="import-account"
                  className={filterControlClass}
                  value={importFields.financialAccountId}
                  onChange={(event) =>
                    setImportFields((current) => ({ ...current, financialAccountId: event.target.value }))
                  }
                  required
                />
              </Field>
            </div>
            <Field label="Conteúdo" htmlFor="import-content" className="mt-3">
              <Textarea
                id="import-content"
                value={importFields.content}
                onChange={(event) => setImportFields((current) => ({ ...current, content: event.target.value }))}
              />
            </Field>
            <div className="mt-3">
              <Button type="button" onClick={() => void handleImport()} loading={processing} disabled={processing}>
                Enviar ao servidor
              </Button>
            </div>
          </div>
        ) : null}
      </WorkbenchSection>
    </ModulePage>
  );
}
