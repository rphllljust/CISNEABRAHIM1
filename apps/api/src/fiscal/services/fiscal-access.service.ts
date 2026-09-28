import { Inject, Injectable } from '@nestjs/common';
import {
  SECURITY_AUDIT_ACTIONS,
  SECURITY_AUDIT_CLASSIFICATIONS,
  SECURITY_AUDIT_OUTCOMES,
  SECURITY_AUDIT_RESOURCE_TYPES,
} from '../../audit/types/security-audit.types';
import { SecurityAuditService } from '../../audit/services/security-audit.service';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { SodEnforcementService } from '../../authorization/services/sod-enforcement.service';
import { SOD_DUTIES, resolveSodScope } from '../../authorization/domain/segregation-of-duties';
import type { FiscalDocumentPort } from '../../platform/bounded-contexts/enterprise-core-ports';
import { assertUuid } from '../../platform/kernel/uuid';
import {
  FISCAL_EVENT_TYPES,
  FISCAL_GATEWAY_OUTCOMES,
  FISCAL_STATUSES,
  FiscalError,
  eventTypeForStatus,
  nextStatusFromGateway,
} from '../domain/fiscal-document';
import {
  validateCancelInput,
  validateCreateFiscalDocumentInput,
  validateFiscalDocumentListQuery,
  type CreateFiscalDocumentInput,
} from '../domain/fiscal-document.validation';
import {
  assertFiscalTransmissionAllowed,
  assertOfficialAuthorizationAllowed,
} from '../domain/fiscal-credentialing';
import {
  FISCAL_AUTHORIZATION_GATEWAY,
  type FiscalAuthorizationGateway,
} from '../ports/fiscal-authorization-gateway.port';
import { FISCAL_CERTIFICATE_PORT, type FiscalCertificatePort } from '../ports/fiscal-certificate.port';
import {
  FISCAL_CREDENTIALING_PORT,
  type FiscalCredentialingPort,
} from '../ports/fiscal-credentialing.port';
import { FiscalRepository } from '../repositories/fiscal.repository';
import type { FiscalAggregate } from '../repositories/fiscal.repository.types';
import {
  toFiscalDocumentPageResponse,
  toFiscalDocumentResponse,
  type FiscalDocumentPageResponse,
  type FiscalDocumentResponse,
} from '../serializers/fiscal-response.serializer';
import { FiscalAccessAuthz } from './fiscal-access.authz';
import { FiscalAccountingIntegrationService } from './fiscal-accounting-integration.service';
import { FiscalPeriodAccessService } from './fiscal-period-access.service';
import { mapFiscalDomainError } from './fiscal-access.errors';
import { IssuerRegistryService } from '../../establishments/services/issuer-registry.service';
import { IssuerHttpException } from '../../establishments/errors/issuer-http.exception';
import { LegalEstablishmentError } from '../../establishments/domain/legal-establishment';
import { mapRegistryError } from '../../establishments/services/establishment-registry-access.errors';
import { FISCAL_PARTY_ROLES } from '../domain/fiscal-document';

@Injectable()
export class FiscalAccessService implements FiscalDocumentPort {
  constructor(
    private readonly repository: FiscalRepository,
    private readonly authz: FiscalAccessAuthz,
    private readonly securityAudit: SecurityAuditService,
    @Inject(FISCAL_AUTHORIZATION_GATEWAY) private readonly gateway: FiscalAuthorizationGateway,
    @Inject(FISCAL_CERTIFICATE_PORT) private readonly certificates: FiscalCertificatePort,
    @Inject(FISCAL_CREDENTIALING_PORT) private readonly credentialing: FiscalCredentialingPort,
    private readonly accountingIntegration: FiscalAccountingIntegrationService,
    private readonly fiscalPeriods: FiscalPeriodAccessService,
    private readonly sod: SodEnforcementService,
    private readonly issuerRegistry: IssuerRegistryService,
  ) {}

