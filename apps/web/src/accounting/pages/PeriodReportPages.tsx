import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Button, Money } from '../../ui';
import { ModulePage } from '../../ui/module-layout';
import {
  EnterpriseMetric,
  WorklistClearFilters,
  WorklistField,
  WorklistFilterBar,
  WorklistFooter,
  WorklistHeader,
  WorklistStatePanel,
  worklistCellClass,
  worklistHeadCellClass,
  worklistNumericHeadCellClass,
  worklistNumericCellClass,
  worklistRowClass,
  worklistSelectClass,
  worklistTableCardClass,
  worklistTableClass,
} from '../../ui/enterprise-list';
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

  /*
   * ESCOPO DE PÁGINA — o `<select>` vazio não informa nada: o operador via um campo desabilitado
   * sem saber o que faltava escolher. Quando a unidade não publica plano, o período não publica
   * nada e (no razão) a conta não foi escolhida, o estado é explicado na MESMA moldura da barra.
   */
  const scopeNotice = (() => {
    if (units.length === 0) {
      return {
        title: 'Nenhuma unidade operacional disponível',
        description:
          'Sua sessão não tem unidade operacional autorizada, então não há relatório para consultar. A unidade é escolhida em lista; esta tela não aceita identificador digitado.',
      };
    }
    if (chartId && charts.length === 0 && chartsQuery.state.phase === 'ready') {
      return {
        title: 'Nenhum plano de contas nesta unidade',
        description:
          'A unidade selecionada não tem plano de contas publicado, então não existe período contábil para apurar. Escolha outra unidade operacional.',
      };
    }
    if (chartId && periods.length === 0 && periodsQuery.state.phase === 'ready') {
      return {
        title: 'Nenhum período contábil neste plano',
        description:
          'O plano selecionado não tem competência publicada. Sem período não há apuração a exibir.',
      };
    }
    if (kind === 'ledger' && periodId && accountId === '' && accounts.length > 0) {
      return {
        title: 'Nenhuma conta selecionada para o razão',
        description:
          'O razão é o extrato de UMA conta no período. Escolha a conta na barra acima para carregar saldo anterior, movimentos e saldo acumulado.',
      };
    }
    return null;
  })();

  return (
    <ModulePage>
      <WorklistHeader
        title={meta.title}
        context={meta.description}
        metrics={
          <>
            {activePeriod ? (
              <>
                <EnterpriseMetric label="Competência" value={activePeriod.code} />
                <EnterpriseMetric
                  label="Situação"
                  value={PERIOD_STATUS_LABELS[activePeriod.status] ?? activePeriod.status}
                  tone={activePeriod.status === 'OPEN' ? 'warning' : 'neutral'}
                />
                <EnterpriseMetric
                  label="Intervalo"
                  value={`${activePeriod.startsOn} a ${activePeriod.endsOn}`}
                />
              </>
            ) : null}
            <ReportScopeMetrics kind={kind} journal={journalQuery} ledger={ledgerQuery} />
          </>
        }
      />

      {/*
        BARRA OPERACIONAL DE RELATÓRIO — unidade, plano, período e (no razão) conta em UMA linha.
        Nenhuma consulta, filtro, recorte ou ordem mudou: os mesmos valores continuam indo ao
        servidor, e o diário/razão continuam paginados pelo servidor.
      */}
      <WorklistFilterBar
        meta={
          kind === 'journal' && journalQuery.state.phase === 'ready'
            ? `${journalQuery.state.data.total} lançamentos postados · página ${
                journalQuery.state.data.page + 1
              } de ${Math.max(journalQuery.state.data.totalPages, 1)}`
            : undefined
        }
      >
        <WorklistField label="Unidade" htmlFor={`${kind}-unit`}>
          <select
            id={`${kind}-unit`}
            className={worklistSelectClass}
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
          </select>
        </WorklistField>
        <WorklistField label="Plano de contas" htmlFor={`${kind}-chart`}>
          <select
            id={`${kind}-chart`}
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
        <WorklistField label="Período contábil" htmlFor={`${kind}-period`}>
          {/*
            LARGURA LIMITADA — o rótulo da competência é longo por natureza
            (`2026-09 — 2026-09-01 a 2026-09-28 (Aberto)`), e um `<select>` que cresce pelo
            conteúdo estoura o container flex e dá scroll horizontal à página inteira. O teto de
            largura não altera nenhuma opção nem o valor enviado ao servidor.
          */}
          <select
            id={`${kind}-period`}
            className={`${worklistSelectClass} w-full max-w-[22rem]`}
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
          </select>
        </WorklistField>
        {kind === 'ledger' ? (
          <WorklistField label="Conta (Razão)" htmlFor="razao-account" grow>
            <select
              id="razao-account"
              className={`${worklistSelectClass} w-full min-w-0 max-w-[26rem]`}
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
            </select>
          </WorklistField>
        ) : null}
        {kind === 'ledger' && accountId !== '' ? (
          <WorklistClearFilters
            visible
            label="Limpar conta"
            onClick={() => {
              setAccountId('');
              setJournalPage(0);
            }}
          />
        ) : null}
      </WorklistFilterBar>

      {/*
        ESTADO INTEGRADO — o pré-requisito e o recorte vazio ocupam o lugar da ÁREA DE
        RESULTADO, dentro da mesma página (cabeçalho, indicadores e barra operacional montados).
        Antes este estado era um `EmptyState` solto que substituía a tela inteira e deixava 80%
        da página em branco.
      */}
      {scopeNotice ? (
        <WorklistStatePanel title={scopeNotice.title} description={scopeNotice.description} />
      ) : null}
      {!scopeNotice && units.length > 0 && !readyScope ? (
        <WorklistStatePanel
          title="Selecione o escopo do relatório"
          description="O relatório é consultado no servidor após escolher o plano de contas da unidade e o período contábil."
        />
      ) : null}
      {gate}
      {content}
      {kind === 'journal' && journalQuery.state.phase === 'ready' && journalQuery.state.data.items.length > 0 ? (
        <WorklistFooter
          rangeLabel={
            <span aria-live="polite">
              Página {journalQuery.state.data.page + 1} de{' '}
              {Math.max(journalQuery.state.data.totalPages, 1)} ·{' '}
              {journalQuery.state.data.total} lançamentos postados
            </span>
          }
        >
          <Button
            variant="secondary"
            disabled={journalQuery.state.data.page <= 0}
            onClick={() => setJournalPage((current) => Math.max(0, current - 1))}
          >
            Página anterior
          </Button>
          <Button
            variant="secondary"
            disabled={journalQuery.state.data.page + 1 >= journalQuery.state.data.totalPages}
            onClick={() => setJournalPage((current) => current + 1)}
          >
            Próxima página
          </Button>
        </WorklistFooter>
      ) : null}
      {kind === 'ledger' && ledgerQuery.state.phase === 'ready' && ledgerQuery.state.data.movements.length > 0 ? (
        <WorklistFooter
          rangeLabel={
            <span aria-live="polite">
              Página {ledgerQuery.state.data.page + 1} de{' '}
              {Math.max(ledgerQuery.state.data.totalPages, 1)} · {ledgerQuery.state.data.total}{' '}
              movimentos
            </span>
          }
        >
          <Button
            variant="secondary"
            disabled={ledgerQuery.state.data.page <= 0}
            onClick={() => setJournalPage((current) => Math.max(0, current - 1))}
          >
            Página anterior
          </Button>
          <Button
            variant="secondary"
            disabled={ledgerQuery.state.data.page + 1 >= ledgerQuery.state.data.totalPages}
            onClick={() => setJournalPage((current) => current + 1)}
          >
            Próxima página
          </Button>
        </WorklistFooter>
      ) : null}
    </ModulePage>
  );
}

