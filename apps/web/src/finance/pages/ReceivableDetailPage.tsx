import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { DateTime, Money, ModulePage, ModulePageHeader } from '../../ui';
import {
  worklistCellClass,
  worklistHeadCellClass,
  worklistNumericCellClass,
  worklistNumericHeadCellClass,
  worklistRowClass,
  worklistTableClass,
} from '../../ui/enterprise-list';
import { MoneyActionForm } from '../../financial-ui/MoneyActionForm';
import { RECEIVABLE_STATUS_LABELS } from '../../financial-ui/labels';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { getClient } from '../../clients/api/clients-api';
import { useAuth } from '../../auth/context/AuthProvider';
import { probeServiceOrderListAccess } from '../../service-orders/api/service-orders-api';
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
import { BusinessChain, useBusinessChain } from '../../business-chain';
import { cancelReceivable, getReceivable, settleReceivable } from '../api/finance-api';
import { CollectionPanel } from '../components/CollectionPanel';
import { FinanceStatusBadge } from '../components/FinanceStatusBadge';
import { mapFinanceErrorToMessage } from '../api/finance-error-messages';
import type { ReceivableDetail } from '../types/finance.types';

/**
 * Historico do titulo a partir de FATOS PERSISTIDOS apenas.
 *
 * O payload de recebiveis nao guarda trilha de eventos nem ator: guarda
 * `createdAt`, `updatedAt`, `cancelledAt` e as liquidacoes com `settledAt`.
 * Entao e exatamente isso que o historico mostra — nada de evento inventado,
 * nada de "Sistema" preenchendo autor desconhecido, nada de estado anterior que
 * nao foi gravado.
 */
export function receivableActivityFacts(item: ReceivableDetail): ActivityFact[] {
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

  for (const settlement of item.settlements) {
    facts.push({
      at: settlement.settledAt,
      event: 'Recebimento registrado',
      reference: `${settlement.amount} ${settlement.currencyCode} · ${settlement.status}`,
    });
  }

  return facts;
}

const RECEIVABLE_ORIGIN_LABELS: Record<string, string> = {
  BILLING_DOCUMENT: 'Documento de faturamento',
};

const RECEIVABLE_STATUS_STEPS: { id: string; label: string }[] = [
  { id: 'OPEN', label: 'Em aberto' },
  { id: 'PARTIALLY_PAID', label: 'Parcialmente recebido' },
  { id: 'PAID', label: 'Recebido' },
];

/**
 * Fluxo persistido do titulo.
 *
 * O status devolvido pelo backend e derivado de `lifecycle`, dos recebimentos
 * `POSTED` e do vencimento. `OVERDUE` e um titulo NAO recebido cujo vencimento
 * passou, portanto ele permanece na etapa "Em aberto" — com o vencimento real
 * como fato. Titulo cancelado antes de qualquer recebimento nao passa pela etapa
 * de recebimento: o fluxo mostra apenas as etapas que ocorreram.
 */