  async createDraft(
    actor: IdentityAuthzContext,
    input: CreateFiscalDocumentInput,
  ): Promise<FiscalDocumentResponse> {
    try {
      const validated = validateCreateFiscalDocumentInput(input);
      await this.authz.assertFiscalAction(actor, AUTHZ_ACTIONS.FiscalDocumentDraft, {
        id: actor.identityId,
        unitId: validated.unitId,
      });
      await this.certificates.resolve(validated.certificateRef);
      await this.fiscalPeriods.assertOrdinaryWriteAllowed(validated.unitId, validated.issuedOn);
      let parties = validated.parties;
      const establishmentId = validated.establishmentId;
      if (establishmentId) {
        // FiscalDocument referencia o estabelecimento emissor do registry:
        // o emissor é sempre resolvido do cadastro (nunca hardcoded).
        const issuer = await this.issuerRegistry.resolveEstablishmentIssuer(establishmentId);
        parties = [
          {
            role: FISCAL_PARTY_ROLES.Issuer,
            legalName: issuer.legalName,
            taxIdentifier: issuer.normalizedCnpj,
            partySnapshot: {
              establishmentId: issuer.establishmentId,
              establishmentCode: issuer.code,
            },
          },
          ...validated.parties.filter((party) => party.role !== FISCAL_PARTY_ROLES.Issuer),
        ];
      }
      const aggregate = await this.repository.createDraft({
        ...validated,
        parties,
        establishmentId,
        taxDetails: validated.taxDetails ?? [],
        actorIdentityId: actor.identityId,
      });
      await this.audit(actor, SECURITY_AUDIT_ACTIONS.FiscalDocumentDraft, aggregate.document.id, {
        sourceKind: validated.sourceKind,
        billingDocumentId: validated.billingDocumentId ?? null,
        establishmentId: establishmentId ?? null,
      });
      return this.toResponse(aggregate);
    } catch (error) {
      if (error instanceof IssuerHttpException) {
        throw error;
      }
      if (error instanceof LegalEstablishmentError) {
        throw mapRegistryError(error);
      }
      throw mapFiscalDomainError(error);
    }
  }

  async replaceSnapshots(
    actor: IdentityAuthzContext,
    fiscalDocumentId: string,
    input: Pick<CreateFiscalDocumentInput, 'parties' | 'items' | 'taxDetails'> & { rowVersion: number },
  ): Promise<FiscalDocumentResponse> {
    assertUuid(fiscalDocumentId, 'fiscalDocumentId');
    try {
      const current = await this.requireDocument(fiscalDocumentId);
      await this.authz.assertFiscalAction(actor, AUTHZ_ACTIONS.FiscalDocumentDraft, {
        id: current.document.id,
        unitId: current.document.unit_id,
      });
      await this.fiscalPeriods.assertOrdinaryWriteAllowed(
        current.document.unit_id,
        current.document.issued_on,
      );
      const validated = validateCreateFiscalDocumentInput({
        unitId: current.document.unit_id,
        sourceKind: current.document.source_kind,
        sourceId: current.document.source_id ?? undefined,
        billingDocumentId: current.document.billing_document_id ?? undefined,
        description: current.document.description,
        currencyCode: current.document.currency_code,
        issuedOn: current.document.issued_on,
        idempotencyKey: current.document.idempotency_key,
        parties: input.parties,
        items: input.items,
        taxDetails: input.taxDetails,
      });
      const aggregate = await this.repository.replaceSnapshots({
        fiscalDocumentId,
        rowVersion: input.rowVersion,
        actorIdentityId: actor.identityId,
        parties: validated.parties,
        items: validated.items,
        taxDetails: validated.taxDetails ?? [],
      });
      return this.toResponse(aggregate);
    } catch (error) {
      throw mapFiscalDomainError(error);
    }
  }

  async markReady(
    actor: IdentityAuthzContext,
    fiscalDocumentId: string,
    input: { rowVersion: number },
  ): Promise<FiscalDocumentResponse> {
    return this.simpleTransition(actor, fiscalDocumentId, input.rowVersion, FISCAL_STATUSES.Ready);
  }

