import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DateTime, EmptyState, Field, Input, Money } from '../../ui';
import { ModulePage } from '../../ui/module-layout';
import { DefinitionList } from '../../financial-ui/DefinitionList';
import { CreateRecordForm, VersionedActionForm } from '../../financial-ui/VersionedActionForm';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { DynamicForm, useEntitySchema } from '../../engine';
import { DynamicSubform } from '../../engine/DynamicSubform';
import {
  approveExpense,
  createExpense,
  getExpense,
  rejectExpense,
  submitExpense,
} from '../api/finance-api';
import { mapFinanceErrorToMessage } from '../api/finance-error-messages';
import { FinanceStatusBadge } from '../components/FinanceStatusBadge';
import { expenseFormValues, expenseItemRows, expenseItemSchema } from '../utils/finance-engine-rows';
import type { ExpenseDetail } from '../types/finance.types';

/**
 * DETALHE DA DESPESA — dirigido por metadados.
 *
 * O bloco de identificação/financeiro/controle deixou de ser `DefinitionList` artesanal: é o
 * `DynamicForm` do schema `expenses`, com o rótulo de `status` vindo do metadado em vez de
 * `EXPENSE_STATUS_LABELS`. Os ITENS viraram um `DynamicSubform` — o Table field do ERPNext, onde
 * o DocType filho rende um grid dentro do form do pai, com o rodapé totalizado pela `aggregation`
 * declarada.
 *
 * PARIDADE COM A VERSÃO ARTESANAL (cada feature do arquivo antigo → onde vive agora):
 *   - DefinitionList status/total/vencimento/versão/centro de custo/reembolso → `DynamicForm`;
 *   - tabela artesanal de itens (Item/Valor) → `DynamicSubform`, com total no rodapé;
 *   - formulário "Registrar despesa"          → PRESERVADO;
 *   - ações Enviar / Aprovar / Rejeitar       → PRESERVADAS (`VersionedActionForm`, com `disabled`
 *                                               por estado e motivo obrigatório na rejeição);
 *   - link de volta à lista                   → PRESERVADO;
 *   - estados loading/erro/negação            → `renderQueryGate`, PRESERVADO.
 *
 * PARIDADE_PERDIDA: nenhuma.
 *
 * O SUBFORMULÁRIO É SOMENTE LEITURA, e é paridade: `createExpense` recebe os `items` de uma vez e
 * a API não publica PATCH por item. Ver `expenseItemSchema()`.
 */
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

  const { schema } = useEntitySchema('expenses');

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
      <header className="mb-4">
        <h1 className="text-xl font-semibold" data-testid="entity-title">
          {schema?.label ?? 'Despesas'}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Cadastro, envio e aprovação são decididos pelo backend. Totais não são recalculados no
          navegador.
        </p>
      </header>
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
  const { schema } = useEntitySchema('expenses');
  const items = expenseItemRows(expense);

  return (
    <>
      {schema ? (
        <div className="mb-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
          {/* SOMENTE LEITURA: o detalhe exibe o registro; quem grava são os comandos do servidor. */}
          <DynamicForm schema={schema} values={expenseFormValues(expense)} readOnly />
        </div>
      ) : (
        <div className="mb-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
          <DefinitionList
            items={[
              {
                label: 'Status',
                value: <FinanceStatusBadge status={expense.status} labels={{}} />,
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
      )}

      {items.length > 0 ? (
        <div className="mb-6">
          <DynamicSubform
            schema={expenseItemSchema()}
            rows={items}
            onChange={() => undefined}
            readOnly
          />
        </div>
      ) : null}

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
