import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DateTime, EmptyState, Field, Input, Money } from '../../ui';
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
import { EXPENSE_STATUS_LABELS } from '../../financial-ui/labels';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import {
  approveExpense,
  createExpense,
  getExpense,
  rejectExpense,
  submitExpense,
} from '../api/finance-api';
import { mapFinanceErrorToMessage } from '../api/finance-error-messages';
import { FinanceStatusBadge } from '../components/FinanceStatusBadge';
import type { ExpenseDetail } from '../types/finance.types';

export function ExpensesPage() {
  const { expenseId } = useParams();
  const navigate = useNavigate();
  const [unitId, setUnitId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [costCenterId, setCostCenterId] = useState('');
  const [costCenterCode, setCostCenterCode] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [description, setDescription] = useState('');
  const [itemDescription, setItemDescription] = useState('');
  const [itemAmount, setItemAmount] = useState('');

  const loader = useCallback(
    (signal?: AbortSignal) => getExpense(expenseId ?? '', signal),
    [expenseId],
  );
  const { state, reload, setReady } = useBackofficeQuery<ExpenseDetail>({
    loader,
    mapError: mapFinanceErrorToMessage,
    enabled: Boolean(expenseId),
    autoLoad: Boolean(expenseId),
  });

  const gate = expenseId
    ? renderQueryGate(
        'Despesas',
        'Carregando despesa…',
        'Você não tem permissão para ver despesas.',
        state,
        () => void reload(),
      )
    : null;

  return (
    <ModulePage>
      <WorklistHeader
        title="Despesas"
        context="Cadastro, envio e aprovação são decididos pelo backend. Totais não são recalculados no navegador."
      />
      <p className="mb-3 text-sm text-gray-500">
        <Link className="font-semibold text-gray-700 hover:text-gray-900" to="/app/finance/expenses">
          Voltar para a lista de despesas
        </Link>
      </p>
      <CreateRecordForm
        title="Registrar despesa"
        description="Os campos são enviados ao servidor. O total é calculado pela API."
        submitLabel="Criar despesa"
        mapError={mapFinanceErrorToMessage}
        onSubmit={async (idempotencyKey) => {
          const created = await createExpense({
            unitId: unitId.trim(),
            expenseCategoryId: categoryId.trim(),
            costCenterId: costCenterId.trim(),
            costCenterCode: costCenterCode.trim(),
            dueDate: dueDate.trim(),
            paymentTerms: paymentTerms.trim(),
            description: description.trim(),
            items: [{ description: itemDescription.trim(), amount: itemAmount.trim() }],
            idempotencyKey,
          });
          void navigate(`/app/finance/expenses/${created.id}`);
        }}
      >
        <Field label="Unidade" htmlFor="expense-unit" required>
          <Input id="expense-unit" value={unitId} onChange={(event) => setUnitId(event.target.value)} required />
        </Field>
        <Field label="Categoria" htmlFor="expense-category" required>
          <Input
            id="expense-category"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            required
          />
        </Field>
        <Field label="Centro de custo (id)" htmlFor="expense-cc-id" required>
          <Input
            id="expense-cc-id"
            value={costCenterId}
            onChange={(event) => setCostCenterId(event.target.value)}
            required
          />
        </Field>
        <Field label="Centro de custo (código)" htmlFor="expense-cc-code" required>
          <Input
            id="expense-cc-code"
            value={costCenterCode}
            onChange={(event) => setCostCenterCode(event.target.value)}
            required
          />
        </Field>
        <Field label="Vencimento" htmlFor="expense-due" required>
          <Input
            id="expense-due"
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            required
          />
        </Field>
        <Field label="Condição de pagamento" htmlFor="expense-terms" required>
          <Input
            id="expense-terms"
            value={paymentTerms}
            onChange={(event) => setPaymentTerms(event.target.value)}
            required
          />
        </Field>
        <Field label="Descrição" htmlFor="expense-description" required className="md:col-span-2">
          <Input
            id="expense-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            required
          />
        </Field>
        <Field label="Item" htmlFor="expense-item" required>
          <Input
            id="expense-item"
            value={itemDescription}
            onChange={(event) => setItemDescription(event.target.value)}
            required
          />
        </Field>
        <Field label="Valor do item" htmlFor="expense-amount" required>
          <Input
            id="expense-amount"
            inputMode="decimal"
            value={itemAmount}
            onChange={(event) => setItemAmount(event.target.value)}
            required
          />
        </Field>
      </CreateRecordForm>
      {gate}
      {!expenseId ? (
        <EmptyState
          title="Nenhuma despesa carregada"
          description="A API atual consulta a despesa por identificador."
        />
      ) : null}
      {state.phase === 'ready' ? (
        <ExpenseView expense={state.data} onReload={reload} onReady={setReady} />
      ) : null}
    </ModulePage>
  );
}

function ExpenseView({
  expense,
  onReload,
  onReady,
}: {
  expense: ExpenseDetail;
  onReload: () => Promise<void>;
  onReady: (next: ExpenseDetail) => void;
}) {
  return (
    <>
      <div className="mb-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
        <DefinitionList
          items={[
            {
              label: 'Status',
              value: <FinanceStatusBadge status={expense.status} labels={EXPENSE_STATUS_LABELS} />,
            },
            {
              label: 'Total informado',
              value: <Money value={expense.totalAmount} currencyCode={expense.currencyCode} emphasis />,
            },
            { label: 'Vencimento', value: <DateTime value={expense.dueDate} mode="date" /> },
            { label: 'Versão', value: String(expense.version) },
            { label: 'Centro de custo', value: expense.costCenterCode },
            { label: 'Reembolso', value: expense.reimbursement?.payableId ?? '—' },
          ]}
        />
      </div>
      <div className={worklistTableCardClass}>
        <table className={worklistTableClass} aria-label="Itens da despesa">
          <thead>
            <tr>
              <th scope="col" className={worklistHeadCellClass}>
                Item
              </th>
              <th scope="col" className={worklistNumericHeadCellClass}>
                Valor
              </th>
            </tr>
          </thead>
          <tbody>
            {expense.items.map((item) => (
              <tr key={item.id} className={worklistRowClass}>
                <td className={worklistCellRaisedClass}>{item.description}</td>
                <td className={worklistNumericCellClass}>
                  <Money value={item.amount} currencyCode={expense.currencyCode} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <VersionedActionForm
          title="Enviar"
          description="O servidor valida comprovante e estado."
          confirmTitle="Enviar despesa"
          confirmDescription="A despesa será enviada para aprovação apenas se o backend aceitar."
          confirmLabel="Enviar"
          disabled={expense.status !== 'DRAFT'}
          mapError={mapFinanceErrorToMessage}
          onReload={() => void onReload()}
          onSubmit={async () => {
            onReady(await submitExpense(expense.id, { version: expense.version }));
          }}
        />
        <VersionedActionForm
          title="Aprovar"
          description="Aprovação segue SOD no backend."
          confirmTitle="Aprovar despesa"
          confirmDescription="A autoaprovação é recusada pelo servidor."
          confirmLabel="Aprovar"
          disabled={expense.status !== 'SUBMITTED'}
          mapError={mapFinanceErrorToMessage}
          onReload={() => void onReload()}
          onSubmit={async () => {
            onReady(await approveExpense(expense.id, { version: expense.version }));
          }}
        />
        <VersionedActionForm
          title="Rejeitar"
          description="Justificativa exigida pelo servidor."
          confirmTitle="Rejeitar despesa"
          confirmDescription="A rejeição só ocorre se o backend aceitar."
          confirmLabel="Rejeitar"
          variant="danger"
          reasonLabel="Motivo"
          disabled={expense.status !== 'SUBMITTED'}
          mapError={mapFinanceErrorToMessage}
          onReload={() => void onReload()}
          onSubmit={async ({ reason }) => {
            onReady(await rejectExpense(expense.id, { version: expense.version, reason: reason ?? '' }));
          }}
        />
      </div>
    </>
  );
}
