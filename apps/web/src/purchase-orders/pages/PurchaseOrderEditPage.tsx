import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { listClients } from '../../clients/api/clients-api';
import { useOperationalUnits } from '../../shell/hooks/useOperationalUnits';
import {
  getPurchaseOrder,
  PurchaseOrdersApiError,
  updatePurchaseOrderDraft,
} from '../api/purchase-orders-api';
import { mapPurchaseOrderErrorToMessage } from '../api/purchase-order-error-messages';
import { PurchaseOrderForm } from '../components/PurchaseOrderForm';
import { VersionConflictNotice } from '../components/VersionConflictNotice';
import { usePurchaseOrderCapabilities } from '../hooks/usePurchaseOrderCapabilities';
import {
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModulePageHeader,
} from '../../ui/module-layout';
import { PURCHASE_ORDER_STATUSES } from '../types/purchase-order.types';
import {
  buildUpdatePurchaseOrderPayload,
  createPurchaseOrderItemRow,
  EMPTY_PURCHASE_ORDER_FORM,
  validatePurchaseOrderForm,
  type PurchaseOrderFormFieldErrors,
  type PurchaseOrderFormValues,
} from '../utils/purchase-order-form-validation';

export function PurchaseOrderEditPage() {
  const { purchaseOrderId = '' } = useParams();
  const navigate = useNavigate();
  const { options: unitOptions } = useOperationalUnits();
  const { capabilities } = usePurchaseOrderCapabilities();
  const [values, setValues] = useState<PurchaseOrderFormValues>(EMPTY_PURCHASE_ORDER_FORM);
  const [rowVersion, setRowVersion] = useState(0);
  const [internalCode, setInternalCode] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<PurchaseOrderFormFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [versionConflict, setVersionConflict] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [clients, setClients] = useState<{ id: string; label: string }[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setVersionConflict(false);
    try {
      const detail = await getPurchaseOrder(purchaseOrderId);
      const po = detail.purchaseOrder;
      if (po.status !== PURCHASE_ORDER_STATUSES.Draft) {
        setCanEdit(false);
        setLoading(false);
        return;
      }
      setCanEdit(true);
      setInternalCode(po.internalCode);
      setPoNumber(po.poNumber);
      setRowVersion(po.rowVersion);
      setValues({
        clientId: po.clientId,
        unitId: po.unitId,
        poNumber: po.poNumber,
        rcNumber: po.rcNumber ?? '',
        issueDate: po.issueDate ?? '',
        serviceManager: po.serviceManager ?? '',
        currencyCode: po.currencyCode,
        pricingStructure: po.pricingStructure,
        totalAmount: po.totalAmount ?? '',
        paymentTerms: po.paymentTerms ?? '',
        paymentMethod: po.paymentMethod ?? '',
        items: detail.items.map((item) =>
          createPurchaseOrderItemRow(item.description, item.lineTotal ?? ''),
        ),
      });
    } catch (error) {
      setLoadError(
        error instanceof PurchaseOrdersApiError
          ? mapPurchaseOrderErrorToMessage(error.code, error.status)
          : 'Não foi possível carregar o pedido.',
      );
    } finally {
      setLoading(false);
    }
  }, [purchaseOrderId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  if (loading) {
    return (
      <ModulePage>
        <ModulePageHeader title="Editar pedido de compra" />
        <ModuleLoadingState title="Editar pedido de compra" message="Carregando pedido…" />
      </ModulePage>
    );
  }

  if (loadError) {
    return (
      <ModulePage>
        <ModulePageHeader title="Editar pedido de compra" />
        <ModuleErrorState
          title="Editar pedido de compra"
          message={loadError}
          retryable
          onRetry={() => void load()}
        />
      </ModulePage>
    );
  }

  if (!capabilities.canUpdate || !canEdit) {
    return (
      <ModulePage>
        <ModulePageHeader title="Editar pedido de compra" />
        <ModuleDeniedState
          title="Editar pedido de compra"
          message="Este pedido não pode ser editado no status atual ou você não tem permissão."
        />
        <p className="mt-3 mb-0">
          <Link to={`/app/purchase-orders/${purchaseOrderId}`}>Voltar ao detalhe</Link>
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
      await updatePurchaseOrderDraft(
        purchaseOrderId,
        buildUpdatePurchaseOrderPayload(values, rowVersion),
      );
      void navigate(`/app/purchase-orders/${purchaseOrderId}`, { replace: true });
    } catch (error) {
      if (error instanceof PurchaseOrdersApiError && error.kind === 'version_conflict') {
        setVersionConflict(true);
      }
      setSubmitError(
        error instanceof PurchaseOrdersApiError
          ? mapPurchaseOrderErrorToMessage(error.code, error.status)
          : 'Não foi possível salvar o pedido.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModulePage>
      <ModulePageHeader
        title={internalCode ? `Editar ${internalCode}` : 'Editar pedido de compra'}
        description={
          poNumber
            ? `Pedido ${poNumber} em rascunho; o servidor recusa alterações concorrentes.`
            : 'Atualiza o rascunho do pedido; o servidor recusa alterações concorrentes.'
        }
        action={
          <Link
            to={`/app/purchase-orders/${purchaseOrderId}`}
            className="inline-flex min-h-9 items-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-700 no-underline ring-1 ring-gray-300 ring-inset hover:bg-gray-50"
          >
            Voltar ao detalhe
          </Link>
        }
      />
      {versionConflict ? <VersionConflictNotice onReload={() => void load()} /> : null}
      <PurchaseOrderForm
        mode="edit"
        values={values}
        clients={clients}
        clientsLoading={clientsLoading}
        unitOptions={unitOptions}
        fieldErrors={fieldErrors}
        submitError={submitError}
        submitting={submitting}
        onChange={setValues}
        onSubmit={(event) => void handleSubmit(event)}
        cancelHref={`/app/purchase-orders/${purchaseOrderId}`}
      />
    </ModulePage>
  );
}
