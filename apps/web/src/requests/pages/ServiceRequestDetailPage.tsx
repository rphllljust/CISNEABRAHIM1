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
import { ServiceRequestPriorityBadge } from '../components/ServiceRequestPriorityBadge';
import { ServiceRequestRelatedChain } from '../components/ServiceRequestRelatedChain';
import { ServiceRequestStatusBadge } from '../components/ServiceRequestStatusBadge';
import { ServiceRequestTimeline } from '../components/ServiceRequestTimeline';
import { VersionConflictNotice } from '../components/VersionConflictNotice';
import { useServiceRequestCapabilities } from '../hooks/useServiceRequestCapabilities';
import { useAuth } from '../../auth/context/AuthProvider';
import {
  SERVICE_REQUEST_PRIORITIES,
  type ServiceRequestDetail,
  type ServiceRequestReadiness,
  type ServiceRequestRelated,
  type ServiceRequestTransition,
} from '../types/service-request.types';
import {
  formatDateTime,
  formatExternalContact,
  formatRegisteredBy,
  formatServiceRequestBlocker,
  formatServiceRequestNextStep,
  formatServiceRequestOrigin,
  formatServiceRequestPriority,
  formatServiceRequestTransition,
} from '../utils/service-request-labels';
import {
  describeDesiredWindowTiming,
  describeServiceRequestAttention,
  formatDesiredWindow,
  formatRelativePast,
  summarizeServiceRequestDescription,
} from '../utils/service-request-workbench';
import { cn } from '../../ui/utils/cn';

type DetailState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'not_found' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; detail: ServiceRequestDetail };