  async unready(
    actor: IdentityAuthzContext,
    fiscalDocumentId: string,
    input: { rowVersion: number },
  ): Promise<FiscalDocumentResponse> {
    return this.simpleTransition(
      actor,
      fiscalDocumentId,
      input.rowVersion,
      FISCAL_STATUSES.Draft,
      FISCAL_EVENT_TYPES.Unreadied,
    );
  }

  async submit(
    actor: IdentityAuthzContext,
    fiscalDocumentId: string,
    input: { rowVersion: number },
  ): Promise<FiscalDocumentResponse> {
    assertUuid(fiscalDocumentId, 'fiscalDocumentId');
    try {
      const current = await this.requireDocument(fiscalDocumentId);
      await this.authz.assertFiscalAction(actor, AUTHZ_ACTIONS.FiscalDocumentSubmit, {
        id: current.document.id,
        unitId: current.document.unit_id,
      });
      if (current.document.status === FISCAL_STATUSES.Authorized) {
        return this.toResponse(current);
      }
      const scope = resolveSodScope(current.document.unit_id);
      await this.sod.enforce(actor, {
        duty: SOD_DUTIES.FiscalSubmit,
        originatorIdentityId: current.document.created_by_identity_id,
        ...scope,
      });
      await this.fiscalPeriods.assertOrdinaryWriteAllowed(
        current.document.unit_id,
        current.document.issued_on,
      );
      assertFiscalTransmissionAllowed(this.credentialing.snapshot());
      const result = await this.gateway.submit({
        fiscalDocumentId: current.document.id,
        unitId: current.document.unit_id,
        idempotencyKey: current.document.idempotency_key,
        certificateRef: current.document.certificate_ref,
        requestSnapshot: {
          sourceKind: current.document.source_kind,
          billingDocumentId: current.document.billing_document_id,
        },
      });
      const submitted =
        current.document.status === FISCAL_STATUSES.Submitted
          ? current
          : await this.repository.transition({
              fiscalDocumentId,
              rowVersion: input.rowVersion,
              actorIdentityId: actor.identityId,
              nextStatus: FISCAL_STATUSES.Submitted,
              eventType: FISCAL_EVENT_TYPES.Submitted,
            });
      return this.applyGatewayResult(actor, submitted.document.id, submitted.document.row_version, result);
    } catch (error) {
      throw mapFiscalDomainError(error);
    }
  }

  async recover(
    actor: IdentityAuthzContext,
    fiscalDocumentId: string,
    input: { rowVersion: number },
  ): Promise<FiscalDocumentResponse> {
    return this.submit(actor, fiscalDocumentId, input);
  }

  async revise(
    actor: IdentityAuthzContext,
    fiscalDocumentId: string,
    input: { rowVersion: number },
  ): Promise<FiscalDocumentResponse> {
    return this.simpleTransition(
      actor,
      fiscalDocumentId,
      input.rowVersion,
      FISCAL_STATUSES.Draft,
      FISCAL_EVENT_TYPES.Revised,
      AUTHZ_ACTIONS.FiscalDocumentDraft,
    );
  }

  async cancel(
    actor: IdentityAuthzContext,
    fiscalDocumentId: string,
    input: { rowVersion: number; reason: string },
  ): Promise<FiscalDocumentResponse> {
    assertUuid(fiscalDocumentId, 'fiscalDocumentId');
    try {
      const current = await this.requireDocument(fiscalDocumentId);
      await this.authz.assertFiscalAction(actor, AUTHZ_ACTIONS.FiscalDocumentCancel, {
        id: current.document.id,
        unitId: current.document.unit_id,
      });
      const validated = validateCancelInput(input);
      const aggregate = await this.repository.transition({
        fiscalDocumentId,
        rowVersion: validated.rowVersion,
        actorIdentityId: actor.identityId,
        nextStatus: FISCAL_STATUSES.Cancelled,
        eventType: FISCAL_EVENT_TYPES.Cancelled,
        cancelReason: validated.reason,
      });
      await this.audit(actor, SECURITY_AUDIT_ACTIONS.FiscalDocumentCancel, aggregate.document.id, {
        reason: validated.reason,
      });
      await this.accountingIntegration.tryReverseCancelledDocument(
        actor,
        aggregate.document.id,
        validated.reason,
      );
      return this.toResponse(aggregate);
    } catch (error) {
      throw mapFiscalDomainError(error);
    }
  }

