import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useState, type FormEvent } from 'react';
import { ClientsApiError, listClients } from '../../clients/api/clients-api';
import { listServiceDefinitions, listServiceDefinitionVersions } from '../../catalog/api/service-catalog-api';
import {
  createServiceRequest,
  listOperationalUnits,
  registerOperationalUnit,
  ServiceRequestsApiError,
} from '../api/service-requests-api';
import { mapRequestErrorToMessage } from '../api/request-error-messages';
import { ServiceRequestForm } from '../components/ServiceRequestForm';
import { useServiceRequestCapabilities } from '../hooks/useServiceRequestCapabilities';
import {
  buildCreatePayload,
  EMPTY_SERVICE_REQUEST_FORM,
  validateServiceRequestForm,
  type ServiceRequestFormFieldErrors,
  type ServiceRequestFormValues,
} from '../utils/service-request-form-validation';

export function ServiceRequestCreatePage() {
  const navigate = useNavigate();
  const { capabilities, loading: capabilitiesLoading } = useServiceRequestCapabilities();
  const [values, setValues] = useState<ServiceRequestFormValues>(EMPTY_SERVICE_REQUEST_FORM);
  const [fieldErrors, setFieldErrors] = useState<ServiceRequestFormFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [clients, setClients] = useState<{ id: string; label: string }[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [units, setUnits] = useState<string[]>([]);
  const [services, setServices] = useState<{ id: string; versionId: string; label: string }[]>([]);

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
      .catch(() => {
        setClients([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setClientsLoading(false);
        }
      });
    void listOperationalUnits(controller.signal)
      .then((response) => setUnits(response.items))
      .catch(() => setUnits([]));
    void listServiceDefinitions({ limit: 100, offset: 0, status: 'ACTIVE' }, controller.signal)
      .then(async (response) => {
        const published = response.items.filter((item) => item.latestPublishedVersion !== null);
        const options = await Promise.all(
          published.map(async (item) => {
            const versions = await listServiceDefinitionVersions(item.id, controller.signal);
            const current = versions.find((version) => version.status === 'PUBLISHED');
            if (!current) {
              return null;
            }
            return { id: item.id, versionId: current.id, label: `${current.code} v${current.version}` };
          }),
        );
        if (!controller.signal.aborted) {
          setServices(options.filter((item): item is { id: string; versionId: string; label: string } => item !== null));
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setServices([]);
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
        <h1 className="m-0 text-2xl font-semibold tracking-tight text-gray-900">Nova solicitação</h1>
        <p className="text-sm text-red-700" role="alert">
          Você não tem permissão para registrar solicitações.
        </p>
        <Link className="button-link button-secondary" to="/app/requests">
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

    const errors = validateServiceRequestForm(values, 'create');
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setSubmitError(null);
      return;
    }

    setFieldErrors({});
    setSubmitError(null);
    setSubmitting(true);

    try {
      const created = await createServiceRequest(buildCreatePayload(values));
      void navigate(`/app/requests/${created.serviceRequest.id}`, { replace: true });
    } catch (error) {
      if (error instanceof ServiceRequestsApiError) {
        setSubmitError(mapRequestErrorToMessage(error.code, error.status));
      } else if (error instanceof ClientsApiError) {
        setSubmitError('Não foi possível validar Clientes autorizados.');
      } else {
        setSubmitError('Não foi possível registrar a solicitação.');
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
            Nova solicitação
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">
            Registra a demanda recebida com a origem, o Cliente ou contato externo e o serviço que
            deve atendê-la.
          </p>
        </div>
      </header>
      <ServiceRequestForm
        mode="create"
        values={values}
        clients={clients}
        clientsLoading={clientsLoading}
        units={units}
        services={services}
        fieldErrors={fieldErrors}
        submitError={submitError}
        submitting={submitting}
        onChange={setValues}
        onRegisterUnit={async (refId) => {
          const response = await registerOperationalUnit(refId);
          setUnits(response.items);
          return response.items;
        }}
        onSubmit={(event) => void handleSubmit(event)}
        cancelHref="/app/requests"
      />
    </main>
  );
}
