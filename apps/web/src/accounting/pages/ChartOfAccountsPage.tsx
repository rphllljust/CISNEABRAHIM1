import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, EmptyState, Field, Input, Money, Select, StatusBadge, worklistTableCardClass } from '../../ui';
import { FilterCard, ModulePage, ModulePageHeader } from '../../ui/module-layout';
import { worklistCellClass, worklistTableClass, worklistHeadCellClass, worklistRowClass } from '../../ui/enterprise-list';
import { DefinitionList } from '../../financial-ui/DefinitionList';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { JOURNAL_STATUS_LABELS } from '../../financial-ui/labels';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { FinanceStatusBadge } from '../../finance/components/FinanceStatusBadge';
import { OperationalUnitOptions, useOperationalUnits } from '../../shell/hooks/useOperationalUnits';
import {
  createAccount,
  listAccounts,
  listCharts,
  listJournals,
  reconstructLedger,
  updateAccount,
} from '../api/accounting-api';
import { mapAccountingErrorToMessage } from '../api/accounting-error-messages';
import type {
  Account,
  AccountClass,
  AccountsList,
  ChartOfAccounts,
  ChartsList,
  JournalListPage,
  LedgerReconstruction,
} from '../types/accounting.types';

const CLASS_LABELS: Record<AccountClass, string> = {
  ASSET: 'Ativo',
  LIABILITY: 'Passivo',
  EQUITY: 'Patrimônio líquido',
  REVENUE: 'Receita',
  EXPENSE: 'Despesa',
};

/** Tamanho de página do detalhamento por conta: mesmo número da lista de lançamentos. */
const DRILL_PAGE_SIZE = 25;

