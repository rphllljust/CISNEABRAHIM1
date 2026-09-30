import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Button, EmptyState, Field, Money, Select, worklistTableCardClass } from '../../ui';
import { FilterCard, ModulePage, ModulePageHeader } from '../../ui/module-layout';
import { worklistCellClass, worklistTableClass, worklistHeadCellClass, worklistRowClass } from '../../ui/enterprise-list';
import { DefinitionList } from '../../financial-ui/DefinitionList';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { OperationalUnitOptions, useOperationalUnits } from '../../shell/hooks/useOperationalUnits';
import {
  getAccountLedger,
  getBalanceSheet,
  getIncomeStatement,
  getTrialBalance,
  listAccounts,
  listCharts,
  listJournals,
  listPeriods,
} from '../api/accounting-api';
import { mapAccountingErrorToMessage } from '../api/accounting-error-messages';
import { ACCOUNT_CLASS_LABELS, PERIOD_STATUS_LABELS } from '../../financial-ui/labels';
import type {
  AccountsList,
  BalanceSheet,
  ChartsList,
  IncomeStatement,
  JournalListPage,
  PeriodsList,
  TrialBalance,
} from '../types/accounting.types';

type ReportKind = 'journal' | 'ledger' | 'trial' | 'income' | 'balance';

export function JournalBookPage() {
  return <PeriodReportShell kind="journal" />;
}

export function GeneralLedgerPage() {
  return <PeriodReportShell kind="ledger" />;
}

export function TrialBalancePage() {
  return <PeriodReportShell kind="trial" />;
}

export function IncomeStatementPage() {
  return <PeriodReportShell kind="income" />;
}

export function BalanceSheetPage() {
  return <PeriodReportShell kind="balance" />;
}

const REPORT_META: Record<ReportKind, { title: string; description: string }> = {
  journal: {
    title: 'Diário',
    description:
      'O diário é derivado somente de lançamentos POSTED, em ordem cronológica, com paginação no servidor.',
  },
  ledger: {
    title: 'Razão',
    description:
      'O razão é calculado por conta no servidor, com saldo anterior e saldo acumulado por natureza contábil.',
  },
  trial: {
    title: 'Balancete',
    description:
      'Balancete do período derivado do ledger. Total débito = total crédito é verificado pelo servidor.',
  },
  income: {
    title: 'DRE',
    description: 'Resultado do período calculado pelo servidor a partir do plano de contas e do ledger POSTED.',
  },
  balance: {
    title: 'Balanço patrimonial',
    description:
      'Posição do final do período; ATIVO = PASSIVO + PATRIMÔNIO LÍQUIDO é conferido pelo servidor, sem ajustes automáticos.',
  },
};

