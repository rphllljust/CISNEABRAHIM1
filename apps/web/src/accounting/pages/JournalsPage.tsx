import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, DateTime, EmptyState, Field, Input, Money, Select, worklistTableCardClass } from '../../ui';
import { FilterCard, ModulePage, ModulePageHeader } from '../../ui/module-layout';
import { worklistCellClass, worklistTableClass, worklistHeadCellClass, worklistRowClass } from '../../ui/enterprise-list';
import { ClosedPeriodBanner } from '../../financial-ui/ClosedPeriodBanner';
import { DefinitionList } from '../../financial-ui/DefinitionList';
import { JOURNAL_STATUS_LABELS, MOVEMENT_DIRECTION_LABELS, PERIOD_STATUS_LABELS } from '../../financial-ui/labels';
import { MoneyActionForm } from '../../financial-ui/MoneyActionForm';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { FinanceStatusBadge } from '../../finance/components/FinanceStatusBadge';
import { useOperationalUnits } from '../../shell/hooks/useOperationalUnits';
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
  const { units, unitId, setUnitId } = useOperationalUnits();
  const [chartId, setChartId] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | JournalStatus>('ALL');
  const [pageNumber, setPageNumber] = useState(0);
  const navigate = useNavigate();

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

  return (
    <ModulePage>
      <ModulePageHeader
        title="Lançamentos"
        description="Rascunhos e postados são lidos do ledger. O navegador não rebalanceia lançamentos."
      />
      <FilterCard>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Field label="Unidade operacional" htmlFor="journal-unit">
            <Select
              id="journal-unit"
              value={unitId}
              onChange={(event) => setUnitId(event.target.value)}
              disabled={units.length === 0}
            >
              {units.length === 0 ? <option value="">Nenhuma unidade disponível</option> : null}

              {units.map((unit, index) => (

                <option key={unit} value={unit}>

                  Unidade {index + 1}

                </option>

              ))}
            </Select>
          </Field>
          <Field label="Plano de contas" htmlFor="journal-chart">
            <Select
              id="journal-chart"
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
            </Select>
          </Field>
          <Field label="Período contábil" htmlFor="journal-period">
            <Select
              id="journal-period"
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
            </Select>
          </Field>
          <Field label="Estado" htmlFor="journal-status">
            <Select
              id="journal-status"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value as 'ALL' | JournalStatus);
                setPageNumber(0);
              }}
            >
              <option value="ALL">Todos</option>
              <option value="DRAFT">Rascunho</option>
              <option value="POSTED">Postado</option>
            </Select>
          </Field>
        </div>
      </FilterCard>

      {units.length === 0 ? (
        <EmptyState
          title="Nenhuma unidade operacional disponível"
          description="Sua sessão não tem unidade operacional autorizada, então não há lançamento para consultar. A unidade é escolhida em lista; esta tela não aceita identificador digitado."
        />
      ) : null}
      {units.length > 0 && !chartId ? (
        <EmptyState
          title="Nenhum plano de contas selecionado"
          description="Escolha o plano de contas da unidade para carregar os períodos contábeis e os lançamentos."
        />
      ) : null}
      {chartId && !periodId ? (
        <EmptyState
          title="Nenhum período selecionado"
          description="Selecione o período para listar lançamentos; cada linha abre o detalhe com postar/estornar."
        />
      ) : null}
      {gate}

      {page ? (
        <>
          <div className={worklistTableCardClass}>
            <table className={worklistTableClass} aria-label="Lançamentos do período">
              <thead className={worklistHeadCellClass}>
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
                  <th scope="col" className={`${worklistHeadCellClass} text-right`}>
                    Débito
                  </th>
                  <th scope="col" className={`${worklistHeadCellClass} text-right`}>
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
                    <td className={worklistCellClass}>{entry.entryNumber ?? '—'}</td>
                    <td className={worklistCellClass}>{entry.occurredOn}</td>
                    <td className={`${worklistCellClass} whitespace-normal`}>{entry.description}</td>
                    {/*
                      Origem persistida: `sourceKind` + `sourceReference` vêm do próprio registro
                      em acc.journal_entries (acc.journal_source_kind), devolvidos na listagem
                      pelo serializador do servidor. Não há derivação pelo histórico e não há
                      link de drill-down: a lista não pode afirmar a existência de um registro
                      de origem fora do escopo autorizado do operador.
                    */}
                    <td className={`${worklistCellClass} whitespace-normal`}>
                      <span className="block">
                        {SOURCE_KIND_LABELS[entry.sourceKind] ?? entry.sourceKind}
                      </span>
                      <span className="block text-xs text-gray-500">{entry.sourceReference}</span>
                    </td>
                    <td className={worklistCellClass}>
                      <FinanceStatusBadge status={entry.status} labels={JOURNAL_STATUS_LABELS} />
                    </td>
                    <td className={worklistCellClass}>{NEXT_ACTION_FOR(entry.status)}</td>
                    <td className={`${worklistCellClass} text-right`}>
                      <Money value={entry.debitTotal} currencyCode={entry.currencyCode} />
                    </td>
                    <td className={`${worklistCellClass} text-right`}>
                      <Money value={entry.creditTotal} currencyCode={entry.currencyCode} />
                    </td>
                    <td className={worklistCellClass}>
                      <Button variant="secondary" onClick={() => void navigate(`/app/accounting/journals/${entry.id}`)}>
                        Abrir
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-4">
            <Button
              variant="secondary"
              disabled={page.page <= 0}
              onClick={() => setPageNumber((current) => Math.max(0, current - 1))}
            >
              Página anterior
            </Button>
            <span className="text-sm text-gray-600">
              Página {page.page + 1} de {Math.max(page.totalPages, 1)} — {page.total} lançamentos
            </span>
            <Button
              variant="secondary"
              disabled={page.page + 1 >= page.totalPages}
              onClick={() => setPageNumber((current) => current + 1)}
            >
              Próxima página
            </Button>
          </div>
        </>
      ) : null}

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
    <ModulePage>
      <ModulePageHeader
        title="Lançamento"
        description="Detalhe do lançamento lido do servidor. Postar e estornar são decididos pelo backend."
      />
      <div className="mb-4">
        <Button variant="secondary" onClick={onBack}>
          ← Voltar para lançamentos
        </Button>
      </div>
      {state.phase === 'error' && state.kind === 'closed_period' ? (
        <ClosedPeriodBanner message={state.message} />
      ) : null}
      {renderQueryGate(
        'Lançamento',
        'Carregando lançamento…',
        'Você não tem permissão para consultar este lançamento.',
        state,
        () => void reload(),
      )}
      {state.phase === 'ready' ? (
        <JournalView journal={state.data} onReload={reload} onReady={setReady} />
      ) : null}
    </ModulePage>
  );
}

