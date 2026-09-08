import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCallback, useEffect, useId, useState } from 'react';
import { DocumentManagementPanel } from '../../documents/components/DocumentManagementPanel';
import { ConfirmDialog } from '../../clients/components/ConfirmDialog';
import {
  approveServiceRequest,
  cancelServiceRequest,
  convertServiceRequest,
  getServiceRequest,
  rejectServiceRequest,
  ServiceRequestsApiError,
  startServiceRequestReview,
  submitServiceRequest,
} from '../api/service-requests-api';
import { mapRequestErrorToMessage } from '../api/request-error-messages';
import { ServiceRequestStatusBadge } from '../components/ServiceRequestStatusBadge';
import { VersionConflictNotice } from '../components/VersionConflictNotice';
import { useServiceRequestCapabilities } from '../hooks/useServiceRequestCapabilities';
import { useAuth } from '../../auth/context/AuthProvider';
import {
  SERVICE_REQUEST_PRIORITIES,
  SERVICE_REQUEST_STATUSES,
  type ServiceRequestDetail,
  type ServiceRequestStatus,
} from '../types/service-request.types';
import {
  formatDateTime,
  formatExternalContact,
  formatRegisteredBy,
  formatServiceRequestOrigin,
} from '../utils/service-request-labels';

type DetailState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'not_found' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; detail: ServiceRequestDetail };

