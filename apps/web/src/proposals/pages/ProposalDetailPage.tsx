import { Link, useParams } from 'react-router-dom';
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
import { ProposalCommercialTimeline } from '../components/ProposalCommercialTimeline';
import { ProposalRevisionPanel } from '../components/ProposalRevisionPanel';
import { ProposalStatusBadge } from '../components/ProposalStatusBadge';
import { VersionConflictNotice } from '../components/VersionConflictNotice';
import { useProposalCapabilities } from '../hooks/useProposalCapabilities';
import { useAuth } from '../../auth/context/AuthProvider';
import {
  PROPOSAL_ACCEPTANCE_ORIGINS,
  type ProposalDetail,
  type ProposalTransition,
  type ProposalVersion,
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
  formatRelativePast,
} from '../utils/proposal-workbench';
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

/**
 * Workbench comercial da proposta.
 *
 * Uma acao primaria contextual (a transicao que o backend autorizou para este ator) e as demais
 * acoes subordinadas. A interface nao decide autorizacao: ela apenas representa o que o backend
 * devolveu em `readiness`.
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

  if (state.phase === 'loading') {
    return (
      <main id="main-content" className="shell-page">
        <p aria-busy="true" aria-live="polite">
          Carregando proposta…
        </p>
      </main>
    );
  }

  if (state.phase === 'denied') {
    return (
      <main id="main-content" className="shell-page">
        <h1>Proposta comercial</h1>
        <p role="alert">Você não tem permissão para consultar esta proposta.</p>
        <Link to="/app/proposals">Voltar à lista</Link>
      </main>
    );
  }

  if (state.phase === 'not_found') {
    return (
      <main id="main-content" className="shell-page">
        <h1>Proposta comercial</h1>
        <p role="alert">Proposta não encontrada.</p>
        <Link to="/app/proposals">Voltar à lista</Link>
      </main>
    );
  }

  if (state.phase === 'error') {
    return (
      <main id="main-content" className="shell-page">
        <h1>Proposta comercial</h1>
        <p className="form-error" role="alert">
          {state.message}
        </p>
        <button type="button" onClick={() => void reload()}>
          Tentar novamente
        </button>
      </main>
    );
  }

  const { detail, versions } = state;
  const { proposal, currentVersion: version, related, readiness, linkedChain, revisions } = detail;
  const now = new Date();
  const originRequests = linkedChain
    .filter((link) => link.kind === 'REQUEST')
    .map((link) => ({ id: link.id, requestCode: link.label, status: link.status ?? '' }));
  const destinationChain = linkedChain.filter((link) => link.kind !== 'REQUEST');
  const attention = describeProposalAttention(
    {
      currentVersionStatus: version?.status ?? null,
      validUntil: version?.validUntil ?? null,
      originRequestCount: originRequests.length,
      revisionCount: revisions.length,
    },
    now,
  );
  const timing = describeValidityTiming(version?.validUntil ?? null, now);
  const availableTransitions = readiness.availableTransitions;
  const primaryTransition = readiness.nextStepTransition;
  const secondaryTransitions = availableTransitions.filter(
    (transition) => transition !== primaryTransition,
  );
  const canEdit = capabilities.canUpdate && version?.status === 'DRAFT';

  const timeline = buildProposalTimeline({
    proposalCreatedAt: proposal.createdAt,
    proposalCode: proposal.proposalCode,
    revisions,
  });



  function runTransition(transition: ProposalTransition): void {
    if (!version) {
      return;
    }
    if (transition === 'issue') {
      void runAction(
        async () => {
          await issueProposalVersion(proposal.id, version.versionNumber, version.rowVersion);
        },
        `Revisão ${version.versionNumber} emitida.`,
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
          await expireProposalVersion(proposal.id, version.versionNumber, version.rowVersion);
        },
        `Revisão ${version.versionNumber} marcada como expirada.`,
      );
      return;
    }
    if (transition === 'cancel') {
      setCancelOpen(true);
    }
  }

  return (
    <main id="main-content" className="shell-page">
      <header className="border-b border-gray-200 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="cisne-type-page-title">{proposal.proposalCode}</h1>
              {version ? <ProposalStatusBadge status={version.status} /> : null}
              <span className="rounded bg-gray-100 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-gray-700 uppercase">
                {proposal.currentVersionNumber === null
                  ? 'Sem versão'
                  : `Revisão ${proposal.currentVersionNumber}`}
              </span>
            </div>
            <p className="mt-1 text-sm font-medium text-gray-900">{proposal.title}</p>
            <p className="mt-0.5 text-xs text-gray-500">
              {related.client?.name ?? (
                <span className="text-gray-400">Cliente não autorizado / não identificado</span>
              )}
              {' · '}
              <span className="cisne-type-money font-semibold text-gray-800">
                {formatMoney(
                  version?.globalSalePrice ?? version?.itemsSaleTotal ?? null,
                  version?.currencyCode,
                )}
              </span>
              {' · '}
              {version?.validUntil
                ? `válida até ${formatDateTime(version.validUntil)}`
                : 'sem validade definida'}
              {timing ? ` (${timing.text})` : ''}
              {' · '}
              {version
                ? formatProposalPricingStructure(version.pricingStructure)
                : 'estrutura de preço não definida'}
            </p>
          </div>

          <div className="flex flex-col items-end gap-2">
            {primaryTransition ? (
              <button
                type="button"
                disabled={actionSubmitting || readiness.blockers.length > 0}
                aria-describedby={
                  readiness.blockers.length > 0 ? 'proposal-readiness-blockers' : undefined
                }
                title={
                  readiness.blockers.length > 0
                    ? formatProposalBlocker(readiness.blockers[0]!)
                    : undefined
                }
                onClick={() => runTransition(primaryTransition)}
              >
                {formatProposalTransition(primaryTransition)}
              </button>
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
                  to={`/app/proposals/${proposal.id}/edit`}
                  className="button-link button-secondary"
                >
                  Editar rascunho
                </Link>
              ) : null}
              {secondaryTransitions.map((transition) => (
                <button
                  key={transition}
                  type="button"
                  className="button-secondary"
                  disabled={actionSubmitting}
                  onClick={() => runTransition(transition)}
                >
                  {formatProposalTransition(transition)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      {versionConflict ? <VersionConflictNotice onReload={() => void reload()} /> : null}
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

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <section className="requests-section lg:col-span-2" aria-labelledby="proposal-summary-heading">
          <h2 id="proposal-summary-heading" className="cisne-type-section-title">
            Resumo comercial
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
                {version?.clientSnapshot ? (
                  <span className="block text-xs text-gray-500">
                    No momento da emissão: {formatClientSnapshot(version.clientSnapshot)}
                  </span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>Unidade</dt>
              <dd>{proposal.unitId}</dd>
            </div>
            <div>
              <dt>Revisão vigente</dt>
              <dd>
                {proposal.currentVersionNumber === null
                  ? 'Sem versão'
                  : `Revisão ${proposal.currentVersionNumber} de ${revisions.length}`}
              </dd>
            </div>
            <div>
              <dt>Estrutura de preço</dt>
              <dd>{version ? formatProposalPricingStructure(version.pricingStructure) : '—'}</dd>
            </div>
            <div>
              <dt>Valor comercial</dt>
              <dd className="cisne-type-money">
                {formatMoney(
                  version?.globalSalePrice ?? version?.itemsSaleTotal ?? null,
                  version?.currencyCode,
                )}
              </dd>
            </div>
            <div>
              <dt>Validade</dt>
              <dd>
                {formatDateTime(version?.validUntil)}
                {timing ? (
                  <span className="block text-xs text-gray-500">{timing.text}</span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>Emitida em</dt>
              <dd>
                {formatDateTime(version?.issuedAt)}
                {version?.issuedByIdentityId ? (
                  <span className="block text-xs text-gray-500">
                    {formatRegisteredBy(version.issuedByIdentityId, identityId)}
                  </span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>Aceite</dt>
              <dd>
                {formatDateTime(version?.acceptedAt)}
                {version?.acceptanceOriginCode ? (
                  <span className="block text-xs text-gray-500">
                    {formatAcceptanceOrigin(version.acceptanceOriginCode)}
                  </span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>Criada em</dt>
              <dd>
                {formatDateTime(proposal.createdAt)}
                <span className="block text-xs text-gray-500">
                  {formatRelativePast(proposal.createdAt, now)}
                </span>
              </dd>
            </div>
            <div>
              <dt>Atualizada em</dt>
              <dd>{formatDateTime(proposal.updatedAt)}</dd>
            </div>
            {version?.notes ? (
              <div className="sm:col-span-2">
                <dt>Observações da revisão</dt>
                <dd>{version.notes}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section className="requests-section" aria-labelledby="proposal-readiness-heading">
          <h2 id="proposal-readiness-heading" className="cisne-type-section-title">
            Próximo passo
          </h2>
          <p className="text-sm font-semibold text-gray-900">
            {formatProposalNextStep(readiness.nextStep)}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Derivado do estado real da revisão vigente e das suas permissões.
          </p>

          {readiness.blockers.length > 0 ? (
            <ul
              id="proposal-readiness-blockers"
              className="mt-3 space-y-1"
              aria-label="Bloqueios para avançar"
            >
              {readiness.blockers.map((blocker) => (
                <li
                  key={blocker}
                  className="rounded bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-600/20 ring-inset"
                >
                  {formatProposalBlocker(blocker)}
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

          {version?.rejectionReason ? (
            <div className="mt-4">
              <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
                Motivo da rejeição
              </p>
              <p className="text-sm text-gray-800">{version.rejectionReason}</p>
            </div>
          ) : null}
          {version?.cancellationReason ? (
            <div className="mt-4">
              <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
                Motivo do cancelamento
              </p>
              <p className="text-sm text-gray-800">{version.cancellationReason}</p>
            </div>
          ) : null}
        </section>
      </div>

      <section className="requests-section mt-5" aria-labelledby="proposal-composition-heading">
        <h2 id="proposal-composition-heading" className="cisne-type-section-title">
          Composição comercial
        </h2>
        {version ? (
          <ProposalCommercialItems version={version} />
        ) : (
          <p className="text-sm text-gray-500">
            Esta proposta ainda não tem versão: crie a primeira revisão para compor a oferta.
          </p>
        )}
      </section>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section className="requests-section" aria-labelledby="proposal-chain-heading">
          <h2 id="proposal-chain-heading" className="cisne-type-section-title">
            Cadeia comercial
          </h2>
          <p className="mb-3 text-xs text-gray-500">
            De onde a proposta veio e para onde ela foi. Cada elo aparece apenas se você puder
            consultá-lo no módulo responsável.
          </p>
          <ProposalCommercialChain chain={destinationChain} originRequests={originRequests} />
        </section>

        <section className="requests-section" aria-labelledby="proposal-timeline-heading">
          <h2 id="proposal-timeline-heading" className="cisne-type-section-title">
            Linha do tempo comercial
          </h2>
          <p className="mb-3 text-xs text-gray-500">
            Marcos registrados pelo domínio, do mais recente para o mais antigo.
          </p>
          <ProposalCommercialTimeline entries={timeline} currentIdentityId={identityId ?? null} />
        </section>
      </div>

      <section className="requests-section mt-5" aria-labelledby="proposal-revisions-heading">
        <h2 id="proposal-revisions-heading" className="cisne-type-section-title">
          Revisões e comparação
        </h2>
        <ProposalRevisionPanel
          revisions={revisions}
          comparison={detail.revisionComparison}
        />
      </section>

      {versions.length > 0 ? (
        <p className="mt-2 text-xs text-gray-400">
          {versions.length} versão(ões) registradas em com.proposal_versions para esta proposta.
        </p>
      ) : null}

      <p className="mt-4">
        <Link to="/app/proposals">Voltar à lista</Link>
      </p>

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
              if (!version) {
                return;
              }
              await acceptProposalVersion(proposal.id, version.versionNumber, {
                rowVersion: version.rowVersion,
                acceptanceOriginCode:
                  acceptOrigin as (typeof PROPOSAL_ACCEPTANCE_ORIGINS)[keyof typeof PROPOSAL_ACCEPTANCE_ORIGINS],
              });
              setAcceptOpen(false);
            },
            `Revisão ${version?.versionNumber ?? ''} aceita.`,
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
              if (!version) {
                return;
              }
              await rejectProposalVersion(proposal.id, version.versionNumber, {
                rowVersion: version.rowVersion,
                rejectionReason: rejectReason.trim() || undefined,
              });
              setRejectOpen(false);
              setRejectReason('');
            },
            `Revisão ${version?.versionNumber ?? ''} rejeitada.`,
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
              if (!version) {
                return;
              }
              await cancelProposalVersion(proposal.id, version.versionNumber, {
                rowVersion: version.rowVersion,
                cancellationReason: cancelReason.trim() || undefined,
              });
              setCancelOpen(false);
              setCancelReason('');
            },
            `Revisão ${version?.versionNumber ?? ''} cancelada.`,
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

    </main>
  );
}
