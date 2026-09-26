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
import { PROPOSAL_VERSION_STATUSES } from '../domain/proposal';
import { buildCommercialItemSnapshot } from '../domain/proposal-commercial-snapshot';
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
import type { ProposalRow } from '../repositories/proposals.repository.types';
import {
  buildProposalDetail,
  toProposalListItemResponse,
  toProposalResponse,
  toProposalVersionResponse,
  type ProposalDetailResponse,
  type ProposalListItemResponse,
  type ProposalResponse,
  type ProposalVersionResponse,
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

    return buildProposalDetail(created.proposal, created.version, created.items, []);
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
    return buildProposalDetail(updated.proposal, updated.version, updated.items, documents);
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

    return buildProposalDetail(result.proposal, result.version, result.items, []);
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
    return toProposalVersionResponse(issued, issuedItems, documents);
  }

  async accept(
    actor: IdentityAuthzContext,
    proposalId: string,
    versionNumber: number,
    input: AcceptProposalInput,
  ): Promise<ProposalVersionResponse> {
    assertValidProposalId(proposalId);
    await this.requireProposal(actor, proposalId, AUTHZ_ACTIONS.CommercialProposalAccept);

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
    return toProposalVersionResponse(accepted, items, documents);
  }

  async reject(
    actor: IdentityAuthzContext,
    proposalId: string,
    versionNumber: number,
    input: RejectProposalInput,
  ): Promise<ProposalVersionResponse> {
    assertValidProposalId(proposalId);
    await this.requireProposal(actor, proposalId, AUTHZ_ACTIONS.CommercialProposalReject);

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
    return toProposalVersionResponse(rejected, items, documents);
  }

  async expire(
    actor: IdentityAuthzContext,
    proposalId: string,
    versionNumber: number,
    rowVersion: number,
  ): Promise<ProposalVersionResponse> {
    assertValidProposalId(proposalId);
    await this.requireProposal(actor, proposalId, AUTHZ_ACTIONS.CommercialProposalExpire);

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
    return toProposalVersionResponse(expired, items, documents);
  }

  async cancel(
    actor: IdentityAuthzContext,
    proposalId: string,
    versionNumber: number,
    input: CancelProposalInput,
  ): Promise<ProposalVersionResponse> {
    assertValidProposalId(proposalId);
    await this.requireProposal(actor, proposalId, AUTHZ_ACTIONS.CommercialProposalCancel);

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
    return toProposalVersionResponse(cancelled, items, documents);
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
    return buildProposalDetail(proposal, version, items, documents);
  }

  async getById(actor: IdentityAuthzContext, proposalId: string): Promise<ProposalDetailResponse> {
    assertValidProposalId(proposalId);
    const proposal = await this.requireProposal(actor, proposalId, AUTHZ_ACTIONS.CommercialProposalRead);
    const versionNumber = proposal.current_version_number;
    if (!versionNumber) {
      return buildProposalDetail(proposal, null, [], []);
    }
    const version = await this.requireVersion(proposalId, versionNumber);
    const items = await this.proposalsRepository.listItems(version.id);
    const documents = await this.proposalsRepository.listDocumentLinks(version.id);
    return buildProposalDetail(proposal, version, items, documents);
  }

  async getVersion(
    actor: IdentityAuthzContext,
    proposalId: string,
    versionNumber: number,
  ): Promise<ProposalVersionResponse> {
    assertValidProposalId(proposalId);
    await this.requireProposal(actor, proposalId, AUTHZ_ACTIONS.CommercialProposalRead);
    const version = await this.requireVersion(proposalId, versionNumber);
    const items = await this.proposalsRepository.listItems(version.id);
    const documents = await this.proposalsRepository.listDocumentLinks(version.id);
    return toProposalVersionResponse(version, items, documents);
  }

  async listVersions(
    actor: IdentityAuthzContext,
    proposalId: string,
  ): Promise<ProposalVersionResponse[]> {
    assertValidProposalId(proposalId);
    await this.requireProposal(actor, proposalId, AUTHZ_ACTIONS.CommercialProposalRead);
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
    return versions.map((version) =>
      toProposalVersionResponse(
        version,
        itemsByVersion.get(version.id) ?? [],
        documentsByVersion.get(version.id) ?? [],
      ),
    );
  }

  async list(
    actor: IdentityAuthzContext,
    query: { clientId?: string; unitId?: string; limit: number; offset: number },
  ): Promise<{ items: ProposalListItemResponse[]; limit: number; offset: number }> {
    const scopeFilter = await this.authz.buildListScopeFilter(actor);

    const clauses = [scopeFilter.clause === 'TRUE' ? 'TRUE' : scopeFilter.clause];
    const params = [...scopeFilter.params];
    if (query.clientId) {
      params.push(query.clientId);
      clauses.push(`client_id = $${params.length}::uuid`);
    }
    if (query.unitId) {
      params.push(query.unitId);
      clauses.push(`unit_id = $${params.length}`);
    }

    const items = await this.proposalsRepository.listProposals(
      clauses.join(' AND '),
      params,
      query.limit,
      query.offset,
    );

    // Enriquecimento ADITIVO da listagem: uma unica consulta extra por pagina para trazer a
    // versao corrente de todas as propostas retornadas (nunca uma consulta por proposta).
    // A autorizacao e a consulta de listagem permanecem exatamente como estavam.
    const currentVersions =
      items.length === 0
        ? []
        : await this.proposalsRepository.findCurrentVersionsForProposals(
            items.map((item) => item.id),
          );
    const versionByProposalId = new Map(
      currentVersions.map((version) => [version.proposal_id, version]),
    );

    return {
      items: items.map((item) =>
        toProposalListItemResponse(item, versionByProposalId.get(item.id) ?? null),
      ),
      limit: query.limit,
      offset: query.offset,
    };
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