export function ChartOfAccountsPage() {
  // A unidade operacional vem do contexto do shell (fonte unica ja usada pelos modulos de
  // backoffice). O operador escolhe na lista de unidades autorizadas e nunca digita
  // identificador: selecionada a unidade, os planos dela sao carregados do servidor e o
  // operador escolhe o plano pelo codigo/nome.
  const { units, options: unitOptions, unitId, setUnitId } = useOperationalUnits();
  const [chartId, setChartId] = useState('');
  const [chartActionError, setChartActionError] = useState<string | null>(null);
  const [drillAccountId, setDrillAccountId] = useState('');
  const [drillPage, setDrillPage] = useState(0);

  const chartsQuery = useBackofficeQuery<ChartsList>({
    enabled: unitId !== '',
    autoLoad: false,
    loader: (signal) => listCharts(unitId, signal),
    mapError: mapAccountingErrorToMessage,
  });

  const activeChartId = chartId || undefined;
  const accountsQuery = useBackofficeQuery<AccountsList>({
    enabled: Boolean(activeChartId),
    autoLoad: false,
    loader: (signal) => listAccounts(activeChartId as string, signal),
    mapError: mapAccountingErrorToMessage,
  });
  const ledgerQuery = useBackofficeQuery<LedgerReconstruction>({
    enabled: Boolean(activeChartId),
    autoLoad: false,
    loader: (signal) => reconstructLedger(activeChartId as string, signal),
    mapError: mapAccountingErrorToMessage,
  });
  // Detalhamento conta -> lancamentos: usa a listagem de lancamentos que ja existe no servidor,
  // filtrada por conta (accountId). Nada e somado nem reclassificado no navegador.
  const journalQuery = useBackofficeQuery<JournalListPage>({
    enabled: Boolean(activeChartId && drillAccountId),
    autoLoad: false,
    loader: (signal) =>
      listJournals(
        activeChartId as string,
        { accountId: drillAccountId, page: drillPage, pageSize: DRILL_PAGE_SIZE },
        signal,
      ),
    mapError: mapAccountingErrorToMessage,
  });

  const charts = chartsQuery.state.phase === 'ready' ? chartsQuery.state.data.items : [];
  const activeChart: ChartOfAccounts | undefined = charts.find((chart) => chart.id === chartId);
  const accountRows = accountsQuery.state.phase === 'ready' ? accountsQuery.state.data.items : [];
  const ledgerRows = ledgerQuery.state.phase === 'ready' ? ledgerQuery.state.data.accounts : [];
  const ledger = ledgerQuery.state.phase === 'ready' ? ledgerQuery.state.data : null;
  const drillAccount = accountRows.find((account) => account.id === drillAccountId);

  const { reload: reloadCharts, reset: resetCharts } = chartsQuery;
  const { reload: reloadAccounts, reset: resetAccounts } = accountsQuery;
  const { reload: reloadLedger, reset: resetLedger } = ledgerQuery;
  const { reload: reloadJournals, reset: resetJournals } = journalQuery;

  // Trocar a unidade limpa o plano selecionado (evita UUID orfao de outro plano) e carrega os
  // planos da unidade escolhida. O conteudo anterior e descartado antes da nova consulta para
  // que nenhum plano de outra unidade fique visivel enquanto a resposta chega.
  useEffect(() => {
    setChartId('');
    resetCharts();
    if (unitId === '') {
      return;
    }
    void reloadCharts();
  }, [reloadCharts, resetCharts, unitId]);

  // Trocar o plano recarrega contas e saldos do plano escolhido pelo mesmo mecanismo.
  useEffect(() => {
    setDrillAccountId('');
    setDrillPage(0);
    resetAccounts();
    resetLedger();
    if (!activeChartId) {
      return;
    }
    void reloadAccounts();
    void reloadLedger();
  }, [activeChartId, reloadAccounts, reloadLedger, resetAccounts, resetLedger]);

  // Trocar de conta (ou de pagina) recarrega os lancamentos da conta escolhida.
  useEffect(() => {
    resetJournals();
    if (!activeChartId || drillAccountId === '') {
      return;
    }
    void reloadJournals();
  }, [activeChartId, drillAccountId, drillPage, reloadJournals, resetJournals]);

  const tree = useMemo(() => buildTree(accountRows), [accountRows]);

  const balancesByAccount = useMemo(() => {
    return new Map(ledgerRows.map((row) => [row.accountId, row]));
  }, [ledgerRows]);

  async function runChartAction(action: () => Promise<unknown>) {
    setChartActionError(null);
    try {
      await action();
      await accountsQuery.reload();
    } catch {
      setChartActionError(mapAccountingErrorToMessage(undefined, 0));
    }
  }

  const createGate = activeChartId
    ? renderQueryGate(
        'Plano de contas',
        'Carregando contas…',
        'Você não tem permissão para consultar o plano de contas.',
        accountsQuery.state,
        () => void accountsQuery.reload(),
      )
    : null;

  const drillGate =
    activeChartId && drillAccountId
      ? renderQueryGate(
          'Lançamentos da conta',
          'Carregando lançamentos…',
          'Você não tem permissão para consultar lançamentos desta conta.',
          journalQuery.state,
          () => void journalQuery.reload(),
        )
      : null;

  const drillSynthetic = drillAccount
    ? accountRows.some((account) => account.parentId === drillAccount.id)
    : false;

  return (
    <ModulePage>
      <ModulePageHeader
        title="Plano de contas"
        description="A árvore e os saldos são a leitura oficial do servidor; o navegador não soma nem reclassifica contas."
      />
      <FilterCard>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Unidade operacional" htmlFor="coa-unit">
            <Select
              id="coa-unit"
              value={unitId}
              onChange={(event) => setUnitId(event.target.value)}
              disabled={units.length === 0}
            >
              {/*
                ESCOPO DE UNIDADE pelo primitivo compartilhado — mesmo tratamento das demais
                superficies contabeis. A tela montava as opcoes a mao com um ordinal
                `Unidade {index + 1}`, e o teste desta tela era o unico que ainda exigia o
                identificador tecnico (`unit-a`) como TEXTO visivel.
              */}
              <OperationalUnitOptions options={unitOptions} />
            </Select>
          </Field>
          <Field label="Plano de contas" htmlFor="coa-chart">
            <Select
              id="coa-chart"
              value={chartId}
              onChange={(event) => setChartId(event.target.value)}
              disabled={charts.length === 0}
            >
              <option value="">Selecione um plano…</option>
              {charts.map((chart) => (
                <option key={chart.id} value={chart.id}>
                  {chart.code} — {chart.name} ({chart.unitId})
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </FilterCard>

      {units.length === 0 ? (
        <EmptyState
          title="Nenhuma unidade operacional disponível"
          description="Sua sessão não tem unidade operacional autorizada, então não há plano de contas para consultar. O plano é escolhido a partir da unidade; esta tela não aceita identificador digitado."
        />
      ) : null}
      {chartsQuery.state.phase === 'denied' ? (
        <Alert tone="error">Você não tem permissão para listar planos de contas desta unidade.</Alert>
      ) : null}
      {units.length > 0 && !activeChartId ? (
        <EmptyState
          title={
            charts.length === 0 && chartsQuery.state.phase === 'ready'
              ? 'Nenhum plano de contas nesta unidade'
              : 'Nenhum plano selecionado'
          }
          description={
            charts.length === 0 && chartsQuery.state.phase === 'ready'
              ? 'A unidade selecionada não tem plano de contas publicado. Escolha outra unidade operacional.'
              : 'Selecione o plano de contas da unidade; as contas e os saldos são consultados automaticamente.'
          }
        />
      ) : null}
      {createGate}

      {activeChart ? (
        <div className="mb-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
          <DefinitionList
            items={[
              { label: 'Código', value: activeChart.code },
              { label: 'Nome', value: activeChart.name },
              { label: 'Unidade', value: activeChart.unitId },
              { label: 'Status', value: activeChart.status },
              ...(ledger
                ? [
                    { label: 'Balanceado', value: ledger.balanced ? 'Sim' : 'Não' },
                    { label: 'Débitos', value: <Money value={ledger.totalDebits} /> },
                    { label: 'Créditos', value: <Money value={ledger.totalCredits} /> },
                  ]
                : []),
            ]}
          />
        </div>
      ) : null}

      {chartActionError ? (
        <div className="mb-4">
          <Alert tone="error">{chartActionError}</Alert>
        </div>
      ) : null}

      {activeChartId && accountRows.length > 0 ? (
        <>
          <div className={worklistTableCardClass}>
            <table className={worklistTableClass} aria-label="Árvore de contas do plano">
              <thead className={worklistHeadCellClass}>
                <tr>
                  <th scope="col" className={worklistHeadCellClass}>
                    Código
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Nome
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Classe
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Situação
                  </th>
                  <th scope="col" className={`${worklistHeadCellClass} text-right`}>
                    Débitos
                  </th>
                  <th scope="col" className={`${worklistHeadCellClass} text-right`}>
                    Créditos
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Ação
                  </th>
                </tr>
              </thead>
              <tbody>
                {tree.map((row) => {
                  const balances = balancesByAccount.get(row.id);
                  const synthetic = accountRows.some((account) => account.parentId === row.id);
                  return (
                    <tr key={row.id} className={worklistRowClass}>
                      <td className={`${worklistCellClass} font-mono`}>{row.code}</td>
                      <td className={worklistCellClass}>
                        <span style={{ paddingLeft: `${row.depth * 1.25}rem` }}>{row.name}</span>
                      </td>
                      <td className={worklistCellClass}>{CLASS_LABELS[row.class] ?? row.class}</td>
                      <td className={worklistCellClass}>
                        <StatusBadge
                          tone={row.status === 'ACTIVE' ? 'success' : 'neutral'}
                          label={row.status === 'ACTIVE' ? 'Ativa' : 'Inativa'}
                        />
                        {synthetic ? <StatusBadge tone="info" label="Sintética" /> : null}
                      </td>
                      <td className={`${worklistCellClass} text-right`}>
                        <Money value={balances?.debits ?? '0'} />
                      </td>
                      <td className={`${worklistCellClass} text-right`}>
                        <Money value={balances?.credits ?? '0'} />
                      </td>
                      <td className={worklistCellClass}>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="secondary"
                            aria-label={`Lançamentos da conta ${row.code}`}
                            onClick={() => {
                              setDrillAccountId(row.id);
                              setDrillPage(0);
                            }}
                          >
                            Lançamentos
                          </Button>
                          {row.status === 'ACTIVE' ? (
                            <Button
                              variant="secondary"
                              onClick={() =>
                                void runChartAction(() =>
                                  updateAccount(activeChartId, row.id, { status: 'INACTIVE' }),
                                )
                              }
                            >
                              Inativar
                            </Button>
                          ) : (
                            <Button
                              variant="secondary"
                              onClick={() =>
                                void runChartAction(() =>
                                  updateAccount(activeChartId, row.id, { status: 'ACTIVE' }),
                                )
                              }
                            >
                              Reativar
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {drillGate}

          {drillAccountId && journalQuery.state.phase === 'ready' ? (
            <div className={worklistTableCardClass}>
              <div className="border-b border-gray-200 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900">
                      {drillAccount
                        ? `Lançamentos da conta ${drillAccount.code} — ${drillAccount.name}`
                        : 'Lançamentos da conta'}
                    </h2>
                    <p className="mt-1 text-sm text-gray-600">
                      Lista do servidor filtrada por esta conta. O navegador não soma nem
                      reclassifica valores.
                    </p>
                  </div>
                  <Button variant="secondary" onClick={() => setDrillAccountId('')}>
                    Fechar
                  </Button>
                </div>
              </div>
              {journalQuery.state.data.items.length === 0 ? (
                <p className="px-4 py-6 text-sm text-gray-600">
                  {drillSynthetic
                    ? 'Conta sintética: agrega subcontas e não recebe lançamento direto.'
                    : 'Nenhum lançamento registrado nesta conta.'}
                </p>
              ) : (
                <>
                  <table className={worklistTableClass} aria-label="Lançamentos da conta">
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
                          Tipo
                        </th>
                        <th scope="col" className={worklistHeadCellClass}>
                          Estado
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
                      {journalQuery.state.data.items.map((entry) => (
                        <tr key={entry.id} className={worklistRowClass}>
                          <td className={worklistCellClass}>{entry.entryNumber ?? '—'}</td>
                          <td className={worklistCellClass}>{entry.occurredOn}</td>
                          <td className={`${worklistCellClass} whitespace-normal`}>
                            {entry.description}
                          </td>
                          <td className={worklistCellClass}>
                            {entry.kind === 'REVERSAL' ? 'Estorno' : 'Lançamento'}
                          </td>
                          <td className={worklistCellClass}>
                            <FinanceStatusBadge
                              status={entry.status}
                              labels={JOURNAL_STATUS_LABELS}
                            />
                          </td>
                          <td className={`${worklistCellClass} text-right`}>
                            <Money value={entry.debitTotal} currencyCode={entry.currencyCode} />
                          </td>
                          <td className={`${worklistCellClass} text-right`}>
                            <Money value={entry.creditTotal} currencyCode={entry.currencyCode} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
                    <Button
                      variant="secondary"
                      disabled={journalQuery.state.data.page <= 0}
                      onClick={() => setDrillPage((current) => Math.max(0, current - 1))}
                    >
                      Página anterior
                    </Button>
                    <span className="text-sm text-gray-600">
                      Página {journalQuery.state.data.page + 1} de{' '}
                      {Math.max(journalQuery.state.data.totalPages, 1)} —{' '}
                      {journalQuery.state.data.total} lançamentos
                    </span>
                    <Button
                      variant="secondary"
                      disabled={
                        journalQuery.state.data.page + 1 >= journalQuery.state.data.totalPages
                      }
                      onClick={() => setDrillPage((current) => current + 1)}
                    >
                      Próxima página
                    </Button>
                  </div>
                </>
              )}
            </div>
          ) : null}

          <CreateAccountPanel
            chartId={activeChartId}
            accounts={accountRows}
            onCreated={() => {
              void accountsQuery.reload();
              void ledgerQuery.reload();
            }}
          />
        </>
      ) : null}
    </ModulePage>
  );
}

function buildTree(accounts: Account[]): Array<Account & { depth: number }> {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const depthById = new Map<string, number>();
  function depthOf(account: Account): number {
    const cached = depthById.get(account.id);
    if (cached !== undefined) {
      return cached;
    }
    const parent = account.parentId ? byId.get(account.parentId) : undefined;
    const depth = parent ? depthOf(parent) + 1 : 0;
    depthById.set(account.id, depth);
    return depth;
  }
  return [...accounts]
    .sort((left, right) => left.code.localeCompare(right.code))
    .map((account) => ({ ...account, depth: depthOf(account) }));
}

function CreateAccountPanel({
  chartId,
  accounts,
  onCreated,
}: {
  chartId: string;
  accounts: Account[];
  onCreated: () => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [accountClass, setAccountClass] = useState<AccountClass>('ASSET');
  const [parentId, setParentId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      await createAccount(chartId, {
        code: code.trim(),
        name: name.trim(),
        class: accountClass,
        parentId: parentId.trim() === '' ? undefined : parentId,
      });
      setCode('');
      setName('');
      setParentId('');
      onCreated();
    } catch {
      setError(mapAccountingErrorToMessage(undefined, 0));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
      <h2 className="mb-4 text-base font-semibold text-gray-900">Nova conta</h2>
      {error ? (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Field label="Conta superior (opcional)" htmlFor="account-parent">
          <Select id="account-parent" value={parentId} onChange={(event) => setParentId(event.target.value)}>
            <option value="">(nenhuma — raiz)</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.code} — {account.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Código" htmlFor="account-code">
          <Input id="account-code" value={code} onChange={(event) => setCode(event.target.value)} />
        </Field>
        <Field label="Nome" htmlFor="account-name">
          <Input id="account-name" value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Classe" htmlFor="account-class">
          <Select
            id="account-class"
            value={accountClass}
            onChange={(event) => setAccountClass(event.target.value as AccountClass)}
          >
            {(Object.keys(CLASS_LABELS) as AccountClass[]).map((key) => (
              <option key={key} value={key}>
                {CLASS_LABELS[key]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="mt-4 flex justify-end">
        <Button
          onClick={() => void submit()}
          disabled={submitting || code.trim() === '' || name.trim() === ''}
        >
          {submitting ? 'Criando…' : 'Criar conta'}
        </Button>
      </div>
    </div>
  );
}
