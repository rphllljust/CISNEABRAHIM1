import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, DateTime, Field, Input, Money, Select, StatusBadge } from '../../ui';
import { ModulePage } from '../../ui/module-layout';
import {
  EnterpriseMetric,
  WorklistClearFilters,
  WorklistField,
  WorklistFilterBar,
  WorklistFooter,
  WorklistHeader,
  WorklistRowLink,
  WorklistStatePanel,
  rowPrimaryActionClass,
  worklistCellClass,
  worklistCellRaisedClass,
  worklistHeadCellClass,
  worklistNumericHeadCellClass,
  worklistNumericCellClass,
  worklistRowClass,
  worklistSelectClass,
  worklistTableCardClass,
  worklistTableClass,
} from '../../ui/enterprise-list';
import {
  ContextDrawer,
  SavedViewsBar,
  useSavedViews,
  type BuiltInView,
  type ContextPreviewBody,
  type SmartListAllowedFilters,
} from '../../operator';
import { ClosedPeriodBanner } from '../../financial-ui/ClosedPeriodBanner';
import { DefinitionList } from '../../financial-ui/DefinitionList';
import { JOURNAL_STATUS_LABELS, MOVEMENT_DIRECTION_LABELS, PERIOD_STATUS_LABELS } from '../../financial-ui/labels';
import { MoneyActionForm } from '../../financial-ui/MoneyActionForm';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { FinanceStatusBadge } from '../../finance/components/FinanceStatusBadge';
import { OperationalUnitOptions, useOperationalUnits } from '../../shell/hooks/useOperationalUnits';
import {
  EnterpriseObjectHeader,
  EnterpriseObjectPage,
  NextActionPanel,
  ObjectContextBlock,
  ObjectPanel,
  ObjectStateFlow,
  SmartRelationBar,
  buildAuthorizedRelations,
} from '../../enterprise-object';
import {
  createJournal,
  getJournal,
  listAccounts,
  listCharts,
  listJournals,
  listPeriods,
  postJournal,
  reverseJournal,
} from '../api/accounting-api';
import { mapAccountingErrorToMessage } from '../api/accounting-error-messages';
import type {
  Account,
  AccountsList,
  ChartsList,
  JournalEntry,
  JournalListPage,
  JournalStatus,
  PeriodsList,
} from '../types/accounting.types';

/**
 * Próxima ação derivada do estado do lançamento — postar/estornar continuam no backend.
 * Nenhuma regra contábil é criada no navegador.
 */
function NEXT_ACTION_FOR(status: JournalStatus): string {
  switch (status) {
    case 'DRAFT':
      return 'Postar';
    case 'POSTED':
      return 'Documentado';
    default:
      return '—';
  }
}

/**
 * Rótulos do vocabulário fechado acc.journal_source_kind — a origem realmente persistida em
 * acc.journal_entries.source_kind. A lista de lançamentos devolve `sourceKind` e
 * `sourceReference` do próprio registro, então a coluna "Origem" lê o dado gravado; nada é
 * inferido a partir do histórico do lançamento. Valor sem rótulo conhecido aparece cru.
 */
const JOURNAL_SAVED_VIEW_FILTERS: SmartListAllowedFilters = {
  filters: { status: ['DRAFT', 'POSTED'] },
};

const JOURNAL_BUILT_IN_VIEWS: BuiltInView[] = [
  {
    id: 'journal-drafts',
    name: 'Rascunhos',
    description: 'Lançamentos em rascunho no período selecionado.',
    config: { filters: { status: 'DRAFT' }, sortKey: null, sortDirection: 'asc', groupKey: null },
  },
  {
    id: 'journal-posted',
    name: 'Postados',
    description: 'Lançamentos já postados no período selecionado.',
    config: { filters: { status: 'POSTED' }, sortKey: null, sortDirection: 'asc', groupKey: null },
  },
];

const SOURCE_KIND_LABELS: Record<string, string> = {
  MANUAL: 'Manual',
  BILLING: 'Faturamento',
  SETTLEMENT: 'Liquidação',
  PAYMENT: 'Pagamento',
  INVENTORY: 'Estoque',
  PAYROLL: 'Folha',
  TAX: 'Tributos',
};

/**
 * Rótulo do período contábil: sempre código humano + intervalo de datas. Nunca o uuid — o
 * identificador técnico fica apenas no `value` da opção, para a consulta autorizada.
 */
function periodLabel(period: {
  code: string;
  startsOn: string;
  endsOn: string;
  status: string;
}): string {
  return `${period.code} — ${period.startsOn} a ${period.endsOn} (${
    PERIOD_STATUS_LABELS[period.status] ?? period.status
  })`;
}

