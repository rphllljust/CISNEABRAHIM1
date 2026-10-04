import { useCallback, useState } from 'react';
import { useParams } from 'react-router-dom';
import { DateTime, Money, ModulePage, ModulePageHeader, Select } from '../../ui';
import { Field } from '../../ui';
import {
  worklistCellClass,
  worklistHeadCellClass,
  worklistNumericCellClass,
  worklistNumericHeadCellClass,
  worklistRowClass,
  worklistTableClass,
} from '../../ui/enterprise-list';
import { MoneyActionForm } from '../../financial-ui/MoneyActionForm';
import { AGING_BUCKET_LABELS, PAYABLE_STATUS_LABELS } from '../../financial-ui/labels';
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
  type ObjectAction,
  type ObjectContextField,
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

const PAYABLE_ORIGIN_LABELS: Record<string, string> = {
  MANUAL: 'Lançamento manual',
};

function reversablePaymentId(payment: Payment): string {
  return payment.id;
}

/**
 * HISTÓRICO DO TÍTULO a partir de FATOS PERSISTIDOS apenas — mesma regra do recebível.
 *
 * O payload de pagáveis guarda `createdAt`, `updatedAt`, `cancelledAt` e os pagamentos com
 * `paidAt`. Nada de evento, ator ou comentário inventado, e nada de "Sistema" preenchendo autor
 * desconhecido.
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

const PAYABLE_STATUS_STEPS: { id: string; label: string }[] = [
  { id: 'OPEN', label: 'Em aberto' },
  { id: 'PARTIALLY_PAID', label: 'Parcialmente pago' },
  { id: 'PAID', label: 'Pago' },
];

/**
 * FLUXO PERSISTIDO do título, na MESMA gramática do recebível.
 *
 * O status vem do backend, derivado de `lifecycle`, dos pagamentos persistidos e do vencimento.
 * `OVERDUE` é um título NÃO pago cujo vencimento passou: ele permanece na etapa "Em aberto", com
 * o vencimento real como fato. Título cancelado antes de qualquer pagamento não passa pela etapa
 * de pagamento.
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
    // Sem pagamento persistido o título não passou pela etapa de pagamento.
    const reached = item.payments.length > 0 ? steps.slice(0, 2) : steps.slice(0, 1);
    return { steps: [...reached, cancelled], currentId: 'CANCELLED' };
  }

  if (overdue) {
    return { steps, currentId: 'OPEN' };
  }
  if (item.status === 'OPEN' || item.status === 'PARTIALLY_PAID' || item.status === 'PAID') {
    return { steps, currentId: item.status };
  }
  // Status desconhecido: nenhuma etapa é marcada em vez de adivinhar a posição.
  return { steps, currentId: null };
}

/**
 * CONTA A PAGAR — DETALHE DO TÍTULO.
 *
 * A página é um DOCUMENTO FINANCEIRO, não um formulário. A ordem de leitura é a de um ERP
 * Tier-1: o que é e em que estado está (cabeçalho) → quanto é (faixa de valores) → de onde veio
 * (contexto) → como está dividido (parcelas) → o que já aconteceu (pagamentos) → o que se pode
 * fazer agora (comandos).
 *
 * HIERARQUIA DO DINHEIRO — a decisão central desta tela.
 * Principal, pago e SALDO têm pesos diferentes de propósito: o saldo é o número que o operador
 * veio buscar, então ele é o único em corpo maior. Colocá-los no mesmo peso obrigaria a ler os
 * três para descobrir qual importa. O vencimento entra na mesma faixa porque é o outro eixo da
 * decisão (quanto e quando), e a faixa carrega o fato de prazo em palavras quando o título está
 * vencido — exceção visível, não decorada.
 *
 * COMANDOS NA ORIGEM, NÃO NO MEIO DO CORPO.
 * Pagar e cancelar vivem no cabeçalho, onde o operador os procura, e obedecem ao estado real:
 * título pago ou cancelado nasce com os comandos desabilitados e o motivo declarado. Antes eles
 * eram formulários que dominavam o corpo e empurravam o dado para baixo.
 *
 * PARCELAS E PAGAMENTOS SÃO SUB-WORKLISTS, não listas de dois campos. Cada uma responde à
 * pergunta que o operador faz naquele ponto: "o que vence e quanto falta" e "o que já foi pago e
 * o que foi estornado". As colunas Pago/Saldo são DERIVADAS dos pagamentos que o servidor enviou
 * e casadas por parcela — quando não há parcela correspondente o campo fica ausente, e nenhum
 * zero é inventado.
 *
 * NÃO HÁ TIMELINE DE AUDITORIA AQUI. Pagamento é fato financeiro; trilha de auditoria é outra
 * capacidade, com contrato e retenção próprios. O histórico abaixo usa apenas timestamps que o
 * payload realmente publica.
 */