function JournalView({
  journal,
  onReload,
  onReady,
}: {
  journal: JournalEntry;
  onReload: () => Promise<void>;
  onReady: (next: JournalEntry) => void;
}) {
  return (
    <>
      <div className="mb-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
        <DefinitionList
          items={[
            { label: 'Número', value: journal.entryNumber !== null ? String(journal.entryNumber) : '— (rascunho)' },
            {
              label: 'Estado',
              value: <FinanceStatusBadge status={journal.status} labels={JOURNAL_STATUS_LABELS} />,
            },
            { label: 'Tipo', value: journal.kind === 'REVERSAL' ? 'Estorno' : 'Lançamento' },
            { label: 'Competência', value: journal.occurredOn },
            { label: 'Descrição', value: journal.description },
            { label: 'Balanceado', value: journal.balanced ? 'Sim' : 'Não' },
            {
              label: 'Débitos',
              value: <Money value={journal.debitTotal} currencyCode={journal.currencyCode} />,
            },
            {
              label: 'Créditos',
              value: <Money value={journal.creditTotal} currencyCode={journal.currencyCode} />,
            },
            { label: 'Origem', value: journal.sourceReference },
            {
              label: 'Lançado em',
              value: journal.postedAt ? <DateTime value={journal.postedAt} /> : '— (rascunho)',
            },
            {
              label: 'Lançado por',
              value: journal.postedBy ?? '—',
            },
            {
              label: 'Estorna o lançamento',
              value: journal.reversesEntryId ? (
                <Link to={`/app/accounting/journals/${journal.reversesEntryId}`}>
                  {journal.reversesEntryId}
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
                    ? `#${journal.reversedByEntryNumber}`
                    : journal.reversedByEntryId}
                </Link>
              ) : (
                '—'
              ),
            },
            { label: 'Versão', value: String(journal.rowVersion) },
          ]}
        />
      </div>
      <div className={worklistTableCardClass}>
        <table className={worklistTableClass} aria-label="Linhas do lançamento">
          <thead className={worklistHeadCellClass}>
            <tr>
              <th scope="col" className={worklistHeadCellClass}>
                Linha
              </th>
              <th scope="col" className={worklistHeadCellClass}>
                Conta
              </th>
              <th scope="col" className={worklistHeadCellClass}>
                Direção
              </th>
              <th scope="col" className={`${worklistHeadCellClass} text-right`}>
                Valor
              </th>
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
                <td className={`${worklistCellClass} text-right`}>
                  <Money value={line.amount} currencyCode={journal.currencyCode} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <MoneyActionForm
          title="Postar lançamento"
          description="A postagem é recusada se o período estiver fechado, o lançamento desbalanceado ou a conta não postável."
          confirmTitle="Postar lançamento"
          confirmDescription="O servidor valida período, versão, contas e partidas dobradas e fixa o número."
          confirmLabel="Postar"
          disabled={journal.status !== 'DRAFT' || journal.kind === 'REVERSAL'}
          mapError={mapAccountingErrorToMessage}
          onReload={() => void onReload()}
          onSubmit={async () => {
            onReady(await postJournal(journal.id, { rowVersion: journal.rowVersion }));
          }}
        />
        <MoneyActionForm
          title="Estornar lançamento"
          description="O estorno gera o lançamento inverso no servidor e preserva o histórico."
          confirmTitle="Estornar lançamento"
          confirmDescription="Somente o backend decide se o estorno é permitido."
          confirmLabel="Estornar"
          reasonLabel="Justificativa"
          disabled={journal.status !== 'POSTED'}
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
    </>
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
    <div className="mt-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
      <h2 className="mb-4 text-base font-semibold text-gray-900">Novo lançamento manual (rascunho)</h2>
      {error ? (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Field label="Data (AAAA-MM-DD)" htmlFor="manual-date">
          <Input
            id="manual-date"
            value={occurredOn}
            placeholder="2026-10-05"
            onChange={(event) => setOccurredOn(event.target.value)}
          />
        </Field>
        <Field label="Histórico" htmlFor="manual-description" className="md:col-span-2">
          <Input
            id="manual-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
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
      <div className="mt-4 flex justify-end">
        <Button onClick={() => void submit()} disabled={!canSubmit}>
          {submitting ? 'Criando…' : 'Criar rascunho'}
        </Button>
      </div>
      {postable.length === 0 ? (
        <p className="mt-2 text-xs text-gray-500">
          Nenhuma conta ativa disponível neste plano; contas sintéticas não recebem lançamento direto.
        </p>
      ) : null}
    </div>
  );
}
