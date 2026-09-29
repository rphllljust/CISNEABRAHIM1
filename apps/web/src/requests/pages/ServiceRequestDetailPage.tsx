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
import { ServiceRequestTimeline } from '../components/ServiceRequestTimeline';
import { VersionConflictNotice } from '../components/VersionConflictNotice';
import { useServiceRequestCapabilities } from '../hooks/useServiceRequestCapabilities';
import { useAuth } from '../../auth/context/AuthProvider';
import {
  SERVICE_REQUEST_PRIORITIES,
  SERVICE_REQUEST_STATUSES,
  type ServiceRequestDetail,
  type ServiceRequestReadiness,
  type ServiceRequestRelated,
  type ServiceRequestStatus,
  type ServiceRequestTransition,
} from '../types/service-request.types';
import {
  formatDateTime,
  formatExternalContact,
  formatRegisteredBy,
  formatServiceRequestBlocker,
  formatServiceRequestNextStep,
  formatServiceRequestOrigin,
  formatServiceRequestStatus,
  formatServiceRequestTransition,
} from '../utils/service-request-labels';
import {
  describeDesiredWindowTiming,
  describeServiceRequestAttention,
  formatDesiredWindow,
  formatRelativePast,
  summarizeServiceRequestDescription,
} from '../utils/service-request-workbench';
import {
  EnterpriseObjectHeader,
  EnterpriseObjectPage,
  NextActionPanel,
  ObjectPanel,
  type NextAction,
  type ObjectAction,
  type ObjectMetadataField,
} from '../../enterprise-object';
import type { StatusBadgeTone } from '../../ui/StatusBadge';
import { DefinitionList } from '../../financial-ui/DefinitionList';
import { ModulePage, ModulePageHeader, UnitScopeLabel } from '../../ui';
import { cn } from '../../ui/utils/cn';

/**
 * OBJECT PAGE DA SOLICITAÇÃO DE SERVIÇO — leitura canônica do contrato `enterprise-object`.
 *
 *   breadcrumb (Solicitações -> Solicitação)
 *     EnterpriseObjectHeader   código, cliente, estado, prioridade e ações do ciclo
 *     NextActionPanel          declarado SOMENTE quando o próximo passo não é um botão desta tela
 *     corpo + coluna lateral   resumo compacto, cadeia, histórico e decisões pendentes
 *
 * A MÁQUINA DE ESTADOS NÃO É RECONSTRUÍDA AQUI. Quais transições existem em cada situação e
 * qual é o próximo passo chegam prontos do servidor (`readiness.availableTransitions` e
 * `readiness.nextStep`): a tela apenas nomeia e oferece o que o backend autorizou. Nenhuma
 * etapa é inventada no front e nenhuma chamada de API muda.
 */

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

