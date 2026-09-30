import { useParams } from 'react-router-dom';
import { useCallback, useEffect, useId, useState } from 'react';
import { ConfirmDialog } from '../../clients/components/ConfirmDialog';
import {
  acceptProposalVersion,
  cancelProposalVersion,
  createProposalRevision,
  expireProposalVersion,
  getProposal,
  issueProposalVersion,
  listProposalVersions,
  ProposalsApiError,
  rejectProposalVersion,
} from '../api/proposals-api';
import { mapProposalErrorToMessage } from '../api/proposal-error-messages';
import { ProposalCommercialChain } from '../components/ProposalCommercialChain';
import { ProposalCommercialItems } from '../components/ProposalCommercialItems';
import { ProposalRevisionPanel } from '../components/ProposalRevisionPanel';
import { VersionConflictNotice } from '../components/VersionConflictNotice';
import { useProposalCapabilities } from '../hooks/useProposalCapabilities';
import { useAuth } from '../../auth/context/AuthProvider';
import {
  PROPOSAL_ACCEPTANCE_ORIGINS,
  PROPOSAL_VERSION_STATUSES,
  type ProposalDetail,
  type ProposalTransition,
  type ProposalVersion,
  type ProposalVersionStatus,
} from '../types/proposal.types';
import {
  formatAcceptanceOrigin,
  formatClientSnapshot,
  formatDateTime,
  formatMoney,
  formatProposalPricingStructure,
  formatRegisteredBy,
} from '../utils/proposal-labels';
import {
  buildProposalTimeline,
  describeProposalAttention,
  describeValidityTiming,
  formatProposalBlocker,
  formatProposalNextStep,
  formatProposalTransition,
  isProposalVersionTerminal,
  PROPOSAL_REVISION_STATE_LABELS,
} from '../utils/proposal-workbench';
import {
  buildAuthorizedRelations,
  EnterpriseObjectHeader,
  EnterpriseObjectPage,
  NextActionPanel,
  ObjectContextBlock,
  ObjectPanel,
  ObjectStateFlow,
  SmartRelationBar,
  type NextAction,
  type ObjectAction,
  type ObjectContextField,
  type ObjectMetadataField,
  type ObjectPagePhase,
  type ObjectStateStep,
  type SmartRelationSpec,
} from '../../enterprise-object';
import { ActivityTimeline, type ActivityFact } from '../../operator';
import { BusinessChain, useBusinessChain } from '../../business-chain';
import { ModulePage, UnitScopeLabel } from '../../ui/module-layout';
import type { StatusBadgeTone } from '../../ui/StatusBadge';
import { cn } from '../../ui/utils/cn';

type DetailState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'not_found' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; detail: ProposalDetail; versions: ProposalVersion[] };

const ATTENTION_TONE_CLASS: Record<string, string> = {
  critical: 'bg-red-50 text-red-700 ring-red-600/20',
  warning: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  info: 'bg-gray-100 text-gray-600 ring-gray-400/20',
};

/** Tom visual do estado real da revisao vigente. */
const STATUS_TONES: Record<ProposalVersionStatus, StatusBadgeTone> = {
  [PROPOSAL_VERSION_STATUSES.Draft]: 'neutral',
  [PROPOSAL_VERSION_STATUSES.Issued]: 'info',
  [PROPOSAL_VERSION_STATUSES.Accepted]: 'success',
  [PROPOSAL_VERSION_STATUSES.Rejected]: 'error',
  [PROPOSAL_VERSION_STATUSES.Expired]: 'warning',
  [PROPOSAL_VERSION_STATUSES.Cancelled]: 'warning',
};

/** Transicoes que encerram a revisao vigente — ficam separadas no menu de acoes. */
const DESTRUCTIVE_TRANSITIONS: ProposalTransition[] = ['reject', 'expire', 'cancel'];

