import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Field, Input, Money, Select, StatusBadge } from '../../ui';
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
  worklistCellRaisedClass,
  worklistHeadCellClass,
  worklistNumericHeadCellClass,
  worklistNumericCellClass,
  worklistRowClass,
  worklistSelectClass,
  worklistTableCardClass,
  worklistTableClass,
} from '../../ui/enterprise-list';
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

  const [accountSearch, setAccountSearch] = useState('');
  const [classFilter, setClassFilter] = useState<'' | AccountClass>('');
  const [statusFilter, setStatusFilter] = useState<'' | 'ACTIVE' | 'INACTIVE'>('');

  const balancesByAccount = useMemo(() => {
    return new Map(ledgerRows.map((row) => [row.accountId, row]));
  }, [ledgerRows]);

  /**
   * CONTAGENS DA ÁRVORE — derivadas APENAS dos campos que o contrato já publica
   * (`Account.class` e `Account.status`), sobre a lista real devolvida pelo servidor.
   *
   * Nada aqui é saldo, total ou indicador contábil: são contagens de cadastro, o mesmo tipo de
   * recorte que `ClientsListPage` faz sobre `status`. Os saldos continuam vindo exclusivamente
   * de `/accounting/ledger` e nunca são somados no navegador.
   */
  const syntheticCount = useMemo(
    () => accountRows.filter((account) => accountRows.some((child) => child.parentId === account.id)).length,
    [accountRows],
  );
  const inactiveCount = useMemo(
    () => accountRows.filter((account) => account.status !== 'ACTIVE').length,
    [accountRows],
  );

  const accountFilterActive =
    accountSearch.trim() !== '' || classFilter !== '' || statusFilter !== '';

  /**
   * RECORTE DE LEITURA — busca por código/nome, classe e situação. É filtro de APRESENTAÇÃO
   * sobre a lista que o servidor já autorizou: nenhuma consulta nova, nenhum recorte contábil
   * recalculado e nenhum saldo alterado. A árvore é reconstruída a partir das linhas visíveis.
   */
  const visibleRows = useMemo(() => {
    const term = accountSearch.trim().toLowerCase();
    return accountRows.filter((account) => {
      if (classFilter !== '' && account.class !== classFilter) {
        return false;
      }
      if (statusFilter !== '' && account.status !== statusFilter) {
        return false;
      }
      if (term !== '') {
        const haystack = `${account.code} ${account.name}`.toLowerCase();
        if (!haystack.includes(term)) {
          return false;
        }
      }
      return true;
    });
  }, [accountRows, accountSearch, classFilter, statusFilter]);

  const visibleTree = useMemo(() => buildTree(visibleRows), [visibleRows]);

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

  /*
   * PRÉ-REQUISITO PENDENTE — o recorte humano (unidade -> plano) é o MESMO; o que muda é onde o
   * estado mora. Antes, "Nenhum plano de contas nesta unidade" era um `EmptyState` solto que
   * substituía a página inteira e deixava o operador sem estrutura nenhuma. Agora o vazio é um
   * ESTADO DA ÁREA PRINCIPAL: cabeçalho, métricas e barra de filtros permanecem montados.
   */
  const chartPending = units.length > 0 && !activeChartId;
  const chartEmpty =
    charts.length === 0 && chartsQuery.state.phase === 'ready' && units.length > 0;

  return (
    <ModulePage>
      <WorklistHeader
        title="Plano de contas"
        count={activeChartId && accountsQuery.state.phase === 'ready' ? accountRows.length : null}
        context="Árvore, situação e saldos são a leitura oficial do servidor; o navegador não soma nem reclassifica contas."
        metrics={
          accountsQuery.state.phase === 'ready' && accountRows.length > 0 ? (
            <>
              <EnterpriseMetric label="Contas no plano" value={accountRows.length} />
              <EnterpriseMetric label="Sintéticas" value={syntheticCount} />
              <EnterpriseMetric
                label="Inativas"
                value={inactiveCount}
                tone={inactiveCount > 0 ? 'warning' : 'neutral'}
              />
              {ledger ? (
                <EnterpriseMetric
                  label="Ledger"
                  value={ledger.balanced ? 'Balanceado' : 'Desbalanceado'}
                  tone={ledger.balanced ? 'neutral' : 'critical'}
                />
              ) : null}
            </>
          ) : null
        }
      />

      {/* BARRA OPERACIONAL: unidade e plano são o recorte; o resto é leitura da árvore já carregada. */}
      <WorklistFilterBar
        meta={
          activeChartId && accountsQuery.state.phase === 'ready'
            ? `${visibleRows.length} de ${accountRows.length} contas`
            : undefined
        }
      >
        <WorklistField label="Unidade" htmlFor="coa-unit">
          <select
            id="coa-unit"
            className={worklistSelectClass}
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
          </select>
        </WorklistField>

        <WorklistField label="Plano de contas" htmlFor="coa-chart">
          {/*
            LARGURA LIMITADA — o rótulo do plano é longo (`COA-2026 — Plano padrão 2026 (unit-x)`),
            e um `<select>` que cresce pelo conteúdo estoura a barra em telas estreitas. O teto
            não altera nenhuma opção nem o valor enviado ao servidor.
          */}
          <select
            id="coa-chart"
            className={`${worklistSelectClass} w-full max-w-[20rem]`}
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
          </select>
        </WorklistField>

        {activeChartId ? (
          <>
            <WorklistField label="Buscar" htmlFor="coa-search" grow>
              {/*
                `min-w-0` no campo de busca: o `grow` compartilhado usa `min-w-52` (13rem), que é
                maior que a largura útil de um celular e empurra a barra além do viewport. O
                controle continua crescendo no desktop e passa a encolher no mobile.
              */}
              <input
                id="coa-search"
                type="search"
                className={`${worklistSelectClass} w-full min-w-0`}
                value={accountSearch}
                onChange={(event) => setAccountSearch(event.target.value)}
                placeholder="Código ou nome da conta"
                autoComplete="off"
                spellCheck={false}
              />
            </WorklistField>
            <WorklistField label="Classe" htmlFor="coa-class">
              <select
                id="coa-class"
                className={worklistSelectClass}
                value={classFilter}
                onChange={(event) => setClassFilter(event.target.value as '' | AccountClass)}
              >
                <option value="">Todas</option>
                {(Object.keys(CLASS_LABELS) as AccountClass[]).map((key) => (
                  <option key={key} value={key}>
                    {CLASS_LABELS[key]}
                  </option>
                ))}
              </select>
            </WorklistField>
            <WorklistField label="Situação" htmlFor="coa-status">
              <select
                id="coa-status"
                className={worklistSelectClass}
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as '' | 'ACTIVE' | 'INACTIVE')
                }
              >
                <option value="">Todas</option>
                <option value="ACTIVE">Ativa</option>
                <option value="INACTIVE">Inativa</option>
              </select>
            </WorklistField>
            <WorklistClearFilters
              visible={accountFilterActive}
              onClick={() => {
                setAccountSearch('');
                setClassFilter('');
                setStatusFilter('');
              }}
            />
          </>
        ) : null}
      </WorklistFilterBar>

      {units.length === 0 ? (
        <WorklistStatePanel
          title="Nenhuma unidade operacional disponível"
          description="Sua sessão não tem unidade operacional autorizada, então não há plano de contas para consultar. O plano é escolhido a partir da unidade; esta tela não aceita identificador digitado."
        />
      ) : null}
      {chartsQuery.state.phase === 'denied' ? (
        <WorklistStatePanel
          tone="critical"
          title="Sem permissão para listar planos de contas desta unidade"
          description="A consulta foi recusada pelo servidor. Peça à administração a capability de leitura contábil desta unidade."
        />
      ) : null}
      {units.length > 0 && !activeChartId && chartEmpty ? (
        <WorklistStatePanel
          title="Nenhum plano de contas nesta unidade"
          description="A unidade selecionada não tem plano de contas publicado. Escolha outra unidade operacional na barra acima."
        />
      ) : null}
      {chartPending && !chartEmpty ? (
        <WorklistStatePanel
          title="Nenhum plano selecionado"
          description="Selecione o plano de contas da unidade; as contas e os saldos são consultados automaticamente."
        />
      ) : null}
      {createGate}

      {activeChart ? (
        /*
         * IDENTIDADE DO PLANO — faixa densa, na MESMA estrutura da grade que ela descreve.
         * Era um cartão `rounded-xl p-6 shadow-sm` que ocupava a primeira dobra só para repetir
         * o que o seletor da barra já diz. Os valores continuam sendo exatamente os do servidor:
         * o `DefinitionList` só mudou de moldura, e "Balanceado/débitos/créditos" seguem vindo da
         * reconstrução do ledger (`/accounting/ledger`), nunca de soma no navegador.
         */
        <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-md border border-gray-200 bg-white px-3 py-2">
          <span className="text-[13px] font-semibold text-gray-900">
            {activeChart.code} — {activeChart.name}
          </span>
          <span className="text-xs text-gray-500">Unidade {activeChart.unitId}</span>
          <StatusBadge
            tone={activeChart.status === 'ACTIVE' ? 'success' : 'neutral'}
            label={activeChart.status === 'ACTIVE' ? 'Ativo' : 'Inativo'}
          />
          {ledger ? (
            <span className="ml-auto flex flex-wrap items-center gap-x-4 text-xs text-gray-600 tabular-nums">
              <span>
                Ledger {ledger.balanced ? 'balanceado' : 'desbalanceado'}
              </span>
              <span>
                Débitos <Money value={ledger.totalDebits} />
              </span>
              <span>
                Créditos <Money value={ledger.totalCredits} />
              </span>
            </span>
          ) : null}
        </div>
      ) : null}

      {chartActionError ? (
        <div className="mb-2">
          <Alert tone="error">{chartActionError}</Alert>
        </div>
      ) : null}

      {activeChartId && accountRows.length > 0 ? (
        <>
          {visibleRows.length === 0 ? (
            <WorklistStatePanel
              title="Nenhuma conta para o recorte atual"
              description="A busca, a classe ou a situação aplicadas não retornam conta neste plano. Limpe os filtros para ver a árvore completa."
              action={
                <WorklistClearFilters
                  visible
                  onClick={() => {
                    setAccountSearch('');
                    setClassFilter('');
                    setStatusFilter('');
                  }}
                />
              }
            />
          ) : (
            <div className={worklistTableCardClass}>
              <table className={worklistTableClass} aria-label="Árvore de contas do plano">
                <thead>
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
                    <th scope="col" className={worklistNumericHeadCellClass}>
                      Débitos
                    </th>
                    <th scope="col" className={worklistNumericHeadCellClass}>
                      Créditos
                    </th>
                    <th scope="col" className={worklistHeadCellClass}>
                      Ação
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleTree.map((row) => {
                    const balances = balancesByAccount.get(row.id);
                    const synthetic = accountRows.some((account) => account.parentId === row.id);
                    return (
                      <tr key={row.id} className={worklistRowClass}>
                        <td className={worklistCellRaisedClass}>
                          <span className="font-mono">{row.code}</span>
                        </td>
                        <td className={worklistCellRaisedClass}>
                          <span style={{ paddingLeft: `${row.depth * 1.1}rem` }}>{row.name}</span>
                        </td>
                        <td className={worklistCellClass}>{CLASS_LABELS[row.class] ?? row.class}</td>
                        <td className={worklistCellClass}>
                          <StatusBadge
                            tone={row.status === 'ACTIVE' ? 'success' : 'neutral'}
                            label={row.status === 'ACTIVE' ? 'Ativa' : 'Inativa'}
                          />
                          {synthetic ? <StatusBadge tone="info" label="Sintética" /> : null}
                        </td>
                        <td className={worklistNumericCellClass}>
                          <Money value={balances?.debits ?? '0'} />
                        </td>
                        <td className={worklistNumericCellClass}>
                          <Money value={balances?.credits ?? '0'} />
                        </td>
                        <td className={worklistCellClass}>
                          <div className="flex flex-wrap gap-1.5">
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
          )}

          {drillGate}

          {drillAccountId && journalQuery.state.phase === 'ready' ? (
            <div className={worklistTableCardClass}>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 px-3 py-2">
                <div className="min-w-0">
                  <h2 className="text-[13px] font-semibold text-gray-900">
                    {drillAccount
                      ? `Lançamentos da conta ${drillAccount.code} — ${drillAccount.name}`
                      : 'Lançamentos da conta'}
                  </h2>
                  <p className="mt-0.5 text-xs text-gray-500">
                    Lista do servidor filtrada por esta conta. O navegador não soma nem
                    reclassifica valores.
                  </p>
                </div>
                <Button variant="secondary" onClick={() => setDrillAccountId('')}>
                  Fechar
                </Button>
              </div>
              {journalQuery.state.data.items.length === 0 ? (
                <p className="px-3 py-3 text-xs text-gray-500">
                  {drillSynthetic
                    ? 'Conta sintética: agrega subcontas e não recebe lançamento direto.'
                    : 'Nenhum lançamento registrado nesta conta.'}
                </p>
              ) : (
                <>
                  <table className={worklistTableClass} aria-label="Lançamentos da conta">
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
                          Tipo
                        </th>
                        <th scope="col" className={worklistHeadCellClass}>
                          Estado
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
                          <td className={worklistNumericCellClass}>
                            <Money value={entry.debitTotal} currencyCode={entry.currencyCode} />
                          </td>
                          <td className={worklistNumericCellClass}>
                            <Money value={entry.creditTotal} currencyCode={entry.currencyCode} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <WorklistFooter
                    rangeLabel={
                      <span aria-live="polite">
                        Página {journalQuery.state.data.page + 1} de{' '}
                        {Math.max(journalQuery.state.data.totalPages, 1)} ·{' '}
                        {journalQuery.state.data.total} lançamentos
                      </span>
                    }
                  >
                    <Button
                      variant="secondary"
                      disabled={journalQuery.state.data.page <= 0}
                      onClick={() => setDrillPage((current) => Math.max(0, current - 1))}
                    >
                      Página anterior
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={
                        journalQuery.state.data.page + 1 >= journalQuery.state.data.totalPages
                      }
                      onClick={() => setDrillPage((current) => current + 1)}
                    >
                      Próxima página
                    </Button>
                  </WorklistFooter>
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
    /*
     * NOVA CONTA — seção densa na MESMA gramática da barra operacional, não um cartão
     * `rounded-xl p-6 shadow-sm` legado. Campos, ordem, rótulos e a chamada `createAccount`
     * continuam idênticos: muda só a moldura.
     */
    <section
      className="mb-3 rounded-md border border-gray-200 bg-white"
      aria-label="Nova conta"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-3 py-2">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold text-gray-900">Nova conta</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            A conta é criada no plano selecionado pelo servidor; a hierarquia é definida pela
            conta superior.
          </p>
        </div>
      </div>
      {error ? (
        <div className="px-3 pt-2">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}
      <div className="flex flex-wrap items-end gap-2 px-3 py-2">
        <div className="min-w-52 flex-1">
          <Field label="Conta superior (opcional)" htmlFor="account-parent">
            <Select
              id="account-parent"
              value={parentId}
              onChange={(event) => setParentId(event.target.value)}
            >
              <option value="">(nenhuma — raiz)</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} — {account.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="w-32">
          <Field label="Código" htmlFor="account-code">
            <Input
              id="account-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </Field>
        </div>
        <div className="min-w-52 flex-1">
          <Field label="Nome" htmlFor="account-name">
            <Input
              id="account-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
        </div>
        <div className="w-44">
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
        <Button
          onClick={() => void submit()}
          disabled={submitting || code.trim() === '' || name.trim() === ''}
        >
          {submitting ? 'Criando…' : 'Criar conta'}
        </Button>
      </div>
    </section>
  );
}