const STATUS_TONES: Record<ServiceRequestStatus, StatusBadgeTone> = {
  [SERVICE_REQUEST_STATUSES.Draft]: 'neutral',
  [SERVICE_REQUEST_STATUSES.Submitted]: 'info',
  [SERVICE_REQUEST_STATUSES.UnderReview]: 'info',
  [SERVICE_REQUEST_STATUSES.Approved]: 'success',
  [SERVICE_REQUEST_STATUSES.Rejected]: 'error',
  [SERVICE_REQUEST_STATUSES.Cancelled]: 'neutral',
  [SERVICE_REQUEST_STATUSES.Converted]: 'operational',
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

  if (state.phase !== 'ready') {
    /*
     * ESTADOS DE PAGINA — a solicitação é identificada pelo CÓDIGO, que já está na rota mesmo
     * quando o payload não chegou: carregando, negado ou com falha, o operador continua sabendo
     * de que tela se trata. Negação não se confunde com registro vazio e a falha oferece nova
     * tentativa real.
     */
    const denied = state.phase === 'denied';
    const notFound = state.phase === 'not_found';

    return (
      <ModulePage>
        <ModulePageHeader title="Solicitação de serviço" />
        <EnterpriseObjectPage
          breadcrumb={[
            { label: 'Solicitações', href: '/app/requests' },
            { label: 'Solicitação' },
          ]}
          phase={
            denied ? 'denied' : notFound ? 'empty' : state.phase === 'loading' ? 'loading' : 'error'
          }
          phaseTitle="Solicitação de serviço"
          phaseMessage={
            state.phase === 'error'
              ? state.message
              : denied
                ? 'Você não tem permissão para consultar esta solicitação.'
                : notFound
                  ? 'Solicitação não encontrada.'
                  : 'Carregando solicitação…'
          }
          onRetry={state.phase === 'error' ? () => void reload() : undefined}
          header={null}
        />
      </ModulePage>
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

  const blocked = readiness.blockers.length > 0;

  /*
   * AÇÃO PRIMÁRIA — o próximo passo REAL do ciclo, autorizado pelo servidor. Quando a
   * solicitação já virou ordem de serviço, a ação primária é abrir a ordem.
   */
  const primaryAction: ObjectAction | null = primaryTransition
    ? {
        id: primaryTransition,
        label: formatServiceRequestTransition(primaryTransition),
        disabled: actionSubmitting || blocked,
        disabledReason: blocked ? formatServiceRequestBlocker(readiness.blockers[0]!) : undefined,
        onSelect: () => runTransition(primaryTransition),
      }
    : serviceOrderLink
      ? {
          id: 'open-service-order',
          label: 'Abrir ordem de serviço',
          to: serviceOrderLink,
        }
      : null;

  const secondaryActions: ObjectAction[] = [
    ...(canEdit
      ? [
          {
            id: 'edit',
            label: 'Editar rascunho',
            onSelect: () => {
              void navigate(`/app/requests/${serviceRequest.id}/edit`);
            },
          },
        ]
      : []),
    ...availableSecondary.map((transition) => ({
      id: transition,
      label: formatServiceRequestTransition(transition),
      disabled: actionSubmitting,
      onSelect: () => runTransition(transition),
    })),
  ];

  /**
   * PRÓXIMA AÇÃO — declarada SOMENTE quando não existe comando autorizado nesta tela.
   * Um bloqueio do domínio e uma ausência de permissão são fatos diferentes e são declarados
   * como fatos, nunca como botão que o servidor recusaria.
   */
  const nextAction: NextAction | null =
    primaryAction !== null
      ? null
      : blocked
        ? {
            kind: 'waiting',
            label: 'Avanço bloqueado',
            description: formatServiceRequestBlocker(readiness.blockers[0]!),
          }
        : {
            kind: 'waiting',
            label: 'Nenhuma ação disponível para o seu perfil',
            description:
              'Nenhuma transição do ciclo está autorizada para o seu perfil no estado atual da solicitação.',
          };

  const metadata: ObjectMetadataField[] = [
    {
      label: 'Prioridade',
      value: <ServiceRequestPriorityBadge priority={serviceRequest.priority} />,
    },
    { label: 'Origem', value: formatServiceRequestOrigin(serviceRequest.originSource) },
    {
      label: 'Janela desejada',
      value: formatDesiredWindow(serviceRequest.desiredStartAt, serviceRequest.desiredEndAt),
    },
    { label: 'Criada em', value: formatDateTime(serviceRequest.createdAt) },
    { label: 'Registrada por', value: formatRegisteredBy(serviceRequest.createdByIdentityId, identityId) },
  ];

  return (
    <ModulePage>
      <EnterpriseObjectPage
        breadcrumb={[
          { label: 'Solicitações', href: '/app/requests' },
          { label: serviceRequest.requestCode },
        ]}
        header={
          <EnterpriseObjectHeader
            // A IDENTIDADE do operador é o código da solicitação; cliente e serviço qualificam.
            title={serviceRequest.requestCode}
            subtitle={[
              related.client?.name,
              related.service?.label ??
                summarizeServiceRequestDescription(serviceRequest.description, 90),
            ]
              .filter(Boolean)
              .join(' · ')}
            status={{
              label: formatServiceRequestStatus(serviceRequest.status),
              tone: STATUS_TONES[serviceRequest.status],
            }}
            metadata={metadata}
            primaryAction={primaryAction}
            secondaryActions={secondaryActions}
          />
        }
        nextAction={<NextActionPanel action={nextAction} />}
        aside={
          <>
            <ObjectPanel title="Próximo passo">
              <p className="m-0 text-sm font-semibold text-gray-900">
                {formatServiceRequestNextStep(readiness.nextStep)}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Derivado do estado atual da solicitação e das suas permissões.
              </p>

              {blocked ? (
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

              <p className="mt-3 text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
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
                <div className="mt-3">
                  <p className="m-0 text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
                    Motivo da rejeição
                  </p>
                  <p className="text-sm text-gray-800">{serviceRequest.rejectionReason}</p>
                </div>
              ) : null}
              {serviceRequest.cancellationReason ? (
                <div className="mt-3">
                  <p className="m-0 text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
                    Motivo do cancelamento
                  </p>
                  <p className="text-sm text-gray-800">{serviceRequest.cancellationReason}</p>
                </div>
              ) : null}
            </ObjectPanel>
          </>
        }
      >
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

        <ObjectPanel title="Resumo operacional">
          <DefinitionList
            items={[
              {
                label: 'Cliente',
                value: related.client ? (
                  <Link to={`/app/clients/${related.client.id}`}>{related.client.name}</Link>
                ) : (
                  <span className="text-gray-500">Não autorizado / não identificado</span>
                ),
              },
              { label: 'Serviço', value: related.service?.label ?? 'Não informado' },
              // O `unitId` é dado interno (em HML, um slug sintético): declara-se o ESCOPO.
              { label: 'Unidade', value: <UnitScopeLabel unitId={serviceRequest.unitId} /> },
              { label: 'Local', value: formatServiceRequestLocation(serviceRequest) },
              {
                label: 'Janela desejada',
                value: (
                  <>
                    {formatDesiredWindow(serviceRequest.desiredStartAt, serviceRequest.desiredEndAt)}
                    {timing ? <span className="block text-xs text-gray-500">{timing.text}</span> : null}
                  </>
                ),
              },
              {
                label: 'Origem',
                value: (
                  <>
                    {formatServiceRequestOrigin(serviceRequest.originSource)}
                    {serviceRequest.externalOriginReference ? (
                      <span className="block text-xs text-gray-500">
                        Ref. externa {serviceRequest.externalOriginReference}
                      </span>
                    ) : null}
                  </>
                ),
              },
              { label: 'Contato externo', value: formatExternalContact(serviceRequest.externalContact) },
              {
                label: 'Criada em',
                value: (
                  <>
                    {formatDateTime(serviceRequest.createdAt)}
                    <span className="block text-xs text-gray-500">
                      {formatRelativePast(serviceRequest.createdAt, now)}
                    </span>
                  </>
                ),
              },
              {
                label: 'Demanda',
                value: serviceRequest.description ?? 'Sem descrição registrada',
              },
              ...(serviceRequest.operationalNotes
                ? [{ label: 'Observações operacionais', value: serviceRequest.operationalNotes }]
                : []),
            ]}
          />
        </ObjectPanel>

        <ObjectPanel title="Cadeia relacionada">
          <p className="m-0 mb-3 text-xs text-gray-500">
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
        </ObjectPanel>

        <ObjectPanel title="Histórico do ciclo">
          <p className="m-0 mb-3 text-xs text-gray-500">
            Eventos registrados pelo domínio, do mais recente para o mais antigo.
          </p>
          <ServiceRequestTimeline
            events={detail.historyEvents}
            currentIdentityId={identityId ?? null}
          />
        </ObjectPanel>

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
      </EnterpriseObjectPage>

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
    </ModulePage>
  );
}

/**
 * LOCAL — o vínculo é exibido pelo rótulo humano (`location.label`/cidade/estado) que o
 * payload carrega. Nada de derivar local a partir de identificador técnico.
 */
function formatServiceRequestLocation(
  serviceRequest: ServiceRequestDetail['serviceRequest'],
): string {
  const parts = [
    serviceRequest.location?.label,
    serviceRequest.location?.city,
    serviceRequest.location?.state,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'Não informado';
}
