import { HttpStatus, Injectable } from '@nestjs/common';
import {
  SECURITY_AUDIT_ACTIONS,
  SECURITY_AUDIT_CLASSIFICATIONS,
  SECURITY_AUDIT_OUTCOMES,
  SECURITY_AUDIT_RESOURCE_TYPES,
} from '../../audit/types/security-audit.types';
import { SecurityAuditService } from '../../audit/services/security-audit.service';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import type { AuthzAction } from '../../authorization/types/authz-actions';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import {
  PROPOSAL_VERSION_STATUSES,
  type ProposalVersionStatus,
} from '../domain/proposal';
import {
  buildProposalListOrderClause,
  buildProposalListWhere,
  ProposalListQueryError,
  type ProposalListDirection,
  type ProposalListSort,
} from '../repositories/proposal-list-sql';
import { buildCommercialItemSnapshot } from '../domain/proposal-commercial-snapshot';
import {
  allowedTransitionsFrom,
  nextStepForStatus,
  readinessBlockers,
} from '../domain/proposal-readiness';
import type { ProposalTransition } from '../domain/proposal-readiness';
import {
  compareProposalRevisions,
  type ProposalRevisionDiff,
} from '../domain/proposal-revision-diff';
import {
  sumProposalItemInternalCostAmounts,
  sumProposalItemSaleAmounts,
} from '../domain/proposal-totals';
import type {
  AcceptProposalInput,
  CancelProposalInput,
  CreateProposalInput,
  LinkProposalDocumentInput,
  RejectProposalInput,
  UpdateProposalDraftInput,
} from '../domain/proposal.validation';
import { COMMERCIAL_ERROR_CODES } from '../errors/commercial-error-codes';
import { CommercialHttpException } from '../errors/commercial-http.exception';
import { ProposalsRepository } from '../repositories/proposals.repository';
import type {
  ProposalItemRow,
  ProposalLinkedRow,
  ProposalRow,
  ProposalVersionRow,
} from '../repositories/proposals.repository.types';
import {
  buildProposalDetail,
  toProposalRevisionSummaryResponse,
  toProposalVersionResponse,
  toProposalWorkbenchItemResponse,
  type ProposalDetailResponse,
  type ProposalListItemResponse,
  type ProposalReadinessResponse,
  type ProposalRelatedResponse,
  type ProposalVersionResponse,
  type ProposalCostVisibility,
} from '../serializers/proposals-response.serializer';
import { groupRowsByKey } from '../../infrastructure/database/sql';
import { ProposalsAccessAuthz } from './proposals-access.authz';
import {
  proposalsAccessNotFound,
  proposalsClientNotFound,
  proposalsInvalidState,
  proposalsVersionConflict,
  proposalsVersionNotFound,
} from './proposals-access.errors';
import {
  assertValidProposalId,
  generateProposalCode,
  resolveAcceptProposalInput,
  resolveCancelProposalInput,
  resolveCreateProposalInput,
  resolveLinkProposalDocumentInput,
  resolveRejectProposalInput,
  resolveUpdateProposalDraftInput,
} from './proposals-input-resolution';
import { ProposalsReferenceValidationService } from './proposals-reference-validation.service';

/** Consulta da fila comercial: filtros e ordenacao ja validados pelo DTO. */
export type ProposalListQuery = {
  clientId?: string;
  unitId?: string;
  status?: string;
  currencyCode?: string;
  validFrom?: string;
  validTo?: string;
  createdFrom?: string;
  createdTo?: string;
  search?: string;
  sort?: ProposalListSort;
  direction?: ProposalListDirection;
  limit: number;
  offset: number;
};

/** Acao de autorizacao que o modulo dono exige para cada transicao real do dominio. */
const TRANSITION_ACTIONS: Record<ProposalTransition, AuthzAction> = {
  issue: AUTHZ_ACTIONS.CommercialProposalIssue,
  accept: AUTHZ_ACTIONS.CommercialProposalAccept,
  reject: AUTHZ_ACTIONS.CommercialProposalReject,
  expire: AUTHZ_ACTIONS.CommercialProposalExpire,
  cancel: AUTHZ_ACTIONS.CommercialProposalCancel,
  revise: AUTHZ_ACTIONS.CommercialProposalUpdate,
};