export function JournalsPage() {
  const { journalId } = useParams();
  const navigate = useNavigate();

  if (journalId) {
    return (
      <JournalDetailRoute
        journalId={journalId}
        onBack={() => void navigate('/app/accounting/journals')}
      />
    );
  }
  return <JournalListRoute />;
}

function JournalListRoute() {
  // A unidade operacional vem do contexto do shell (mesma fonte única usada pelos outros
  // módulos de backoffice). O operador escolhe na lista de unidades autorizadas e nunca digita
  // identificador: escolhida a unidade, os planos dela são carregados do servidor, e o período
  // vem por plano. Cada consulta continua autorizada no servidor.
  const { units, options: unitOptions, unitId, setUnitId } = useOperationalUnits();
  const [chartId, setChartId] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | JournalStatus>('ALL');
  const [pageNumber, setPageNumber] = useState(0);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const savedViews = useSavedViews(
    'accounting.journals',
    JOURNAL_BUILT_IN_VIEWS,
    JOURNAL_SAVED_VIEW_FILTERS,
  );

  const chartsQuery = useBackofficeQuery<ChartsList>({
    enabled: unitId !== '',
    autoLoad: false,
    loader: (signal) => listCharts(unitId, signal),
    mapError: mapAccountingErrorToMessage,
  });
  const periodsQuery = useBackofficeQuery<PeriodsList>({
    enabled: Boolean(chartId),
    autoLoad: false,
    loader: (signal) => listPeriods(chartId, undefined, signal),
    mapError: mapAccountingErrorToMessage,
  });
  const accountsQuery = useBackofficeQuery<AccountsList>({
    enabled: Boolean(chartId),
    autoLoad: false,
    loader: (signal) => listAccounts(chartId, signal),
    mapError: mapAccountingErrorToMessage,
  });
  const journalsQuery = useBackofficeQuery<JournalListPage>({
    enabled: Boolean(chartId && periodId),
    autoLoad: false,
    loader: (signal) =>
      listJournals(
        chartId,
        {
          periodId,
          status: statusFilter === 'ALL' ? undefined : statusFilter,
          page: pageNumber,
          pageSize: 25,
        },
        signal,
      ),
    mapError: mapAccountingErrorToMessage,
  });

  const charts = chartsQuery.state.phase === 'ready' ? chartsQuery.state.data.items : [];
  const periods = periodsQuery.state.phase === 'ready' ? periodsQuery.state.data.items : [];
  const accounts = accountsQuery.state.phase === 'ready' ? accountsQuery.state.data.items : [];
  const page = journalsQuery.state.phase === 'ready' ? journalsQuery.state.data : null;
  const previewRow = page?.items.find((entry) => entry.id === previewId) ?? null;

  const { reload: reloadCharts, reset: resetCharts } = chartsQuery;
  const { reload: reloadPeriods, reset: resetPeriods } = periodsQuery;
  const { reload: reloadAccounts, reset: resetAccounts } = accountsQuery;
  const { reload: reloadJournals, reset: resetJournals } = journalsQuery;

  // Trocar a unidade limpa plano e período (evita uuid órfão de outra unidade) e carrega os
  // planos da unidade escolhida; o conteúdo anterior é descartado antes da nova consulta.
  useEffect(() => {
    setChartId('');
    resetCharts();
    if (unitId === '') {
      return;
    }
    void reloadCharts();
  }, [reloadCharts, resetCharts, unitId]);

  // Trocar o plano limpa o período e recarrega os períodos do plano escolhido.
  useEffect(() => {
    setPeriodId('');
    setPageNumber(0);
    resetPeriods();
    resetAccounts();
    if (!chartId) {
      return;
    }
    void reloadPeriods();
    void reloadAccounts();
  }, [chartId, reloadAccounts, reloadPeriods, resetAccounts, resetPeriods]);

  // Trocar de período (ou de filtro/página) recarrega os lançamentos do recorte escolhido.
  useEffect(() => {
    resetJournals();
    if (!chartId || periodId === '') {
      return;
    }
    void reloadJournals();
  }, [chartId, pageNumber, periodId, reloadJournals, resetJournals, statusFilter]);

  const gate = renderQueryGate(
    'Lançamentos',
    'Carregando lançamentos…',
    'Você não tem permissão para consultar lançamentos.',
    journalsQuery.state,
    () => void journalsQuery.reload(),
  );

  /*
   * CONTAGENS DA PÁGINA — derivadas somente de `JournalEntry.status`, campo que a própria
   * listagem do servidor publica. Não são totais contábeis: são contagens de linhas devolvidas
   * pelo recorte, o mesmo tipo de leitura que as worklists aprovadas fazem. Nenhum valor é
   * somado, nenhum lançamento é rebalanceado e `page.total` continua sendo o número do servidor.
   */
  const draftOnPage = page ? page.items.filter((entry) => entry.status === 'DRAFT').length : 0;
  const postedOnPage = page ? page.items.filter((entry) => entry.status === 'POSTED').length : 0;
  const reversalOnPage = page ? page.items.filter((entry) => entry.kind === 'REVERSAL').length : 0;

  const scopePending = !chartId || !periodId;

  return (
    <ModulePage layout="wide">
      <WorklistHeader
        title="Lançamentos"
        count={page ? page.total : null}
        context="Rascunhos e postados são lidos do ledger. O navegador não rebalanceia lançamentos."
        metrics={
          page && page.items.length > 0 ? (
            <>
              <EnterpriseMetric label="Rascunhos nesta página" value={draftOnPage} tone={draftOnPage > 0 ? 'warning' : 'neutral'} />
              <EnterpriseMetric label="Postados nesta página" value={postedOnPage} />
              <EnterpriseMetric label="Estornos nesta página" value={reversalOnPage} />
            </>
          ) : null
        }
      />

      <SavedViewsBar
        views={savedViews.views}
        builtInViews={savedViews.builtInViews}
        activeViewId={activeViewId}
        onApply={(view) => {
          const status = view.config.filters.status;
          setStatusFilter(status === 'DRAFT' || status === 'POSTED' ? status : 'ALL');
          setActiveViewId(view.id === '__all__' ? null : view.id);
          setPageNumber(0);
        }}
        onSave={savedViews.saveView}
        onRename={savedViews.renameView}
        onRemove={(id) => {
          savedViews.removeView(id);
          if (activeViewId === id) setActiveViewId(null);
        }}
        currentConfig={{
          filters: statusFilter === 'ALL' ? {} : { status: statusFilter },
          sortKey: null,
          sortDirection: 'asc',
          groupKey: null,
        }}
        canSave={savedViews.persistable && statusFilter !== 'ALL'}
        allLabel="Todos"
      />

      {/*
        BARRA OPERACIONAL — os quatro controles soltos (unidade, plano, período, estado) viram
        UMA linha de trabalho. Nenhum filtro, consulta, capability ou paginação mudou: o mesmo
        recorte continua sendo enviado ao servidor e cada mudança continua zerando a página.
      */}
      <WorklistFilterBar
        meta={
          page
            ? `Página ${page.page + 1} de ${Math.max(page.totalPages, 1)}`
            : undefined
        }
      >
        <WorklistField label="Unidade" htmlFor="journal-unit">
          <select
            id="journal-unit"
            className={worklistSelectClass}
            value={unitId}
            onChange={(event) => setUnitId(event.target.value)}
            disabled={units.length === 0}
          >
            {/*
              ESCOPO DE UNIDADE pelo primitivo compartilhado.

              Esta tela montava as opcoes a mao com `Unidade {index + 1}` — um ordinal que nao
              diz QUAL unidade o operador esta consultando. Com duas unidades autorizadas o
              seletor virava "Unidade 1 / Unidade 2", e escolher a errada so era perceptivel
              depois, nos lancamentos ja carregados.

              `OperationalUnitOptions` existe exatamente para isto desde a correcao que tirou o
              identificador tecnico (`unit-synthetic-homolog`) das doze superficies de
              backoffice. Ele mantem o valor real no `value` (o que a consulta autorizada
              envia) e usa um rotulo honesto na exibicao. Aleatorio, index-based, nao serve.
            */}
            <OperationalUnitOptions options={unitOptions} />
          </select>
        </WorklistField>
        <WorklistField label="Plano de contas" htmlFor="journal-chart">
          <select
            id="journal-chart"
            className={worklistSelectClass}
            value={chartId}
            onChange={(event) => setChartId(event.target.value)}
            disabled={charts.length === 0}
          >
            <option value="">Selecione…</option>
            {charts.map((chart) => (
              <option key={chart.id} value={chart.id}>
                {chart.code} — {chart.name}
              </option>
            ))}
          </select>
        </WorklistField>
        <WorklistField label="Período contábil" htmlFor="journal-period">
          {/*
            LARGURA LIMITADA — o rótulo da competência é longo por natureza e um `<select>` que
            cresce pelo conteúdo estoura o container flex. O teto não altera nenhuma opção nem o
            valor enviado ao servidor.
          */}
          <select
            id="journal-period"
            className={`${worklistSelectClass} w-full max-w-[22rem]`}
            value={periodId}
            onChange={(event) => {
              setPeriodId(event.target.value);
              setPageNumber(0);
            }}
            disabled={periods.length === 0}
          >
            <option value="">Selecione…</option>
            {periods.map((period) => (
              <option key={period.id} value={period.id}>
                {periodLabel(period)}
              </option>
            ))}
          </select>
        </WorklistField>
        <WorklistField label="Estado" htmlFor="journal-status">
          <select
            id="journal-status"
            className={worklistSelectClass}
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value as 'ALL' | JournalStatus);
              setActiveViewId(null);
              setPageNumber(0);
            }}
          >
            <option value="ALL">Todos</option>
            <option value="DRAFT">Rascunho</option>
            <option value="POSTED">Postado</option>
          </select>
        </WorklistField>
        <WorklistClearFilters
          visible={statusFilter !== 'ALL'}
          onClick={() => {
            setStatusFilter('ALL');
            setActiveViewId(null);
            setPageNumber(0);
          }}
          label="Limpar estado"
        />
      </WorklistFilterBar>

      {units.length === 0 ? (
        <WorklistStatePanel
          title="Nenhuma unidade operacional disponível"
          description="Sua sessão não tem unidade operacional autorizada, então não há lançamento para consultar. A unidade é escolhida em lista; esta tela não aceita identificador digitado."
        />
      ) : null}
      {units.length > 0 && scopePending ? (
        <WorklistStatePanel
          title={!chartId ? 'Nenhum plano de contas selecionado' : 'Nenhum período selecionado'}
          description={
            !chartId
              ? 'Escolha o plano de contas da unidade para carregar os períodos contábeis e os lançamentos.'
              : 'Selecione o período para listar lançamentos; cada linha abre o detalhe com postar/estornar.'
          }
        />
      ) : null}
      {gate}

      {page ? (
        <>
          {page.items.length === 0 ? (
            /*
             * VAZIO DENTRO DA ESTRUTURA — a lista vazia é um ESTADO DA ÁREA DE RESULTADO, não
             * uma segunda página. Cabeçalho, faixa de indicadores, barra operacional e o bloco
             * de novo rascunho continuam montados; só o corpo da grade troca.
             */
            <WorklistStatePanel
              title={
                statusFilter === 'ALL'
                  ? 'Nenhum lançamento no período'
                  : `Nenhum lançamento ${statusFilter === 'DRAFT' ? 'em rascunho' : 'postado'} no período`
              }
              description="O período selecionado não tem lançamento para este recorte. Ajuste o estado ou escolha outro período na barra acima."
              action={
                <WorklistClearFilters
                  visible={statusFilter !== 'ALL'}
                  onClick={() => {
                    setStatusFilter('ALL');
                    setPageNumber(0);
                  }}
                  label="Ver todos os estados"
                />
              }
            />
          ) : (
            <>
              <div className={worklistTableCardClass}>
                <table className={worklistTableClass} aria-label="Lançamentos do período">
                  <thead>
                    <tr>
                      <th scope="col" className={worklistHeadCellClass}>
                        Nº
                      </th>
                      <th scope="col" className={worklistHeadCellClass}>
                        Data
                      </th>
                      <th scope="col" className={worklistHeadCellClass}>
                        Histórico
                      </th>
                      <th scope="col" className={worklistHeadCellClass}>
                        Origem
                      </th>
                      <th scope="col" className={worklistHeadCellClass}>
                        Estado
                      </th>
                      <th scope="col" className={worklistHeadCellClass}>
                        Próxima ação
                      </th>
                      <th scope="col" className={worklistNumericHeadCellClass}>
                        Débito
                      </th>
                      <th scope="col" className={worklistNumericHeadCellClass}>
                        Crédito
                      </th>
                      <th scope="col" className={worklistHeadCellClass}>
                        Ação
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.items.map((entry) => (
                      <tr key={entry.id} className={worklistRowClass}>
                        <td className={worklistCellClass}>
                          <WorklistRowLink href={`/app/accounting/journals/${entry.id}`}>
                            {entry.entryNumber ?? '—'}
                          </WorklistRowLink>
                        </td>
                        <td className={worklistCellRaisedClass}>{entry.occurredOn}</td>
                        <td className={`${worklistCellRaisedClass} whitespace-normal`}>
                          {entry.description}
                        </td>
                        {/*
                          Origem persistida: `sourceKind` + `sourceReference` vêm do próprio registro
                          em acc.journal_entries (acc.journal_source_kind), devolvidos na listagem
                          pelo serializador do servidor. Não há derivação pelo histórico e não há
                          link de drill-down: a lista não pode afirmar a existência de um registro
                          de origem fora do escopo autorizado do operador.
                        */}
                        <td className={`${worklistCellRaisedClass} whitespace-normal`}>
                          <span className="block">
                            {SOURCE_KIND_LABELS[entry.sourceKind] ?? entry.sourceKind}
                          </span>
                          <span className="block text-[11px] text-gray-500">
                            {entry.sourceReference}
                          </span>
                        </td>
                        <td className={worklistCellRaisedClass}>
                          <FinanceStatusBadge status={entry.status} labels={JOURNAL_STATUS_LABELS} />
                        </td>
                        <td className={worklistCellRaisedClass}>{NEXT_ACTION_FOR(entry.status)}</td>
                        <td className={worklistNumericCellClass}>
                          <Money value={entry.debitTotal} currencyCode={entry.currencyCode} />
                        </td>
                        <td className={worklistNumericCellClass}>
                          <Money value={entry.creditTotal} currencyCode={entry.currencyCode} />
                        </td>
                        <td className={worklistCellClass}>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="secondary"
                              onClick={() => setPreviewId(entry.id)}
                              aria-label={`Prévia do lançamento ${entry.entryNumber ?? entry.id}`}
                            >
                              Prévia
                            </Button>
                            <Link
                              to={`/app/accounting/journals/${entry.id}`}
                              className={rowPrimaryActionClass}
                            >
                              Abrir
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <WorklistFooter
                rangeLabel={
                  <span aria-live="polite">
                    Página {page.page + 1} de {Math.max(page.totalPages, 1)} · {page.total}{' '}
                    {page.total === 1 ? 'lançamento' : 'lançamentos'} no recorte
                  </span>
                }
                extra={
                  statusFilter === 'ALL'
                    ? null
                    : `estado: ${statusFilter === 'DRAFT' ? 'Rascunho' : 'Postado'}`
                }
              >
                <Button
                  variant="secondary"
                  disabled={page.page <= 0}
                  onClick={() => setPageNumber((current) => Math.max(0, current - 1))}
                >
                  Página anterior
                </Button>
                <Button
                  variant="secondary"
                  disabled={page.page + 1 >= page.totalPages}
                  onClick={() => setPageNumber((current) => current + 1)}
                >
                  Próxima página
                </Button>
              </WorklistFooter>
            </>
          )}
        </>
      ) : null}

      <ContextDrawer
        open={previewRow !== null}
        title="Contexto do lançamento"
        preview={previewRow ? buildJournalPreview(previewRow) : null}
        onClose={() => setPreviewId(null)}
      />

      {periodId && chartId ? (
        <ManualDraftCard
          chartId={chartId}
          periodId={periodId}
          accounts={accounts}
          onCreated={() => {
            setPageNumber(0);
            void journalsQuery.reload();
          }}
        />
      ) : null}
    </ModulePage>
  );
}