/**
 * Workbench comercial da proposta — OBJECT PAGE canonica do contrato enterprise.
 *
 * Ordem de leitura: referencia/estado/acoes (header) -> fluxo real da revisao -> proxima acao
 * derivada -> relacoes autorizadas -> contexto -> composicao, revisoes e historico persistido.
 *
 * A interface NAO decide autorizacao: `readiness` do backend ja entrega o que o ator pode
 * executar, e cada acao daqui so existe quando a transicao correspondente veio em
 * `availableTransitions`. Nada de UUID, nome de capability ou etapa inventada.
 */
export function ProposalDetailPage() {
  const { proposalId = '' } = useParams();
  const reasonId = useId();
  const { identityId } = useAuth();
  const { capabilities } = useProposalCapabilities();
  const [state, setState] = useState<DetailState>({ phase: 'loading' });
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [versionConflict, setVersionConflict] = useState(false);
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [acceptOrigin, setAcceptOrigin] = useState<string>(
    PROPOSAL_ACCEPTANCE_ORIGINS.InternalApproval,
  );

  const reload = useCallback(async () => {
    setState({ phase: 'loading' });
    setActionError(null);
    setActionSuccess(null);
    setVersionConflict(false);
    try {
      const [detail, versions] = await Promise.all([
        getProposal(proposalId),
        listProposalVersions(proposalId),
      ]);
      setState({ phase: 'ready', detail, versions });
    } catch (error) {
      if (error instanceof ProposalsApiError) {
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
          error instanceof ProposalsApiError
            ? mapProposalErrorToMessage(error.code, error.status)
            : 'Não foi possível carregar a proposta.',
      });
    }
  }, [proposalId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /*
   * CADEIA EMPRESARIAL — a linhagem do negocio por clique, em UMA requisicao ao read
   * model existente (`PROPOSAL` e ancora suportada pelo backend). O servidor devolve
   * a cadeia ja autorizada e ja ordenada; o front nao remonta a linhagem, nao filtra
   * e nao infere elo. Cliente -> Solicitacao -> Proposta -> PO -> OS -> Medicao ->
   * Faturamento -> Recebivel deixa de exigir que o operador cace telas.
   */
  const businessChain = useBusinessChain('PROPOSAL', proposalId);

  async function runAction(action: () => Promise<void>, successMessage?: string): Promise<void> {
    if (state.phase !== 'ready') {
      return;
    }
    setActionSubmitting(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await action();
      await reload();
      if (successMessage) {
        setActionSuccess(successMessage);
      }
    } catch (error) {
      if (error instanceof ProposalsApiError && error.kind === 'version_conflict') {
        setVersionConflict(true);
      }
      setActionError(
        error instanceof ProposalsApiError
          ? mapProposalErrorToMessage(error.code, error.status)
          : 'Não foi possível concluir a operação.',
      );
    } finally {
      setActionSubmitting(false);
    }
  }

  /** Estado de pagina do contrato: negacao nao se confunde com registro inexistente. */
  const phase: ObjectPagePhase =
    state.phase === 'not_found' ? 'empty' : state.phase === 'ready' ? 'ready' : state.phase;

  if (state.phase !== 'ready') {
    return (
      <ModulePage>
        <EnterpriseObjectPage
          phase={phase}
          phaseTitle="Proposta comercial"
          phaseMessage={state.phase === 'error' ? state.message : undefined}
          onRetry={() => void reload()}
          header={null}
        />
      </ModulePage>
    );
  }

  const { detail, versions } = state;
  const { proposal, currentVersion, related, readiness, linkedChain, revisions } = detail;
  const now = new Date();
  const originRequests = linkedChain
    .filter((link) => link.kind === 'REQUEST')
    .map((link) => ({ id: link.id, requestCode: link.label, status: link.status ?? '' }));
  const destinationChain = linkedChain.filter((link) => link.kind !== 'REQUEST');
  const attention = describeProposalAttention(
    {
      currentVersionStatus: currentVersion?.status ?? null,
      validUntil: currentVersion?.validUntil ?? null,
      originRequestCount: originRequests.length,
      revisionCount: revisions.length,
    },
    now,
  );
  const timing = describeValidityTiming(currentVersion?.validUntil ?? null, now);
  const availableTransitions = readiness.availableTransitions;
  /** Acao primaria: a transicao que o backend autorizou E que o backend elegeu como proximo passo. */
  const primaryTransition =
    readiness.nextStepTransition && availableTransitions.includes(readiness.nextStepTransition)
      ? readiness.nextStepTransition
      : null;
  const secondaryTransitions = availableTransitions.filter(
    (transition) => transition !== primaryTransition,
  );
  const canEdit = capabilities.canUpdate && currentVersion?.status === PROPOSAL_VERSION_STATUSES.Draft;
  const waitingForClientDecision = readiness.nextStep === 'AWAIT_CLIENT_DECISION';

  const clientName = related.client?.name ?? null;
  const humanValue = formatMoney(
    currentVersion?.globalSalePrice ?? currentVersion?.itemsSaleTotal ?? null,
    currentVersion?.currencyCode,
  );

  function runTransition(transition: ProposalTransition): void {
    if (!currentVersion) {
      return;
    }
    if (transition === 'issue') {
      void runAction(
        async () => {
          await issueProposalVersion(
            proposal.id,
            currentVersion.versionNumber,
            currentVersion.rowVersion,
          );
        },
        `Revisão ${currentVersion.versionNumber} emitida.`,
      );
      return;
    }
    if (transition === 'revise') {
      void runAction(
        async () => {
          await createProposalRevision(proposal.id);
        },
        'Nova revisão criada a partir da vigente.',
      );
      return;
    }
    if (transition === 'accept') {
      setAcceptOpen(true);
      return;
    }
    if (transition === 'reject') {
      setRejectOpen(true);
      return;
    }
    if (transition === 'expire') {
      void runAction(
        async () => {
          await expireProposalVersion(
            proposal.id,
            currentVersion.versionNumber,
            currentVersion.rowVersion,
          );
        },
        `Revisão ${currentVersion.versionNumber} marcada como expirada.`,
      );
      return;
    }
    if (transition === 'cancel') {
      setCancelOpen(true);
    }
  }

  function transitionAction(transition: ProposalTransition): ObjectAction {
    return {
      id: transition,
      label: formatProposalTransition(transition),
      onSelect: () => runTransition(transition),
      disabled: actionSubmitting,
    };
  }

  /* 1 — HEADER ------------------------------------------------------------- */

  const breadcrumb = [
    { label: 'Propostas', href: '/app/proposals' },
    ...(related.client && clientName
      ? [{ label: clientName, href: `/app/clients/${related.client.id}` }]
      : []),
    { label: proposal.proposalCode },
  ];

  const metadata: Array<ObjectMetadataField | null> = [
    { label: 'Valor total', value: humanValue, emphasis: true },
    {
      label: 'Válida até',
      value: currentVersion?.validUntil ? formatDateTime(currentVersion.validUntil) : null,
      emphasis: timing?.tone === 'critical' || timing?.tone === 'warning',
    },
    { label: 'Cliente', value: clientName ?? 'Cliente não identificado' },
    currentVersion?.issuedByIdentityId
      ? {
          label: 'Emitida por',
          value: formatRegisteredBy(currentVersion.issuedByIdentityId, identityId),
        }
      : null,
  ];
  const visibleMetadata = metadata.filter(
    (field): field is ObjectMetadataField => field !== null,
  );

  const currentVersionNumber = currentVersion?.versionNumber ?? null;
  if (currentVersionNumber !== null) {
    visibleMetadata.push({
      label: 'Revisão',
      value:
        revisions.length > 0
          ? `${currentVersionNumber} de ${revisions.length}`
          : String(currentVersionNumber),
    });
  }

  const primaryAction: ObjectAction | null = primaryTransition
    ? transitionAction(primaryTransition)
    : null;
  const secondaryActions: ObjectAction[] = [
    ...(canEdit
      ? [{ id: 'edit', label: 'Editar rascunho', to: `/app/proposals/${proposal.id}/edit` }]
      : []),
    ...secondaryTransitions
      .filter((transition) => !DESTRUCTIVE_TRANSITIONS.includes(transition))
      .map(transitionAction),
  ];
  const destructiveActions: ObjectAction[] = secondaryTransitions
    .filter((transition) => DESTRUCTIVE_TRANSITIONS.includes(transition))
    .map(transitionAction);

  /* 2 — FLUXO REAL DO CICLO DA REVISAO VIGENTE ----------------------------- */

  const stateFlowSteps: ObjectStateStep[] = [];
  const currentStatus = currentVersion?.status ?? null;
  if (currentVersion && currentStatus) {
    /** Etapas que REALMENTE aconteceram — cada uma ancorada no seu timestamp persistido. */
    const completed: ProposalVersionStatus[] = [PROPOSAL_VERSION_STATUSES.Draft];
    if (currentVersion.issuedAt) {
      completed.push(PROPOSAL_VERSION_STATUSES.Issued);
    }
    if (currentVersion.acceptedAt) {
      completed.push(PROPOSAL_VERSION_STATUSES.Accepted);
    }
    if (currentVersion.status === PROPOSAL_VERSION_STATUSES.Rejected && currentVersion.rejectedAt) {
      completed.push(PROPOSAL_VERSION_STATUSES.Rejected);
    }
    if (currentVersion.status === PROPOSAL_VERSION_STATUSES.Expired && currentVersion.expiredAt) {
      completed.push(PROPOSAL_VERSION_STATUSES.Expired);
    }
    if (currentVersion.status === PROPOSAL_VERSION_STATUSES.Cancelled && currentVersion.cancelledAt) {
      completed.push(PROPOSAL_VERSION_STATUSES.Cancelled);
    }

    /** Instante persistido de cada etapa do ciclo desta revisao. */
    const occurredAt: Record<string, string | null> = {
      [PROPOSAL_VERSION_STATUSES.Draft]: currentVersion.issuedAt ?? null,
      [PROPOSAL_VERSION_STATUSES.Issued]: currentVersion.issuedAt,
      [PROPOSAL_VERSION_STATUSES.Accepted]: currentVersion.acceptedAt,
      [PROPOSAL_VERSION_STATUSES.Rejected]: currentVersion.rejectedAt,
      [PROPOSAL_VERSION_STATUSES.Expired]: currentVersion.expiredAt,
      [PROPOSAL_VERSION_STATUSES.Cancelled]: currentVersion.cancelledAt,
    };

    for (const status of completed) {
      stateFlowSteps.push({
        id: status,
        label: PROPOSAL_REVISION_STATE_LABELS[status],
        hint: occurredAt[status] ? formatDateTime(occurredAt[status]) : undefined,
        terminal: status === currentStatus && isProposalVersionTerminal(currentStatus),
      });
    }
  }

  /* 3 — PROXIMA ACAO ------------------------------------------------------- */

  let nextAction: NextAction | null = null;
  if (readiness.blockers.length > 0) {
    nextAction = {
      kind: 'waiting',
      label: formatProposalBlocker(readiness.blockers[0]!),
      description:
        readiness.blockers.length > 1
          ? `Mais ${readiness.blockers.length - 1} pendência(s) para avançar.`
          : undefined,
    };
  } else if (waitingForClientDecision) {
    nextAction = {
      kind: 'waiting',
      label: formatProposalNextStep(readiness.nextStep),
      waitingOn: clientName ?? undefined,
    };
  } else if (primaryTransition) {
    const attentionText = attention[0]?.text;
    nextAction = {
      kind: 'act',
      label: formatProposalTransition(primaryTransition),
      description:
        currentStatus === PROPOSAL_VERSION_STATUSES.Draft
          ? readiness.nextStep === 'COMPLETE_AND_ISSUE'
            ? formatProposalNextStep(readiness.nextStep)
            : attentionText
          : attentionText,
      onSelect: () => runTransition(primaryTransition),
    };
  } else if (readiness.nextStep === 'FOLLOW_COMMERCIAL_FLOW') {
    nextAction = {
      kind: 'waiting',
      label: formatProposalNextStep(readiness.nextStep),
    };
  }

  /* 5 — RELACOES (contagem real + destino real + autorizacao real) ---------- */

  /**
   * Toda relacao precisa de CONTAGEM real e DESTINO REALMENTE filtrado — um numero que nao
   * navega para o recorte certo e um numero que mente.
   *
   * - `Revisões`: contagem da lista COMPLETA de versoes persistidas devolvida por `/versions`;
   *   o destino e o painel de revisoes desta propria pagina.
   * - `Ordens de serviço`: contagem dos elos `SERVICE_ORDER` que o backend autorizou a ler em
   *   `linkedChain`, com o recorte de CLIENTE que a lista de OS realmente le da URL.
   *
   * FICAM FORA da barra, porque nao existe destino filtrado de verdade:
   * - solicitação de origem: a fila de solicitações nao le recorte pela URL;
   * - pedido de compra: a lista de pedidos nao le recorte por proposta nem por cliente.
   * Os elos continuam visiveis, com destino real, na "Cadeia comercial".
   */
  const serviceOrderLinks = linkedChain.filter((link) => link.kind === 'SERVICE_ORDER');
  const relationSpecs: SmartRelationSpec[] = [
    {
      id: 'revisions',
      label: 'Revisões',
      count: versions.length,
      to: '#proposal-revisions',
      hint: 'Revisões registradas para esta proposta',
      allowed: versions.length > 0,
    },
    {
      id: 'service-orders',
      label: 'Ordens de serviço',
      count: serviceOrderLinks.length,
      to: `/app/service-orders?clientId=${proposal.clientId}`,
      hint: 'Ordens de serviço do cliente, incluindo as ligadas a esta proposta',
      // `linkedChain` ja chega filtrado pelo modulo dono: elo negado nao esta aqui, e a
      // relacao desaparece por inteiro (sem rotulo, sem contagem, sem "oculto").
      allowed: serviceOrderLinks.length > 0 && Boolean(proposal.clientId),
    },
  ];

  const relations = buildAuthorizedRelations(relationSpecs);

  /* 6 — CONTEXTO ----------------------------------------------------------- */

  const contextFields: Array<ObjectContextField | null> = [
    related.client && clientName
      ? { label: 'Cliente', value: clientName, to: `/app/clients/${related.client.id}` }
      : null,
    { label: 'Unidade', value: <UnitScopeLabel unitId={proposal.unitId} /> },
    currentVersion?.issuedByIdentityId
      ? {
          label: 'Responsável',
          value: formatRegisteredBy(currentVersion.issuedByIdentityId, identityId),
        }
      : null,
    currentVersion?.validUntil
      ? {
          label: 'Validade',
          value: formatDateTime(currentVersion.validUntil),
          hint: timing?.text,
        }
      : null,
    currentVersion
      ? {
          label: 'Estrutura de preço',
          value: formatProposalPricingStructure(currentVersion.pricingStructure),
        }
      : null,
    currentVersion?.clientSnapshot
      ? { label: 'Cliente na emissão', value: formatClientSnapshot(currentVersion.clientSnapshot) }
      : null,
  ];
  const visibleContextFields = contextFields.filter(
    (field): field is ObjectContextField => field !== null,
  );

  /* 8 — HISTORICO (somente fatos persistidos) ------------------------------ */

  const activityFacts: ActivityFact[] = buildProposalTimeline({
    proposalCreatedAt: proposal.createdAt,
    proposalCode: proposal.proposalCode,
    revisions,
  }).map((entry) => ({
    at: entry.occurredAt,
    event: entry.label,
  }));

  const publishedAt = currentVersion?.issuedAt ?? null;

  return (
    <ModulePage>
      <EnterpriseObjectPage
        breadcrumb={breadcrumb}
        phase="ready"
        header={
          <EnterpriseObjectHeader
            reference={proposal.proposalCode}
            title={proposal.title}
            subtitle={clientName}
            status={
              currentVersion
                ? {
                    label: PROPOSAL_REVISION_STATE_LABELS[currentVersion.status],
                    tone: STATUS_TONES[currentVersion.status],
                    description: publishedAt
                      ? `Emitida em ${formatDateTime(publishedAt)}`
                      : undefined,
                  }
                : null
            }
            metadata={visibleMetadata}
            primaryAction={primaryAction}
            secondaryActions={secondaryActions}
            destructiveActions={destructiveActions}
          />
        }
        stateFlow={<ObjectStateFlow steps={stateFlowSteps} currentId={currentStatus} title="Ciclo da revisão" />}
        nextAction={<NextActionPanel action={nextAction} />}
        relations={<SmartRelationBar relations={relations} />}
        context={<ObjectContextBlock fields={visibleContextFields} columns={3} />}
        aside={
          <ObjectPanel title="Histórico">
            <ActivityTimeline facts={activityFacts} title="Histórico" />
          </ObjectPanel>
        }
      >
        {versionConflict ? <VersionConflictNotice onReload={() => void reload()} /> : null}
        {actionError ? (
          <p
            className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-500/20 ring-inset"
            role="alert"
          >
            {actionError}
          </p>
        ) : null}
        {actionSuccess ? (
          <p
            className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-600/20 ring-inset"
            role="status"
          >
            {actionSuccess}
          </p>
        ) : null}

        <ObjectPanel title="Composição comercial">
          {currentVersion ? (
            <ProposalCommercialItems version={currentVersion} />
          ) : (
            <p className="text-sm text-gray-500" role="status">
              Esta proposta ainda não tem versão: crie a primeira revisão para compor a oferta.
            </p>
          )}
        </ObjectPanel>

        <ObjectPanel title="Revisões e comparação">
          <div id="proposal-revisions" className="scroll-mt-24">
            <ProposalRevisionPanel revisions={revisions} comparison={detail.revisionComparison} />
          </div>
        </ObjectPanel>

        <ObjectPanel title="Cadeia comercial">
          <ProposalCommercialChain
            chain={destinationChain}
            originRequests={originRequests}
            client={related.client}
          />
        </ObjectPanel>

        {/*
          Linhagem EMPRESARIAL completa (read model do backend), distinta do painel acima:
          aqui a proposta aparece no meio da cadeia do negocio, navegavel por clique.
        */}
        <BusinessChain
          chain={businessChain.chain}
          phase={businessChain.phase}
          message={businessChain.message}
          onRetry={businessChain.retry}
          title="Cadeia de negócio da proposta"
        />

        {attention.length > 0 || readiness.blockers.length > 0 ? (
          <ObjectPanel title="Situação comercial">
            <div className="flex flex-wrap gap-1.5">
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
              {readiness.blockers.map((blocker) => (
                <span
                  key={blocker}
                  className="inline-flex items-center rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-600/20 ring-inset"
                >
                  {formatProposalBlocker(blocker)}
                </span>
              ))}
            </div>
            {currentVersion?.rejectionReason ? (
              <p className="mt-2 text-sm text-gray-800">
                <span className="text-gray-500">Motivo da rejeição: </span>
                {currentVersion.rejectionReason}
              </p>
            ) : null}
            {currentVersion?.cancellationReason ? (
              <p className="mt-1 text-sm text-gray-800">
                <span className="text-gray-500">Motivo do cancelamento: </span>
                {currentVersion.cancellationReason}
              </p>
            ) : null}
            {currentVersion?.notes ? (
              <p className="mt-1 text-sm text-gray-800">
                <span className="text-gray-500">Observações da revisão: </span>
                {currentVersion.notes}
              </p>
            ) : null}
          </ObjectPanel>
        ) : null}
      </EnterpriseObjectPage>

      <ConfirmDialog
        open={acceptOpen}
        title="Registrar aceite da proposta"
        description="Confirme a origem da aceitação comercial."
        confirmLabel="Confirmar aceitação"
        confirmDisabled={actionSubmitting}
        onCancel={() => setAcceptOpen(false)}
        onConfirm={() => {
          void runAction(
            async () => {
              if (!currentVersion) {
                return;
              }
              await acceptProposalVersion(proposal.id, currentVersion.versionNumber, {
                rowVersion: currentVersion.rowVersion,
                acceptanceOriginCode:
                  acceptOrigin as (typeof PROPOSAL_ACCEPTANCE_ORIGINS)[keyof typeof PROPOSAL_ACCEPTANCE_ORIGINS],
              });
              setAcceptOpen(false);
            },
            `Revisão ${currentVersion?.versionNumber ?? ''} aceita.`,
          );
        }}
      >
        <div className="form-field">
          <label htmlFor={`${reasonId}-accept-origin`}>Origem da aceitação</label>
          <select
            id={`${reasonId}-accept-origin`}
            value={acceptOrigin}
            onChange={(event) => setAcceptOrigin(event.target.value)}
          >
            {Object.values(PROPOSAL_ACCEPTANCE_ORIGINS).map((origin) => (
              <option key={origin} value={origin}>
                {formatAcceptanceOrigin(origin)}
              </option>
            ))}
          </select>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={rejectOpen}
        title="Rejeitar proposta"
        description="Informe o motivo da rejeição, se aplicável."
        confirmLabel="Confirmar rejeição"
        confirmDisabled={actionSubmitting}
        onCancel={() => {
          setRejectOpen(false);
          setRejectReason('');
        }}
        onConfirm={() => {
          void runAction(
            async () => {
              if (!currentVersion) {
                return;
              }
              await rejectProposalVersion(proposal.id, currentVersion.versionNumber, {
                rowVersion: currentVersion.rowVersion,
                rejectionReason: rejectReason.trim() || undefined,
              });
              setRejectOpen(false);
              setRejectReason('');
            },
            `Revisão ${currentVersion?.versionNumber ?? ''} rejeitada.`,
          );
        }}
      >
        <div className="form-field">
          <label htmlFor={`${reasonId}-reject`}>Motivo</label>
          <textarea
            id={`${reasonId}-reject`}
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            rows={3}
          />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={cancelOpen}
        title="Cancelar proposta"
        description="Informe o motivo do cancelamento."
        confirmLabel="Confirmar cancelamento"
        confirmDisabled={actionSubmitting}
        onCancel={() => {
          setCancelOpen(false);
          setCancelReason('');
        }}
        onConfirm={() => {
          void runAction(
            async () => {
              if (!currentVersion) {
                return;
              }
              await cancelProposalVersion(proposal.id, currentVersion.versionNumber, {
                rowVersion: currentVersion.rowVersion,
                cancellationReason: cancelReason.trim() || undefined,
              });
              setCancelOpen(false);
              setCancelReason('');
            },
            `Revisão ${currentVersion?.versionNumber ?? ''} cancelada.`,
          );
        }}
      >
        <div className="form-field">
          <label htmlFor={`${reasonId}-cancel`}>Motivo</label>
          <textarea
            id={`${reasonId}-cancel`}
            value={cancelReason}
            onChange={(event) => setCancelReason(event.target.value)}
            rows={3}
          />
        </div>
      </ConfirmDialog>

      <p className="mt-3 text-xs text-gray-400">
        {versions.length} versão(ões) registradas para esta proposta.
      </p>
    </ModulePage>
  );
}