  async getDocument(actor: IdentityAuthzContext, fiscalDocumentId: string): Promise<FiscalDocumentResponse> {
    assertUuid(fiscalDocumentId, 'fiscalDocumentId');
    try {
      const aggregate = await this.requireDocument(fiscalDocumentId);
      await this.authz.assertFiscalAction(actor, AUTHZ_ACTIONS.FiscalDocumentRead, {
        id: aggregate.document.id,
        unitId: aggregate.document.unit_id,
      });
      return this.toResponse(aggregate);
    } catch (error) {
      throw mapFiscalDomainError(error);
    }
  }

  /**
   * Lista paginada de documentos fiscais da unidade. Consulta pura (sem escrita) para a
   * superficie de situacao/consulta: substitui a exigencia de digitar identificador manual.
   * Autorizacao resolvida por escopo de unidade (`fiscal:document:list`).
   */
  async listDocuments(
    actor: IdentityAuthzContext,
    query: { unitId: string } & Record<string, unknown>,
  ): Promise<FiscalDocumentPageResponse> {
    try {
      const validated = validateFiscalDocumentListQuery(query);
      await this.authz.assertFiscalAction(actor, AUTHZ_ACTIONS.FiscalDocumentList, {
        id: validated.unitId,
        unitId: validated.unitId,
      });
      const result = await this.repository.listDocumentPage({
        unitId: validated.unitId,
        status: validated.status,
        sourceKind: validated.sourceKind,
        billingDocumentId: validated.billingDocumentId,
        issuedFrom: validated.issuedFrom,
        issuedTo: validated.issuedTo,
        page: validated.page,
        pageSize: validated.pageSize,
      });
      return toFiscalDocumentPageResponse({
        page: validated.page,
        pageSize: validated.pageSize,
        total: result.total,
        items: result.items,
      });
    } catch (error) {
      throw mapFiscalDomainError(error);
    }
  }

  /**
   * READ CONTRACT do port (ver `FiscalDocumentPort`): fatos fiscais da competencia para o
   * fechamento contabil. A tabela `fis.fiscal_documents` pertence a ESTE contexto, entao a
   * leitura mora aqui — o consumidor nao toca o schema privado.
   *
   * Nao avalia autorizacao: quem consome decide antes de chamar (o fechamento so monta a secao
   * fiscal quando o ator tem concessao de leitura de documento fiscal).
   */
  async countDocumentsInWindow(input: {
    unitId: string;
    startsOn: string;
    endsOn: string;
  }): Promise<{ unauthorized: number; rejected: number; pendingAuthorization: number; draft: number }> {
    return this.repository.countDocumentsInWindow(input);
  }

  async createFromSource(input: {
    sourceKind: string;
    sourceId: string;
    unitId: string;
    actorIdentityId: string;
    idempotencyKey: string;
    description: string;
    currencyCode: string;
    issuedOn: string;
    parties: CreateFiscalDocumentInput['parties'];
    items: CreateFiscalDocumentInput['items'];
    taxDetails?: CreateFiscalDocumentInput['taxDetails'];
    billingDocumentId?: string;
  }): Promise<{ fiscalDocumentId: string; idempotent: boolean }> {
    try {
      const before = await this.repository.findByIdempotency({
        unitId: input.unitId,
        idempotencyKey: input.idempotencyKey,
        sourceKind: input.sourceKind,
        sourceId: input.sourceId,
      });
      const created = await this.createDraft(
        { identityId: input.actorIdentityId, sessionId: 'source' },
        {
          unitId: input.unitId,
          sourceKind: input.sourceKind,
          sourceId: input.sourceId,
          billingDocumentId: input.billingDocumentId,
          description: input.description,
          currencyCode: input.currencyCode,
          issuedOn: input.issuedOn,
          idempotencyKey: input.idempotencyKey,
          parties: input.parties,
          items: input.items,
          taxDetails: input.taxDetails,
        },
      );
      return { fiscalDocumentId: created.id, idempotent: Boolean(before) };
    } catch (error) {
      throw mapFiscalDomainError(error);
    }
  }

