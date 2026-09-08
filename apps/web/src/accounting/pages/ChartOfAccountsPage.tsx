import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Field,
  Input,
  Money,
  Select,
  StatusBadge,
  EmptyState,
} from '../../ui';
import {
  FilterCard,
  ModulePage,
  ModulePageHeader,
  ModuleTableCard,
  moduleTableCellClass,
  moduleTableClass,
  moduleTableHeadClass,
  moduleTableHeaderCellClass,
  moduleTableRowClass,
} from '../../ui/module-layout';
import { DefinitionList } from '../../financial-ui/DefinitionList';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import {
  createAccount,
  listAccounts,
  listCharts,
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
  LedgerReconstruction,
} from '../types/accounting.types';

const CLASS_LABELS: Record<AccountClass, string> = {
  ASSET: 'Ativo',
  LIABILITY: 'Passivo',
  EQUITY: 'Patrimônio líquido',
  REVENUE: 'Receita',
  EXPENSE: 'Despesa',
};

export function ChartOfAccountsPage() {
  const [unitId, setUnitId] = useState('');
  const [submittedUnit, setSubmittedUnit] = useState('');
  const [chartId, setChartId] = useState('');
  const [chartActionError, setChartActionError] = useState<string | null>(null);

  const chartsQuery = useBackofficeQuery<ChartsList>({
    enabled: submittedUnit.trim() !== '',
    autoLoad: submittedUnit.trim() !== '',
    loader: (signal) => listCharts(submittedUnit.trim(), signal),
    mapError: mapAccountingErrorToMessage,
  });

  const activeChartId = chartId || undefined;
  const accountsQuery = useBackofficeQuery<AccountsList>({
    enabled: Boolean(activeChartId),
    autoLoad: Boolean(activeChartId),
    loader: (signal) => listAccounts(activeChartId as string, signal),
    mapError: mapAccountingErrorToMessage,
  });
  const ledgerQuery = useBackofficeQuery<LedgerReconstruction>({
    enabled: Boolean(activeChartId),
    autoLoad: Boolean(activeChartId),
    loader: (signal) => reconstructLedger(activeChartId as string, signal),
    mapError: mapAccountingErrorToMessage,
  });

  const charts = chartsQuery.state.phase === 'ready' ? chartsQuery.state.data.items : [];
  const activeChart: ChartOfAccounts | undefined = charts.find((chart) => chart.id === chartId);
  const accountRows = accountsQuery.state.phase === 'ready' ? accountsQuery.state.data.items : [];
  const ledgerRows = ledgerQuery.state.phase === 'ready' ? ledgerQuery.state.data.accounts : [];
  const ledger = ledgerQuery.state.phase === 'ready' ? ledgerQuery.state.data : null;

  // Ao trocar a unidade, resetamos o plano selecionado (evita UUID órfão de outro plano).
  useEffect(() => {
    setChartId('');
  }, [submittedUnit]);

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

  return (
    <ModulePage>
      <ModulePageHeader
        title="Plano de contas"
        description="A árvore e os saldos são a leitura oficial do servidor; o navegador não soma nem reclassifica contas."
      />
      <FilterCard>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Field label="Unidade operacional" htmlFor="coa-unit">
            <Input
              id="coa-unit"
              value={unitId}
              placeholder="ex.: unit-a"
              onChange={(event) => setUnitId(event.target.value)}
            />
          </Field>
          <div className="flex items-end">
            <Button
              onClick={() => {
                setSubmittedUnit(unitId.trim());
              }}
              disabled={unitId.trim() === ''}
            >
              Carregar planos
            </Button>
          </div>
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

      {chartsQuery.state.phase === 'denied' ? (
        <Alert tone="error">Você não tem permissão para listar planos de contas desta unidade.</Alert>
      ) : null}
      {!activeChartId ? (
        <EmptyState
          title="Nenhum plano selecionado"
          description="Carregue os planos da unidade e selecione um plano; as contas são consultadas automaticamente."
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
          <ModuleTableCard>
            <table className={moduleTableClass} aria-label="Árvore de contas do plano">
              <thead className={moduleTableHeadClass}>
                <tr>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Código
                  </th>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Nome
                  </th>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Classe
                  </th>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Situação
                  </th>
                  <th scope="col" className={`${moduleTableHeaderCellClass} text-right`}>
                    Débitos
                  </th>
                  <th scope="col" className={`${moduleTableHeaderCellClass} text-right`}>
                    Créditos
                  </th>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Ação
                  </th>
                </tr>
              </thead>
              <tbody>
                {tree.map((row) => {
                  const balances = balancesByAccount.get(row.id);
                  const synthetic = accountRows.some((account) => account.parentId === row.id);
                  return (
                    <tr key={row.id} className={moduleTableRowClass}>
                      <td className={`${moduleTableCellClass} font-mono`}>{row.code}</td>
                      <td className={moduleTableCellClass}>
                        <span style={{ paddingLeft: `${row.depth * 1.25}rem` }}>{row.name}</span>
                      </td>
                      <td className={moduleTableCellClass}>{CLASS_LABELS[row.class] ?? row.class}</td>
                      <td className={moduleTableCellClass}>
                        <StatusBadge
                          tone={row.status === 'ACTIVE' ? 'success' : 'neutral'}
                          label={row.status === 'ACTIVE' ? 'Ativa' : 'Inativa'}
                        />
                        {synthetic ? <StatusBadge tone="info" label="Sintética" /> : null}
                      </td>
                      <td className={`${moduleTableCellClass} text-right`}>
                        <Money value={balances?.debits ?? '0'} />
                      </td>
                      <td className={`${moduleTableCellClass} text-right`}>
                        <Money value={balances?.credits ?? '0'} />
                      </td>
                      <td className={moduleTableCellClass}>
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ModuleTableCard>
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
