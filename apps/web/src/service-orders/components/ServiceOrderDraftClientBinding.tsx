import { useId, useState, type FormEvent } from 'react';
import { HumanLookupField } from '../../financial-ui/HumanLookupField';
import { ServiceOrdersApiError, linkClientToDraftOrder } from '../api/service-orders-api';
import { mapServiceOrdersErrorToMessage } from '../api/service-orders-error-messages';
import { searchClientsForLookup } from '../utils/service-order-relation-lookup';

export type ServiceOrderDraftClientBindingProps = {
  serviceOrderId: string;
  rowVersion: number;
  onUpdated: () => Promise<void>;
};

/**
 * Release requires an active client. DRAFT is the last state where clientId
 * is editable; PREPARED makes it immutable. This optional authorized PATCH
 * prevents a real order from getting stuck after PREPARE, without adding a
 * transition, bypassing authorization or changing the server's state machine.
 */
export function ServiceOrderDraftClientBinding({
  serviceOrderId, rowVersion, onUpdated,
}: ServiceOrderDraftClientBindingProps) {
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!clientId) {
      setError('Selecione o cliente antes de vincular.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await linkClientToDraftOrder(serviceOrderId, rowVersion, clientId);
      await onUpdated();
    } catch (cause) {
      if (cause instanceof ServiceOrdersApiError) {
        const message = mapServiceOrdersErrorToMessage(cause.code, cause.status);
        setError(cause.status === 409
          ? message + ' O servidor recusou a alteração (HTTP 409). Recarregue a OS.'
          : message);
      } else {
        setError('Falha ao vincular o cliente. Nenhuma alteração foi presumida.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Regularizar cliente da OS" className="mt-3 border-t border-gray-200 pt-3">
      <p className="m-0 text-sm text-amber-800" role="status">
        A liberação exige cliente ativo. Vincule o cliente enquanto a OS está em rascunho:
        após preparar, esse vínculo não poderá mais ser alterado.
      </p>
      {!open ? (
        <button type="button" className="mt-2 text-sm font-semibold text-brand-700 underline"
          onClick={() => setOpen(true)}>
          Vincular cliente à OS
        </button>
      ) : (
        <form className="mt-3 space-y-3" onSubmit={(event) => void submit(event)}>
          <HumanLookupField
            label="Cliente da ordem"
            htmlFor={fieldId}
            value={clientId}
            onChange={(id) => { setClientId(id); setError(null); }}
            search={searchClientsForLookup}
            required
            placeholder="Buscar por nome ou documento"
            emptyMessage="Nenhum cliente autorizado encontrado."
            emptyAction={{ label: 'Abrir clientes', to: '/app/clients' }}
            selectTestId="so-draft-client-select"
          />
          {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || !clientId}
              className="rounded bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? 'Vinculando…' : 'Confirmar cliente'}
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
