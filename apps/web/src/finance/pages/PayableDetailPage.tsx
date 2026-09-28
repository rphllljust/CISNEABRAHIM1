import { useCallback, useState } from 'react';
import { useParams } from 'react-router-dom';
import { DateTime, Money, Select } from '../../ui';
import {
  moduleTableCellClass,
  moduleTableClass,
  moduleTableHeadClass,
  moduleTableHeaderCellClass,
  moduleTableRowClass,
} from '../../ui/module-layout';
import { Field } from '../../ui';
import { MoneyActionForm } from '../../financial-ui/MoneyActionForm';
import { AGING_BUCKET_LABELS, PAYABLE_STATUS_LABELS, toneForStatus } from '../../financial-ui/labels';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import {
  EnterpriseObjectHeader,
  EnterpriseObjectPage,
  NextActionPanel,
  ObjectContextBlock,
  ObjectPanel,
  ObjectStateFlow,
  SmartRelationBar,
  buildAuthorizedRelations,
  toHumanText,
  type NextAction,
  type ObjectContextField,
  type ObjectMetadataField,
  type ObjectPagePhase,
  type ObjectStateStep,
} from '../../enterprise-object';
import { ActivityTimeline, type ActivityFact } from '../../operator';
import { cancelPayable, getPayable, payPayable, reversePayable } from '../api/finance-api';
import { mapFinanceErrorToMessage } from '../api/finance-error-messages';
import { FinanceStatusBadge } from '../components/FinanceStatusBadge';
import type { PayableDetail, Payment } from '../types/finance.types';
import { buildReversePaymentPayload, selectReversablePayments } from '../utils/payable-actions';

const PAYMENT_KIND_LABELS: Record<string, string> = {
  PAYMENT: 'Pagamento',
  REVERSAL: 'Estorno',
};

/**
 * Historico do titulo a partir de FATOS PERSISTIDOS apenas — mesma regra do
 * recebivel. O payload de pagaveis guarda `createdAt`, `updatedAt`, `cancelledAt`
 * e os pagamentos com `paidAt`. Nada de evento, ator ou comentario inventado, e
 * nada de "Sistema" preenchendo autor desconhecido.
 */
export function payableActivityFacts(item: PayableDetail): ActivityFact[] {
  const facts: ActivityFact[] = [
    { at: item.createdAt, event: 'Título criado' },
    { at: item.updatedAt, event: 'Título atualizado' },
  ];

  if (item.cancelledAt) {
    facts.push({
      at: item.cancelledAt,
      event: 'Título cancelado',
      reference: item.cancelReason ?? null,
    });
  }

  for (const payment of item.payments) {
    const isReversal = payment.kind === 'REVERSAL' || Boolean(payment.reversesPaymentId);
    facts.push({
      at: payment.paidAt,
      event: isReversal ? 'Pagamento estornado' : 'Pagamento registrado',
      reference: `${payment.amount} ${payment.currencyCode}`,
    });
  }

  return facts;
}

const PAYABLE_ORIGIN_LABELS: Record<string, string> = {
  MANUAL: 'Lançamento manual',
};

const PAYABLE_STATUS_STEPS: { id: string; label: string }[] = [
  { id: 'OPEN', label: 'Em aberto' },
  { id: 'PARTIALLY_PAID', label: 'Parcialmente pago' },
  { id: 'PAID', label: 'Pago' },
];

/**
 * Fluxo persistido do titulo, na MESMA gramatica do recebivel.
 *
 * O status vem do backend, derivado de `lifecycle`, dos pagamentos persistidos e
 * do vencimento. `OVERDUE` e um titulo NAO pago cujo vencimento passou: ele
 * permanece na etapa "Em aberto", com o vencimento real como fato. Titulo
 * cancelado antes de qualquer pagamento nao passa pela etapa de pagamento.
 */
export function payableStateSteps(item: PayableDetail): {
  steps: ObjectStateStep[];
  currentId: string | null;
} {
  const overdue = item.status === 'OVERDUE';
  const steps: ObjectStateStep[] = PAYABLE_STATUS_STEPS.map((step) => {
    if (step.id === 'OPEN' && overdue) {
      return { ...step, hint: `Vencido em ${new Date(item.dueDate).toLocaleDateString('pt-BR')}` };
    }
    return { ...step };
  });

  if (item.lifecycle === 'CANCELLED') {
    const cancelled: ObjectStateStep = {
      id: 'CANCELLED',
      label: PAYABLE_STATUS_LABELS['CANCELLED'] ?? 'Cancelado',
      terminal: true,
      hint: item.cancelledAt
        ? `Cancelado em ${new Date(item.cancelledAt).toLocaleString('pt-BR')}`
        : undefined,
    };
    // Sem pagamento persistido o titulo nao passou pela etapa de pagamento.
    const reached = item.payments.length > 0 ? steps.slice(0, 2) : steps.slice(0, 1);
    return { steps: [...reached, cancelled], currentId: 'CANCELLED' };
  }

  if (overdue) {
    return { steps, currentId: 'OPEN' };
  }
  if (item.status === 'OPEN' || item.status === 'PARTIALLY_PAID' || item.status === 'PAID') {
    return { steps, currentId: item.status };
  }
  // Status desconhecido: nenhuma etapa e marcada em vez de adivinhar a posicao.
  return { steps, currentId: null };
}