  private async simpleTransition(
    actor: IdentityAuthzContext,
    fiscalDocumentId: string,
    rowVersion: number,
    nextStatus: string,
    eventType?: string,
    action: (typeof AUTHZ_ACTIONS)[keyof typeof AUTHZ_ACTIONS] = AUTHZ_ACTIONS.FiscalDocumentDraft,
  ): Promise<FiscalDocumentResponse> {
    assertUuid(fiscalDocumentId, 'fiscalDocumentId');
    try {
      const current = await this.requireDocument(fiscalDocumentId);
      await this.authz.assertFiscalAction(actor, action, {
        id: current.document.id,
        unitId: current.document.unit_id,
      });
      await this.fiscalPeriods.assertOrdinaryWriteAllowed(
        current.document.unit_id,
        current.document.issued_on,
      );
      const aggregate = await this.repository.transition({
        fiscalDocumentId,
        rowVersion,
        actorIdentityId: actor.identityId,
        nextStatus,
        eventType: eventType ?? eventTypeForStatus(nextStatus),
      });
      return this.toResponse(aggregate);
    } catch (error) {
      throw mapFiscalDomainError(error);
    }
  }

  private async applyGatewayResult(
    actor: IdentityAuthzContext,
    fiscalDocumentId: string,
    rowVersion: number,
    result: {
      outcome: 'AUTHORIZED' | 'REJECTED' | 'TIMEOUT';
      protocolCode?: string | null;
      message?: string | null;
      responseSnapshot?: Record<string, unknown>;
    },
  ): Promise<FiscalDocumentResponse> {
    const current = await this.requireDocument(fiscalDocumentId);
    if (result.outcome === FISCAL_GATEWAY_OUTCOMES.Authorized) {
      assertOfficialAuthorizationAllowed({
        approved: this.credentialing.snapshot().approved,
        protocolCode: result.protocolCode,
      });
    }
    const nextStatus = nextStatusFromGateway(result.outcome);
    const eventType =
      result.outcome === FISCAL_GATEWAY_OUTCOMES.Timeout
        ? FISCAL_EVENT_TYPES.TimedOut
        : eventTypeForStatus(nextStatus);
    const aggregate = await this.repository.recordAuthorizationAttempt({
      fiscalDocumentId,
      rowVersion,
      actorIdentityId: actor.identityId,
      gatewayId: this.gateway.gatewayId,
      outcome: result.outcome,
      nextStatus,
      eventType,
      protocolCode: result.protocolCode,
      message: result.message,
      requestSnapshot: {
        sourceKind: current.document.source_kind,
        billingDocumentId: current.document.billing_document_id,
      },
      responseSnapshot: result.responseSnapshot ?? {},
    });
    if (nextStatus === FISCAL_STATUSES.Authorized) {
      await this.audit(actor, SECURITY_AUDIT_ACTIONS.FiscalDocumentAuthorize, aggregate.document.id, {
        gatewayId: this.gateway.gatewayId,
        protocolCode: result.protocolCode ?? null,
      });
      await this.accountingIntegration.tryPostAuthorizedDocument(actor, aggregate.document.id);
    }
    return this.toResponse(aggregate);
  }

  private toResponse(aggregate: FiscalAggregate): FiscalDocumentResponse {
    return toFiscalDocumentResponse(aggregate, this.credentialing.snapshot());
  }

  private async requireDocument(fiscalDocumentId: string) {
    const row = await this.repository.findById(fiscalDocumentId);
    if (!row) {
      throw new FiscalError('FISCAL_NOT_FOUND');
    }
    return row;
  }

  private async audit(
    actor: IdentityAuthzContext,
    action: (typeof SECURITY_AUDIT_ACTIONS)[keyof typeof SECURITY_AUDIT_ACTIONS],
    resourceId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.FiscalDocument,
      resourceId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata,
    });
  }
}
