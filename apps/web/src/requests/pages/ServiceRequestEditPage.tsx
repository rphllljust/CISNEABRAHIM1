import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { listClients } from '../../clients/api/clients-api';
import {
  getServiceRequest,
  ServiceRequestsApiError,
  updateServiceRequestDraft,
} from '../api/service-requests-api';
import { mapRequestErrorToMessage } from '../api/request-error-messages';
import { ServiceRequestForm } from '../components/ServiceRequestForm';
import { VersionConflictNotice } from '../components/VersionConflictNotice';
import { useServiceRequestCapabilities } from '../hooks/useServiceRequestCapabilities';
import { SERVICE_REQUEST_STATUSES } from '../types/service-request.types';
import {
  buildUpdatePayload,
  toDatetimeLocalValue,
  validateServiceRequestForm,
  type ServiceRequestFormFieldErrors,
  type ServiceRequestFormValues,
} from '../utils/service-request-form-validation';

type EditState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'not_found' }
  | { phase: 'invalid_state' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; values: ServiceRequestFormValues; rowVersion: number };

export function ServiceRequestEditPage() {
  const { serviceRequestId = '' } = useParams();
  const navigate = useNavigate();
  const { capabilities } = useServiceRequestCapabilities();
  const [state, setState] = useState<EditState>({ phase: 'loading' });
  const [fieldErrors, setFieldErrors] = useState<ServiceRequestFormFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [versionConflict, setVersionConflict] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [clients, setClients] = useState<{ id: string; label: string }[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);

  const load = useCallback(async () => {
    setState({ phase: 'loading' });
    setVersionConflict(false);
    setSubmitError(null);
    try {
      const detail = await getServiceRequest(serviceRequestId);
      const request = detail.serviceRequest;
      if (request.status !== SERVICE_REQUEST_STATUSES.Draft) {
        setState({ phase: 'invalid_state' });
        return;
      }
      setState({
        phase: 'ready',
        rowVersion: request.rowVersion,
        values: {
          unitId: request.unitId,
          originSource: request.originSource,
          externalContactName: request.externalContact.name ?? '',
          externalContactEmail: request.externalContact.email ?? '',
          externalContactPhone: request.externalContact.phone ?? '',
          externalOriginReference: request.externalOriginReference ?? '',
          clientId: request.clientId ?? '',
          description: request.description ?? '',
          locationLabel: request.location.label ?? '',
          locationStreet: request.location.street ?? '',
          locationCity: request.location.city ?? '',
          locationState: request.location.state ?? '',
          desiredStartAt: toDatetimeLocalValue(request.desiredStartAt),
          desiredEndAt: toDatetimeLocalValue(request.desiredEndAt),
          operationalNotes: request.operationalNotes ?? '',
          serviceDefinitionId: request.serviceDefinitionId ?? '',
          serviceDefinitionVersionId: request.serviceDefinitionVersionId ?? '',
        },
      });
    } catch (error) {
      if (error instanceof ServiceRequestsApiError) {
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
          error instanceof ServiceRequestsApiError
            ? mapRequestErrorToMessage(error.code, error.status)
            : 'Não foi possível carregar a solicitação.',
      });
    }
  }, [serviceRequestId]);

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

  if (state.phase === 'loading') {
    return (
      <main id="main-content" className="shell-page">
        <p aria-busy="true" aria-live="polite">
          Carregando solicitação…
        </p>
      </main>
    );
  }

  if (state.phase === 'denied' || !capabilities.canUpdate) {
    return (
      <main id="main-content" className="shell-page">
        <h1>Editar solicitação</h1>
        <p role="alert">Você não tem permissão para editar esta solicitação.</p>
        <Link to={`/app/requests/${serviceRequestId}`}>Voltar ao detalhe</Link>
      </main>
    );
  }

  if (state.phase === 'not_found') {
    return (
      <main id="main-content" className="shell-page">
        <h1>Editar solicitação</h1>
        <p role="alert">Solicitação não encontrada.</p>
        <Link to="/app/requests">Voltar à lista</Link>
      </main>
    );
  }

  if (state.phase === 'invalid_state') {
    return (
      <main id="main-content" className="shell-page">
        <h1>Editar solicitação</h1>
        <p role="alert">Somente solicitações em rascunho podem ser editadas.</p>
        <Link to={`/app/requests/${serviceRequestId}`}>Voltar ao detalhe</Link>
      </main>
    );
  }

  if (state.phase === 'error') {
    return (
      <main id="main-content" className="shell-page">
        <h1>Editar solicitação</h1>
        <p className="form-error" role="alert">
          {state.message}
        </p>
        <button type="button" onClick={() => void load()}>
          Tentar novamente
        </button>
      </main>
    );
  }

  if (state.phase !== 'ready') {
    return null;
  }

  const { values, rowVersion } = state;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }

    const errors = validateServiceRequestForm(values, 'edit');
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setSubmitError(null);
      return;
    }

    setFieldErrors({});
    setSubmitError(null);
    setSubmitting(true);

    try {
      await updateServiceRequestDraft(
        serviceRequestId,
        buildUpdatePayload(values, rowVersion),
      );
      void navigate(`/app/requests/${serviceRequestId}`, { replace: true });
    } catch (error) {
      if (error instanceof ServiceRequestsApiError && error.kind === 'version_conflict') {
        setVersionConflict(true);
        setSubmitError(null);
      } else {
        setSubmitError(
          error instanceof ServiceRequestsApiError
            ? mapRequestErrorToMessage(error.code, error.status)
            : 'Não foi possível salvar o rascunho.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main id="main-content" className="shell-page requests-page">
      <header className="requests-page__header">
        <h1>Editar rascunho</h1>
      </header>
      {versionConflict ? <VersionConflictNotice onReload={() => void load()} /> : null}
      <ServiceRequestForm
        mode="edit"
        values={values}
        clients={clients}
        clientsLoading={clientsLoading}
        fieldErrors={fieldErrors}
        submitError={submitError}
        submitting={submitting}
        onChange={(nextValues) => {
          setState({ phase: 'ready', rowVersion, values: nextValues });
        }}
        onSubmit={(event) => void handleSubmit(event)}
        cancelHref={`/app/requests/${serviceRequestId}`}
      />
    </main>
  );
}