/**
 * INDICADORES DO RELATÓRIO — somente os números que o CONTRATO já publicou para o recorte
 * consultado, na faixa somente-leitura do cabeçalho (`EnterpriseMetric`).
 *
 * Nada é derivado: `balanced`, `difference`, `available` e `total` vêm do servidor e são
 * exibidos como vieram. Quando o relatório ainda não foi consultado, a faixa fica vazia em vez
 * de mostrar zero — zero afirmaria "nada a apurar", que é uma conclusão contábil.
 */
function ReportScopeMetrics({
  kind,
  journal,
  ledger,
}: {
  kind: ReportKind;
  journal: ReturnType<typeof useBackofficeQuery<JournalListPage>>;
  ledger: ReturnType<typeof useBackofficeQuery<Awaited<ReturnType<typeof getAccountLedger>>>>;
}) {
  if (kind === 'journal' && journal.state.phase === 'ready') {
    return (
      <>
        <EnterpriseMetric label="Lançamentos postados" value={journal.state.data.total} />
        <EnterpriseMetric
          label="Página"
          value={`${journal.state.data.page + 1}/${Math.max(journal.state.data.totalPages, 1)}`}
        />
      </>
    );
  }
  if (kind === 'ledger' && ledger.state.phase === 'ready') {
    const data = ledger.state.data;
    return (
      <>
        <EnterpriseMetric label="Movimentos" value={data.total} />
        <EnterpriseMetric
          label="Página"
          value={`${data.page + 1}/${Math.max(data.totalPages, 1)}`}
        />
        <EnterpriseMetric
          label="Saldo anterior"
          value={`${data.openingBalance.side === 'DEBIT' ? 'D' : 'C'} ${formatMoney(
            data.openingBalance.amount,
          )}`}
        />
        <EnterpriseMetric
          label="Saldo final"
          value={`${data.closingBalance.side === 'DEBIT' ? 'D' : 'C'} ${formatMoney(
            data.closingBalance.amount,
          )}`}
        />
      </>
    );
  }
  return null;
}