export function PayableDetailPage() {
  const { payableId = '' } = useParams();
  const [reversalPaymentId, setReversalPaymentId] = useState('');
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [showCancelForm, setShowCancelForm] = useState(false);
  const loader = useCallback((signal?: AbortSignal) => getPayable(payableId, signal), [payableId]);
  const { state, reload, setReady } = useBackofficeQuery<PayableDetail>({
    loader,
    mapError: mapFinanceErrorToMessage,
    enabled: Boolean(payableId),
  });

  /*
   * Estados de página resolvidos pela MESMA moldura do recebível: negação, ausência e falha não
   * se confundem entre si, e a página nunca cai num cartão solto.
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
      <ModulePage>
        <ModulePageHeader title="Conta a pagar" />
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
      </ModulePage>
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

  const overdue = item.status === 'OVERDUE';
  const dueDays = daysUntil(item.dueDate);
  const closedReason = !payableActive
    ? 'O título está cancelado e não aceita novos comandos.'
    : item.status === 'PAID'
      ? 'O título está integralmente pago.'
      : 'Ação indisponível para o estado atual do título.';

  /*
   * RELAÇÕES AUTORIZADAS.
   *
   * O título a pagar NÃO tem âncora própria na cadeia de negócio (o backend suporta
   * CLIENT..RECEIVABLE; PAYABLE não está entre elas), então não se força uma cadeia aqui —
   * inventar linhagem seria pior que não mostrá-la. O que existe de real e navegável é a origem
   * do lançamento, que leva à lista já recortada pela referência.
   */
  const relations = buildAuthorizedRelations(
    item.origin.kind === 'MANUAL' && item.origin.reference
      ? [
          {
            id: 'origin',
            label: 'Origem do lançamento',
            count: 1,
            to: `/app/finance/payables?ref=${encodeURIComponent(item.origin.reference)}`,
            allowed: true,
          },
        ]
      : [],
  );

  /*
   * COMANDOS DO TÍTULO — apresentados como COMMANDS, com disponibilidade derivada do estado.
   * Cada um abre o formulário que o servidor exige (valor/motivo), porque são operações com
   * validação de versão, saldo e idempotência: não são um "editar status".
   */
  const secondaryActions: ObjectAction[] = [];
  if (!closed) {
    secondaryActions.push({
      id: 'reverse-payment',
      label: 'Estornar pagamento',
      disabled: reversablePayments.length === 0,
      disabledReason: 'Não há pagamento estornável neste título.',
      onSelect: () => {
        setShowPaymentForm(false);
        setShowCancelForm(false);
        document.getElementById('reversal-payment-select')?.focus();
      },
    });
    secondaryActions.push({
      id: 'cancel',
      label: 'Cancelar título',
      onSelect: () => {
        setShowPaymentForm(false);
        setShowCancelForm(true);
      },
    });
  }

  /**
   * PRÓXIMA AÇÃO derivada do estado real: título em aberto aguarda o pagamento; título pago ou
   * cancelado não tem próximo passo declarado e a seção desaparece.
   */
  const nextAction: NextAction | null = closed
    ? null
    : item.status === 'OVERDUE'
      ? {
          kind: 'act',
          label: 'Regularizar o título vencido',
          description:
            'O título está vencido. O pagamento é registrado pelo comando do cabeçalho e o backend valida saldo, versão e origem.',
        }
      : {
          kind: 'act',
          label: 'Registrar o pagamento',
          description: 'O saldo em aberto é baixado quando o pagamento é registrado.',
        };

  const metadataFields: ObjectContextField[] = [
    { label: 'Unidade', value: item.unitId },
    { label: 'Origem', value: PAYABLE_ORIGIN_LABELS[item.origin.kind] ?? toHumanText(item.origin.kind) },
    { label: 'Referência de origem', value: item.origin.reference },
    { label: 'Condição de pagamento', value: item.paymentTerms },
    { label: 'Centro de custo', value: item.costCenter.code },
    { label: 'Aging', value: AGING_BUCKET_LABELS[item.agingBucket] ?? item.agingBucket },
    {
      label: 'Cancelado em',
      value: item.cancelledAt ? new Date(item.cancelledAt).toLocaleString('pt-BR') : null,
    },
    { label: 'Motivo do cancelamento', value: item.cancelReason },
    { label: 'Atualizado em', value: new Date(item.updatedAt).toLocaleString('pt-BR') },
  ];

  return (
    <ModulePage>
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
            status={{ label: statusLabel, tone: toneForStatusSafe(item.status) }}
            primaryAction={
              closed
                ? null
                : {
                    id: 'pay',
                    label: 'Registrar pagamento',
                    onSelect: () => {
                      setShowCancelForm(false);
                      setShowPaymentForm(true);
                    },
                  }
            }
            secondaryActions={secondaryActions}
          />
        }
        relations={<SmartRelationBar relations={relations} />}
        stateFlow={
          <ObjectStateFlow steps={steps} currentId={currentId} title="Fluxo do título a pagar" />
        }
        nextAction={<NextActionPanel action={nextAction} />}
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
        {/*
          FAIXA FINANCEIRA — os quatro números que decidem o título, na ordem em que o operador
          os lê. O SALDO é o único em corpo maior: é o número que ele veio buscar. O vencimento
          carrega o fato de prazo em palavras quando o título está vencido ou vence hoje.
        */}
        <section aria-label="Resumo financeiro do título" className="mb-3">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 lg:grid-cols-4">
            <SummaryCell label="Principal">
              <Money value={item.principal} currencyCode={item.currencyCode} />
            </SummaryCell>
            <SummaryCell label="Pago">
              <Money value={item.paidAmount} currencyCode={item.currencyCode} />
            </SummaryCell>
            <SummaryCell label="Saldo em aberto" emphasis>
              <Money value={item.remainingBalance} currencyCode={item.currencyCode} emphasis />
            </SummaryCell>
            <SummaryCell label="Vencimento">
              <DateTime value={item.dueDate} mode="date" />
              {overdue ? (
                <span className="mt-0.5 block text-[11px] font-semibold text-red-700">
                  {dueDays < 0
                    ? `Vencido há ${Math.abs(dueDays)} ${Math.abs(dueDays) === 1 ? 'dia' : 'dias'}`
                    : 'Vence hoje'}
                </span>
              ) : null}
            </SummaryCell>
          </div>
        </section>

        <ObjectContextBlock fields={metadataFields} columns={3} />

        {/*
          PARCELAS — sub-worklist. Responde "o que vence e quanto falta nesta parcela".
          Pago e Saldo são casados com os pagamentos que o servidor publicou; ausência de
          correspondência fica ausente em vez de virar zero.
        */}
        {item.installments.length > 0 ? (
          <ObjectPanel title="Parcelas">
            <div className="overflow-x-auto">
              <table className={worklistTableClass} aria-label="Parcelas do título">
                <thead>
                  <tr>
                    <th scope="col" className={worklistHeadCellClass}>
                      Parcela
                    </th>
                    <th scope="col" className={worklistHeadCellClass}>
                      Vencimento
                    </th>
                    <th scope="col" className={worklistNumericHeadCellClass}>
                      Principal
                    </th>
                    <th scope="col" className={worklistNumericHeadCellClass}>
                      Pago
                    </th>
                    <th scope="col" className={worklistNumericHeadCellClass}>
                      Saldo
                    </th>
                    <th scope="col" className={worklistHeadCellClass}>
                      Situação
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {item.installments.map((installment) => {
                    const settled = paidForInstallment(
                      item.payments,
                      installment.installmentNumber,
                      item.installments.length,
                    );
                    const balance = settled === null ? null : Number(installment.principal) - settled;
                    const late = Number(balance ?? installment.principal) > 0 && daysUntil(installment.dueDate) < 0;
                    return (
                      <tr key={installment.id} className={worklistRowClass}>
                        <td className={worklistCellClass}>
                          <span className="font-semibold text-gray-900 tabular-nums">
                            {installment.installmentNumber}
                          </span>
                        </td>
                        <td className={worklistCellClass}>
                          <DateTime value={installment.dueDate} mode="date" />
                          {late ? (
                            <span className="mt-0.5 block text-[11px] font-semibold text-red-700">
                              Vencida
                            </span>
                          ) : null}
                        </td>
                        <td className={worklistNumericCellClass}>
                          <Money value={installment.principal} currencyCode={item.currencyCode} />
                        </td>
                        <td className={worklistNumericCellClass}>
                          {settled === null ? (
                            <span className="text-gray-400">—</span>
                          ) : (
                            <Money
                              value={String(settled)}
                              currencyCode={item.currencyCode}
                            />
                          )}
                        </td>
                        <td className={worklistNumericCellClass}>
                          {balance === null ? (
                            <span className="text-gray-400">—</span>
                          ) : (
                            <Money value={String(balance)} currencyCode={item.currencyCode} emphasis />
                          )}
                        </td>
                        <td className={worklistCellClass}>
                          <FinanceStatusBadge
                            status={installmentStatus(item, installment.installmentNumber, balance)}
                            labels={INSTALLMENT_STATUS_LABELS}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ObjectPanel>
        ) : null}

        {/*
          PAGAMENTOS — fato financeiro, não trilha de auditoria. Cada linha diz data, valor,
          referência, origem e se aquele lançamento é um ESTORNO de outro pagamento.
        */}
        <ObjectPanel title="Pagamentos">
          {item.payments.length > 0 ? (
            <div className="overflow-x-auto">
              <table className={worklistTableClass} aria-label="Pagamentos do título">
                <thead>
                  <tr>
                    <th scope="col" className={worklistHeadCellClass}>
                      Tipo
                    </th>
                    <th scope="col" className={worklistHeadCellClass}>
                      Data
                    </th>
                    <th scope="col" className={worklistHeadCellClass}>
                      Referência
                    </th>
                    <th scope="col" className={worklistHeadCellClass}>
                      Origem
                    </th>
                    <th scope="col" className={worklistNumericHeadCellClass}>
                      Valor
                    </th>
                    <th scope="col" className={worklistHeadCellClass}>
                      Relação
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {item.payments.map((payment) => {
                    const isReversal =
                      payment.kind === 'REVERSAL' || Boolean(payment.reversesPaymentId);
                    return (
                      <tr key={payment.id} className={worklistRowClass}>
                        <td className={worklistCellClass}>
                          <FinanceStatusBadge
                            status={payment.kind}
                            labels={PAYMENT_KIND_LABELS}
                          />
                        </td>
                        <td className={worklistCellClass}>
                          <DateTime value={payment.paidAt} />
                        </td>
                        <td className={worklistCellClass}>
                          {payment.paymentReference || (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        {/*
                          A origem vem com rótulo HUMANO do backend (`originReference`). Quando só
                          existe o identificador técnico, a célula mostra o rótulo do tipo — nunca
                          o UUID.
                        */}
                        <td className={worklistCellClass}>
                          {payment.originReference || toHumanText(payment.originKind) || (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className={worklistNumericCellClass}>
                          <Money
                            value={payment.amount}
                            currencyCode={payment.currencyCode}
                            className={isReversal ? 'text-red-700' : undefined}
                          />
                        </td>
                        <td className={worklistCellClass}>
                          {isReversal ? (
                            <span className="text-[11px] font-medium text-gray-600">
                              Estorno de pagamento anterior
                            </span>
                          ) : (
                            <span className="text-[11px] text-gray-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              Nenhum pagamento lançado para este título.
            </p>
          )}
        </ObjectPanel>

        {/*
          ESTORNO — só aparece quando existe pagamento estornável. O comando vive no cabeçalho;
          aqui fica o formulário que o servidor exige (referência e motivo).
        */}
        {reversablePayments.length > 0 && !closed ? (
          <ObjectPanel title="Estornar pagamento">
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
                    {payment.paymentReference} · {formatMoney(payment.amount, payment.currencyCode)}
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

        {/*
          COMANDOS — o formulário de pagamento abre pelo comando do cabeçalho e não ocupa a
          página quando ninguém está pagando. Título encerrado explica POR QUE não há comando,
          em vez de oferecer um botão desabilitado sem motivo.
        */}
        {closed ? (
          <div className="mb-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
            <p className="text-[13px] text-gray-700">{closedReason}</p>
          </div>
        ) : null}

        {showPaymentForm && !closed ? (
          <div className="mb-3">
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
              mapError={mapFinanceErrorToMessage}
              onReload={() => void reload()}
              onSubmit={async ({ amount, extra, idempotencyKey }) => {
                const next = await payPayable(item.id, {
                  amount: amount ?? '',
                  rowVersion: item.rowVersion,
                  idempotencyKey,
                  paymentReference: extra ?? '',
                });
                setShowPaymentForm(false);
                setReady(next);
              }}
            />
          </div>
        ) : null}

        {showCancelForm && !closed ? (
          <div className="mb-3">
            <MoneyActionForm
              title="Cancelar título"
              description="Cancelamento exigido pelo servidor com justificativa."
              confirmTitle="Cancelar título"
              confirmDescription="O título só será cancelado se o backend aceitar."
              confirmLabel="Cancelar título"
              reasonLabel="Justificativa"
              mapError={mapFinanceErrorToMessage}
              onReload={() => void reload()}
              onSubmit={async ({ reason, idempotencyKey }) => {
                const next = await cancelPayable(item.id, {
                  rowVersion: item.rowVersion,
                  cancelReason: reason ?? '',
                  idempotencyKey,
                });
                setShowCancelForm(false);
                setReady(next);
              }}
            />
          </div>
        ) : null}
      </EnterpriseObjectPage>
    </ModulePage>
  );
}

/* ------------------------------------------------------------------ apoio local */

const INSTALLMENT_STATUS_LABELS: Record<string, string> = {
  PAID: 'Quitada',
  PARTIALLY_PAID: 'Parcial',
  OPEN: 'Em aberto',
  OVERDUE: 'Vencida',
};

/** Célula da faixa financeira: rótulo pequeno, valor grande. */
function SummaryCell({
  label,
  children,
  emphasis = false,
}: {
  label: string;
  children: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className="bg-white px-3 py-2">
      <p className="text-[10px] font-semibold tracking-wide text-gray-500 uppercase">{label}</p>
      <p
        className={
          emphasis
            ? 'mt-0.5 text-lg leading-tight font-semibold text-gray-900 tabular-nums'
            : 'mt-0.5 text-[13px] text-gray-800 tabular-nums'
        }
      >
        {children}
      </p>
    </div>
  );
}

/** Dias inteiros até uma data, na data local do operador. */
function daysUntil(date: string): number {
  const due = new Date(`${date.slice(0, 10)}T00:00:00`);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

/**
 * Total pago de UMA parcela.
 *
 * O contrato de pagamento NÃO publica a qual parcela o valor foi alocado (`Payment` carrega
 * valor, data e referência, não `installmentNumber`). Sem esse vínculo, ratear o pagamento entre
 * as parcelas por ordem seria INVENTAR alocação — o operador veria "parcela 1 quitada, parcela 2
 * em aberto" sem que o servidor tenha afirmado isso.
 *
 * O que o contrato permite afirmar com segurança:
 *   - parcela 1 com UM único pagamento e nenhuma outra parcela: a alocação é inequívoca;
 *   - qualquer outro caso: ausente.
 *
 * Ausência é declarada na célula como "—". Um zero afirmaria que nada foi pago naquela parcela,
 * que é uma afirmação diferente e não sustentada pelo dado.
 */
function paidForInstallment(
  payments: Payment[],
  installmentNumber: number,
  totalInstallments: number,
): number | null {
  if (totalInstallments !== 1 || installmentNumber !== 1) {
    return null;
  }
  const settled = payments.filter(
    (payment) => payment.kind !== 'REVERSAL' && !payment.reversesPaymentId,
  );
  const reversals = payments.filter(
    (payment) => payment.kind === 'REVERSAL' || Boolean(payment.reversesPaymentId),
  );
  if (settled.length === 0 || reversals.length > 0) {
    return null;
  }
  return settled.reduce((sum, payment) => sum + Number(payment.amount), 0);
}

/** Situação da parcela derivada do saldo e do prazo. Nunca inventa estado que o dado não tem. */
function installmentStatus(
  item: PayableDetail,
  installmentNumber: number,
  balance: number | null,
): string {
  if (item.lifecycle === 'CANCELLED') {
    return 'OPEN';
  }
  if (balance === null) {
    return 'OPEN';
  }
  if (balance <= 0) {
    return 'PAID';
  }
  const installment = item.installments.find(
    (entry) => entry.installmentNumber === installmentNumber,
  );
  if (installment && daysUntil(installment.dueDate) < 0) {
    return 'OVERDUE';
  }
  return balance < Number(installment?.principal ?? balance) ? 'PARTIALLY_PAID' : 'OPEN';
}

function formatMoney(value: string, currencyCode: string): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currencyCode }).format(
    Number(value),
  );
}

/**
 * Tom do badge a partir do estado REAL do título.
 *
 * `OVERDUE` é um título não pago cujo vencimento passou: ele exige decisão, e é isso que a cor
 * precisa comunicar.
 */
function toneForStatusSafe(status: string): 'success' | 'warning' | 'error' | 'neutral' {
  switch (status) {
    case 'PAID':
      return 'success';
    case 'OVERDUE':
      return 'error';
    case 'PARTIALLY_PAID':
      return 'warning';
    case 'OPEN':
      return 'warning';
    default:
      return 'neutral';
  }
}
