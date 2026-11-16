import { useId, useState, type FormEvent } from 'react';
import { HumanLookupField } from '../../financial-ui/HumanLookupField';
import { ServiceOrdersApiError, linkPurchaseOrderToDraftOrder } from '../api/service-orders-api';
import { mapServiceOrdersErrorToMessage } from '../api/service-orders-error-messages';
import { searchPurchaseOrdersForLookup } from '../utils/service-order-relation-lookup';

export type ServiceOrderDraftPurchaseOrderBindingProps = {
  serviceOrderId: string;
  rowVersion: number;
  requiredByCatalog: boolean;
  onUpdated: () => Promise<void>;
};

/**
 * A PO required for release must be attached while the OS is still DRAFT.
 * This is a real PATCH under record UPDATE authz, not a status mutation.
 * The server validates the linked PO's lifecycle, unit and client.
 */
export function ServiceOrderDraftPurchaseOrderBinding({
  serviceOrderId, rowVersion, requiredByCatalog, onUpdated,
}: ServiceOrderDraftPurchaseOrderBindingProps) {
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [purchaseOrderId, setPurchaseOrderId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!purchaseOrderId) {
      setError('Selecione um pedido de compra existente.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await linkPurchaseOrderToDraftOrder(serviceOrderId, rowVersion, purchaseOrderId);
      await onUpdated();
    } catch (cause) {
      if (cause instanceof ServiceOrdersApiError) {
        const message = mapServiceOrdersErrorToMessage(cause.code, cause.status);
        setError(cause.status === 409
          ? message + ' O backend recusou a alteração (HTTP 409). Recarregue a OS.'
          : message);
      } else {
        setError('Não foi possível vincular o pedido. Nenhuma alteração foi presumida.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Vincular pedido de compra à OS" className="mt-3 border-t border-gray-200 pt-3">
      <p className="m-0 text-sm text-amber-800" role="status">
        {requiredByCatalog
          ? 'O serviço publicado exige pedido de compra antes da liberação. Vincule-o enquanto a OS está em rascunho.'
          : 'Vincule um pedido existente quando exigido pelo cliente ou operação, antes de preparar a OS.'}
      </p>
      {!open ? (
        <button type="button" className="mt-2 text-sm font-semibold text-brand-700 underline"
          onClick={() => setOpen(true)}>
          Vincular pedido de compra
        </button>
      ) : (
        <form className="mt-3 space-y-3" onSubmit={(event) => void submit(event)}>
          <HumanLookupField
            label="Pedido de compra existente"
            htmlFor={fieldId}
            value={purchaseOrderId}
            onChange={(id) => { setPurchaseOrderId(id); setError(null); }}
            search={searchPurchaseOrdersForLookup}
            required
            placeholder="Buscar por número do pedido"
            emptyMessage="Nenhum pedido disponível nesta busca."
            emptyAction={{ label: 'Abrir pedidos de compra', to: '/app/purchase-orders' }}
            selectTestId="so-draft-purchase-order-select"
          />
          {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || !purchaseOrderId}
              className="rounded bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? 'Vinculando…' : 'Confirmar pedido'}
            </button>
            <button type="button" disabled={busy} onClick={() => { setOpen(false); setError(null); }}
              className="rounded border border-gray-300 px-3 py-2 text-sm">
              Cancelar
            </button>
            <button type="button" disabled={busy} onClick={() => void onUpdated()}
              className="rounded border border-gray-300 px-3 py-2 text-sm">
              Recarregar OS
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