function JournalTable({ data }: { data: JournalListPage }) {
  const flattened = useMemo(
    () =>
      data.items.flatMap((entry) =>
        entry.lines.map((line) => ({ entry, line })),
      ),
    [data.items],
  );
  /*
   * TOTAIS DA PÁGINA — soma dos valores que o servidor JÁ devolveu para a página corrente, sobre
   * o mesmo conjunto exibido ao lado. Não é apuração contábil: é o "total desta página" que as
   * listas densas do ERP mostram, e `data.total` continua sendo o número de lançamentos do
   * servidor. O fechamento, o balancete e o balanço seguem calculados exclusivamente no backend.
   */
  const debitTotal = sumFlattened(flattened, 'DEBIT');
  const creditTotal = sumFlattened(flattened, 'CREDIT');

  if (flattened.length === 0) {
    return (
      <WorklistStatePanel
        title="Nenhum lançamento postado no período"
        description="O diário é derivado somente de lançamentos POSTED. O período selecionado não tem lançamento postado para exibir — rascunhos aparecem em Lançamentos até serem postados."
      />
    );
  }

  return (
    <>
      <div className={worklistTableCardClass}>
        <table className={worklistTableClass} aria-label="Livro diário (postados)">
          <thead>
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
              <th scope="col" className={worklistNumericHeadCellClass}>
                Débito
              </th>
              <th scope="col" className={worklistNumericHeadCellClass}>
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
                <td className={`${worklistCellClass} whitespace-normal`}>{entry.sourceReference}</td>
                <td className={worklistNumericCellClass}>
                  {line.direction === 'DEBIT' ? <Money value={line.amount} /> : null}
                </td>
                <td className={worklistNumericCellClass}>
                  {line.direction === 'CREDIT' ? <Money value={line.amount} /> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={worklistTableCardClass}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2 text-xs text-gray-600 tabular-nums">
          <span>
            Débitos da página: <Money value={debitTotal} /> — Créditos da página:{' '}
            <Money value={creditTotal} />
          </span>
          <span>
            {data.total} lançamentos postados no período · página {data.page + 1} de{' '}
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
        /*
         * IDENTIDADE DA CONTA DO RAZÃO — faixa densa acima do extrato. Era um cartão
         * `rounded-xl p-6 shadow-sm`. `naturalBalance`, `openingBalance` e `closingBalance`
         * continuam sendo EXATAMENTE os valores do servidor: nada é somado no navegador.
         */
        <section
          className="mb-2 rounded-md border border-gray-200 bg-white"
          aria-label="Conta do razão"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-gray-200 px-3 py-2">
            <span className="font-mono text-[13px] font-semibold text-gray-900">
              {data.account.code}
            </span>
            <span className="text-[13px] text-gray-900">{data.account.name}</span>
            <span className="text-xs text-gray-500">
              {ACCOUNT_CLASS_LABELS[data.account.class] ?? data.account.class} ·{' '}
              {data.account.status === 'ACTIVE' ? 'Ativa' : 'Inativa'} · natureza{' '}
              {data.account.normalBalance === 'DEBIT' ? 'Devedora' : 'Credora'}
            </span>
            <span className="ml-auto flex flex-wrap items-center gap-x-4 text-xs text-gray-600 tabular-nums">
              <span>
                Saldo anterior{' '}
                <strong>
                  {data.openingBalance.side === 'DEBIT' ? 'D' : 'C'}{' '}
                  {formatMoney(data.openingBalance.amount)}
                </strong>
              </span>
              <span>
                Débitos <Money value={data.periodDebits} />
              </span>
              <span>
                Créditos <Money value={data.periodCredits} />
              </span>
              <span>
                Saldo final{' '}
                <strong>
                  {data.closingBalance.side === 'DEBIT' ? 'D' : 'C'}{' '}
                  {formatMoney(data.closingBalance.amount)}
                </strong>
              </span>
            </span>
          </div>
        </section>
      ) : null}
      {data.movements.length === 0 ? (
        <WorklistStatePanel
          title="Nenhum movimento nesta conta no período"
          description="A conta escolhida não recebeu lançamento postado no período selecionado. Saldo anterior e saldo final continuam sendo os apurados pelo servidor."
        />
      ) : (
        <div className={worklistTableCardClass}>
          <table className={worklistTableClass} aria-label="Razão da conta no período">
            <thead>
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
                <th scope="col" className={worklistNumericHeadCellClass}>
                  Débito
                </th>
                <th scope="col" className={worklistNumericHeadCellClass}>
                  Crédito
                </th>
                <th scope="col" className={worklistNumericHeadCellClass}>
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
                  <td className={worklistNumericCellClass}>
                    {movement.direction === 'DEBIT' ? <Money value={movement.amount} /> : null}
                  </td>
                  <td className={worklistNumericCellClass}>
                    {movement.direction === 'CREDIT' ? <Money value={movement.amount} /> : null}
                  </td>
                  <td className={worklistNumericCellClass}>
                    {movement.runningBalance.side === 'DEBIT' ? 'D ' : 'C '}
                    <Money value={movement.runningBalance.amount} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function TrialTable({ data }: { data: TrialBalance }) {
  /*
   * BALANCETE — relatório contábil enterprise: cabeçalho de conferência com os totais do
   * SERVIDOR, corpo denso por conta e rodapé de fechamento. Nenhuma linha é criada aqui: as
   * contas, os débitos, os créditos, a diferença e o veredito `balanced` vêm do backend.
   */
  if (data.accounts.length === 0) {
    return (
      <WorklistStatePanel
        title="Balancete sem contas no período"
        description="O período selecionado não tem conta com movimento apurado. Os totais continuam sendo os conferidos pelo servidor."
      />
    );
  }
  return (
    <>
      <section className="mb-2 rounded-md border border-gray-200 bg-white" aria-label="Conferência do balancete">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-3 py-2 text-xs text-gray-600 tabular-nums">
          <span>
            Total débito <Money value={data.totalDebits} />
          </span>
          <span>
            Total crédito <Money value={data.totalCredits} />
          </span>
          <span>
            Diferença <strong>{formatMoney(data.difference)}</strong>
          </span>
          <span className={data.balanced ? 'text-emerald-700' : 'text-red-700'}>
            {data.balanced
              ? 'Conferido pelo servidor'
              : 'Desbalanceado — o sistema não corrige automaticamente'}
          </span>
        </div>
      </section>
      {data.balanced ? null : (
        <div className="mb-2">
          <Alert tone="error">
            Balancete desbalanceado — diferença de {formatMoney(data.difference)}. O sistema não corrige
            automaticamente.
          </Alert>
        </div>
      )}
      <div className={worklistTableCardClass}>
        <table className={worklistTableClass} aria-label="Balancete do período">
          <thead>
            <tr>
              <th scope="col" className={worklistHeadCellClass}>
                Conta
              </th>
              <th scope="col" className={worklistHeadCellClass}>
                Classe
              </th>
              <th scope="col" className={worklistNumericHeadCellClass}>
                Débito
              </th>
              <th scope="col" className={worklistNumericHeadCellClass}>
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
                <td className={worklistNumericCellClass}>
                  {Number(account.debit) !== 0 ? <Money value={account.debit} /> : null}
                </td>
                <td className={worklistNumericCellClass}>
                  {Number(account.credit) !== 0 ? <Money value={account.credit} /> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-gray-200 px-3 py-2 text-xs text-gray-600 tabular-nums">
          <span>
            Total débito <Money value={data.totalDebits} /> — Total crédito{' '}
            <Money value={data.totalCredits} />
          </span>
          <span>Diferença: {formatMoney(data.difference)}</span>
        </div>
      </div>
    </>
  );
}

function IncomeTable({ data }: { data: IncomeStatement }) {
  /*
   * DRE — a área de resultado é o RELATÓRIO, não um cartão com três linhas soltas. Receita,
   * despesa e resultado continuam sendo exatamente os valores apurados pelo servidor; o
   * navegador não recalcula nada (nem uma subtração).
   */
  if (!data.available) {
    return (
      <>
        <Alert tone="warning">
          O plano de contas ainda não possui contas de Receita/Despesa para apurar resultado.
        </Alert>
        <div className="mt-2">
          <WorklistStatePanel
            title="DRE indisponível para este plano"
            description="A apuração de resultado exige contas de Receita e Despesa publicadas no plano. Nenhum resultado é estimado nesta tela."
          />
        </div>
      </>
    );
  }
  return (
    <section className="mb-3 rounded-md border border-gray-200 bg-white" aria-label="Resultado do período">
      <div className="border-b border-gray-200 px-3 py-2">
        <h2 className="text-[13px] font-semibold text-gray-900">Resultado do período</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Apurado pelo servidor a partir do plano de contas e do ledger POSTED.
        </p>
      </div>
      <dl className="divide-y divide-gray-100">
        {[
          { label: 'Receita', value: data.revenue, emphasis: false },
          { label: 'Despesa', value: data.expense, emphasis: false },
          { label: 'Resultado do período', value: data.netIncome, emphasis: true },
        ].map((row) => (
          <div
            key={row.label}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2"
          >
            <dt
              className={
                row.emphasis
                  ? 'text-[13px] font-semibold text-gray-900'
                  : 'text-[13px] text-gray-700'
              }
            >
              {row.label}
            </dt>
            <dd className="m-0 text-[13px] tabular-nums">
              <Money value={row.value} emphasis={row.emphasis} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function BalanceTable({ data }: { data: BalanceSheet }) {
  /*
   * BALANÇO PATRIMONIAL — ATIVO = PASSIVO + PATRIMÔNIO LÍQUIDO é a regra VALIDADA PELO SERVIDOR.
   * A tela apenas mostra os valores e o veredito `balanced`; não existe ajuste automático nem
   * recomposição no navegador.
   */
  if (!data.available) {
    return (
      <WorklistStatePanel
        title="Balanço indisponível para este plano"
        description="O plano de contas ainda não publica as classes patrimoniais necessárias para a posição. Nenhum valor é estimado nesta tela."
      />
    );
  }
  const rows = [
    { label: 'Ativo', value: data.assets, group: 'patrimonial' as const },
    { label: 'Passivo', value: data.liabilities, group: 'patrimonial' as const },
    { label: 'Patrimônio líquido', value: data.equity, group: 'patrimonial' as const },
    { label: 'Resultado do período', value: data.netIncome, group: 'resultado' as const },
  ];
  return (
    <>
      {data.balanced ? null : (
        <div className="mb-2">
          <Alert tone="error">
            Balanço desbalanceado — ATIVO ≠ PASSIVO + PATRIMÔNIO LÍQUIDO. O sistema não ajusta
            automaticamente.
          </Alert>
        </div>
      )}
      <section
        className="mb-3 rounded-md border border-gray-200 bg-white"
        aria-label="Posição patrimonial do período"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-gray-200 px-3 py-2">
          <div>
            <h2 className="text-[13px] font-semibold text-gray-900">Posição patrimonial</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              Posição do final do período, conferida pelo servidor (A = P + PL).
            </p>
          </div>
          <span
            className={
              data.balanced
                ? 'text-xs font-semibold text-emerald-700'
                : 'text-xs font-semibold text-red-700'
            }
          >
            {data.balanced ? 'Conferido: A = P + PL' : 'Não conferido: A ≠ P + PL'}
          </span>
        </div>
        <dl className="divide-y divide-gray-100">
          {rows.map((row) => (
            <div
              key={row.label}
              className={
                row.group === 'resultado'
                  ? 'flex flex-wrap items-center justify-between gap-x-4 gap-y-1 bg-gray-50/60 px-3 py-2'
                  : 'flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2'
              }
            >
              <dt className="text-[13px] text-gray-700">{row.label}</dt>
              <dd className="m-0 text-[13px] tabular-nums">
                <Money value={row.value} />
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}

function formatMoney(value: string): string {
  const numeric = Number(value);
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(numeric);
}
