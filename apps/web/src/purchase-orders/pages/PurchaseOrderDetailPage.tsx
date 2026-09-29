import { useNavigate, useParams } from 'react-router-dom';
import { useCallback, useEffect, useId, useState } from 'react';
import { ConfirmDialog } from '../../clients/components/ConfirmDialog';
import {
  EnterpriseObjectHeader,
  EnterpriseObjectPage,
  ObjectContextBlock,
  ObjectPanel,
  ObjectStateFlow,
  type ObjectAction,
  type ObjectContextField,
  type ObjectMetadataField,
  type ObjectPagePhase,
  type ObjectStateStep,
} from '../../enterprise-object';
import { ActivityTimeline, type ActivityFact } from '../../operator';
import { BusinessChain, useBusinessChain } from '../../business-chain';
import type { StatusBadgeTone } from '../../ui/StatusBadge';
import {
  cancelPurchaseOrder,
  getPurchaseOrder,
  PurchaseOrdersApiError,
  registerPurchaseOrder,
} from '../api/purchase-orders-api';
import { mapPurchaseOrderErrorToMessage } from '../api/purchase-order-error-messages';
import { VersionConflictNotice } from '../components/VersionConflictNotice';
import { usePurchaseOrderCapabilities } from '../hooks/usePurchaseOrderCapabilities';
import {
  PURCHASE_ORDER_STATUSES,
  type PurchaseOrder,
  type PurchaseOrderDetail,
  type PurchaseOrderStatus,
} from '../types/purchase-order.types';
import {
  formatBillingRuleType,
  formatBuyerContact,
  formatClientSnapshot,
  formatDate,
  formatDateTime,
  formatMoney,
  formatPurchaseOrderPricingStructure,
  formatPurchaseOrderStatus,
} from '../utils/purchase-order-labels';

type DetailState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'not_found' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; detail: PurchaseOrderDetail };

const STATUS_TONES: Record<PurchaseOrderStatus, StatusBadgeTone> = {
  [PURCHASE_ORDER_STATUSES.Draft]: 'neutral',
  [PURCHASE_ORDER_STATUSES.Registered]: 'success',
  [PURCHASE_ORDER_STATUSES.Cancelled]: 'error',
};

/**
 * Etapas REALMENTE persistidas do pedido de compra.
 *
 * `DRAFT`, `REGISTERED` e `CANCELLED` sao os estados do dominio, e cada passo
 * recebido aqui so aparece com a marca temporal que o backend gravou. Quando o
 * pedido foi cancelado ANTES do registro (`registeredAt` ausente), a etapa de
 * registro nao e representada: ela nunca ocorreu.
 */
export function purchaseOrderStateSteps(po: PurchaseOrder): ObjectStateStep[] {
  const draft: ObjectStateStep = {
    id: PURCHASE_ORDER_STATUSES.Draft,
    label: formatPurchaseOrderStatus(PURCHASE_ORDER_STATUSES.Draft),
    hint: `Criado em ${formatDateTime(po.createdAt)}`,
  };
  const registered: ObjectStateStep = {
    id: PURCHASE_ORDER_STATUSES.Registered,
    label: formatPurchaseOrderStatus(PURCHASE_ORDER_STATUSES.Registered),
    hint: po.registeredAt ? `Registrado em ${formatDateTime(po.registeredAt)}` : undefined,
  };
  const cancelled: ObjectStateStep = {
    id: PURCHASE_ORDER_STATUSES.Cancelled,
    label: formatPurchaseOrderStatus(PURCHASE_ORDER_STATUSES.Cancelled),
    terminal: true,
    hint: po.cancelledAt ? `Cancelado em ${formatDateTime(po.cancelledAt)}` : undefined,
  };

  if (po.status === PURCHASE_ORDER_STATUSES.Cancelled && !po.registeredAt) {
    return [draft, cancelled];
  }
  return [draft, registered, cancelled];
}

