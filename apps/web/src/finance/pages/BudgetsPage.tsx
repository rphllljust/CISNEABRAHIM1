import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EmptyState, Field, Input, Money } from '../../ui';
import { ModulePage } from '../../ui/module-layout';
import {
  WorklistHeader,
  worklistCellRaisedClass,
  worklistHeadCellClass,
  worklistNumericCellClass,
  worklistNumericHeadCellClass,
  worklistRowClass,
  worklistTableCardClass,
  worklistTableClass,
} from '../../ui/enterprise-list';
import { DefinitionList } from '../../financial-ui/DefinitionList';
import { CreateRecordForm, VersionedActionForm } from '../../financial-ui/VersionedActionForm';
import { BUDGET_STATUS_LABELS } from '../../financial-ui/labels';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import {
  addBudgetLine,
  addBudgetPeriod,
  approveBudget,
  compareBudget,
  createBudget,
  createBudgetVersion,
  getBudget,
} from '../api/finance-api';
import { mapFinanceErrorToMessage } from '../api/finance-error-messages';
import { FinanceStatusBadge } from '../components/FinanceStatusBadge';
import type { BudgetComparison, BudgetDetail } from '../types/finance.types';

export function BudgetsPage() {
  const { budgetId } = useParams();
  const navigate = useNavigate();
  const [unitId, setUnitId] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [currencyCode, setCurrencyCode] = useState('BRL');

  const loader = useCallback((signal?: AbortSignal) => getBudget(budgetId ?? '', signal), [budgetId]);
  const { state, reload, setReady } = useBackofficeQuery<BudgetDetail>({
    loader,
    mapError: mapFinanceErrorToMessage,
    enabled: Boolean(budgetId),
    autoLoad: Boolean(budgetId),
  });

  const gate = budgetId
    ? renderQueryGate(
        'Orçamentos',
        'Carregando orçamento…',
        'Você não tem permissão para ver orçamentos.',
        state,
        () => void reload(),
      )
    : null;

  return (
    <ModulePage>
      <WorklistHeader
        title="Orçamentos"
        context="Versões, linhas e aprovação são persistidas pelo servidor. Variância não é calculada no navegador."
      />
      <p className="mb-4 text-sm text-gray-500">
        <Link className="font-semibold text-gray-700 hover:text-gray-900" to="/app/finance/budgets">
          Voltar para a lista de orçamentos
        </Link>
      </p>
      <CreateRecordForm
        title="Criar orçamento"
        description="O código e a moeda são validados pela API."
        submitLabel="Criar orçamento"
        mapError={mapFinanceErrorToMessage}
        onSubmit={async () => {
          const created = await createBudget({
            unitId: unitId.trim(),
            code: code.trim(),
            name: name.trim(),
            currencyCode: currencyCode.trim() || 'BRL',
          });
          void navigate(`/app/finance/budgets/${created.id}`);
        }}
      >
        <Field label="Unidade" htmlFor="budget-unit" required>
          <Input id="budget-unit" value={unitId} onChange={(event) => setUnitId(event.target.value)} required />
        </Field>
        <Field label="Código" htmlFor="budget-code" required>
          <Input id="budget-code" value={code} onChange={(event) => setCode(event.target.value)} required />
        </Field>
        <Field label="Nome" htmlFor="budget-name" required>
          <Input id="budget-name" value={name} onChange={(event) => setName(event.target.value)} required />
        </Field>
        <Field label="Moeda" htmlFor="budget-currency" required>
          <Input
            id="budget-currency"
            value={currencyCode}
            onChange={(event) => setCurrencyCode(event.target.value)}
            required
          />
        </Field>
      </CreateRecordForm>
      {gate}
      {!budgetId ? (
        <EmptyState title="Nenhum orçamento carregado" description="Consulte pelo identificador devolvido pelo servidor." />
      ) : null}
      {state.phase === 'ready' ? (
        <BudgetView budget={state.data} onReload={reload} onReady={setReady} />
      ) : null}
    </ModulePage>
  );
}