export function ServiceRequestDetailPage() {
  const { serviceRequestId = '' } = useParams();
  const navigate = useNavigate();
  const reasonId = useId();
  const { identityId } = useAuth();
  const { capabilities } = useServiceRequestCapabilities();
  const [state, setState] = useState<DetailState>({ phase: 'loading' });
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [versionConflict, setVersionConflict] = useState(false);
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [approvePriority, setApprovePriority] = useState<string>(SERVICE_REQUEST_PRIORITIES.Normal);

  const reload = useCallback(async () => {
    setState({ phase: 'loading' });
    setActionError(null);
    setActionSuccess(null);
    setVersionConflict(false);
    try {
      const detail = await getServiceRequest(serviceRequestId);
      setState({ phase: 'ready', detail });
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
    void reload();
  }, [reload]);

  async function runAction(action: () => Promise<void>): Promise<void> {
    if (state.phase !== 'ready') {
      return;
    }
    setActionSubmitting(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await action();
      await reload();
    } catch (error) {
      if (error instanceof ServiceRequestsApiError && error.kind === 'version_conflict') {
        setVersionConflict(true);
      }
      setActionError(
        error instanceof ServiceRequestsApiError
          ? mapRequestErrorToMessage(error.code, error.status)
          : 'Não foi possível concluir a operação.',
      );
    } finally {
      setActionSubmitting(false);
    }
  }

  async function convertToServiceOrder(): Promise<void> {
    if (state.phase !== 'ready' || actionSubmitting) {
      return;
    }
    setActionSubmitting(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const detail = await convertServiceRequest(serviceRequest.id, serviceRequest.rowVersion);
      const convertedServiceOrderId = detail.serviceRequest.convertedServiceOrderId;
      if (convertedServiceOrderId) {
        void navigate(`/app/service-orders/${convertedServiceOrderId}/planning`);
        return;
      }
      setState({ phase: 'ready', detail });
      setActionSuccess('Solicitação convertida em ordem de serviço.');
    } catch (error) {
      if (error instanceof ServiceRequestsApiError && error.kind === 'version_conflict') {
        setVersionConflict(true);
      }
      setActionError(
        error instanceof ServiceRequestsApiError
          ? mapRequestErrorToMessage(error.code, error.status)
          : 'Não foi possível converter a solicitação.',
      );
    } finally {
      setActionSubmitting(false);
    }
  }

  if (state.phase === 'loading') {
    return (
      <main id="main-content" className="shell-page">
        <p aria-busy="true" aria-live="polite">
          Carregando solicitação…
        </p>
      </main>
    );
  }

  if (state.phase === 'denied') {
    return (
      <main id="main-content" className="shell-page">
        <h1>Solicitação de serviço</h1>
        <p role="alert">Você não tem permissão para consultar esta solicitação.</p>
        <Link to="/app/requests">Voltar à lista</Link>
      </main>
    );
  }

  if (state.phase === 'not_found') {
    return (
      <main id="main-content" className="shell-page">
        <h1>Solicitação de serviço</h1>
        <p role="alert">Solicitação não encontrada.</p>
        <Link to="/app/requests">Voltar à lista</Link>
      </main>
    );
  }

  if (state.phase === 'error') {
    return (
      <main id="main-content" className="shell-page">
        <h1>Solicitação de serviço</h1>
        <p className="form-error" role="alert">
          {state.message}
        </p>
        <button type="button" onClick={() => void reload()}>
          Tentar novamente
        </button>
      </main>
    );
  }

  const detail = state.detail;
  const { serviceRequest } = detail;
  const canEdit =
    capabilities.canUpdate && serviceRequest.status === SERVICE_REQUEST_STATUSES.Draft;
  const canSubmit =
    capabilities.canSubmit && serviceRequest.status === SERVICE_REQUEST_STATUSES.Draft;
  const canReview =
    capabilities.canReview && serviceRequest.status === SERVICE_REQUEST_STATUSES.Submitted;
  const canApprove =
    capabilities.canApprove && serviceRequest.status === SERVICE_REQUEST_STATUSES.UnderReview;
  const canReject =
    capabilities.canReject && serviceRequest.status === SERVICE_REQUEST_STATUSES.UnderReview;
  const cancellableStatuses = new Set<ServiceRequestStatus>([
    SERVICE_REQUEST_STATUSES.Draft,
    SERVICE_REQUEST_STATUSES.Submitted,
    SERVICE_REQUEST_STATUSES.UnderReview,
    SERVICE_REQUEST_STATUSES.Approved,
  ]);
  const canCancel = capabilities.canCancel && cancellableStatuses.has(serviceRequest.status);
  const canConvert =
    serviceRequest.status === SERVICE_REQUEST_STATUSES.Approved &&
    !serviceRequest.convertedServiceOrderId;

  return (
    <main id="main-content" className="shell-page requests-page">
      <header className="requests-page__header">
        <div>
          <h1>{serviceRequest.requestCode}</h1>
          <ServiceRequestStatusBadge status={serviceRequest.status} />
        </div>
        <div className="button-row">
          {canEdit ? (
            <Link
              to={`/app/requests/${serviceRequest.id}/edit`}
              className="button-link button-secondary"
            >
              Editar rascunho
            </Link>
          ) : null}
          {canSubmit ? (
            <button
              type="button"
              disabled={actionSubmitting}
              onClick={() =>
                void runAction(async () => {
                  await submitServiceRequest(serviceRequest.id, serviceRequest.rowVersion);
                })
              }
            >
              Enviar
            </button>
          ) : null}
          {canReview ? (
            <button
              type="button"
              disabled={actionSubmitting}
              onClick={() =>
                void runAction(async () => {
                  await startServiceRequestReview(serviceRequest.id, serviceRequest.rowVersion);
                })
              }
            >
              Iniciar análise
            </button>
          ) : null}
          {canApprove ? (
            <button type="button" disabled={actionSubmitting} onClick={() => setApproveOpen(true)}>
              Aprovar
            </button>
          ) : null}
          {canReject ? (
            <button
              type="button"
              className="button-secondary"
              disabled={actionSubmitting}
              onClick={() => setRejectOpen(true)}
            >
              Rejeitar
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
          {canConvert ? (
            <button
              type="button"
              disabled={actionSubmitting}
              onClick={() => void convertToServiceOrder()}
            >
              Converter em OS
            </button>
          ) : null}
        </div>
      </header>

      {actionError ? (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      ) : null}
      {actionSuccess ? (
        <p className="form-notice" role="status">
          {actionSuccess}
        </p>
      ) : null}
      {versionConflict ? <VersionConflictNotice onReload={() => void reload()} /> : null}

      <section className="requests-section" aria-labelledby="request-origin-detail-heading">
        <h2 id="request-origin-detail-heading">Origem da solicitação</h2>
        <dl className="requests-details">
          <div>
            <dt>Canal / fonte</dt>
            <dd>{formatServiceRequestOrigin(serviceRequest.originSource)}</dd>
          </div>
          <div>
            <dt>Contato externo</dt>
            <dd>{formatExternalContact(serviceRequest.externalContact)}</dd>
          </div>
          <div>
            <dt>Referência externa</dt>
            <dd>{serviceRequest.externalOriginReference ?? '—'}</dd>
          </div>
        </dl>
      </section>

      <section className="requests-section" aria-labelledby="request-registered-heading">
        <h2 id="request-registered-heading">Registrado por</h2>
        <dl className="requests-details">
          <div>
            <dt>Usuário interno</dt>
            <dd>{formatRegisteredBy(serviceRequest.createdByIdentityId, identityId)}</dd>
          </div>
          <div>
            <dt>Registrado em</dt>
            <dd>{formatDateTime(serviceRequest.createdAt)}</dd>
          </div>
        </dl>
      </section>

      <section className="requests-section" aria-labelledby="request-demand-heading">
        <h2 id="request-demand-heading">Demanda</h2>
        <dl className="requests-details">
          <div>
            <dt>Cliente</dt>
            <dd>
              {serviceRequest.clientId ? (
                <Link to={`/app/clients/${serviceRequest.clientId}`}>Ver Cliente</Link>
              ) : (
                'Não identificado'
              )}
            </dd>
          </div>
          <div>
            <dt>Unidade</dt>
            <dd>{serviceRequest.unitId}</dd>
          </div>
          <div>
            <dt>Descrição</dt>
            <dd>{serviceRequest.description ?? '—'}</dd>
          </div>
          <div>
            <dt>Prioridade</dt>
            <dd>{serviceRequest.priority ?? '—'}</dd>
          </div>
          <div>
            <dt>Período desejado</dt>
            <dd>
              {formatDateTime(serviceRequest.desiredStartAt)} —{' '}
              {formatDateTime(serviceRequest.desiredEndAt)}
            </dd>
          </div>
          <div>
            <dt>Observações operacionais</dt>
            <dd>{serviceRequest.operationalNotes ?? '—'}</dd>
          </div>
        </dl>
      </section>

      {serviceRequest.rejectionReason ? (
        <section className="requests-section" aria-labelledby="request-rejection-heading">
          <h2 id="request-rejection-heading">Rejeição</h2>
          <p>{serviceRequest.rejectionReason}</p>
          <p className="form-hint">Rejeitada em {formatDateTime(serviceRequest.rejectedAt)}</p>
        </section>
      ) : null}

      {serviceRequest.cancellationReason ? (
        <section className="requests-section" aria-labelledby="request-cancel-heading">
          <h2 id="request-cancel-heading">Cancelamento</h2>
          <p>{serviceRequest.cancellationReason}</p>
          <p className="form-hint">Cancelada em {formatDateTime(serviceRequest.cancelledAt)}</p>
        </section>
      ) : null}

      {serviceRequest.convertedServiceOrderId ? (
        <section className="requests-section" aria-labelledby="request-service-order-heading">
          <h2 id="request-service-order-heading">Ordem de serviço</h2>
          <p>
            <Link to={`/app/service-orders/${serviceRequest.convertedServiceOrderId}/planning`}>
              Abrir planejamento e alocação
            </Link>
          </p>
        </section>
      ) : null}

      {serviceRequest.proposalId ? (
        <section className="requests-section" aria-labelledby="request-proposal-heading">
          <h2 id="request-proposal-heading">Proposta comercial</h2>
          <p>
            <Link to={`/app/proposals/${serviceRequest.proposalId}`}>Ver proposta vinculada</Link>
          </p>
        </section>
      ) : null}

      {serviceRequest.purchaseOrderId ? (
        <section className="requests-section" aria-labelledby="request-po-heading">
          <h2 id="request-po-heading">Pedido de compra</h2>
          <p>
            <Link to={`/app/purchase-orders/${serviceRequest.purchaseOrderId}`}>
              Ver pedido de compra vinculado
            </Link>
          </p>
        </section>
      ) : null}

      <DocumentManagementPanel
        scope={{
          kind: 'SERVICE_REQUEST',
          unitId: serviceRequest.unitId,
          entityId: serviceRequest.id,
          entityLabel: serviceRequest.requestCode,
        }}
        links={detail.documentLinks.map((link) => ({
          id: link.id,
          documentId: link.documentId,
          linkPurpose: link.linkPurpose,
          createdAt: link.createdAt,
        }))}
        onLinksChange={(links) =>
          setState({
            phase: 'ready',
            detail: {
              ...detail,
              documentLinks: links.map((link) => ({
                id: link.id ?? link.documentId,
                documentId: link.documentId,
                linkPurpose: link.linkPurpose ?? 'EVIDENCE',
                createdAt: link.createdAt ?? new Date().toISOString(),
              })),
            },
          })
        }
      />

      <p>
        <Link to="/app/requests">Voltar à lista</Link>
      </p>

      <ConfirmDialog
        open={rejectOpen}
        title="Rejeitar solicitação"
        description="Informe o motivo da rejeição. Esta ação não pode ser desfeita."
        confirmLabel="Confirmar rejeição"
        confirmDisabled={!rejectReason.trim() || actionSubmitting}
        onCancel={() => {
          setRejectOpen(false);
          setRejectReason('');
        }}
        onConfirm={() => {
          void runAction(async () => {
            await rejectServiceRequest(
              serviceRequest.id,
              serviceRequest.rowVersion,
              rejectReason.trim(),
            );
            setRejectOpen(false);
            setRejectReason('');
          });
        }}
      >
        <div className="form-field">
          <label htmlFor={reasonId}>Motivo da rejeição</label>
          <textarea
            id={reasonId}
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            rows={3}
            required
          />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={cancelOpen}
        title="Cancelar solicitação"
        description="Informe o motivo do cancelamento."
        confirmLabel="Confirmar cancelamento"
        confirmDisabled={!cancelReason.trim() || actionSubmitting}
        onCancel={() => {
          setCancelOpen(false);
          setCancelReason('');
        }}
        onConfirm={() => {
          void runAction(async () => {
            await cancelServiceRequest(
              serviceRequest.id,
              serviceRequest.rowVersion,
              cancelReason.trim(),
            );
            setCancelOpen(false);
            setCancelReason('');
          });
        }}
      >
        <div className="form-field">
          <label htmlFor={`${reasonId}-cancel`}>Motivo do cancelamento</label>
          <textarea
            id={`${reasonId}-cancel`}
            value={cancelReason}
            onChange={(event) => setCancelReason(event.target.value)}
            rows={3}
            required
          />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={approveOpen}
        title="Aprovar solicitação"
        description="Defina a prioridade operacional, se necessário."
        confirmLabel="Confirmar aprovação"
        confirmDisabled={actionSubmitting}
        onCancel={() => setApproveOpen(false)}
        onConfirm={() => {
          void runAction(async () => {
            await approveServiceRequest(
              serviceRequest.id,
              serviceRequest.rowVersion,
              approvePriority as (typeof SERVICE_REQUEST_PRIORITIES)[keyof typeof SERVICE_REQUEST_PRIORITIES],
            );
            setApproveOpen(false);
          });
        }}
      >
        <div className="form-field">
          <label htmlFor={`${reasonId}-priority`}>Prioridade</label>
          <select
            id={`${reasonId}-priority`}
            value={approvePriority}
            onChange={(event) => setApprovePriority(event.target.value)}
          >
            {Object.values(SERVICE_REQUEST_PRIORITIES).map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </select>
        </div>
      </ConfirmDialog>
    </main>
  );
}