/** Fatos de historico: somente timestamps e marcos persistidos pelo backend. */
export function purchaseOrderActivityFacts(po: PurchaseOrder): ActivityFact[] {
  const facts: ActivityFact[] = [
    { at: po.createdAt, event: 'Pedido criado' },
    { at: po.updatedAt, event: 'Pedido atualizado' },
  ];
  if (po.registeredAt) {
    facts.push({ at: po.registeredAt, event: 'Pedido registrado' });
  }
  if (po.cancelledAt) {
    facts.push({ at: po.cancelledAt, event: 'Pedido cancelado' });
  }
  return facts;
}

/** `—` e ausencia de dado, nunca conteudo de tela. */
function orNull(value: string | null | undefined): string | null {
  if (!value || value === '—') {
    return null;
  }
  return value;
}

export function PurchaseOrderDetailPage() {
  const { purchaseOrderId = '' } = useParams();
  const navigate = useNavigate();
  const reasonId = useId();
  const { capabilities } = usePurchaseOrderCapabilities();
  const [state, setState] = useState<DetailState>({ phase: 'loading' });
  const [actionError, setActionError] = useState<string | null>(null);
  const [versionConflict, setVersionConflict] = useState(false);
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const reload = useCallback(async () => {
    setState({ phase: 'loading' });
    setActionError(null);
    setVersionConflict(false);
    try {
      const detail = await getPurchaseOrder(purchaseOrderId);
      setState({ phase: 'ready', detail });
    } catch (error) {
      if (error instanceof PurchaseOrdersApiError) {
        if (error.kind === 'denied') {
          setState({ phase: 'denied' });
          return;
        }
        if (error.kind === 'not_found') {
          setState({ phase: 'not_found' });
          return;
        }
      }
      setState({
        phase: 'error',
        message:
          error instanceof PurchaseOrdersApiError
            ? mapPurchaseOrderErrorToMessage(error.code, error.status)
            : 'Não foi possível carregar o pedido.',
      });
    }
  }, [purchaseOrderId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /*
   * Cadeia empresarial ancorada no PEDIDO DE COMPRA: o read model devolve a linhagem
   * ja autorizada e ordenada, com a rota real de cada no.
   *
   * Este hook fica ANTES dos retornos antecipados de fase: hooks nao podem ser
   * chamados condicionalmente, e o gate de carregamento/negacao retorna cedo. Mover
   * esta chamada para depois do gate faz o React renderizar mais hooks que no render
   * anterior e quebra a pagina inteira.
   */
  const businessChain = useBusinessChain('PURCHASE_ORDER', purchaseOrderId);

  async function runAction(action: () => Promise<void>): Promise<void> {
    if (state.phase !== 'ready') {
      return;
    }
    setActionSubmitting(true);
    setActionError(null);
    try {
      await action();
      await reload();
    } catch (error) {
      if (error instanceof PurchaseOrdersApiError && error.kind === 'version_conflict') {
        setVersionConflict(true);
      }
      setActionError(
        error instanceof PurchaseOrdersApiError
          ? mapPurchaseOrderErrorToMessage(error.code, error.status)
          : 'Não foi possível concluir a operação.',
      );
    } finally {
      setActionSubmitting(false);
    }
  }

  // Estados de pagina: loading, negacao, ausencia e falha resolvidos pela moldura
  // unica do contrato — nenhuma tela inventa o proprio estado.
  if (state.phase !== 'ready') {
    let phase: ObjectPagePhase = 'error';
    let phaseMessage = 'Não foi possível carregar o pedido.';
    let phaseTitle = 'Pedido de compra';
    let onRetry: (() => void) | undefined;
    if (state.phase === 'loading') {
      phase = 'loading';
      phaseMessage = 'Carregando pedido…';
    } else if (state.phase === 'denied') {
      phase = 'denied';
      phaseMessage = 'Você não tem permissão para consultar este pedido.';
    } else if (state.phase === 'not_found') {
      phase = 'empty';
      phaseTitle = 'Pedido de compra não encontrado';
      phaseMessage = 'O servidor não encontrou este pedido.';
    } else {
      phaseMessage = state.message;
      onRetry = () => void reload();
    }
    return (
      <main id="main-content" className="shell-page">
        <EnterpriseObjectPage
          breadcrumb={[
            { label: 'Pedidos de compra', href: '/app/purchase-orders' },
            { label: 'Pedido de compra' },
          ]}
          phase={phase}
          phaseTitle={phaseTitle}
          phaseMessage={phaseMessage}
          onRetry={phase === 'error' ? onRetry : undefined}
          header={null}
        />
      </main>
    );
  }

  const { detail } = state;
  const { purchaseOrder: po, items, billingRules } = detail;

  const canEdit = capabilities.canUpdate && po.status === PURCHASE_ORDER_STATUSES.Draft;
  const canRegister = capabilities.canRegister && po.status === PURCHASE_ORDER_STATUSES.Draft;
  const canCancel =
    capabilities.canCancel &&
    (po.status === PURCHASE_ORDER_STATUSES.Draft ||
      po.status === PURCHASE_ORDER_STATUSES.Registered);

  const authorizedAmount =
    po.totalAmount ??
    (items.length > 0
      ? items
          .reduce((sum, item) => {
            const amount = Number.parseFloat(item.lineTotal ?? '0');
            return sum + (Number.isNaN(amount) ? 0 : amount);
          }, 0)
          .toFixed(4)
      : null);

  const editPath = `/app/purchase-orders/${po.id}/edit`;
  const clientName = orNull(formatClientSnapshot(po.clientSnapshot));

  // Acao primaria: a mais provavel AGORA, decidida por estado + capability real.
  const primaryAction: ObjectAction | null = canRegister
    ? {
        id: 'register',
        label: 'Registrar pedido',
        loading: actionSubmitting,
        onSelect: () =>
          void runAction(async () => {
            await registerPurchaseOrder(po.id, po.rowVersion);
          }),
      }
    : canEdit
      ? {
          id: 'edit',
          label: 'Editar rascunho',
          onSelect: () => {
            void navigate(editPath);
          },
        }
      : null;

  const secondaryActions: ObjectAction[] =
    canRegister && canEdit
      ? [
          {
            id: 'edit',
            label: 'Editar rascunho',
            onSelect: () => {
              void navigate(editPath);
            },
          },
        ]
      : [];

  const destructiveActions: ObjectAction[] = canCancel
    ? [{ id: 'cancel', label: 'Cancelar pedido', onSelect: () => setCancelOpen(true) }]
    : [];

  const metadata: ObjectMetadataField[] = [
    { label: 'Emissão', value: po.issueDate ? formatDate(po.issueDate) : null },
    { label: 'Registrado em', value: po.registeredAt ? formatDateTime(po.registeredAt) : null },
    {
      label: 'Valor autorizado',
      value: authorizedAmount ? formatMoney(authorizedAmount, po.currencyCode) : null,
      emphasis: true,
    },
    { label: 'Itens', value: items.length > 0 ? String(items.length) : null },
    {
      label: 'Regras de faturamento',
      value: billingRules.length > 0 ? String(billingRules.length) : null,
    },
  ];

  const contextFields: ObjectContextField[] = [
    { label: 'Cliente', value: clientName, to: `/app/clients/${po.clientId}` },
    { label: 'Código interno', value: po.internalCode },
    { label: 'Unidade', value: po.unitId },
    { label: 'Nº RC', value: po.rcNumber },
    {
      label: 'Estrutura de preço',
      value: formatPurchaseOrderPricingStructure(po.pricingStructure),
    },
    { label: 'Condições de pagamento', value: po.paymentTerms },
    { label: 'Forma de pagamento', value: po.paymentMethod },
    { label: 'Gestor de serviço', value: po.serviceManager },
    { label: 'Contato do comprador', value: orNull(formatBuyerContact(po.buyerContact)) },
    { label: 'Atualizado em', value: formatDateTime(po.updatedAt) },
  ];

  return (
    <main id="main-content" className="shell-page">
      <EnterpriseObjectPage
        breadcrumb={[
          { label: 'Pedidos de compra', href: '/app/purchase-orders' },
          { label: po.poNumber },
        ]}
        header={
          <EnterpriseObjectHeader
            reference={po.poNumber}
            title="Pedido de compra"
            subtitle={clientName}
            status={{
              label: formatPurchaseOrderStatus(po.status),
              tone: STATUS_TONES[po.status] ?? 'neutral',
              description:
                po.status === PURCHASE_ORDER_STATUSES.Cancelled && po.cancelledAt
                  ? `Cancelado em ${formatDateTime(po.cancelledAt)}`
                  : undefined,
            }}
            metadata={metadata}
            primaryAction={primaryAction}
            secondaryActions={secondaryActions}
            destructiveActions={destructiveActions}
          />
        }
        stateFlow={
          <ObjectStateFlow
            steps={purchaseOrderStateSteps(po)}
            currentId={po.status}
            title="Fluxo do pedido de compra"
          />
        }
        aside={
          <ObjectPanel title="Histórico">
            <ActivityTimeline
              facts={purchaseOrderActivityFacts(po)}
              title="Histórico do pedido"
              emptyMessage="Este pedido não expõe histórico persistido além dos marcos abaixo."
            />
          </ObjectPanel>
        }
      >
        {/* O contexto entra no corpo: a moldura do contrato nesta revisao nao renderiza o
            slot `context` (so breadcrumb, header, fluxo, proxima acao, relacoes e corpo). */}
        <ObjectContextBlock fields={contextFields} columns={3} />

        {versionConflict ? <VersionConflictNotice onReload={() => void reload()} /> : null}
        {actionError ? (
          <p className="form-error" role="alert">
            {actionError}
          </p>
        ) : null}

        {items.length > 0 ? (
          <ObjectPanel title="Itens">
            <table className="requests-table" aria-label="Itens do pedido">
              <thead>
                <tr>
                  <th scope="col">Linha</th>
                  <th scope="col">Descrição</th>
                  <th scope="col">Qtd.</th>
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.lineNumber}</td>
                    <td>{item.description}</td>
                    <td>{item.quantity ?? '—'}</td>
                    <td className="numeric">{formatMoney(item.lineTotal, po.currencyCode)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ObjectPanel>
        ) : null}

        {billingRules.length > 0 ? (
          <ObjectPanel title="Regras de faturamento">
            <ul>
              {billingRules.map((rule) => (
                <li key={rule.id}>{formatBillingRuleType(rule.ruleType)}</li>
              ))}
            </ul>
          </ObjectPanel>
        ) : null}

        {/* Cadeia relacionada: responde "de onde vem o valor consumido deste pedido".
        {/*
          CADEIA DE NEGOCIO — linhagem AUTORIZADA do servidor, nao uma remontagem local.
          Antes esta area era um painel proprio com um resolvedor de rota caseiro
          (`linkedRecordPath`), que so conhecia dois tipos e caia na LISTA DE PEDIDOS
          para qualquer outro elo — inclusive para faturamento e recebivel. O read model
          ja devolve a cadeia ordenada, autorizada e com a rota real de cada no; o
          cliente nao deve reconstruir linhagem. Vem DEPOIS das acoes e antes do
          historico: e continuidade, nao decoracao.
        */}
        <BusinessChain
          chain={businessChain.chain}
          phase={businessChain.phase}
          message={businessChain.message}
          onRetry={businessChain.retry}
          title="Cadeia de negócio do pedido"
        />

        {po.cancellationReason ? (
          <ObjectPanel title="Cancelamento">
            <p>{po.cancellationReason}</p>
            <p className="form-hint">Cancelado em {formatDateTime(po.cancelledAt)}</p>
          </ObjectPanel>
        ) : null}
      </EnterpriseObjectPage>

      <ConfirmDialog
        open={cancelOpen}
        title="Cancelar pedido de compra"
        description="Informe o motivo do cancelamento."
        confirmLabel="Confirmar cancelamento"
        confirmDisabled={actionSubmitting}
        onCancel={() => {
          setCancelOpen(false);
          setCancelReason('');
        }}
        onConfirm={() => {
          void runAction(async () => {
            await cancelPurchaseOrder(po.id, {
              rowVersion: po.rowVersion,
              cancellationReason: cancelReason.trim() || undefined,
            });
            setCancelOpen(false);
            setCancelReason('');
          });
        }}
      >
        <div className="form-field">
          <label htmlFor={`${reasonId}-cancel`}>Motivo</label>
          <textarea
            id={`${reasonId}-cancel`}
            value={cancelReason}
            onChange={(event) => setCancelReason(event.target.value)}
            rows={3}
          />
        </div>
      </ConfirmDialog>
    </main>
  );
}