export function receivableStateSteps(item: ReceivableDetail): {
  steps: ObjectStateStep[];
  currentId: string | null;
} {
  const overdue = item.status === 'OVERDUE';
  const steps: ObjectStateStep[] = RECEIVABLE_STATUS_STEPS.map((step) => {
    if (step.id === 'OPEN' && overdue) {
      return { ...step, hint: `Vencido em ${new Date(item.dueDate).toLocaleDateString('pt-BR')}` };
    }
    return { ...step };
  });

  if (item.lifecycle === 'CANCELLED') {
    const cancelled: ObjectStateStep = {
      id: 'CANCELLED',
      label: RECEIVABLE_STATUS_LABELS['CANCELLED'] ?? 'Cancelado',
      terminal: true,
      hint: item.cancelledAt
        ? `Cancelado em ${new Date(item.cancelledAt).toLocaleString('pt-BR')}`
        : undefined,
    };
    // Sem recebimento persistido o titulo nao passou pela etapa de recebimento.
    const reached = item.settlements.length > 0 ? steps.slice(0, 2) : steps.slice(0, 1);
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

/**
 * Nome humano do Cliente do titulo.
 *
 * O titulo carrega apenas `clientId` — identificador tecnico que NAO pode ir para a
 * tela. A leitura do cadastro de Clientes resolve o nome e, ao mesmo tempo, e a
 * autorizacao real do vinculo: negada, o fato e omitido.
 */
function useClientName(clientId: string): string | null {
  const { status } = useAuth();
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'authenticated' || clientId.length === 0) {
      setName(null);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    void getClient(clientId, controller.signal)
      .then((client) => {
        if (!cancelled) {
          setName(toHumanText(client.tradeName ?? client.legalName));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setName(null);
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [clientId, status]);

  return name;
}

/**
 * Leitura de ordens de servico autorizada: a origem do titulo aponta para a OS
 * faturada, e sem autorizacao de leitura naquele dominio a relacao desaparece.
 */
function useServiceOrderReadAccess(): boolean {
  const { status } = useAuth();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    if (status !== 'authenticated') {
      setAllowed(false);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    void probeServiceOrderListAccess(controller.signal)
      .then((result) => {
        if (!cancelled) {
          setAllowed(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAllowed(false);
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [status]);

  return allowed;
}

export function ReceivableDetailPage() {
  const { receivableId = '' } = useParams();
  const [showSettleForm, setShowSettleForm] = useState(false);
  const [showCancelForm, setShowCancelForm] = useState(false);
  const loader = useCallback((signal?: AbortSignal) => getReceivable(receivableId, signal), [receivableId]);
  const { state, reload, setReady } = useBackofficeQuery<ReceivableDetail>({
    loader,
    mapError: mapFinanceErrorToMessage,
    enabled: Boolean(receivableId),
  });

  const clientName = useClientName(state.phase === 'ready' ? state.data.clientId : '');
  const canReadServiceOrders = useServiceOrderReadAccess();
  // Cadeia empresarial do titulo: origem (faturamento, medicao, OS) e resultados (liquidacoes)
  // em UMA requisicao. O servidor ja omitiu todo no nao autorizado.
  const businessChain = useBusinessChain('RECEIVABLE', state.phase === 'ready' ? state.data.id : '');

  // Estados de pagina resolvidos pela moldura do contrato: negacao, ausencia e falha
  // nao se confundem entre si.
  if (state.phase !== 'ready') {
    let phase: ObjectPagePhase;
    let phaseTitle = 'Conta a receber';
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
        <ModulePageHeader title="Conta a receber" />
        <EnterpriseObjectPage
          breadcrumb={[
            { label: 'Contas a receber', href: '/app/finance/receivables' },
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
  const statusLabel = RECEIVABLE_STATUS_LABELS[item.status] ?? item.status;
  const { steps, currentId } = receivableStateSteps(item);

  // Relacao REAL e autorizada: a OS faturada que originou o titulo.
  const relations = buildAuthorizedRelations(
    item.origin.serviceOrderId
      ? [
          {
            id: 'service-order',
            label: 'Ordem de serviço faturada',
            count: 1,
            to: `/app/service-orders/${item.origin.serviceOrderId}/planning`,
            allowed: canReadServiceOrders,
          },
        ]
      : [],
  );

  /**
   * Proxima acao derivada do estado real: titulo em aberto aguarda o recebimento
   * (de quem depende o proximo passo); titulo recebido ou cancelado nao tem proximo
   * passo declarado e a secao desaparece.
   */
  const nextAction: NextAction | null = closed
    ? null
    : {
        kind: 'waiting',
        label: 'Aguardar recebimento do título',
        description: 'O saldo em aberto é baixado quando o recebimento é registrado.',
        waitingOn: clientName ?? undefined,
      };

  /*
   * COMANDOS DO TÍTULO — apresentados como COMMANDS no cabeçalho, com disponibilidade derivada
   * do estado real. Cada um abre o formulário que o servidor exige (valor/justificativa),
   * porque são operações com validação de versão e idempotência: não são um "editar status".
   */
  const secondaryActions: ObjectAction[] = closed
    ? []
    : [
        {
          id: 'cancel',
          label: 'Cancelar título',
          onSelect: () => {
            setShowSettleForm(false);
            setShowCancelForm(true);
          },
        },
      ];

  const today = startOfDay(new Date());
  const dueDays = daysUntil(item.dueDate, today);
  const overdue = item.status === 'OVERDUE';
  const closedReason =
    item.lifecycle === 'CANCELLED'
      ? 'O título está cancelado e não aceita novos comandos.'
      : 'O título está integralmente recebido.';

  const contextFields: ObjectContextField[] = [
    {
      label: 'Cliente',
      value: clientName,
      // O vinculo so navega quando o cadastro de Clientes foi realmente lido.
      to: clientName ? `/app/clients/${item.clientId}` : undefined,
    },
    { label: 'Unidade', value: item.unitId },
    {
      label: 'Origem',
      value: RECEIVABLE_ORIGIN_LABELS[item.origin.kind] ?? item.origin.kind,
    },
    { label: 'Condição de pagamento', value: item.paymentTerms },
    {
      label: 'Cancelado em',
      value: item.cancelledAt ? new Date(item.cancelledAt).toLocaleString('pt-BR') : null,
    },
    { label: 'Motivo do cancelamento', value: item.cancelReason },
    {
      label: 'Atualizado em',
      value: new Date(item.updatedAt).toLocaleString('pt-BR'),
    },
  ];

  return (
    <ModulePage>
      <EnterpriseObjectPage
        breadcrumb={[
          { label: 'Contas a receber', href: '/app/finance/receivables' },
          { label: item.externalReference ?? 'Título a receber' },
        ]}
        header={
          <EnterpriseObjectHeader
            reference={item.externalReference}
            title="Conta a receber"
            subtitle={clientName}
            status={{ label: statusLabel, tone: toneForReceivableStatus(item.status) }}
            primaryAction={
              closed
                ? null
                : {
                    id: 'settle',
                    label: 'Registrar recebimento',
                    onSelect: () => {
                      setShowCancelForm(false);
                      setShowSettleForm(true);
                    },
                  }
            }
            secondaryActions={secondaryActions}
          />
        }
        stateFlow={
          <ObjectStateFlow
            steps={steps}
            currentId={currentId}
            title="Fluxo do título a receber"
          />
        }
        nextAction={<NextActionPanel action={nextAction} />}
        relations={<SmartRelationBar relations={relations} />}
        aside={
          <ObjectPanel title="Histórico">
            <ActivityTimeline
              facts={receivableActivityFacts(item)}
              title="Histórico do título"
              emptyMessage="Este título não expõe histórico persistido além dos timestamps abaixo."
            />
          </ObjectPanel>
        }
      >
        {/*
          FAIXA FINANCEIRA — os quatro números que decidem o título, na ordem em que o operador os
          lê. O SALDO é o único em corpo maior: é o número que ele veio buscar. O vencimento
          carrega o fato de prazo em palavras quando o título está vencido.
        */}
        <section aria-label="Resumo financeiro do título" className="mb-3">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 lg:grid-cols-4">
            <SummaryCell label="Principal">
              <Money value={item.principal} currencyCode={item.currencyCode} />
            </SummaryCell>
            <SummaryCell label="Recebido">
              <Money value={item.settledAmount} currencyCode={item.currencyCode} />
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

        {/* O contexto entra no corpo: a moldura do contrato nesta revisao nao renderiza o
            slot `context` (so breadcrumb, header, fluxo, proxima acao, relacoes e corpo). */}
        <ObjectContextBlock fields={contextFields} columns={3} />

        {/* De onde veio / o que foi gerado: a linhagem completa do titulo, por clique. */}
        <BusinessChain
          chain={businessChain.chain}
          phase={businessChain.phase}
          message={businessChain.message}
          onRetry={businessChain.retry}
          title="Cadeia de negócio do título"
        />

        {/*
          PARCELAS — sub-worklist. Além do principal, cada parcela diz o que já foi recebido e o
          que falta, e marca a vencida. Recebido/Saldo por parcela só são afirmados quando o
          contrato torna a alocação inequívoca; caso contrário a célula declara ausência, porque um
          zero afirmaria que nada foi recebido naquela parcela — uma afirmação diferente e não
          sustentada pelo dado.
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
                      Recebido
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
                    const received = settledForInstallment(item.settlements, installment.id);
                    const balance =
                      received === null ? null : Number(installment.principal) - received;
                    const late =
                      Number(balance ?? installment.principal) > 0 &&
                      daysUntil(installment.dueDate, today) < 0;
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
                          {received === null ? (
                            <span className="text-gray-400">—</span>
                          ) : (
                            <Money value={String(received)} currencyCode={item.currencyCode} />
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
                            status={installmentStatus(item, installment.installmentNumber, balance, today)}
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
          RECEBIMENTOS — fato financeiro, não trilha de auditoria. Cada linha diz data, valor,
          referência e o ESTADO persistido da liquidação.
        */}
        <ObjectPanel title="Recebimentos">
          {item.settlements.length > 0 ? (
            <div className="overflow-x-auto">
              <table className={worklistTableClass} aria-label="Recebimentos do título">
                <thead>
                  <tr>
                    <th scope="col" className={worklistHeadCellClass}>
                      Data
                    </th>
                    <th scope="col" className={worklistHeadCellClass}>
                      Referência
                    </th>
                    <th scope="col" className={worklistNumericHeadCellClass}>
                      Valor
                    </th>
                    <th scope="col" className={worklistHeadCellClass}>
                      Situação
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {item.settlements.map((settlement) => (
                    <tr key={settlement.id} className={worklistRowClass}>
                      <td className={worklistCellClass}>
                        <DateTime value={settlement.settledAt} />
                      </td>
                      <td className={worklistCellClass}>
                        {settlement.externalReference || (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className={worklistNumericCellClass}>
                        <Money
                          value={settlement.amount}
                          currencyCode={settlement.currencyCode}
                          emphasis
                        />
                      </td>
                      <td className={worklistCellClass}>
                        <FinanceStatusBadge
                          status={settlement.status}
                          labels={SETTLEMENT_STATUS_LABELS}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              Nenhum recebimento registrado para este título.
            </p>
          )}
        </ObjectPanel>

        <CollectionPanel
          key={item.rowVersion}
          receivableId={item.id}
          receivable={item}
          onChanged={() => void reload()}
        />

        {/*
          COMANDOS — o formulário abre pelo comando do cabeçalho e não ocupa a página quando
          ninguém está operando. Título encerrado explica POR QUE não há comando, em vez de
          oferecer um botão desabilitado sem motivo.
        */}
        {closed ? (
          <div className="mb-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
            <p className="text-[13px] text-gray-700">{closedReason}</p>
          </div>
        ) : null}

        {showSettleForm && !closed ? (
          <div className="mb-3">
            <MoneyActionForm
              title="Registrar recebimento"
              description="O servidor valida o valor, a versão e a idempotência."
              confirmTitle="Confirmar recebimento"
              confirmDescription="O valor informado será enviado ao backend. Nada é calculado neste formulário."
              confirmLabel="Receber"
              amountLabel="Valor"
              mapError={mapFinanceErrorToMessage}
              onReload={() => void reload()}
              onSubmit={async ({ amount, idempotencyKey }) => {
                const next = await settleReceivable(item.id, {
                  amount: amount ?? '',
                  rowVersion: item.rowVersion,
                  idempotencyKey,
                });
                setShowSettleForm(false);
                setReady(next);
              }}
            />
          </div>
        ) : null}

        {showCancelForm && !closed ? (
          <div className="mb-3">
            <MoneyActionForm
              title="Cancelar título"
              description="O cancelamento exige justificativa e é decidido pelo servidor."
              confirmTitle="Cancelar título"
              confirmDescription="O título será cancelado apenas se o backend aceitar a operação."
              confirmLabel="Cancelar título"
              reasonLabel="Justificativa"
              mapError={mapFinanceErrorToMessage}
              onReload={() => void reload()}
              onSubmit={async ({ reason, idempotencyKey }) => {
                const next = await cancelReceivable(item.id, {
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

const SETTLEMENT_STATUS_LABELS: Record<string, string> = {
  POSTED: 'Lançado',
  PENDING: 'Pendente',
  REVERSED: 'Estornado',
  CANCELLED: 'Cancelado',
};

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

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Dias inteiros até uma data, na data local do operador. */
function daysUntil(date: string, today: Date): number {
  const due = startOfDay(new Date(`${date.slice(0, 10)}T00:00:00`));
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

/**
 * Total recebido de UMA parcela, pela ALOCAÇÃO QUE O CONTRATO PUBLICA.
 *
 * `Settlement` carrega `installmentId` — o vínculo real entre o recebimento e a parcela que ele
 * baixou. A soma usa esse vínculo, e não a ordem das linhas: ratear por ordem seria inventar
 * alocação, e o operador veria "parcela 1 quitada" sem que o servidor tenha afirmado isso.
 *
 * Recebimento estornado NÃO entra na soma (o dinheiro não está mais lá). Quando nenhum
 * recebimento aponta para a parcela, devolve `null` e a célula declara ausência — um zero
 * afirmaria que nada foi recebido naquela parcela, que é outra afirmação.
 */
function settledForInstallment(
  settlements: ReceivableDetail['settlements'],
  installmentId: string,
): number | null {
  const matching = settlements.filter(
    (entry) => entry.installmentId === installmentId && entry.status !== 'REVERSED',
  );
  if (matching.length === 0) {
    return null;
  }
  return matching.reduce((sum, entry) => sum + Number(entry.amount), 0);
}

/** Situação da parcela derivada do saldo e do prazo. Nunca inventa estado que o dado não tem. */
function installmentStatus(
  item: ReceivableDetail,
  installmentNumber: number,
  balance: number | null,
  today: Date,
): string {
  if (item.lifecycle === 'CANCELLED' || balance === null) {
    return 'OPEN';
  }
  if (balance <= 0) {
    return 'PAID';
  }
  const installment = item.installments.find(
    (entry) => entry.installmentNumber === installmentNumber,
  );
  if (installment && daysUntil(installment.dueDate, today) < 0) {
    return 'OVERDUE';
  }
  return balance < Number(installment?.principal ?? balance) ? 'PARTIALLY_PAID' : 'OPEN';
}

/**
 * Tom do badge a partir do estado REAL do título.
 *
 * `OVERDUE` é um título não recebido cujo vencimento passou: ele exige cobrança, e é isso que a
 * cor precisa comunicar.
 */
function toneForReceivableStatus(status: string): 'success' | 'warning' | 'error' | 'neutral' {
  switch (status) {
    case 'PAID':
      return 'success';
    case 'OVERDUE':
      return 'error';
    case 'PARTIALLY_PAID':
    case 'OPEN':
      return 'warning';
    default:
      return 'neutral';
  }
}