function buildJournalPreview(entry: JournalEntry): ContextPreviewBody {
  return {
    identifier: entry.entryNumber ? `Lançamento #${entry.entryNumber}` : 'Lançamento contábil',
    subtitle: entry.description,
    status: <FinanceStatusBadge status={entry.status} labels={JOURNAL_STATUS_LABELS} />,
    facts: [
      { label: 'Data', value: <DateTime value={entry.occurredOn} mode="date" /> },
      {
        label: 'Origem',
        value: `${SOURCE_KIND_LABELS[entry.sourceKind] ?? entry.sourceKind} · ${entry.sourceReference}`,
      },
      { label: 'Débito', value: <Money value={entry.debitTotal} currencyCode={entry.currencyCode} /> },
      { label: 'Crédito', value: <Money value={entry.creditTotal} currencyCode={entry.currencyCode} /> },
      { label: 'Balanceado', value: entry.balanced ? 'Sim' : 'Não' },
      { label: 'Tipo', value: entry.kind === 'REVERSAL' ? 'Estorno' : 'Lançamento' },
    ],
    relations: [],
    nextAction: {
      label: entry.status === 'DRAFT' ? 'Abrir e postar lançamento' : 'Abrir lançamento',
      href: `/app/accounting/journals/${entry.id}`,
    },
    detailHref: `/app/accounting/journals/${entry.id}`,
    detailLabel: 'Abrir lançamento completo',
  };
}