function BudgetView({
  budget,
  onReload,
  onReady,
}: {
  budget: BudgetDetail;
  onReload: () => Promise<void>;
  onReady: (next: BudgetDetail) => void;
}) {
  const [periodKey, setPeriodKey] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [lineAmount, setLineAmount] = useState('');
  const [costCenterCode, setCostCenterCode] = useState('');
  const [comparison, setComparison] = useState<BudgetComparison | null>(null);
  const draft = budget.versions.find((version) => version.status === 'DRAFT') ?? budget.versions.at(-1);
  const lines = draft?.periods.flatMap((period) => period.lines.map((line) => ({ ...line, periodKey: period.periodKey }))) ?? [];

  return (
    <>
      <div className="mb-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
        <DefinitionList
          items={[
            { label: 'Código', value: budget.code },
            { label: 'Nome', value: budget.name },
            {
              label: 'Status',
              value: <FinanceStatusBadge status={budget.status} labels={BUDGET_STATUS_LABELS} />,
            },
            { label: 'Versão do registro', value: String(budget.rowVersion) },
            { label: 'Moeda', value: budget.currencyCode },
          ]}
        />
      </div>
      <CreateRecordForm
        title="Adicionar período"
        description="A chave do período segue o formato exigido pelo servidor."
        submitLabel="Incluir período"
        mapError={mapFinanceErrorToMessage}
        onSubmit={async () => {
          onReady(await addBudgetPeriod(budget.id, { periodKey: periodKey.trim(), startsOn, endsOn }));
        }}
      >
        <Field label="Competência (AAAA-MM)" htmlFor="budget-period-key" required>
          <Input id="budget-period-key" value={periodKey} onChange={(event) => setPeriodKey(event.target.value)} required />
        </Field>
        <Field label="Início" htmlFor="budget-starts" required>
          <Input id="budget-starts" type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} required />
        </Field>
        <Field label="Fim" htmlFor="budget-ends" required>
          <Input id="budget-ends" type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} required />
        </Field>
      </CreateRecordForm>
      <CreateRecordForm
        title="Adicionar linha"
        description="Informe pelo menos uma dimensão. O valor não é totalizado no navegador."
        submitLabel="Incluir linha"
        mapError={mapFinanceErrorToMessage}
        onSubmit={async () => {
          onReady(
            await addBudgetLine(budget.id, {
              periodId: periodId.trim(),
              amount: lineAmount.trim(),
              costCenterCode: costCenterCode.trim() || null,
            }),
          );
        }}
      >
        <Field label="Período (id)" htmlFor="budget-line-period" required>
          <Input id="budget-line-period" value={periodId} onChange={(event) => setPeriodId(event.target.value)} required />
        </Field>
        <Field label="Valor" htmlFor="budget-line-amount" required>
          <Input id="budget-line-amount" inputMode="decimal" value={lineAmount} onChange={(event) => setLineAmount(event.target.value)} required />
        </Field>
        <Field label="Centro de custo" htmlFor="budget-line-cc">
          <Input id="budget-line-cc" value={costCenterCode} onChange={(event) => setCostCenterCode(event.target.value)} />
        </Field>
      </CreateRecordForm>
      {lines.length === 0 ? (
        <EmptyState title="Sem linhas nesta versão" description="Inclua períodos e linhas para o rascunho atual." />
      ) : (
        <div className={worklistTableCardClass}>
          <table className={worklistTableClass} aria-label="Linhas do orçamento">
            <thead>
              <tr>
                <th scope="col" className={worklistHeadCellClass}>
                  Competência
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Dimensão
                </th>
                <th scope="col" className={worklistNumericHeadCellClass}>
                  Valor orçado
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className={worklistRowClass}>
                  <td className={worklistCellRaisedClass}>{line.periodKey}</td>
                  <td className={worklistCellRaisedClass}>
                    {line.costCenterCode ?? line.expenseCategoryId ?? line.accountId ?? '—'}
                  </td>
                  <td className={worklistNumericCellClass}>
                    <Money value={line.amount} currencyCode={budget.currencyCode} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <VersionedActionForm
          title="Aprovar"
          description="Aprovação exige checker distinto no backend e a versão carregada aqui."
          confirmTitle="Aprovar orçamento"
          confirmDescription="O servidor recusa rascunho incompleto, autoaprovação e versão desatualizada."
          confirmLabel="Aprovar"
          mapError={mapFinanceErrorToMessage}
          onReload={() => void onReload()}
          onSubmit={async () => {
            // A versao vai no corpo: aprovacao sem versao e recusada pelo servidor, e uma
            // versao desatualizada vira conflito em vez de aprovar estado velho.
            onReady(await approveBudget(budget.id, { version: draft?.versionNumber ?? 0 }));
          }}
        />
        <VersionedActionForm
          title="Nova versão"
          description="Cria rascunho a partir da versão aprovada."
          confirmTitle="Criar versão"
          confirmDescription="Somente o backend decide se uma nova versão pode ser aberta."
          confirmLabel="Criar versão"
          mapError={mapFinanceErrorToMessage}
          onReload={() => void onReload()}
          onSubmit={async () => {
            onReady(await createBudgetVersion(budget.id));
          }}
        />
        <VersionedActionForm
          title="Comparar realizado"
          description="Orçado × realizado vêm do servidor."
          confirmTitle="Consultar comparação"
          confirmDescription="Nenhum saldo é calculado neste formulário."
          confirmLabel="Comparar"
          mapError={mapFinanceErrorToMessage}
          onReload={() => void onReload()}
          onSubmit={async () => {
            setComparison(await compareBudget(budget.id));
          }}
        />
      </div>
      {comparison ? (
        <div className="mb-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
          <DefinitionList
            items={[
              { label: 'Orçado', value: <Money value={comparison.budgeted} currencyCode={comparison.currencyCode} /> },
              { label: 'Realizado', value: <Money value={comparison.actual} currencyCode={comparison.currencyCode} /> },
              { label: 'Variância', value: <Money value={comparison.variance} currencyCode={comparison.currencyCode} emphasis /> },
            ]}
          />
        </div>
      ) : null}
    </>
  );
}
