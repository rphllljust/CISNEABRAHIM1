import { Link, useParams } from 'react-router-dom';
import { useCallback, useEffect, useId, useState } from 'react';
import { ConfirmDialog } from '../../clients/components/ConfirmDialog';
import {
  cancelPurchaseOrder,
  getPurchaseOrder,
  PurchaseOrdersApiError,
  registerPurchaseOrder,
} from '../api/purchase-orders-api';
import { mapPurchaseOrderErrorToMessage } from '../api/purchase-order-error-messages';
import { PurchaseOrderStatusBadge } from '../components/PurchaseOrderStatusBadge';
import { VersionConflictNotice } from '../components/VersionConflictNotice';
import { usePurchaseOrderCapabilities } from '../hooks/usePurchaseOrderCapabilities';
import {
  PURCHASE_ORDER_STATUSES,
  type PurchaseOrderDetail,
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

const PURCHASE_ORDER_LINKED_KIND_LABELS: Record<string, string> = {
  REQUEST: 'Solicitação',
  SERVICE_ORDER: 'Ordem de serviço',
  MEASUREMENT: 'Medição',
  BILLING_RECORD: 'Faturamento',
  BILLING_DOCUMENT: 'Documento fiscal',
};

function linkedRecordPath(record: { kind: string; id: string }): string {
  if (record.kind === 'SERVICE_ORDER') {
    return `/app/service-orders/${record.id}/planning`;
  }
  if (record.kind === 'REQUEST') {
    return `/app/requests/${record.id}`;
  }
  return `/app/purchase-orders`;
}
export function PurchaseOrderDetailPage() {
  const { purchaseOrderId = '' } = useParams();
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

  if (state.phase === 'loading') {
    return (
      <main id="main-content" className="shell-page">
        <p aria-busy="true" aria-live="polite">
          Carregando pedido…
        </p>
      </main>
    );
  }

  if (state.phase === 'denied') {
    return (
      <main id="main-content" className="shell-page">
        <h1>Pedido de compra</h1>
        <p role="alert">Você não tem permissão para consultar este pedido.</p>
        <Link to="/app/purchase-orders">Voltar à lista</Link>
      </main>
    );
  }

  if (state.phase === 'not_found') {
    return (
      <main id="main-content" className="shell-page">
        <h1>Pedido de compra</h1>
        <p role="alert">Pedido não encontrado.</p>
        <Link to="/app/purchase-orders">Voltar à lista</Link>
      </main>
    );
  }

  if (state.phase === 'error') {
    return (
      <main id="main-content" className="shell-page">
        <h1>Pedido de compra</h1>
        <p className="form-error" role="alert">
          {state.message}
        </p>
        <button type="button" onClick={() => void reload()}>
          Tentar novamente
        </button>
      </main>
    );
  }

  const { detail } = state;
  const { purchaseOrder: po, items, billingRules, linked = [] } = detail;

  const canEdit =
    capabilities.canUpdate && po.status === PURCHASE_ORDER_STATUSES.Draft;
  const canRegister =
    capabilities.canRegister && po.status === PURCHASE_ORDER_STATUSES.Draft;
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

  return (
    <main id="main-content" className="shell-page requests-page">
      <header className="requests-page__header">
        <div>
          <h1>{po.poNumber}</h1>
          <p className="form-hint">{po.internalCode}</p>
          <PurchaseOrderStatusBadge status={po.status} />
        </div>
        <div className="button-row">
          {canEdit ? (
            <Link
              to={`/app/purchase-orders/${po.id}/edit`}
              className="button-link button-secondary"
            >
              Editar rascunho
            </Link>
          ) : null}
          {canRegister ? (
            <button
              type="button"
              disabled={actionSubmitting}
              onClick={() =>
                void runAction(async () => {
                  await registerPurchaseOrder(po.id, po.rowVersion);
                })
              }
            >
              Registrar
            </button>
          ) : null}
          {canCancel ? (
            <button
              type="button"
              className="button-secondary"
              disabled={actionSubmitting}
              onClick={() => setCancelOpen(true)}
            >
              Cancelar
            </button>
          ) : null}
        </div>
      </header>

      {versionConflict ? <VersionConflictNotice onReload={() => void reload()} /> : null}
      {actionError ? (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      ) : null}

      <section className="requests-section" aria-labelledby="po-summary-heading">
        <h2 id="po-summary-heading">Resumo</h2>
        <dl className="requests-details">
          <div>
            <dt>Cliente</dt>
            <dd>
              <Link to={`/app/clients/${po.clientId}`}>Ver cliente</Link>
              {po.clientSnapshot ? (
                <span className="form-hint"> ({formatClientSnapshot(po.clientSnapshot)})</span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>Unidade</dt>
            <dd>{po.unitId}</dd>
          </div>
          <div>
            <dt>Número RC</dt>
            <dd>{po.rcNumber ?? '—'}</dd>
          </div>
          <div>
            <dt>Data de emissão</dt>
            <dd>{formatDate(po.issueDate)}</dd>
          </div>
          <div>
            <dt>Registrado em</dt>
            <dd>{formatDateTime(po.registeredAt)}</dd>
          </div>
          <div>
            <dt>Estrutura de preço</dt>
            <dd>{formatPurchaseOrderPricingStructure(po.pricingStructure)}</dd>
          </div>
          <div>
            <dt>Valor autorizado</dt>
            <dd className="numeric">{formatMoney(authorizedAmount, po.currencyCode)}</dd>
          </div>
          <div>
            <dt>Condições de pagamento</dt>
            <dd>{po.paymentTerms ?? '—'}</dd>
          </div>
          <div>
            <dt>Forma de pagamento</dt>
            <dd>{po.paymentMethod ?? '—'}</dd>
          </div>
          <div>
            <dt>Gestor de serviço</dt>
            <dd>{po.serviceManager ?? '—'}</dd>
          </div>
          <div>
            <dt>Contato do comprador</dt>
            <dd>{formatBuyerContact(po.buyerContact)}</dd>
          </div>
          <div>
            <dt>Atualizado em</dt>
            <dd>{formatDateTime(po.updatedAt)}</dd>
          </div>
        </dl>
      </section>

      {items.length > 0 ? (
        <section className="requests-section" aria-labelledby="po-items-heading">
          <h2 id="po-items-heading">Itens</h2>
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
        </section>
      ) : null}

      {billingRules.length > 0 ? (
        <section className="requests-section" aria-labelledby="po-rules-heading">
          <h2 id="po-rules-heading">Regras de faturamento</h2>
          <ul>
            {billingRules.map((rule) => (
              <li key={rule.id}>{formatBillingRuleType(rule.ruleType)}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Cadeia relacionada: responde "de onde vem o valor consumido deste pedido".
          Relacoes que o dominio ja possui — nenhuma regra nova, so leitura. */}
      {linked.length > 0 ? (
        <section className="requests-section" aria-labelledby="po-linked-heading">
          <h2 id="po-linked-heading">Cadeia relacionada</h2>
          <p className="form-hint">
            Documentos ligados a este pedido, do pedido do cliente ao faturamento.
          </p>
          <ol className="mt-3 border-l border-gray-200 pl-4">
            {linked.map((record) => (
              <li key={`${record.kind}-${record.id}`} className="relative pb-3 last:pb-0">
                <span
                  aria-hidden="true"
                  className="absolute top-1.5 -left-[21px] h-2 w-2 rounded-full bg-brand-500"
                />
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-[10px] font-semibold tracking-wide text-gray-400 uppercase">
                    {PURCHASE_ORDER_LINKED_KIND_LABELS[record.kind] ?? record.kind}
                  </span>
                  <Link
                    to={linkedRecordPath(record)}
                    className="text-sm font-semibold text-brand-700 no-underline hover:text-brand-800"
                  >
                    {record.label}
                  </Link>
                  <span className="text-xs text-gray-500">
                    {formatPurchaseOrderStatus(record.status)}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 text-xs text-gray-500">
                  <span className="tabular-nums">{formatDateTime(record.occurredAt)}</span>
                  {record.amount ? (
                    <span className="cisne-type-money font-semibold text-gray-800">
                      {formatMoney(record.amount, record.currencyCode ?? po.currencyCode)}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {po.cancellationReason ? (
        <section className="requests-section">
          <h2>Cancelamento</h2>
          <p>{po.cancellationReason}</p>
          <p className="form-hint">Cancelado em {formatDateTime(po.cancelledAt)}</p>
        </section>
      ) : null}

      <p>
        <Link to="/app/purchase-orders">Voltar à lista</Link>
      </p>

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