function JournalDetailRoute({
  journalId,
  onBack,
}: {
  journalId: string;
  onBack: () => void;
}) {
  const loader = useMemo(() => {
    return (signal?: AbortSignal) => getJournal(journalId, signal);
  }, [journalId]);
  const { state, reload, setReady } = useBackofficeQuery<JournalEntry>({
    loader,
    mapError: mapAccountingErrorToMessage,
    enabled: Boolean(journalId),
    autoLoad: true,
  });

  return (
    <ModulePage layout="wide">
      {state.phase === 'error' && state.kind === 'closed_period' ? (
        <ClosedPeriodBanner message={state.message} />
      ) : null}
      {state.phase !== 'ready' ? (
        <>
          <WorklistHeader
            title="Lançamento"
            context="Detalhe do lançamento lido do servidor. Postar e estornar são decididos pelo backend."
            action={
              <Button variant="secondary" onClick={onBack}>
                ← Voltar para lançamentos
              </Button>
            }
          />
          {renderQueryGate(
            'Lançamento',
            'Carregando lançamento…',
            'Você não tem permissão para consultar este lançamento.',
            state,
            () => void reload(),
          )}
        </>
      ) : (
        <JournalView
          journal={state.data}
          onBack={onBack}
          onReload={reload}
          onReady={setReady}
        />
      )}
    </ModulePage>
  );
}