function reversablePaymentId(payment: Payment): string {
  return payment.id;
}

export function PayableDetailPage() {
  const { payableId = '' } = useParams();
  const [reversalPaymentId, setReversalPaymentId] = useState('');
  const loader = useCallback((signal?: AbortSignal) => getPayable(payableId, signal), [payableId]);
  const { state, reload, setReady } = useBackofficeQuery<PayableDetail>({
    loader,
    mapError: mapFinanceErrorToMessage,
    enabled: Boolean(payableId),
  });

  /*
   * Estados de pagina resolvidos pela MESMA moldura do recebivel: negacao, ausencia
   * e falha nao se confundem entre si, e a pagina nunca cai num cartao solto.
   */
  if (state.phase !== 'ready') {
    let phase: ObjectPagePhase;
    let phaseTitle = 'Conta a pagar';
    let phaseMessage: string | undefined;
    let onRetry: (() => void) | undefined;
    switch (state.phase) {
      case 'idle':
        phase = 'empty';
        phaseTitle = 'Título não informado';
        phaseMessage = 'Informe um título válido.';
        break;
      case 'loading':
        phase = 'loading';
        phaseMessage = 'Carregando título…';
        break;
      case 'denied':
        phase = 'denied';
        phaseMessage = 'Você não tem permissão para ver este título.';
        break;
      default:
        phase = 'error';
        phaseMessage = state.message;
        onRetry = state.retryable ? () => void reload() : undefined;
        break;
    }
    return (
      <main id="main-content" className="shell-page">
        <EnterpriseObjectPage
          breadcrumb={[
            { label: 'Contas a pagar', href: '/app/finance/payables' },
            { label: 'Título' },
          ]}
          phase={phase}
          phaseTitle={phaseTitle}
          phaseMessage={phaseMessage}
          onRetry={onRetry}
          header={null}
        />
      </main>
    );
  }

  const item = state.data;
  const closed = item.lifecycle === 'CANCELLED' || item.status === 'PAID';
  const payableActive = item.lifecycle === 'ACTIVE';
  const statusLabel = PAYABLE_STATUS_LABELS[item.status] ?? item.status;
  const { steps, currentId } = payableStateSteps(item);
  const reversablePayments = selectReversablePayments(item.payments, payableActive);
  const reversalPayment = item.payments.find(
    (payment) => reversablePaymentId(payment) === reversalPaymentId,
  );

  /*
   * RELACOES AUTORIZADAS.
   *
   * O titulo a pagar NAO tem ancora propria na cadeia de negocio (o backend
   * suporta CLIENT..RECEIVABLE; PAYABLE nao esta entre elas), entao nao se forca
   * uma cadeia aqui — inventar linhagem seria pior que nao mostra-la. O que existe
   * de real e navegavel: o titulo que este pagamento estorna (quando houver), que
   * leva ao proprio titulo. Sem contagem oculta e sem vazar existencia.
   */
  const relations = buildAuthorizedRelations(
    item.origin.kind === 'MANUAL' && item.origin.reference
      ? [
          {
            id: 'origin',
            label: 'Origem do lançamento',
            count: 1,
            // Destino real: a lista de pagaveis ja filtrada pela referencia de origem.
            to: `/app/finance/payables?ref=${encodeURIComponent(item.origin.reference)}`,
            allowed: true,
          },
        ]
      : [],
  );

  /**
   * Proxima acao derivada do estado real: titulo em aberto aguarda o pagamento;
   * titulo pago ou cancelado nao tem proximo passo declarado e a secao desaparece.
   */
  const nextAction: NextAction | null = closed
    ? null
    : item.status === 'OVERDUE'
      ? {
          kind: 'act',
          label: 'Regularizar o título vencido',
          description:
            'O título está vencido. O pagamento é registrado abaixo e o backend valida saldo, versão e origem.',
        }
      : {
          kind: 'act',
          label: 'Registrar o pagamento',
          description: 'O saldo em aberto é baixado quando o pagamento é registrado.',
        };

  const metadata: ObjectMetadataField[] = [
    { label: 'Vencimento', value: <DateTime value={item.dueDate} mode="date" /> },
    { label: 'Principal', value: <Money value={item.principal} currencyCode={item.currencyCode} /> },
    {
      label: 'Saldo informado',
      value: <Money value={item.remainingBalance} currencyCode={item.currencyCode} emphasis />,
      emphasis: true,
    },
    { label: 'Pago', value: <Money value={item.paidAmount} currencyCode={item.currencyCode} /> },
    { label: 'Aging', value: AGING_BUCKET_LABELS[item.agingBucket] ?? item.agingBucket },
    {
      label: 'Parcelas',
      value: item.installments.length > 0 ? String(item.installments.length) : null,
    },
  ];

  const contextFields: ObjectContextField[] = [
    /*
     * Contraparte e categoria de despesa chegam no payload apenas como identificador
     * tecnico (`counterpartyId`, `expenseCategoryId`). Identificador tecnico NAO vai
     * para a tela, e o fato sem rotulo humano e omitido em vez de virar UUID.
     */
    { label: 'Unidade', value: item.unitId },
    { label: 'Origem', value: PAYABLE_ORIGIN_LABELS[item.origin.kind] ?? toHumanText(item.origin.kind) },
    { label: 'Referência de origem', value: item.origin.reference },
    { label: 'Condição de pagamento', value: item.paymentTerms },
    { label: 'Centro de custo', value: item.costCenter.code },
    {
      label: 'Cancelado em',
      value: item.cancelledAt ? new Date(item.cancelledAt).toLocaleString('pt-BR') : null,
    },
    { label: 'Motivo do cancelamento', value: item.cancelReason },
    { label: 'Atualizado em', value: new Date(item.updatedAt).toLocaleString('pt-BR') },
  ];

  return (
    <main id="main-content" className="shell-page">
      <EnterpriseObjectPage
        breadcrumb={[
          { label: 'Contas a pagar', href: '/app/finance/payables' },
          { label: item.externalReference ?? 'Título a pagar' },
        ]}
        header={
          <EnterpriseObjectHeader
            reference={item.externalReference}
            title="Conta a pagar"
            subtitle={item.origin.reference ?? undefined}
            status={{ label: statusLabel, tone: toneForStatus(item.status) }}
            metadata={metadata}
          />
        }
        stateFlow={
          <ObjectStateFlow steps={steps} currentId={currentId} title="Fluxo do título a pagar" />
        }
        nextAction={<NextActionPanel action={nextAction} />}
        relations={<SmartRelationBar relations={relations} />}
        aside={
          <ObjectPanel title="Histórico">
            <ActivityTimeline
              facts={payableActivityFacts(item)}
              title="Histórico do título"
              emptyMessage="Este título não expõe histórico persistido além dos timestamps abaixo."
            />
          </ObjectPanel>
        }
      >
        <ObjectContextBlock fields={contextFields} columns={3} />

        {item.installments.length > 0 ? (
          <ObjectPanel title="Parcelas do título">
            <div className="overflow-x-auto">
              <table className={moduleTableClass} aria-label="Parcelas do título">
                <thead className={moduleTableHeadClass}>
                  <tr>
                    <th scope="col" className={moduleTableHeaderCellClass}>
                      Parcela
                    </th>
                    <th scope="col" className={moduleTableHeaderCellClass}>
                      Vencimento
                    </th>
                    <th scope="col" className={`${moduleTableHeaderCellClass} text-right`}>
                      Principal
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {item.installments.map((installment) => (
                    <tr key={installment.id} className={moduleTableRowClass}>
                      <td className={moduleTableCellClass}>{installment.installmentNumber}</td>
                      <td className={moduleTableCellClass}>
                        <DateTime value={installment.dueDate} mode="date" />
                      </td>
                      <td className={`${moduleTableCellClass} text-right`}>
                        <Money value={installment.principal} currencyCode={item.currencyCode} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ObjectPanel>
        ) : null}

        {item.payments.length > 0 ? (
          <ObjectPanel title="Pagamentos do título">
            <div className="overflow-x-auto">
              <table className={moduleTableClass} aria-label="Pagamentos do título">
                <thead className={moduleTableHeadClass}>
                  <tr>
                    <th scope="col" className={moduleTableHeaderCellClass}>
                      Tipo
                    </th>
                    <th scope="col" className={moduleTableHeaderCellClass}>
                      Quando
                    </th>
                    <th scope="col" className={moduleTableHeaderCellClass}>
                      Referência
                    </th>
                    <th scope="col" className={moduleTableHeaderCellClass}>
                      Origem
                    </th>
                    <th scope="col" className={`${moduleTableHeaderCellClass} text-right`}>
                      Valor
                    </th>
                    <th scope="col" className={moduleTableHeaderCellClass}>
                      Estorna
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {item.payments.map((payment) => (
                    <tr key={payment.id} className={moduleTableRowClass}>
                      <td className={moduleTableCellClass}>
                        <FinanceStatusBadge status={payment.kind} labels={PAYMENT_KIND_LABELS} />
                      </td>
                      <td className={moduleTableCellClass}>
                        <DateTime value={payment.paidAt} />
                      </td>
                      <td className={moduleTableCellClass}>{payment.paymentReference}</td>
                      {/*
                       * A origem do pagamento vem com rotulo HUMANO do backend
                       * (`originReference`). Quando so existe o identificador tecnico,
                       * a celula mostra o rotulo do tipo — nunca o UUID.
                       */}
                      <td className={moduleTableCellClass}>
                        {payment.originReference ||
                          toHumanText(payment.originKind) ||
                          '—'}
                      </td>
                      <td className={`${moduleTableCellClass} text-right`}>
                        <Money value={payment.amount} currencyCode={payment.currencyCode} />
                      </td>
                      <td className={moduleTableCellClass}>
                        {payment.reversesPaymentId ? 'Pagamento estornado' : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ObjectPanel>
        ) : (
          <ObjectPanel title="Pagamentos do título">
            <p className="text-sm text-gray-500">
              Nenhum pagamento lançado para este título.
            </p>
          </ObjectPanel>
        )}

        {reversablePayments.length > 0 ? (
          <ObjectPanel title="Estorno de pagamento">
            <Field label="Pagamento a estornar" htmlFor="reversal-payment-select" required>
              <Select
                id="reversal-payment-select"
                value={reversalPaymentId}
                onChange={(event) => setReversalPaymentId(event.target.value)}
                required
              >
                <option value="">Selecione…</option>
                {reversablePayments.map((payment) => (
                  <option key={payment.id} value={reversablePaymentId(payment)}>
                    {payment.paymentReference} · {payment.amount}
                  </option>
                ))}
              </Select>
            </Field>
            <MoneyActionForm
              title="Estornar pagamento"
              description="Estorno integral: sem valor informado, o servidor estorna o valor original do pagamento."
              confirmTitle="Estornar pagamento"
              confirmDescription="O backend valida versão, motivo e se o pagamento ainda pode ser estornado."
              confirmLabel="Estornar pagamento"
              extraField={{
                id: 'reversal-payment-reference',
                label: 'Referência do estorno',
                name: 'paymentReference',
              }}
              reasonLabel="Motivo"
              disabled={!reversalPayment}
              mapError={mapFinanceErrorToMessage}
              onReload={() => void reload()}
              onSubmit={async ({ extra, reason, idempotencyKey }) => {
                if (!reversalPayment) {
                  return;
                }
                const next = await reversePayable(
                  item.id,
                  reversalPayment.id,
                  buildReversePaymentPayload({
                    rowVersion: item.rowVersion,
                    paymentReference: extra ?? '',
                    reason: reason ?? '',
                    idempotencyKey,
                  }),
                );
                setReversalPaymentId('');
                setReady(next);
              }}
            />
          </ObjectPanel>
        ) : null}

        {/* Acoes primarias na zona de trabalho; a destrutiva fica separada. */}
        <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
          <MoneyActionForm
            title="Registrar pagamento"
            description="O valor e a referência são enviados ao servidor sem recálculo local."
            confirmTitle="Confirmar pagamento"
            confirmDescription="O backend valida saldo, versão e origem do pagamento."
            confirmLabel="Pagar"
            amountLabel="Valor"
            extraField={{
              id: 'payment-reference',
              label: 'Referência do pagamento',
              name: 'paymentReference',
            }}
            disabled={closed}
            mapError={mapFinanceErrorToMessage}
            onReload={() => void reload()}
            onSubmit={async ({ amount, extra, idempotencyKey }) => {
              const next = await payPayable(item.id, {
                amount: amount ?? '',
                rowVersion: item.rowVersion,
                idempotencyKey,
                paymentReference: extra ?? '',
              });
              setReady(next);
            }}
          />
          <MoneyActionForm
            title="Cancelar título"
            description="Cancelamento exigido pelo servidor com justificativa."
            confirmTitle="Cancelar título"
            confirmDescription="O título só será cancelado se o backend aceitar."
            confirmLabel="Cancelar título"
            reasonLabel="Justificativa"
            disabled={closed}
            mapError={mapFinanceErrorToMessage}
            onReload={() => void reload()}
            onSubmit={async ({ reason, idempotencyKey }) => {
              const next = await cancelPayable(item.id, {
                rowVersion: item.rowVersion,
                cancelReason: reason ?? '',
                idempotencyKey,
              });
              setReady(next);
            }}
          />
        </div>
      </EnterpriseObjectPage>
    </main>
  );
}