const ATTENTION_TONE_CLASS: Record<string, string> = {
  critical: 'bg-red-50 text-red-700 ring-red-600/20',
  warning: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  info: 'bg-gray-100 text-gray-600 ring-gray-400/20',
};

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
  // Resiliência de leitura: payload sem os blocos derivados não quebra o workbench.
  const readiness: ServiceRequestReadiness = detail.readiness ?? {
    nextStep: 'CLOSED',
    nextStepTransition: null,
    availableTransitions: [],
    blockers: [],
  };
  const related: ServiceRequestRelated = detail.related ?? { client: null, service: null };
  const linkedChain = detail.linkedChain ?? [];
  const now = new Date();
  const attention = describeServiceRequestAttention(serviceRequest, now);
  const timing = describeDesiredWindowTiming(serviceRequest.desiredStartAt, now);
  const availableTransitions = readiness.availableTransitions;
  const canEdit = capabilities.canUpdate && availableTransitions.includes('submit');
  const primaryTransition = readiness.nextStepTransition;
  const availableSecondary = availableTransitions.filter(
    (transition) => transition !== primaryTransition,
  );

  function runTransition(transition: ServiceRequestTransition): void {
    if (transition === 'submit') {
      void runAction(async () => {
        await submitServiceRequest(serviceRequest.id, serviceRequest.rowVersion);
      });
      return;
    }
    if (transition === 'startReview') {
      void runAction(async () => {
        await startServiceRequestReview(serviceRequest.id, serviceRequest.rowVersion);
      });
      return;
    }
    if (transition === 'approve') {
      setApproveOpen(true);
      return;
    }
    if (transition === 'reject') {
      setRejectOpen(true);
      return;
    }
    if (transition === 'cancel') {
      setCancelOpen(true);
      return;
    }
    if (transition === 'convert') {
      void convertToServiceOrder();
    }
  }

  const serviceOrderLink = serviceRequest.convertedServiceOrderId
    ? `/app/service-orders/${serviceRequest.convertedServiceOrderId}/planning`
    : null;

  return (
    <main id="main-content" className="shell-page">
      <header className="border-b border-gray-200 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="cisne-type-page-title">{serviceRequest.requestCode}</h1>
              <ServiceRequestStatusBadge status={serviceRequest.status} />
              <ServiceRequestPriorityBadge priority={serviceRequest.priority} />
            </div>
            <p className="mt-1 text-sm font-medium text-gray-900">
              {related.client?.name ?? (
                <span className="text-gray-400">Cliente não identificado</span>
              )}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">
              {related.service?.label ?? summarizeServiceRequestDescription(serviceRequest.description, 90)}
              {' · '}
              {formatServiceRequestOrigin(serviceRequest.originSource)}
              {' · '}
              {formatDesiredWindow(serviceRequest.desiredStartAt, serviceRequest.desiredEndAt)}
              {timing ? ` (${timing.text})` : ''}
            </p>
          </div>

          <div className="flex flex-col items-end gap-2">
            {primaryTransition ? (
              <button
                type="button"
                disabled={actionSubmitting || readiness.blockers.length > 0}
                aria-describedby={
                  readiness.blockers.length > 0 ? 'request-readiness-blockers' : undefined
                }
                title={
                  readiness.blockers.length > 0
                    ? formatServiceRequestBlocker(readiness.blockers[0]!)
                    : undefined
                }
                onClick={() => runTransition(primaryTransition)}
              >
                {formatServiceRequestTransition(primaryTransition)}
              </button>
            ) : serviceOrderLink ? (
              <Link to={serviceOrderLink} className="button-link">
                Abrir ordem de serviço
              </Link>
            ) : (
              <span className="text-sm text-gray-500">
                {readiness.blockers.length > 0
                  ? 'Avanço bloqueado'
                  : 'Nenhuma ação disponível para o seu perfil'}
              </span>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2">
              {canEdit ? (
                <Link
                  to={`/app/requests/${serviceRequest.id}/edit`}
                  className="button-link button-secondary"
                >
                  Editar rascunho
                </Link>
              ) : null}
              {availableSecondary.map((transition) => (
                <button
                  key={transition}
                  type="button"
                  className="button-secondary"
                  disabled={actionSubmitting}
                  onClick={() => runTransition(transition)}
                >
                  {formatServiceRequestTransition(transition)}
                </button>
              ))}
            </div>
          </div>
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

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <section className="requests-section lg:col-span-2" aria-labelledby="request-context-heading">
          <h2 id="request-context-heading" className="cisne-type-section-title">
            Resumo operacional
          </h2>
          <dl className="requests-details sm:grid-cols-2">
            <div>
              <dt>Cliente</dt>
              <dd>
                {related.client ? (
                  <Link to={`/app/clients/${related.client.id}`}>{related.client.name}</Link>
                ) : (
                  <span className="text-gray-500">Não autorizado / não identificado</span>
                )}
              </dd>
            </div>
            <div>
              <dt>Serviço</dt>
              <dd>{related.service?.label ?? 'Não informado'}</dd>
            </div>
            <div>
              <dt>Unidade</dt>
              <dd>{serviceRequest.unitId}</dd>
            </div>
            <div>
              <dt>Local</dt>
              <dd>
                {[
                  serviceRequest.location?.label,
                  serviceRequest.location?.city,
                  serviceRequest.location?.state,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'Não informado'}
              </dd>
            </div>
            <div>
              <dt>Janela desejada</dt>
              <dd>
                {formatDesiredWindow(serviceRequest.desiredStartAt, serviceRequest.desiredEndAt)}
                {timing ? <span className="block text-xs text-gray-500">{timing.text}</span> : null}
              </dd>
            </div>
            <div>
              <dt>Origem</dt>
              <dd>
                {formatServiceRequestOrigin(serviceRequest.originSource)}
                {serviceRequest.externalOriginReference ? (
                  <span className="block text-xs text-gray-500">
                    Ref. externa {serviceRequest.externalOriginReference}
                  </span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>Contato externo</dt>
              <dd>{formatExternalContact(serviceRequest.externalContact)}</dd>
            </div>
            <div>
              <dt>Prioridade</dt>
              <dd>{formatServiceRequestPriority(serviceRequest.priority)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt>Demanda</dt>
              <dd>{serviceRequest.description ?? 'Sem descrição registrada'}</dd>
            </div>
            {serviceRequest.operationalNotes ? (
              <div className="sm:col-span-2">
                <dt>Observações operacionais</dt>
                <dd>{serviceRequest.operationalNotes}</dd>
              </div>
            ) : null}
            <div>
              <dt>Registrada por</dt>
              <dd>{formatRegisteredBy(serviceRequest.createdByIdentityId, identityId)}</dd>
            </div>
            <div>
              <dt>Criada em</dt>
              <dd>
                {formatDateTime(serviceRequest.createdAt)}
                <span className="block text-xs text-gray-500">
                  {formatRelativePast(serviceRequest.createdAt, now)}
                </span>
              </dd>
            </div>
          </dl>
        </section>

        <section className="requests-section" aria-labelledby="request-readiness-heading">
          <h2 id="request-readiness-heading" className="cisne-type-section-title">
            Próximo passo
          </h2>
          <p className="text-sm font-semibold text-gray-900">
            {formatServiceRequestNextStep(readiness.nextStep)}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Derivado do estado atual da solicitação e das suas permissões.
          </p>

          {readiness.blockers.length > 0 ? (
            <ul
              id="request-readiness-blockers"
              className="mt-3 space-y-1"
              aria-label="Bloqueios para avançar"
            >
              {readiness.blockers.map((blocker) => (
                <li
                  key={blocker}
                  className="rounded bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-600/20 ring-inset"
                >
                  {formatServiceRequestBlocker(blocker)}
                </li>
              ))}
            </ul>
          ) : null}

          <p className="mt-4 text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
            Sinais de atenção
          </p>
          {attention.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {attention.map((fact) => (
                <span
                  key={fact.code}
                  className={cn(
                    'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
                    ATTENTION_TONE_CLASS[fact.tone],
                  )}
                >
                  {fact.text}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-xs text-gray-500">Nenhum sinal derivável no momento.</p>
          )}

          {serviceRequest.rejectionReason ? (
            <div className="mt-4">
              <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
                Motivo da rejeição
              </p>
              <p className="text-sm text-gray-800">{serviceRequest.rejectionReason}</p>
            </div>
          ) : null}
          {serviceRequest.cancellationReason ? (
            <div className="mt-4">
              <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
                Motivo do cancelamento
              </p>
              <p className="text-sm text-gray-800">{serviceRequest.cancellationReason}</p>
            </div>
          ) : null}
        </section>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section className="requests-section" aria-labelledby="request-chain-heading">
          <h2 id="request-chain-heading" className="cisne-type-section-title">
            Cadeia relacionada
          </h2>
          <p className="mb-3 text-xs text-gray-500">
            Proposta, pedido de compra e ordens de serviço realmente vinculados. Cada elo aparece
            apenas se você puder consultá-lo no módulo responsável.
          </p>
          <ServiceRequestRelatedChain
            chain={linkedChain}
            hasUnidentifiedLinks={
              (serviceRequest.proposalId !== null ||
                serviceRequest.purchaseOrderId !== null ||
                serviceRequest.convertedServiceOrderId !== null) &&
              linkedChain.length === 0
            }
          />
        </section>

        <section className="requests-section" aria-labelledby="request-lifecycle-heading">
          <h2 id="request-lifecycle-heading" className="cisne-type-section-title">
            Histórico do ciclo
          </h2>
          <p className="mb-3 text-xs text-gray-500">
            Eventos registrados pelo domínio, do mais recente para o mais antigo.
          </p>
          <ServiceRequestTimeline
            events={detail.historyEvents}
            currentIdentityId={identityId ?? null}
          />
        </section>
      </div>

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

      <p className="mt-4">
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