function JournalView({
  journal,
  onBack,
  onReload,
  onReady,
}: {
  journal: JournalEntry;
  onBack: () => void;
  onReload: () => Promise<void>;
  onReady: (next: JournalEntry) => void;
}) {
  const canPost = journal.status === 'DRAFT' && journal.kind !== 'REVERSAL';
  const canReverse = journal.status === 'POSTED';

  const actionTarget = canPost ? 'journal-post-command' : canReverse ? 'journal-reverse-command' : null;
  const focusCommand = () => {
    if (!actionTarget) return;
    document.getElementById(actionTarget)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const relations = buildAuthorizedRelations([
    ...(journal.reversesEntryId
      ? [{
          id: 'reverses-entry',
          label: 'Lançamento estornado',
          count: 1,
          to: `/app/accounting/journals/${journal.reversesEntryId}`,
          allowed: true,
        }]
      : []),
    ...(journal.reversedByEntryId
      ? [{
          id: 'reversed-by-entry',
          label: 'Lançamento de estorno',
          count: 1,
          to: `/app/accounting/journals/${journal.reversedByEntryId}`,
          allowed: true,
        }]
      : []),
  ]);

  const nextAction = canPost
    ? {
        kind: 'act' as const,
        label: 'Postar lançamento',
        description:
          'O servidor valida período, versão, contas e partidas dobradas antes de fixar o lançamento.',
        onSelect: focusCommand,
      }
    : canReverse
      ? {
          kind: 'act' as const,
          label: 'Estornar lançamento',
          description:
            'O estorno gera o lançamento inverso no servidor e preserva o vínculo com o lançamento original.',
          onSelect: focusCommand,
        }
      : null;

  const contextFields = [
    { label: 'Data contábil', value: <DateTime value={journal.occurredOn} mode="date" /> },
    {
      label: 'Origem',
      value: `${SOURCE_KIND_LABELS[journal.sourceKind] ?? journal.sourceKind} · ${journal.sourceReference}`,
    },
    { label: 'Débitos', value: <Money value={journal.debitTotal} currencyCode={journal.currencyCode} />, emphasis: true },
    { label: 'Créditos', value: <Money value={journal.creditTotal} currencyCode={journal.currencyCode} />, emphasis: true },
    { label: 'Balanceamento', value: journal.balanced ? 'Balanceado' : 'Desbalanceado' },
    { label: 'Tipo', value: journal.kind === 'REVERSAL' ? 'Estorno' : 'Lançamento' },
    {
      label: 'Lançado em',
      value: journal.postedAt ? <DateTime value={journal.postedAt} /> : 'Rascunho ainda não postado',
    },
    { label: 'Lançado por', value: journal.postedBy },
    { label: 'Versão', value: String(journal.rowVersion) },
  ];

  return (
    <EnterpriseObjectPage
      breadcrumb={[
        { label: 'Contabilidade', href: '/app/accounting/journals' },
        { label: 'Lançamentos', href: '/app/accounting/journals' },
        {
          label: journal.entryNumber !== null
            ? `Lançamento #${journal.entryNumber}`
            : 'Lançamento em rascunho',
        },
      ]}
      header={
        <EnterpriseObjectHeader
          reference={journal.entryNumber !== null ? String(journal.entryNumber) : null}
          title={journal.description || 'Lançamento contábil'}
          subtitle={journal.sourceReference}
          status={{ label: JOURNAL_STATUS_LABELS[journal.status] ?? journal.status }}
          metadata={[
            { label: 'Moeda', value: journal.currencyCode },
            { label: 'Tipo', value: journal.kind === 'REVERSAL' ? 'Estorno' : 'Lançamento' },
          ]}
          primaryAction={
            nextAction
              ? {
                  id: canPost ? 'post-journal' : 'reverse-journal',
                  label: nextAction.label,
                  onSelect: focusCommand,
                }
              : null
          }
          secondaryActions={[
            {
              id: 'back-to-journals',
              label: 'Voltar para lançamentos',
              onSelect: onBack,
            },
          ]}
        />
      }
      stateFlow={
        <ObjectStateFlow
          title="Fluxo do lançamento"
          steps={[
            { id: 'DRAFT', label: 'Rascunho' },
            { id: 'POSTED', label: 'Postado' },
          ]}
          currentId={journal.status === 'DRAFT' || journal.status === 'POSTED' ? journal.status : null}
        />
      }
      nextAction={<NextActionPanel action={nextAction} />}
      relations={relations.length > 0 ? <SmartRelationBar relations={relations} /> : null}
      context={<ObjectContextBlock fields={contextFields} columns={3} />}
      aside={
        <ObjectPanel title="Rastreabilidade">
          <DefinitionList
            items={[
              { label: 'Origem persistida', value: journal.sourceReference },
              {
                label: 'Estorna o lançamento',
                value: journal.reversesEntryId ? (
                  <Link to={`/app/accounting/journals/${journal.reversesEntryId}`}>
                    Abrir lançamento original
                  </Link>
                ) : (
                  '—'
                ),
              },
              {
                label: 'Estornado por',
                value: journal.reversedByEntryId ? (
                  <Link to={`/app/accounting/journals/${journal.reversedByEntryId}`}>
                    {journal.reversedByEntryNumber !== null
                      ? `Abrir estorno #${journal.reversedByEntryNumber}`
                      : 'Abrir lançamento de estorno'}
                  </Link>
                ) : (
                  '—'
                ),
              },
            ]}
          />
        </ObjectPanel>
      }
    >
      <ObjectPanel title="Partidas">
        <div className={worklistTableCardClass}>
          <table className={worklistTableClass} aria-label="Linhas do lançamento">
            <thead>
              <tr>
                <th scope="col" className={worklistHeadCellClass}>Linha</th>
                <th scope="col" className={worklistHeadCellClass}>Conta</th>
                <th scope="col" className={worklistHeadCellClass}>Direção</th>
                <th scope="col" className={worklistNumericHeadCellClass}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {journal.lines.map((line) => (
                <tr key={line.id} className={worklistRowClass}>
                  <td className={worklistCellClass}>{line.lineNumber}</td>
                  <td className={`${worklistCellClass} font-mono`}>
                    {line.accountCode ?? line.accountId}
                    {line.accountName ? ` — ${line.accountName}` : ''}
                  </td>
                  <td className={worklistCellClass}>
                    {MOVEMENT_DIRECTION_LABELS[line.direction] ?? line.direction}
                  </td>
                  <td className={worklistNumericCellClass}>
                    <Money value={line.amount} currencyCode={journal.currencyCode} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ObjectPanel>

      <ObjectPanel title="Comandos">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div id="journal-post-command">
            <MoneyActionForm
              title="Postar lançamento"
              description="A postagem é recusada se o período estiver fechado, o lançamento desbalanceado ou a conta não postável."
              confirmTitle="Postar lançamento"
              confirmDescription="O servidor valida período, versão, contas e partidas dobradas e fixa o número."
              confirmLabel="Postar"
              disabled={!canPost}
              mapError={mapAccountingErrorToMessage}
              onReload={() => void onReload()}
              onSubmit={async () => {
                onReady(await postJournal(journal.id, { rowVersion: journal.rowVersion }));
              }}
            />
          </div>
          <div id="journal-reverse-command">
            <MoneyActionForm
              title="Estornar lançamento"
              description="O estorno gera o lançamento inverso no servidor e preserva o histórico."
              confirmTitle="Estornar lançamento"
              confirmDescription="Somente o backend decide se o estorno é permitido."
              confirmLabel="Estornar"
              reasonLabel="Justificativa"
              disabled={!canReverse}
              mapError={mapAccountingErrorToMessage}
              onReload={() => void onReload()}
              onSubmit={async ({ reason }) => {
                onReady(
                  await reverseJournal(journal.id, {
                    rowVersion: journal.rowVersion,
                    reason: reason ?? '',
                  }),
                );
              }}
            />
          </div>
        </div>
      </ObjectPanel>
    </EnterpriseObjectPage>
  );
}

function ManualDraftCard({
  chartId,
  periodId,
  accounts,
  onCreated,
}: {
  chartId: string;
  periodId: string;
  accounts: Account[];
  onCreated: () => void;
}) {
  const [description, setDescription] = useState('');
  const [occurredOn, setOccurredOn] = useState('');
  const [debitAccountId, setDebitAccountId] = useState('');
  const [creditAccountId, setCreditAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID()).current;

  const postable = useMemo(
    () => accounts.filter((account) => account.status === 'ACTIVE'),
    [accounts],
  );

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      await createJournal({
        chartId,
        periodId,
        description: description.trim(),
        occurredOn: occurredOn.trim(),
        currencyCode: 'BRL',
        sourceKind: 'MANUAL',
        sourceId: crypto.randomUUID(),
        sourceReference: description.trim() || 'Lançamento manual',
        idempotencyKey,
        lines: [
          {
            lineNumber: 1,
            accountId: debitAccountId,
            direction: 'DEBIT',
            amount: amount.trim(),
          },
          {
            lineNumber: 2,
            accountId: creditAccountId,
            direction: 'CREDIT',
            amount: amount.trim(),
          },
        ],
      });
      setDescription('');
      setOccurredOn('');
      setAmount('');
      onCreated();
    } catch {
      setError(mapAccountingErrorToMessage(undefined, 0));
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit =
    !submitting &&
    description.trim() !== '' &&
    /^\d{4}-\d{2}-\d{2}$/.test(occurredOn.trim()) &&
    debitAccountId.trim() !== '' &&
    creditAccountId.trim() !== '' &&
    Number(amount) > 0;

  return (
    /*
     * NOVO RASCUNHO — seção densa na mesma gramática da barra operacional, não um cartão
     * `rounded-xl p-6 shadow-sm`. Campos, ordem, validação e a chamada `createJournal`
     * continuam idênticos; a postagem segue sendo decisão do backend.
     */
    <section className="mb-3 rounded-md border border-gray-200 bg-white" aria-label="Novo lançamento manual">
      <div className="border-b border-gray-200 px-3 py-2">
        <h2 className="text-[13px] font-semibold text-gray-900">
          Novo lançamento manual (rascunho)
        </h2>
        <p className="mt-0.5 text-xs text-gray-500">
          O rascunho é criado no período selecionado; a postagem continua sendo validada pelo
          servidor.
        </p>
      </div>
      {error ? (
        <div className="px-3 pt-2">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}
      <div className="flex flex-wrap items-end gap-2 px-3 py-2">
        <div className="w-40">
          <Field label="Data (AAAA-MM-DD)" htmlFor="manual-date">
            <Input
              id="manual-date"
              value={occurredOn}
              placeholder="2026-10-05"
              onChange={(event) => setOccurredOn(event.target.value)}
            />
          </Field>
        </div>
        <div className="min-w-52 flex-1">
          <Field label="Histórico" htmlFor="manual-description">
            <Input
              id="manual-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
        </div>
        <div className="min-w-44">
          <Field label="Conta de débito" htmlFor="manual-debit-account">
            <Select
              id="manual-debit-account"
              value={debitAccountId}
              onChange={(event) => setDebitAccountId(event.target.value)}
            >
              <option value="">Selecione…</option>
              {postable.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} — {account.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="min-w-44">
          <Field label="Conta de crédito" htmlFor="manual-credit-account">
            <Select
              id="manual-credit-account"
              value={creditAccountId}
              onChange={(event) => setCreditAccountId(event.target.value)}
            >
              <option value="">Selecione…</option>
              {postable.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} — {account.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="w-32">
          <Field label="Valor (R$)" htmlFor="manual-amount">
            <Input
              id="manual-amount"
              inputMode="decimal"
              value={amount}
              placeholder="100.00"
              onChange={(event) => setAmount(event.target.value)}
            />
          </Field>
        </div>
        <Button onClick={() => void submit()} disabled={!canSubmit}>
          {submitting ? 'Criando…' : 'Criar rascunho'}
        </Button>
      </div>
      {postable.length === 0 ? (
        <p className="px-3 pb-2 text-[11px] text-gray-500">
          Nenhuma conta ativa disponível neste plano; contas sintéticas não recebem lançamento
          direto.
        </p>
      ) : null}
    </section>
  );
}