@Injectable()
export class ProposalsAccessService {
  constructor(
    private readonly proposalsRepository: ProposalsRepository,
    private readonly authz: ProposalsAccessAuthz,
    private readonly referenceValidation: ProposalsReferenceValidationService,
    private readonly securityAudit: SecurityAuditService,
  ) {}

  async create(
    actor: IdentityAuthzContext,
    input: CreateProposalInput,
  ): Promise<ProposalDetailResponse> {
    const validated = resolveCreateProposalInput(input);

    await this.authz.assertCreateAction(actor, input.clientId, input.unitId);
    await this.referenceValidation.assertClientActive(input.clientId);
    await this.referenceValidation.assertUnitRegistered(input.unitId);
    await this.referenceValidation.assertServiceReferences(validated.items);

    const created = await this.proposalsRepository.createProposal({
      proposalCode: generateProposalCode(),
      clientId: input.clientId,
      unitId: input.unitId,
      title: input.title.trim(),
      pricingStructure: validated.pricingStructure,
      currencyCode: validated.currencyCode,
      globalSalePrice: validated.globalSalePrice,
      globalInternalCost: validated.globalInternalCost,
      commercialTerms: input.commercialTerms ?? {},
      validUntil: input.validUntil ?? null,
      notes: input.notes ?? null,
      items: validated.items,
      actorIdentityId: actor.identityId,
    });

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.CommercialProposalCreate,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.CommercialProposal,
      resourceId: created.proposal.id,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata: { proposalCode: created.proposal.proposal_code },
    });

    return buildProposalDetail(created.proposal, created.version, created.items, [], {}, {
      includeInternalCost: await this.authz.canReadInternalCost(actor, created.proposal),
    });
  }

  async updateDraft(
    actor: IdentityAuthzContext,
    proposalId: string,
    versionNumber: number,
    input: UpdateProposalDraftInput,
  ): Promise<ProposalDetailResponse> {
    assertValidProposalId(proposalId);
    await this.requireProposal(actor, proposalId, AUTHZ_ACTIONS.CommercialProposalUpdate);

    const validated = resolveUpdateProposalDraftInput(input);
    if (validated.items) {
      await this.referenceValidation.assertServiceReferences(validated.items);
    }

    const updated = await this.proposalsRepository.updateDraft({
      proposalId,
      versionNumber,
      ...validated,
      actorIdentityId: actor.identityId,
    });

    if (updated === 'VERSION_CONFLICT') {
      throw proposalsVersionConflict();
    }
    if (updated === 'INVALID_STATE') {
      throw proposalsInvalidState();
    }

    const documents = await this.proposalsRepository.listDocumentLinks(updated.version.id);
    return buildProposalDetail(updated.proposal, updated.version, updated.items, documents, {}, {
      includeInternalCost: await this.authz.canReadInternalCost(actor, updated.proposal),
    });
  }

  async createRevision(
    actor: IdentityAuthzContext,
    proposalId: string,
  ): Promise<ProposalDetailResponse> {
    assertValidProposalId(proposalId);
    await this.requireProposal(actor, proposalId, AUTHZ_ACTIONS.CommercialProposalUpdate);

    const result = await this.proposalsRepository.createRevision(proposalId, actor.identityId);
    if (result === 'DRAFT_EXISTS') {
      throw new CommercialHttpException(
        HttpStatus.CONFLICT,
        COMMERCIAL_ERROR_CODES.DRAFT_EXISTS,
        'A draft version already exists.',
      );
    }
    if (result === 'REVISION_NOT_ALLOWED') {
      throw new CommercialHttpException(
        HttpStatus.CONFLICT,
        COMMERCIAL_ERROR_CODES.REVISION_NOT_ALLOWED,
        'Revision is not allowed for the current version.',
      );
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.CommercialProposalCreateVersion,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.CommercialProposal,
      resourceId: proposalId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata: { versionNumber: result.version.version_number },
    });

    return buildProposalDetail(result.proposal, result.version, result.items, [], {}, {
      includeInternalCost: await this.authz.canReadInternalCost(actor, result.proposal),
    });
  }

  async issue(
    actor: IdentityAuthzContext,
    proposalId: string,
    versionNumber: number,
    rowVersion: number,
  ): Promise<ProposalVersionResponse> {
    assertValidProposalId(proposalId);
    const proposal = await this.requireProposal(actor, proposalId, AUTHZ_ACTIONS.CommercialProposalIssue);
    const version = await this.requireVersion(proposalId, versionNumber);
    if (version.status !== PROPOSAL_VERSION_STATUSES.Draft || version.row_version !== rowVersion) {
      throw version.status !== PROPOSAL_VERSION_STATUSES.Draft
        ? proposalsInvalidState()
        : proposalsVersionConflict();
    }

    await this.referenceValidation.assertIssueReady(version);

    const client = await this.proposalsRepository.findClientById(proposal.client_id);
    if (!client) {
      throw proposalsClientNotFound();
    }

    const items = await this.proposalsRepository.listItems(version.id);
    const snapshottedAt = new Date().toISOString();
    const itemSnapshots = await Promise.all(
      items.map(async (item) => {
        const serviceSnapshot = !item.service_definition_id
          ? null
          : await this.proposalsRepository
              .findServiceSnapshot(
                item.service_definition_id,
                item.service_definition_version_id ?? undefined,
              )
              .then((snapshot) =>
                snapshot
                  ? {
                      serviceDefinitionId: snapshot.service_definition_id,
                      serviceDefinitionVersionId: snapshot.service_definition_version_id,
                      code: snapshot.code,
                      name: snapshot.name,
                      version: snapshot.version,
                      versionStatus: snapshot.version_status,
                    }
                  : null,
              );

        return {
          itemId: item.id,
          serviceSnapshot,
          commercialSnapshot: buildCommercialItemSnapshot(item, snapshottedAt),
        };
      }),
    );

    const issued = await this.proposalsRepository.issueVersion(
      proposalId,
      versionNumber,
      rowVersion,
      actor.identityId,
      {
        clientId: client.id,
        legalName: client.legal_name,
        tradeName: client.trade_name,
        normalizedTaxId: client.normalized_tax_id,
        status: client.status,
      },
      itemSnapshots,
      {
        itemsSaleTotal: sumProposalItemSaleAmounts(items),
        itemsInternalCostTotal: sumProposalItemInternalCostAmounts(items),
      },
    );

    if (issued === 'VERSION_CONFLICT') {
      throw proposalsVersionConflict();
    }
    if (issued === 'INVALID_STATE') {
      throw proposalsInvalidState();
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.CommercialProposalIssue,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.CommercialProposal,
      resourceId: proposalId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata: { versionNumber },
    });

    const documents = await this.proposalsRepository.listDocumentLinks(issued.id);
    const issuedItems = await this.proposalsRepository.listItems(issued.id);
    return toProposalVersionResponse(
      issued,
      issuedItems,
      documents,
      await this.visibilityFor(actor, proposal),
    );
  }

  async accept(
    actor: IdentityAuthzContext,
    proposalId: string,
    versionNumber: number,
    input: AcceptProposalInput,
  ): Promise<ProposalVersionResponse> {
    assertValidProposalId(proposalId);
    const proposal = await this.requireProposal(
      actor,
      proposalId,
      AUTHZ_ACTIONS.CommercialProposalAccept,
    );

    const validated = resolveAcceptProposalInput(input);

    if (validated.acceptanceEvidenceDocumentId) {
      await this.referenceValidation.assertDocumentExists(validated.acceptanceEvidenceDocumentId);
    }

    const accepted = await this.proposalsRepository.transitionVersion(
      proposalId,
      versionNumber,
      validated.rowVersion,
      PROPOSAL_VERSION_STATUSES.Accepted,
      actor.identityId,
      {
        acceptedAt: new Date().toISOString(),
        acceptedByIdentityId: actor.identityId,
        acceptanceOriginCode: validated.acceptanceOriginCode,
        acceptanceEvidenceDocumentId: validated.acceptanceEvidenceDocumentId ?? null,
      },
    );

    if (accepted === 'VERSION_CONFLICT') {
      throw proposalsVersionConflict();
    }
    if (accepted === 'INVALID_STATE') {
      throw proposalsInvalidState();
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.CommercialProposalAccept,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.CommercialProposal,
      resourceId: proposalId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Critical,
      metadata: {
        versionNumber,
        acceptanceOriginCode: validated.acceptanceOriginCode,
      },
    });

    const documents = await this.proposalsRepository.listDocumentLinks(accepted.id);
    const items = await this.proposalsRepository.listItems(accepted.id);
    return toProposalVersionResponse(
      accepted,
      items,
      documents,
      await this.visibilityFor(actor, proposal),
    );
  }

  async reject(
    actor: IdentityAuthzContext,
    proposalId: string,
    versionNumber: number,
    input: RejectProposalInput,
  ): Promise<ProposalVersionResponse> {
    assertValidProposalId(proposalId);
    const proposal = await this.requireProposal(
      actor,
      proposalId,
      AUTHZ_ACTIONS.CommercialProposalReject,
    );

    const validated = resolveRejectProposalInput(input);

    const rejected = await this.proposalsRepository.transitionVersion(
      proposalId,
      versionNumber,
      validated.rowVersion,
      PROPOSAL_VERSION_STATUSES.Rejected,
      actor.identityId,
      {
        rejectedAt: new Date().toISOString(),
        rejectedByIdentityId: actor.identityId,
        rejectionReason: validated.rejectionReason ?? null,
      },
    );

    if (rejected === 'VERSION_CONFLICT') {
      throw proposalsVersionConflict();
    }
    if (rejected === 'INVALID_STATE') {
      throw proposalsInvalidState();
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.CommercialProposalReject,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.CommercialProposal,
      resourceId: proposalId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata: { versionNumber },
    });

    const documents = await this.proposalsRepository.listDocumentLinks(rejected.id);
    const items = await this.proposalsRepository.listItems(rejected.id);
    return toProposalVersionResponse(
      rejected,
      items,
      documents,
      await this.visibilityFor(actor, proposal),
    );
  }

  async expire(
    actor: IdentityAuthzContext,
    proposalId: string,
    versionNumber: number,
    rowVersion: number,
  ): Promise<ProposalVersionResponse> {
    assertValidProposalId(proposalId);
    const proposal = await this.requireProposal(
      actor,
      proposalId,
      AUTHZ_ACTIONS.CommercialProposalExpire,
    );

    const expired = await this.proposalsRepository.transitionVersion(
      proposalId,
      versionNumber,
      rowVersion,
      PROPOSAL_VERSION_STATUSES.Expired,
      actor.identityId,
      { expiredAt: new Date().toISOString() },
    );

    if (expired === 'VERSION_CONFLICT') {
      throw proposalsVersionConflict();
    }
    if (expired === 'INVALID_STATE') {
      throw proposalsInvalidState();
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.CommercialProposalExpire,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.CommercialProposal,
      resourceId: proposalId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata: { versionNumber },
    });

    const documents = await this.proposalsRepository.listDocumentLinks(expired.id);
    const items = await this.proposalsRepository.listItems(expired.id);
    return toProposalVersionResponse(
      expired,
      items,
      documents,
      await this.visibilityFor(actor, proposal),
    );
  }

  async cancel(
    actor: IdentityAuthzContext,
    proposalId: string,
    versionNumber: number,
    input: CancelProposalInput,
  ): Promise<ProposalVersionResponse> {
    assertValidProposalId(proposalId);
    const proposal = await this.requireProposal(
      actor,
      proposalId,
      AUTHZ_ACTIONS.CommercialProposalCancel,
    );

    const validated = resolveCancelProposalInput(input);

    const cancelled = await this.proposalsRepository.cancelVersion(
      proposalId,
      versionNumber,
      validated.rowVersion,
      actor.identityId,
      validated.cancellationReason ?? null,
    );

    if (cancelled === 'VERSION_CONFLICT') {
      throw proposalsVersionConflict();
    }
    if (cancelled === 'INVALID_STATE') {
      throw proposalsInvalidState();
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.CommercialProposalCancel,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.CommercialProposal,
      resourceId: proposalId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata: { versionNumber },
    });

    const documents = await this.proposalsRepository.listDocumentLinks(cancelled.id);
    const items = await this.proposalsRepository.listItems(cancelled.id);
    return toProposalVersionResponse(
      cancelled,
      items,
      documents,
      await this.visibilityFor(actor, proposal),
    );
  }

  async linkDocument(
    actor: IdentityAuthzContext,
    proposalId: string,
    versionNumber: number,
    input: LinkProposalDocumentInput,
  ): Promise<ProposalDetailResponse> {
    assertValidProposalId(proposalId);
    const proposal = await this.requireProposal(actor, proposalId, AUTHZ_ACTIONS.CommercialProposalUpdate);
    const version = await this.requireVersion(proposalId, versionNumber);

    const validated = resolveLinkProposalDocumentInput(input);

    await this.referenceValidation.assertDocumentUnitMatch(validated.documentId, proposal.unit_id);

    await this.proposalsRepository.linkDocument(
      version.id,
      validated.documentId,
      validated.linkPurpose,
      actor.identityId,
    );

    const items = await this.proposalsRepository.listItems(version.id);
    const documents = await this.proposalsRepository.listDocumentLinks(version.id);
    return buildProposalDetail(
      proposal,
      version,
      items,
      documents,
      {},
      await this.visibilityFor(actor, proposal),
    );
  }

  async getById(actor: IdentityAuthzContext, proposalId: string): Promise<ProposalDetailResponse> {
    assertValidProposalId(proposalId);
    const proposal = await this.requireProposal(actor, proposalId, AUTHZ_ACTIONS.CommercialProposalRead);
    const versionNumber = proposal.current_version_number;
    if (!versionNumber) {
      const [chain, readiness, enrichment] = await Promise.all([
        this.authorizedChain(actor, proposalId),
        Promise.resolve<ProposalReadinessResponse>({
          nextStep: 'COMPLETE_AND_ISSUE',
          nextStepTransition: null,
          availableTransitions: [],
          blockers: [],
        }),
        this.buildClientEnrichment(actor, proposal.client_id),
      ]);
      return buildProposalDetail(
        proposal,
        null,
        [],
        [],
        {
          related: enrichment,
          linkedChain: chain,
          readiness,
        },
        await this.visibilityFor(actor, proposal),
      );
    }

    const version = await this.requireVersion(proposalId, versionNumber);
    const [items, documents, versions, chain] = await Promise.all([
      this.proposalsRepository.listItems(version.id),
      this.proposalsRepository.listDocumentLinks(version.id),
      this.proposalsRepository.listVersions(proposalId),
      this.authorizedChain(actor, proposalId),
    ]);

    const [enrichment, readiness, revisionComparison, costVisibility] = await Promise.all([
      this.buildClientEnrichment(actor, proposal.client_id),
      this.buildReadiness(actor, proposal, version, items),
      this.buildRevisionComparison(proposalId, versions),
      this.visibilityFor(actor, proposal),
    ]);

    const previousVersionNumber =
      versions
        .map((entry) => entry.version_number)
        .filter((number) => number < version.version_number)
        .sort((left, right) => right - left)[0] ?? null;

    const revisions = versions.map((entry) =>
      toProposalRevisionSummaryResponse(
        entry,
        proposal.current_version_number,
        entry.id === version.id ? items.length : 0,
        entry.version_number === version.version_number ? previousVersionNumber : null,
      ),
    );

    const revisionItems = await this.countItemsByVersionNumber(proposalId, versions);
    const revisionsWithCounts = revisions.map((revision) => ({
      ...revision,
      itemCount: revisionItems.get(revision.versionNumber) ?? 0,
    }));

    return buildProposalDetail(
      proposal,
      version,
      items,
      documents,
      {
        related: enrichment,
        revisions: revisionsWithCounts,
        revisionComparison,
        linkedChain: chain,
        readiness,
      },
      costVisibility,
    );
  }

  /**
   * Prontidao derivada das regras reais: transicoes permitidas pelo estado (mesma tabela do
   * dominio) e autorizadas para ESTE ator, bloqueios impostos pelo backend e o proximo passo.
   */
  private async buildReadiness(
    actor: IdentityAuthzContext,
    proposal: ProposalRow,
    version: ProposalVersionRow,
    items: ProposalItemRow[],
  ): Promise<ProposalReadinessResponse> {
    const status = version.status as ProposalVersionStatus;
    const allowed = allowedTransitionsFrom(status);
    const granted = await Promise.all(
      allowed.map(async (transition) => ({
        transition,
        allowed: await this.authz.canPerformRecordAction(
          actor,
          TRANSITION_ACTIONS[transition],
          proposal,
        ),
      })),
    );
    const availableTransitions = granted
      .filter((entry) => entry.allowed)
      .map((entry) => entry.transition);
    const nextStep = nextStepForStatus(status);

    return {
      nextStep: nextStep.step,
      nextStepTransition:
        nextStep.transition && availableTransitions.includes(nextStep.transition)
          ? nextStep.transition
          : null,
      availableTransitions,
      blockers: readinessBlockers({
        status,
        pricingStructure: version.pricing_structure,
        globalSalePriceAmount: version.global_sale_price_amount,
        itemCount: items.length,
        itemsMissingLineAmount: items.filter((item) => !item.line_sale_amount).length,
      }),
    };
  }

  /**
   * Comparacao entre as duas revisoes mais recentes, calculada a partir dos dados persistidos
   * (validade, valor, condicoes, observacoes e itens). Nunca persistida.
   */
  private async buildRevisionComparison(
    proposalId: string,
    versions: ProposalVersionRow[],
  ): Promise<ProposalRevisionDiff | null> {
    if (versions.length < 2) {
      return null;
    }
    const ordered = [...versions].sort((left, right) => left.version_number - right.version_number);
    const previous = ordered[ordered.length - 2]!;
    const current = ordered[ordered.length - 1]!;
    if (previous.version_number === current.version_number) {
      return null;
    }

    const items = await this.proposalsRepository.listItemsForVersionNumbers(proposalId, [
      previous.version_number,
      current.version_number,
    ]);

    return compareProposalRevisions({
      from: previous,
      to: current,
      fromItems: items.filter((item) => item.version_number === previous.version_number),
      toItems: items.filter((item) => item.version_number === current.version_number),
    });
  }

  private async countItemsByVersionNumber(
    proposalId: string,
    versions: ProposalVersionRow[],
  ): Promise<Map<number, number>> {
    if (versions.length === 0) {
      return new Map();
    }
    const items = await this.proposalsRepository.listItemsForVersionNumbers(
      proposalId,
      versions.map((version) => version.version_number),
    );
    const counts = new Map<number, number>();
    for (const item of items) {
      counts.set(item.version_number, (counts.get(item.version_number) ?? 0) + 1);
    }
    return counts;
  }

  /**
   * Elos autorizados. Elo negado e removido e a resposta NAO declara sua existencia — mesmo padrao
   * ja consolidado no pedido de compra e nas solicitacoes de servico (omissao silenciosa).
   */
  private async authorizedChain(
    actor: IdentityAuthzContext,
    proposalId: string,
  ): Promise<ProposalLinkedRow[]> {
    const chain = await this.proposalsRepository.findLinkedChain(proposalId);
    const allowed = await this.authz.filterAuthorizedLinkedChain(actor, chain);
    return chain.filter((row) => allowed.has(`${row.kind}:${row.id}`));
  }

  /** Visibilidade de custo interno resolvida pela trilha autoritativa, uma vez por requisicao. */
  private async visibilityFor(
    actor: IdentityAuthzContext,
    proposal: ProposalRow,
  ): Promise<ProposalCostVisibility> {
    return { includeInternalCost: await this.authz.canReadInternalCost(actor, proposal) };
  }

  /** Nome do cliente em UMA consulta, somente quando o modulo CLIENTES autoriza este ator. */
  private async buildClientEnrichment(
    actor: IdentityAuthzContext,
    clientId: string,
  ): Promise<ProposalRelatedResponse> {
    const labels = await this.buildClientLabels(actor, [clientId]);
    const label = labels.get(clientId) ?? null;
    return { client: label ? { id: clientId, name: label } : null };
  }

  private async buildClientLabels(
    actor: IdentityAuthzContext,
    clientIds: string[],
  ): Promise<Map<string, string>> {
    const distinct = [...new Set(clientIds)];
    const allowed = await this.authz.filterAuthorizedClientIds(actor, distinct);
    if (allowed.size === 0) {
      return new Map();
    }
    const rows = await this.proposalsRepository.listClientLabels([...allowed]);
    return new Map(
      rows.map((row) => [
        row.id,
        row.trade_name?.trim() ? row.trade_name : row.legal_name,
      ]),
    );
  }

  async list(
    actor: IdentityAuthzContext,
    query: ProposalListQuery,
  ): Promise<{ items: ProposalListItemResponse[]; limit: number; offset: number }> {
    const scopeFilter = await this.authz.buildListScopeFilter(actor);

    let whereClause: { clause: string; params: unknown[] };
    let orderClause: string;
    try {
      whereClause = buildProposalListWhere(
        { clause: scopeFilter.clause === 'TRUE' ? 'TRUE' : scopeFilter.clause, params: scopeFilter.params },
        query,
      );
      orderClause = buildProposalListOrderClause(query.sort, query.direction);
    } catch (error) {
      if (error instanceof ProposalListQueryError) {
        throw new CommercialHttpException(
          HttpStatus.BAD_REQUEST,
          COMMERCIAL_ERROR_CODES.VALIDATION_FAILED,
          'Invalid query parameters.',
        );
      }
      throw error;
    }

    const rows = await this.proposalsRepository.listProposalsForWorkbench(
      whereClause.clause,
      whereClause.params,
      query.limit,
      query.offset,
      orderClause,
    );

    const clientLabels = await this.buildClientLabels(
      actor,
      rows.map((row) => row.client_id),
    );
    const originsByProposal = await this.authorizedOriginRequests(
      actor,
      rows.map((row) => row.id),
    );

    return {
      items: rows.map((row) =>
        toProposalWorkbenchItemResponse(row, {
          clientName: clientLabels.get(row.client_id) ?? null,
          originRequests: originsByProposal.get(row.id) ?? [],
        }),
      ),
      limit: query.limit,
      offset: query.offset,
    };
  }

  /**
   * Solicitacoes de origem que ESTE ator pode ler. UMA consulta para a pagina inteira e uma
   * decisao de autorizacao por solicitacao distinta (memorizada) — nunca uma consulta por linha.
   */
  private async authorizedOriginRequests(
    actor: IdentityAuthzContext,
    proposalIds: string[],
  ): Promise<Map<string, Array<{ id: string; requestCode: string; status: string }>>> {
    const result = new Map<string, Array<{ id: string; requestCode: string; status: string }>>();
    if (proposalIds.length === 0) {
      return result;
    }
    const rows = await this.proposalsRepository.listOriginRequests(proposalIds);
    if (rows.length === 0) {
      return result;
    }
    const allowed = await this.authz.filterAuthorizedLinkedChain(actor, rows);
    for (const row of rows) {
      // O agrupamento por proposta vem do proprio vinculo (`sr.service_requests.proposal_id`).
      const proposalId = row.proposal_id;
      if (!proposalId || !allowed.has(`${row.kind}:${row.id}`)) {
        continue;
      }
      const bucket = result.get(proposalId) ?? [];
      bucket.push({ id: row.id, requestCode: row.label, status: row.status ?? '' });
      result.set(proposalId, bucket);
    }
    return result;
  }

  async getVersion(
    actor: IdentityAuthzContext,
    proposalId: string,
    versionNumber: number,
  ): Promise<ProposalVersionResponse> {
    assertValidProposalId(proposalId);
    const proposal = await this.requireProposal(
      actor,
      proposalId,
      AUTHZ_ACTIONS.CommercialProposalRead,
    );
    const version = await this.requireVersion(proposalId, versionNumber);
    const items = await this.proposalsRepository.listItems(version.id);
    const documents = await this.proposalsRepository.listDocumentLinks(version.id);
    return toProposalVersionResponse(
      version,
      items,
      documents,
      await this.visibilityFor(actor, proposal),
    );
  }

  async listVersions(
    actor: IdentityAuthzContext,
    proposalId: string,
  ): Promise<ProposalVersionResponse[]> {
    assertValidProposalId(proposalId);
    const proposal = await this.requireProposal(
      actor,
      proposalId,
      AUTHZ_ACTIONS.CommercialProposalRead,
    );
    const versions = await this.proposalsRepository.listVersions(proposalId);
    if (versions.length === 0) {
      return [];
    }
    const versionIds = versions.map((version) => version.id);
    const [allItems, allDocuments] = await Promise.all([
      this.proposalsRepository.listItemsForVersions(versionIds),
      this.proposalsRepository.listDocumentLinksForVersions(versionIds),
    ]);
    const itemsByVersion = groupRowsByKey(allItems, 'proposal_version_id');
    const documentsByVersion = groupRowsByKey(allDocuments, 'proposal_version_id');
    const visibility = await this.visibilityFor(actor, proposal);
    return versions.map((version) =>
      toProposalVersionResponse(
        version,
        itemsByVersion.get(version.id) ?? [],
        documentsByVersion.get(version.id) ?? [],
        visibility,
      ),
    );
  }

  private async requireProposal(
    actor: IdentityAuthzContext,
    proposalId: string,
    action: AuthzAction,
  ): Promise<ProposalRow> {
    const proposal = await this.proposalsRepository.findProposalById(proposalId);
    if (!proposal) {
      throw proposalsAccessNotFound();
    }
    await this.authz.assertRecordAction(actor, action, proposal);
    return proposal;
  }

  private async requireVersion(proposalId: string, versionNumber: number) {
    const version = await this.proposalsRepository.findVersion(proposalId, versionNumber);
    if (!version) {
      throw proposalsVersionNotFound();
    }
    return version;
  }
}