import { useId, useState, type FormEvent } from 'react';
import { HumanLookupField } from '../../financial-ui/HumanLookupField';
import { ServiceOrdersApiError, linkPublishedServiceToDraftOrder } from '../api/service-orders-api';
import { mapServiceOrdersErrorToMessage } from '../api/service-orders-error-messages';
import { searchPublishedServicesForLookup } from '../utils/service-order-relation-lookup';

export type ServiceOrderDraftServiceBindingProps = {
  serviceOrderId: string;
  rowVersion: number;
  onUpdated: () => Promise<void>;
};

/**
 * Recovery path for a persisted DRAFT OS whose authoritative control center
 * publishes SERVICE_DEFINITION_REQUIRED. Uses existing PATCH/rowVersion/audit;
 * never calls PREPARE itself, invents a status, or creates another OS.
 */
export function ServiceOrderDraftServiceBinding({
  serviceOrderId,
  rowVersion,
  onUpdated,
}: ServiceOrderDraftServiceBindingProps) {
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [definitionId, setDefinitionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!definitionId) {
      setError('Selecione uma definição publicada antes de continuar.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await linkPublishedServiceToDraftOrder(serviceOrderId, rowVersion, definitionId);
      // A new authorized read determines both the frozen catalog version
      // and whether PREPARE has become available. No optimistic transition.
      await onUpdated();
    } catch (cause) {
      if (cause instanceof ServiceOrdersApiError) {
        const message = mapServiceOrdersErrorToMessage(cause.code, cause.status);
        setError(cause.status === 409 ? message + ' A API recusou a alteração (HTTP 409). Recarregue a OS.' : message);
      } else {
        setError('Não foi possível vincular o serviço. Nenhuma alteração foi presumida.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Regularizar serviço da OS" className="mt-3 border-t border-gray-200 pt-3">
      <p className="m-0 text-sm text-amber-800" role="status">
        Preparação bloqueada: esta OS ainda precisa de definição e versão de serviço publicadas.
      </p>
      {!open ? (
        <button type="button" className="mt-2 text-sm font-semibold text-brand-700 underline"
          onClick={() => setOpen(true)}>
          Vincular serviço do catálogo
        </button>
      ) : (
        <form className="mt-3 space-y-3" onSubmit={(event) => void submit(event)}>
          <HumanLookupField
            label="Definição de serviço publicada"
            htmlFor={fieldId}
            value={definitionId}
            onChange={(id) => { setDefinitionId(id); setError(null); }}
            search={searchPublishedServicesForLookup}
            required
            placeholder="Buscar pelo nome ou código do serviço"
            emptyMessage="Nenhum serviço ativo e publicado encontrado."
            emptyAction={{ label: 'Abrir catálogo', to: '/app/catalog' }}
            selectTestId="so-draft-service-select"
          />
          {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || !definitionId}
              className="rounded bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? 'Vinculando…' : 'Vincular serviço'}
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
