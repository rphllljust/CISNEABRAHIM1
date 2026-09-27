import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useState, type FormEvent } from 'react';
import { listClients } from '../../clients/api/clients-api';
import { createPurchaseOrder, PurchaseOrdersApiError } from '../api/purchase-orders-api';
import { mapPurchaseOrderErrorToMessage } from '../api/purchase-order-error-messages';
import { PurchaseOrderForm } from '../components/PurchaseOrderForm';
import { usePurchaseOrderCapabilities } from '../hooks/usePurchaseOrderCapabilities';
import {
  buildCreatePurchaseOrderPayload,
  EMPTY_PURCHASE_ORDER_FORM,
  validatePurchaseOrderForm,
  type PurchaseOrderFormFieldErrors,
  type PurchaseOrderFormValues,
} from '../utils/purchase-order-form-validation';

export function PurchaseOrderCreatePage() {
  const navigate = useNavigate();
  const { capabilities, loading: capabilitiesLoading } = usePurchaseOrderCapabilities();
  const [values, setValues] = useState<PurchaseOrderFormValues>(EMPTY_PURCHASE_ORDER_FORM);
  const [fieldErrors, setFieldErrors] = useState<PurchaseOrderFormFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [clients, setClients] = useState<{ id: string; label: string }[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    void listClients({ limit: 100, offset: 0 }, controller.signal)
      .then((response) => {
        setClients(
          response.items.map((client) => ({
            id: client.id,
            label: client.tradeName || client.legalName,
          })),
        );
      })
      .catch(() => setClients([]))
      .finally(() => {
        if (!controller.signal.aborted) {
          setClientsLoading(false);
        }
      });
    return () => controller.abort();
  }, []);

  if (capabilitiesLoading) {
    return (
      <main id="main-content" className="shell-page requests-page">
        <p className="text-sm text-gray-500" aria-busy="true" aria-live="polite">
          Verificando permissões…
        </p>
      </main>
    );
  }

  if (!capabilities.canCreate) {
    return (
      <main id="main-content" className="shell-page requests-page">
        <h1 className="m-0 text-2xl font-semibold tracking-tight text-gray-900">
          Novo pedido de compra
        </h1>
        <p className="text-sm text-red-700" role="alert">
          Você não tem permissão para registrar pedidos de compra.
        </p>
        <Link className="button-link button-secondary" to="/app/purchase-orders">
          Voltar à lista
        </Link>
      </main>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }

    const errors = validatePurchaseOrderForm(values);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setSubmitError(null);
      return;
    }

    setFieldErrors({});
    setSubmitError(null);
    setSubmitting(true);

    try {
      const created = await createPurchaseOrder(buildCreatePurchaseOrderPayload(values));
      void navigate(`/app/purchase-orders/${created.purchaseOrder.id}`, { replace: true });
    } catch (error) {
      if (error instanceof PurchaseOrdersApiError) {
        setSubmitError(mapPurchaseOrderErrorToMessage(error.code, error.status));
      } else {
        setSubmitError('Não foi possível registrar o pedido de compra.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main id="main-content" className="shell-page requests-page">
      <header className="requests-page__header">
        <div className="min-w-0">
          <h1 className="m-0 text-2xl font-semibold tracking-tight text-gray-900">
            Novo pedido de compra
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">
            Registra o pedido do Cliente com as referências, o valor autorizado e os itens desta
            compra.
          </p>
        </div>
      </header>
      <PurchaseOrderForm
        mode="create"
        values={values}
        clients={clients}
        clientsLoading={clientsLoading}
        fieldErrors={fieldErrors}
        submitError={submitError}
        submitting={submitting}
        onChange={setValues}
        onSubmit={(event) => void handleSubmit(event)}
        cancelHref="/app/purchase-orders"
      />
    </main>
  );
}
