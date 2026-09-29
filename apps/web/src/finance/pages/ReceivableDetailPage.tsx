import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { DateTime, Money, ModulePage, ModulePageHeader } from '../../ui';
import {
  moduleTableCellClass,
  moduleTableClass,
  moduleTableHeadClass,
  moduleTableHeaderCellClass,
  moduleTableRowClass,
} from '../../ui/module-layout';
import { MoneyActionForm } from '../../financial-ui/MoneyActionForm';
import { RECEIVABLE_STATUS_LABELS, toneForStatus } from '../../financial-ui/labels';
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
  type ObjectContextField,
  type ObjectMetadataField,
  type ObjectPagePhase,
  type ObjectStateStep,
} from '../../enterprise-object';
import { ActivityTimeline, type ActivityFact } from '../../operator';
import { BusinessChain, useBusinessChain } from '../../business-chain';
import { cancelReceivable, getReceivable, settleReceivable } from '../api/finance-api';
import { CollectionPanel } from '../components/CollectionPanel';
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

  const metadata: ObjectMetadataField[] = [
    {
      label: 'Vencimento',
      value: <DateTime value={item.dueDate} mode="date" />,
    },
    {
      label: 'Principal',
      value: <Money value={item.principal} currencyCode={item.currencyCode} />,
    },
    {
      label: 'Saldo informado',
      value: <Money value={item.remainingBalance} currencyCode={item.currencyCode} emphasis />,
      emphasis: true,
    },
    {
      label: 'Recebido',
      value: <Money value={item.settledAmount} currencyCode={item.currencyCode} />,
    },
    { label: 'Condição', value: item.paymentTerms },
    { label: 'Parcelas', value: item.installments.length > 0 ? String(item.installments.length) : null },
  ];

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
            status={{ label: statusLabel, tone: toneForStatus(item.status) }}
            metadata={metadata}
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

        <CollectionPanel
          key={item.rowVersion}
          receivableId={item.id}
          receivable={item}
          onChanged={() => void reload()}
        />

        <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
          <MoneyActionForm
            title="Registrar recebimento"
            description="O servidor valida o valor, a versão e a idempotência."
            confirmTitle="Confirmar recebimento"
            confirmDescription="O valor informado será enviado ao backend. Nada é calculado neste formulário."
            confirmLabel="Receber"
            amountLabel="Valor"
            disabled={closed}
            mapError={mapFinanceErrorToMessage}
            onReload={() => void reload()}
            onSubmit={async ({ amount, idempotencyKey }) => {
              const next = await settleReceivable(item.id, {
                amount: amount ?? '',
                rowVersion: item.rowVersion,
                idempotencyKey,
              });
              setReady(next);
            }}
          />
          <MoneyActionForm
            title="Cancelar título"
            description="O cancelamento exige justificativa e é decidido pelo servidor."
            confirmTitle="Cancelar título"
            confirmDescription="O título será cancelado apenas se o backend aceitar a operação."
            confirmLabel="Cancelar título"
            reasonLabel="Justificativa"
            disabled={closed}
            mapError={mapFinanceErrorToMessage}
            onReload={() => void reload()}
            onSubmit={async ({ reason, idempotencyKey }) => {
              const next = await cancelReceivable(item.id, {
                rowVersion: item.rowVersion,
                cancelReason: reason ?? '',
                idempotencyKey,
              });
              setReady(next);
            }}
          />
        </div>
      </EnterpriseObjectPage>
    </ModulePage>
  );
}