function PeriodReportShell({ kind }: { kind: ReportKind }) {
  // A unidade operacional vem do contexto do shell (mesma fonte única dos outros módulos de
  // backoffice): o operador escolhe na lista de unidades autorizadas e nunca digita
  // identificador. Unidade -> plano -> período; o relatório continua sendo calculado e
  // autorizado no servidor.
  const { units, options: unitOptions, unitId, setUnitId } = useOperationalUnits();
  const [chartId, setChartId] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [journalPage, setJournalPage] = useState(0);

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

  const charts = chartsQuery.state.phase === 'ready' ? chartsQuery.state.data.items : [];
  const periods = periodsQuery.state.phase === 'ready' ? periodsQuery.state.data.items : [];
  const accounts = accountsQuery.state.phase === 'ready' ? accountsQuery.state.data.items : [];
  const activePeriod = periods.find((candidate) => candidate.id === periodId) ?? null;
  // Só o período realmente devolvido pelo servidor para o plano atual é consultável: assim
  // nenhuma consulta sai com plano novo + período de outro plano enquanto a troca acontece.
  const selectedPeriodId = activePeriod?.id ?? '';

  const journalQuery = useBackofficeQuery<JournalListPage>({
    enabled: kind === 'journal' && Boolean(chartId && selectedPeriodId),
    autoLoad: false,
    loader: (signal) =>
      listJournals(
        chartId,
        { periodId: selectedPeriodId, status: 'POSTED', page: journalPage, pageSize: 50 },
        signal,
      ),
    mapError: mapAccountingErrorToMessage,
  });
  const ledgerQuery = useBackofficeQuery<Awaited<ReturnType<typeof getAccountLedger>>>({
    enabled: kind === 'ledger' && Boolean(selectedPeriodId) && Boolean(accountId),
    autoLoad: false,
    loader: (signal) => getAccountLedger(selectedPeriodId, accountId, journalPage, 30, signal),
    mapError: mapAccountingErrorToMessage,
  });
  const trialQuery = useBackofficeQuery<TrialBalance>({
    enabled: kind === 'trial' && Boolean(selectedPeriodId),
    autoLoad: false,
    loader: (signal) => getTrialBalance(selectedPeriodId, signal),
    mapError: mapAccountingErrorToMessage,
  });
  const incomeQuery = useBackofficeQuery<IncomeStatement>({
    enabled: kind === 'income' && Boolean(selectedPeriodId),
    autoLoad: false,
    loader: (signal) => getIncomeStatement(selectedPeriodId, signal),
    mapError: mapAccountingErrorToMessage,
  });
  const balanceQuery = useBackofficeQuery<BalanceSheet>({
    enabled: kind === 'balance' && Boolean(selectedPeriodId),
    autoLoad: false,
    loader: (signal) => getBalanceSheet(selectedPeriodId, signal),
    mapError: mapAccountingErrorToMessage,
  });

  const { reload: reloadCharts, reset: resetCharts } = chartsQuery;
  const { reload: reloadPeriods, reset: resetPeriods } = periodsQuery;
  const { reload: reloadAccounts, reset: resetAccounts } = accountsQuery;
  const { reload: reloadJournals, reset: resetJournals } = journalQuery;
  const { reload: reloadLedger, reset: resetLedger } = ledgerQuery;
  const { reload: reloadTrial, reset: resetTrial } = trialQuery;
  const { reload: reloadIncome, reset: resetIncome } = incomeQuery;
  const { reload: reloadBalance, reset: resetBalance } = balanceQuery;

  // Trocar a unidade limpa plano, período e conta (evita uuid órfão de outra unidade) e carrega
  // os planos da unidade escolhida; o conteúdo anterior é descartado antes da nova consulta.
  useEffect(() => {
    setChartId('');
    resetCharts();
    if (unitId === '') {
      return;
    }
    void reloadCharts();
  }, [reloadCharts, resetCharts, unitId]);

  // Trocar o plano limpa período e conta e recarrega os períodos do plano escolhido.
  useEffect(() => {
    setPeriodId('');
    setAccountId('');
    setJournalPage(0);
    resetPeriods();
    resetAccounts();
    if (!chartId) {
      return;
    }
    void reloadPeriods();
    void reloadAccounts();
  }, [chartId, reloadAccounts, reloadPeriods, resetAccounts, resetPeriods]);

  // Consulta o relatório do recorte escolhido. O conteúdo anterior é descartado antes da nova
  // consulta (nada de relatório de outro período na tela) e a página corrente do diário/razão
  // entra como dependência para que paginar realmente consulte o servidor.
  useEffect(() => {
    resetJournals();
    resetLedger();
    resetTrial();
    resetIncome();
    resetBalance();
    if (selectedPeriodId === '' || !chartId) {
      return;
    }
    if (kind === 'journal') {
      void reloadJournals();
    } else if (kind === 'ledger') {
      if (accountId !== '') {
        void reloadLedger();
      }
    } else if (kind === 'trial') {
      void reloadTrial();
    } else if (kind === 'income') {
      void reloadIncome();
    } else {
      void reloadBalance();
    }
  }, [
    accountId,
    chartId,
    journalPage,
    kind,
    reloadBalance,
    reloadIncome,
    reloadJournals,
    reloadLedger,
    reloadTrial,
    resetBalance,
    resetIncome,
    resetJournals,
    resetLedger,
    resetTrial,
    selectedPeriodId,
  ]);

  const meta = REPORT_META[kind];
  const readyScope = Boolean(chartId && periodId && (kind !== 'ledger' || accountId));

  let gate: ReactNode = null;
  let content: ReactNode = null;
  if (kind === 'journal') {
    gate = renderQueryGate(meta.title, 'Carregando diário…', 'Sem permissão para o diário.', journalQuery.state, () =>
      void journalQuery.reload(),
    );
    content = journalQuery.state.phase === 'ready' ? <JournalTable data={journalQuery.state.data} /> : null;
  } else if (kind === 'ledger') {
    gate = renderQueryGate(meta.title, 'Carregando razão…', 'Sem permissão para o razão.', ledgerQuery.state, () =>
      void ledgerQuery.reload(),
    );
    content = ledgerQuery.state.phase === 'ready' ? <LedgerTable data={ledgerQuery.state.data} /> : null;
  } else if (kind === 'trial') {
    gate = renderQueryGate(meta.title, 'Carregando balancete…', 'Sem permissão para o balancete.', trialQuery.state, () =>
      void trialQuery.reload(),
    );
    content = trialQuery.state.phase === 'ready' ? <TrialTable data={trialQuery.state.data} /> : null;
  } else if (kind === 'income') {
    gate = renderQueryGate(meta.title, 'Carregando DRE…', 'Sem permissão para a DRE.', incomeQuery.state, () =>
      void incomeQuery.reload(),
    );
    content = incomeQuery.state.phase === 'ready' ? <IncomeTable data={incomeQuery.state.data} /> : null;
  } else {
    gate = renderQueryGate(meta.title, 'Carregando balanço…', 'Sem permissão para o balanço.', balanceQuery.state, () =>
      void balanceQuery.reload(),
    );
    content = balanceQuery.state.phase === 'ready' ? <BalanceTable data={balanceQuery.state.data} /> : null;
  }

  return (
    <ModulePage>
      <ModulePageHeader title={meta.title} description={meta.description} />
      <FilterCard>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Field label="Unidade operacional" htmlFor={`${kind}-unit`}>
            <Select
              id={`${kind}-unit`}
              value={unitId}
              onChange={(event) => setUnitId(event.target.value)}
              disabled={units.length === 0}
            >
              {/*
                ESCOPO DE UNIDADE pelo primitivo compartilhado — mesmo tratamento de Lancamentos,
                Diario e Fechamentos. A tela montava as opcoes a mao com um ordinal
                `Unidade {index + 1}`, que nao diz QUAL unidade esta selecionada.
              */}
              <OperationalUnitOptions options={unitOptions} />
            </Select>
          </Field>
          <Field label="Plano de contas" htmlFor={`${kind}-chart`}>
            <Select
              id={`${kind}-chart`}
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
          <Field label="Período contábil" htmlFor={`${kind}-period`}>
            <Select
              id={`${kind}-period`}
              value={periodId}
              onChange={(event) => {
                setPeriodId(event.target.value);
                setJournalPage(0);
              }}
              disabled={periods.length === 0}
            >
              <option value="">Selecione…</option>
              {periods.map((period) => (
                <option key={period.id} value={period.id}>
                  {period.code} — {period.startsOn} a {period.endsOn} (
                  {PERIOD_STATUS_LABELS[period.status] ?? period.status})
                </option>
              ))}
            </Select>
          </Field>
          {kind === 'ledger' ? (
            <Field label="Conta (Razão)" htmlFor="razao-account" className="md:col-span-2">
              <Select
                id="razao-account"
                value={accountId}
                onChange={(event) => {
                  setAccountId(event.target.value);
                  setJournalPage(0);
                }}
                disabled={accounts.length === 0}
              >
                <option value="">Selecione a conta…</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.code} — {account.name} ({ACCOUNT_CLASS_LABELS[account.class] ?? account.class})
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>
      </FilterCard>

      {activePeriod ? (
        <div className="mb-4 rounded-xl bg-white p-4 text-sm text-gray-700 shadow-sm ring-1 ring-gray-900/5">
          Período: <strong>{activePeriod.code}</strong> ({activePeriod.startsOn} a {activePeriod.endsOn}) —{' '}
          {PERIOD_STATUS_LABELS[activePeriod.status] ?? activePeriod.status}
        </div>
      ) : null}
      {units.length === 0 ? (
        <EmptyState
          title="Nenhuma unidade operacional disponível"
          description="Sua sessão não tem unidade operacional autorizada, então não há relatório para consultar. A unidade é escolhida em lista; esta tela não aceita identificador digitado."
        />
      ) : null}
      {units.length > 0 && !readyScope ? (
        <EmptyState
          title="Selecione o escopo do relatório"
          description="O relatório é consultado no servidor após escolher o plano de contas da unidade e o período contábil."
        />
      ) : null}
      {gate}
      {content}
      {kind === 'journal' && journalQuery.state.phase === 'ready' ? (
        <div className="flex items-center justify-between gap-4">
          <Button
            variant="secondary"
            disabled={journalQuery.state.data.page <= 0}
            onClick={() => setJournalPage((current) => Math.max(0, current - 1))}
          >
            Página anterior
          </Button>
          <span className="text-sm text-gray-600">
            Página {journalQuery.state.data.page + 1} de {Math.max(journalQuery.state.data.totalPages, 1)}
          </span>
          <Button
            variant="secondary"
            disabled={journalQuery.state.data.page + 1 >= journalQuery.state.data.totalPages}
            onClick={() => setJournalPage((current) => current + 1)}
          >
            Próxima página
          </Button>
        </div>
      ) : null}
      {kind === 'ledger' && ledgerQuery.state.phase === 'ready' ? (
        <div className="flex items-center justify-between gap-4">
          <Button
            variant="secondary"
            disabled={ledgerQuery.state.data.page <= 0}
            onClick={() => setJournalPage((current) => Math.max(0, current - 1))}
          >
            Página anterior
          </Button>
          <span className="text-sm text-gray-600">
            Página {ledgerQuery.state.data.page + 1} de {Math.max(ledgerQuery.state.data.totalPages, 1)}
          </span>
          <Button
            variant="secondary"
            disabled={ledgerQuery.state.data.page + 1 >= ledgerQuery.state.data.totalPages}
            onClick={() => setJournalPage((current) => current + 1)}
          >
            Próxima página
          </Button>
        </div>
      ) : null}
    </ModulePage>
  );
}

function JournalTable({ data }: { data: JournalListPage }) {
  const flattened = useMemo(
    () =>
      data.items.flatMap((entry) =>
        entry.lines.map((line) => ({ entry, line })),
      ),
    [data.items],
  );
  const debitTotal = sumFlattened(flattened, 'DEBIT');
  const creditTotal = sumFlattened(flattened, 'CREDIT');
  return (
    <>
      <div className={worklistTableCardClass}>
        <table className={worklistTableClass} aria-label="Livro diário (postados)">
          <thead className={worklistHeadCellClass}>
            <tr>
              <th scope="col" className={worklistHeadCellClass}>
                Data
              </th>
              <th scope="col" className={worklistHeadCellClass}>
                Nº
              </th>
              <th scope="col" className={worklistHeadCellClass}>
                Histórico
              </th>
              <th scope="col" className={worklistHeadCellClass}>
                Conta
              </th>
              <th scope="col" className={worklistHeadCellClass}>
                Origem
              </th>
              <th scope="col" className={`${worklistHeadCellClass} text-right`}>
                Débito
              </th>
              <th scope="col" className={`${worklistHeadCellClass} text-right`}>
                Crédito
              </th>
            </tr>
          </thead>
          <tbody>
            {flattened.map(({ entry, line }) => (
              <tr key={`${entry.id}-${line.id}`} className={worklistRowClass}>
                <td className={worklistCellClass}>{entry.occurredOn}</td>
                <td className={worklistCellClass}>{entry.entryNumber ?? '—'}</td>
                <td className={`${worklistCellClass} whitespace-normal`}>{entry.description}</td>
                <td className={`${worklistCellClass} font-mono`}>
                  {line.accountCode ?? line.accountId}
                  {line.accountName ? ` — ${line.accountName}` : ''}
                </td>
                <td className={worklistCellClass}>{entry.sourceReference}</td>
                <td className={`${worklistCellClass} text-right`}>
                  {line.direction === 'DEBIT' ? <Money value={line.amount} /> : null}
                </td>
                <td className={`${worklistCellClass} text-right`}>
                  {line.direction === 'CREDIT' ? <Money value={line.amount} /> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={worklistTableCardClass}>
        <div className="flex flex-wrap justify-between gap-4 px-6 py-4 text-sm text-gray-700">
          <span>
            Débitos da página: <Money value={debitTotal} /> — Créditos da página: <Money value={creditTotal} />
          </span>
          <span>
            {data.total} lançamentos postados no período — página {data.page + 1} de{' '}
            {Math.max(data.totalPages, 1)}
          </span>
        </div>
      </div>
    </>
  );
}

function sumFlattened(rows: Array<{ line: { direction: string; amount: string } }>, direction: string): string {
  const amounts = rows.filter((row) => row.line.direction === direction).map((row) => row.line.amount);
  if (amounts.length === 0) {
    return '0';
  }
  const total = amounts.reduce((acc, amount) => acc + Number(amount), 0);
  return String(total);
}

function LedgerTable({ data }: { data: Awaited<ReturnType<typeof getAccountLedger>> }) {
  return (
    <>
      {data.account ? (
        <div className="mb-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
          <DefinitionList
            items={[
              { label: 'Conta', value: `${data.account.code} — ${data.account.name}` },
              { label: 'Classe', value: ACCOUNT_CLASS_LABELS[data.account.class] ?? data.account.class },
              { label: 'Situação', value: data.account.status === 'ACTIVE' ? 'Ativa' : 'Inativa' },
              { label: 'Natureza', value: data.account.normalBalance === 'DEBIT' ? 'Devedora' : 'Credora' },
              {
                label: 'Saldo anterior',
                value: `${data.openingBalance.side === 'DEBIT' ? 'D' : 'C'} ${formatMoney(data.openingBalance.amount)}`,
              },
              { label: 'Débitos do período', value: <Money value={data.periodDebits} /> },
              { label: 'Créditos do período', value: <Money value={data.periodCredits} /> },
              {
                label: 'Saldo final',
                value: `${data.closingBalance.side === 'DEBIT' ? 'D' : 'C'} ${formatMoney(data.closingBalance.amount)}`,
              },
            ]}
          />
        </div>
      ) : null}
      <div className={worklistTableCardClass}>
        <table className={worklistTableClass} aria-label="Razão da conta no período">
          <thead className={worklistHeadCellClass}>
            <tr>
              <th scope="col" className={worklistHeadCellClass}>
                Data
              </th>
              <th scope="col" className={worklistHeadCellClass}>
                Lançamento
              </th>
              <th scope="col" className={worklistHeadCellClass}>
                Histórico
              </th>
              <th scope="col" className={`${worklistHeadCellClass} text-right`}>
                Débito
              </th>
              <th scope="col" className={`${worklistHeadCellClass} text-right`}>
                Crédito
              </th>
              <th scope="col" className={`${worklistHeadCellClass} text-right`}>
                Saldo
              </th>
            </tr>
          </thead>
          <tbody>
            {data.movements.map((movement) => (
              <tr key={`${movement.journalEntryId}-${movement.direction}-${movement.amount}`} className={worklistRowClass}>
                <td className={worklistCellClass}>{movement.occurredOn}</td>
                <td className={worklistCellClass}>{movement.journalEntryId.slice(0, 8)}</td>
                <td className={`${worklistCellClass} whitespace-normal`}>{movement.description}</td>
                <td className={`${worklistCellClass} text-right`}>
                  {movement.direction === 'DEBIT' ? <Money value={movement.amount} /> : null}
                </td>
                <td className={`${worklistCellClass} text-right`}>
                  {movement.direction === 'CREDIT' ? <Money value={movement.amount} /> : null}
                </td>
                <td className={`${worklistCellClass} text-right`}>
                  {movement.runningBalance.side === 'DEBIT' ? 'D ' : 'C '}
                  <Money value={movement.runningBalance.amount} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TrialTable({ data }: { data: TrialBalance }) {
  return (
    <>
      {data.balanced ? null : (
        <div className="mb-4">
          <Alert tone="error">
            Balancete desbalanceado — diferença de {formatMoney(data.difference)}. O sistema não corrige
            automaticamente.
          </Alert>
        </div>
      )}
      <div className={worklistTableCardClass}>
        <table className={worklistTableClass} aria-label="Balancete do período">
          <thead className={worklistHeadCellClass}>
            <tr>
              <th scope="col" className={worklistHeadCellClass}>
                Conta
              </th>
              <th scope="col" className={worklistHeadCellClass}>
                Classe
              </th>
              <th scope="col" className={`${worklistHeadCellClass} text-right`}>
                Débito
              </th>
              <th scope="col" className={`${worklistHeadCellClass} text-right`}>
                Crédito
              </th>
            </tr>
          </thead>
          <tbody>
            {data.accounts.map((account) => (
              <tr key={account.accountId} className={worklistRowClass}>
                <td className={`${worklistCellClass} font-mono`}>
                  {account.code} — {account.name}
                </td>
                <td className={worklistCellClass}>{ACCOUNT_CLASS_LABELS[account.class] ?? account.class}</td>
                <td className={`${worklistCellClass} text-right`}>
                  {Number(account.debit) !== 0 ? <Money value={account.debit} /> : null}
                </td>
                <td className={`${worklistCellClass} text-right`}>
                  {Number(account.credit) !== 0 ? <Money value={account.credit} /> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={worklistTableCardClass}>
        <div className="flex flex-wrap justify-between gap-4 px-6 py-4 text-sm text-gray-700">
          <span>
            Total débito: <Money value={data.totalDebits} /> — Total crédito: <Money value={data.totalCredits} />
          </span>
          <span>Diferença: {formatMoney(data.difference)}</span>
        </div>
      </div>
    </>
  );
}

function IncomeTable({ data }: { data: IncomeStatement }) {
  return (
    <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
      {!data.available ? (
        <Alert tone="warning">
          O plano de contas ainda não possui contas de Receita/Despesa para apurar resultado.
        </Alert>
      ) : null}
      <DefinitionList
        items={[
          { label: 'Receita', value: <Money value={data.revenue} /> },
          { label: 'Despesa', value: <Money value={data.expense} /> },
          { label: 'Resultado do período', value: <Money value={data.netIncome} /> },
        ]}
      />
    </div>
  );
}

function BalanceTable({ data }: { data: BalanceSheet }) {
  return (
    <>
      {data.balanced ? null : (
        <div className="mb-4">
          <Alert tone="error">
            Balanço desbalanceado — ATIVO ≠ PASSIVO + PATRIMÔNIO LÍQUIDO. O sistema não ajusta
            automaticamente.
          </Alert>
        </div>
      )}
      <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
        <DefinitionList
          items={[
            { label: 'Ativo', value: <Money value={data.assets} /> },
            { label: 'Passivo', value: <Money value={data.liabilities} /> },
            { label: 'Patrimônio líquido', value: <Money value={data.equity} /> },
            { label: 'Resultado do período', value: <Money value={data.netIncome} /> },
            { label: 'Conferido (A = P + PL)', value: data.balanced ? 'Sim' : 'Não' },
          ]}
        />
      </div>
    </>
  );
}

function formatMoney(value: string): string {
  const numeric = Number(value);
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(numeric);
}
