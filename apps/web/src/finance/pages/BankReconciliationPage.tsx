import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, DateTime, EmptyState, Field, Input, Money, Select, Textarea, VersionConflictBanner, worklistTableCardClass } from '../../ui';
import { ModuleDeniedState, ModuleErrorState, ModuleLoadingState, ModulePage, ModuleStatePage, ModulePagination, UnitScopeLabel, filterControlClass } from '../../ui/module-layout';
import { worklistCellClass, worklistTableClass, worklistHeadCellClass, worklistNumericCellClass, worklistNumericHeadCellClass, worklistRowClass, WorklistHeader } from '../../ui/enterprise-list';
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
  BankStatementLine,
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

/**
 * Conciliação rastreada para UMA linha, se houver.
 *
 * A lista vem do auto-match e do vínculo manual desta sessão — nunca de um casamento calculado
 * aqui. Sem entrada, não existe lado de sistema para a linha, e a célula declara ausência.
 */
function reconciliationForLine(
  lineId: string,
  tracked: ReconciliationMatch[],
): ReconciliationMatch | undefined {
  return tracked.find((item) => item.bankStatementLineId === lineId);
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
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
 * PRIORIDADE DE EXCEÇÃO — a ordem em que o operador precisa ver as linhas.
 *
 * Conciliação é trabalho de exceção: o que está sem vínculo ou divergente decide o dia, e o que
 * já bateu é conferência. A ordenação põe o problema primeiro, e `duplicate` (que o contrato
 * publica e a tela não usava) entra como o sinal mais grave de todos: uma linha repetida no
 * extrato contamina o saldo.
 */
const MATCH_PRIORITY: Record<string, number> = {
  UNMATCHED: 0,
  REVIEW_REQUIRED: 1,
  SUGGESTED: 2,
  MATCHED: 3,
};

function linePriority(line: BankStatementLine): number {
  if (line.duplicate) {
    return -1;
  }
  return MATCH_PRIORITY[line.matchStatus] ?? 0;
}

/**
 * WORKSPACE DE CONCILIAÇÃO BANCÁRIA.
 *
 * A tela é uma MESA DE TRABALHO, não uma listagem. A área principal compara LADO A LADO o que o
 * banco publicou e o que o CISNE tem para casar com aquilo — é a única forma de o operador
 * decidir um vínculo sem abrir duas telas.
 *
 * DECISÃO DE DENSIDADE — e a correção mais importante desta reescrita.
 * A versão anterior desenhava UM CARTÃO POR LINHA sem vínculo. Num extrato de 60 linhas isso são
 * 60 cartões empilhados: a página vira uma parede de blocos, o operador rola por minutos e não
 * consegue comparar dois lançamentos. Conciliação exige GRADE — muitas linhas visíveis ao mesmo
 * tempo, valores alinhados, exceção marcada na própria linha. As linhas agora vivem numa grade
 * densa; a fila de cartões permanece apenas na LISTA de extratos, onde a unidade de trabalho é o
 * extrato inteiro e o volume é pequeno.
 *
 * EXCEÇÃO PRIMEIRO: a grade ordena por gravidade (divergente/sem vínculo → revisão → sugerido →
 * conciliado), então o que exige decisão aparece antes do que já está resolvido.
 *
 * LADO BANCO × LADO SISTEMA: o valor do banco vem da própria linha do extrato; o lado do sistema
 * vem do `match` da conciliação, que é o único lugar onde o contrato publica o valor do registro
 * casado. Quando a linha não tem conciliação, não há lado de sistema — e nenhum valor é inventado
 * para preencher a célula. A DIFERENÇA só é exibida quando os dois lados existem E divergem; ela
 * é aritmética entre dois números publicados, não um recálculo de domínio.
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
  /*
   * ORDEM DE EXCEÇÃO. A grade é o instrumento de trabalho: o que está divergente ou sem vínculo
   * tem de aparecer na primeira dobra, e não depois de 40 linhas já conciliadas. A ordenação é
   * estável — linhas de mesma gravidade mantêm a ordem do extrato.
   *
   * CADEIA: source → order → PAGINATE → render. O extrato NÃO é paginado pelo servidor —
   * `getBankStatement` devolve todas as linhas de uma vez —, então o recorte de página continua
   * sendo LOCAL, como já era antes desta reescrita. Paginar DEPOIS de ordenar é o que mantém a
   * exceção na primeira página; renderizar as 60 linhas de uma vez encheria o DOM e traria de
   * volta a parede de rolagem que esta mudança existe para eliminar.
   */
  const orderedLines = lines
    .map((line, index) => ({ line, index }))
    .sort((left, right) => {
      const byPriority = linePriority(left.line) - linePriority(right.line);
      return byPriority !== 0 ? byPriority : left.index - right.index;
    })
    .map((entry) => entry.line);
  const safePageNumber = Math.min(pageNumber, pageCount);
  const pageItems = sliceTablePage(orderedLines, safePageNumber);
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

          {/*
            ÁREA DE TRABALHO — GRADE DENSA DE COMPARAÇÃO, banco ↔ CISNE.

            Uma linha por movimento do extrato, ordenada por GRAVIDADE da exceção. O operador lê
            as duas colunas de valor lado a lado e decide na própria linha: não há cartão por
            movimento, e por isso 60 linhas continuam cabendo na tela.
          */}
          <section className="mb-3">
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="m-0 text-sm font-semibold text-gray-900">
                Movimentos do extrato × registros do CISNE
              </h2>
              <p className="m-0 text-[11px] text-gray-500">
                Ordenado por exceção: divergência e falta de vínculo primeiro. O servidor exige
                correspondência exata (conta, valor, direção e data); nada é casado no navegador.
              </p>
            </div>

            {lines.length === 0 ? (
              <EmptyState title="Extrato sem linhas" />
            ) : (
              <>
                <div className={worklistTableCardClass}>
                  <table
                    className={worklistTableClass}
                    aria-label="Movimentos do extrato bancário"
                  >
                    <thead>
                      <tr>
                        <th scope="col" className={worklistHeadCellClass}>
                          Movimento bancário
                        </th>
                        <th scope="col" className={worklistHeadCellClass}>
                          Vencimento
                        </th>
                        <th scope="col" className={worklistNumericHeadCellClass}>
                          Valor banco
                        </th>
                        <th scope="col" className={worklistHeadCellClass}>
                          Registro no CISNE
                        </th>
                        <th scope="col" className={worklistNumericHeadCellClass}>
                          Valor sistema
                        </th>
                        <th scope="col" className={worklistNumericHeadCellClass}>
                          Diferença
                        </th>
                        <th scope="col" className={worklistHeadCellClass}>
                          Situação
                        </th>
                        <th scope="col" className={worklistHeadCellClass}>
                          Ação
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageItems.map((line) => {
                        const reconciliation = reconciliationForLine(
                          line.id,
                          trackedReconciliations,
                        );
                        const systemAmount = reconciliation?.match?.amount ?? null;
                        const difference =
                          systemAmount === null ? null : Number(line.amount) - Number(systemAmount);
                        const isDuplicate = line.duplicate;
                        const needsWork = line.matchStatus !== 'MATCHED';
                        return (
                          <tr
                            key={line.id}
                            className={
                              isDuplicate
                                ? `${worklistRowClass} bg-red-50/60`
                                : needsWork
                                  ? `${worklistRowClass} bg-amber-50/40`
                                  : worklistRowClass
                            }
                            data-match-status={line.matchStatus}
                            data-duplicate={String(isDuplicate)}
                          >
                            <td className={worklistCellClass}>
                              <span className="font-medium text-gray-900">
                                {line.description}
                              </span>
                              <span className="mt-0.5 block font-mono text-[11px] text-gray-500">
                                #{line.lineNumber} ·{' '}
                                {MOVEMENT_DIRECTION_LABELS[line.direction] ?? line.direction}
                              </span>
                              {isDuplicate ? (
                                <span className="mt-0.5 block text-[11px] font-semibold text-red-700">
                                  Linha repetida no extrato
                                </span>
                              ) : null}
                            </td>
                            <td className={worklistCellClass}>
                              <DateTime value={line.occurredOn} mode="date" />
                            </td>
                            <td className={worklistNumericCellClass}>
                              <Money value={line.amount} emphasis />
                            </td>
                            <td className={worklistCellClass}>
                              {reconciliation?.match ? (
                                <>
                                  <span className="font-medium text-gray-800">
                                    {reconciliation.match.targetKind}
                                  </span>
                                  <span className="mt-0.5 block font-mono text-[11px] text-gray-500">
                                    {reconciliation.match.targetId}
                                  </span>
                                </>
                              ) : (
                                <span className="text-[11px] text-gray-400">
                                  Nenhum candidato publicado
                                </span>
                              )}
                            </td>
                            <td className={worklistNumericCellClass}>
                              {systemAmount === null ? (
                                <span className="text-gray-400">—</span>
                              ) : (
                                <Money value={systemAmount} />
                              )}
                            </td>
                            <td className={worklistNumericCellClass}>
                              {difference === null ? (
                                <span className="text-gray-400">—</span>
                              ) : difference === 0 ? (
                                <span className="text-[11px] font-medium text-green-700">
                                  Sem diferença
                                </span>
                              ) : (
                                <span className="font-semibold text-red-700">
                                  {formatCurrency(Math.abs(difference))}
                                </span>
                              )}
                            </td>
                            <td className={worklistCellClass}>
                              <FinanceStatusBadge
                                status={line.matchStatus}
                                labels={MATCH_STATUS_LABELS}
                              />
                            </td>
                            <td className={worklistCellClass}>
                              {needsWork ? (
                                <button
                                  type="button"
                                  className="rounded border border-brand-600 bg-white px-2 py-0.5 text-[12px] font-semibold text-brand-700 hover:bg-brand-50"
                                  onClick={() => {
                                    setManualMatch((current) => ({
                                      ...current,
                                      lineId: line.id,
                                    }));
                                    document
                                      .getElementById('match-transaction')
                                      ?.focus();
                                  }}
                                >
                                  Vincular
                                </button>
                              ) : (
                                <span className="text-[11px] text-gray-400">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <ModulePagination
                  pageNumber={safePageNumber}
                  rangeLabel={`Página ${safePageNumber} de ${pageCount} · ${lines.length} linhas`}
                  onPrevious={() => setPageNumber((current) => Math.max(1, current - 1))}
                  onNext={() => setPageNumber((current) => Math.min(pageCount, current + 1))}
                  previousDisabled={safePageNumber <= 1}
                  nextDisabled={safePageNumber >= pageCount}
                />
              </>
            )}
          </section>

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
