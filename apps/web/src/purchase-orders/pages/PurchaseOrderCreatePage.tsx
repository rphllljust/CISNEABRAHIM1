import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useState, type FormEvent } from 'react';
import { listClients } from '../../clients/api/clients-api';
import { createPurchaseOrder, PurchaseOrdersApiError } from '../api/purchase-orders-api';
import { mapPurchaseOrderErrorToMessage } from '../api/purchase-order-error-messages';
import { PurchaseOrderForm } from '../components/PurchaseOrderForm';
import { usePurchaseOrderCapabilities } from '../hooks/usePurchaseOrderCapabilities';
import {
  ModuleDeniedState,
  ModuleLoadingState,
  ModulePage,
  ModulePageHeader,
} from '../../ui/module-layout';
import {
  buildCreatePurchaseOrderPayload,
  EMPTY_PURCHASE_ORDER_FORM,
  validatePurchaseOrderForm,
  type PurchaseOrderFormFieldErrors,
  type PurchaseOrderFormValues,
} from '../utils/purchase-order-form-validation';

const CREATE_DESCRIPTION =
  'Registra o pedido do Cliente com as referências, o valor autorizado e os itens desta compra.';

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
      <ModulePage>
        <ModulePageHeader title="Novo pedido de compra" description={CREATE_DESCRIPTION} />
        <ModuleLoadingState title="Novo pedido de compra" message="Verificando permissões…" />
      </ModulePage>
    );
  }

  if (!capabilities.canCreate) {
    return (
      <ModulePage>
        <ModulePageHeader title="Novo pedido de compra" description={CREATE_DESCRIPTION} />
        <ModuleDeniedState
          title="Novo pedido de compra"
          message="Você não tem permissão para registrar pedidos de compra."
        />
        <p className="mt-3 mb-0">
          <Link className="button-link button-secondary" to="/app/purchase-orders">
            Voltar à lista
          </Link>
        </p>
      </ModulePage>
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
    <ModulePage>
      <ModulePageHeader title="Novo pedido de compra" description={CREATE_DESCRIPTION} />
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
    </ModulePage>
  );
}
