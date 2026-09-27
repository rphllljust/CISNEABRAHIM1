import { Inject, Injectable } from '@nestjs/common';
import type { AuthzAction } from '../../authorization/types/authz-actions';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import {
  SERVICE_REQUEST_CONVERSION_PORT,
  type ServiceRequestConversionPort,
} from '../domain/service-request-conversion.port';
import type { ServiceRequestStatus } from '../domain/service-request';
import {
  assertTransition,
  ServiceRequestStateError,
} from '../domain/service-request.state-machine';
import {
  ServiceRequestValidationError,
  type ApproveServiceRequestInput,
  type CancelServiceRequestInput,
  type CreateServiceRequestInput,
  type LinkServiceRequestDocumentInput,
  type RejectServiceRequestInput,
  type UpdateServiceRequestDraftInput,
} from '../domain/service-request.validation';
import type { ServiceRequestDetailResponse } from '../serializers/service-requests-response.serializer';
import { ServiceRequestsAccessAuthz } from './service-requests-access.authz';
import { ServiceRequestsAccessAudit } from './service-requests-access.audit';
import {
  serviceRequestsAccessDenied,
  serviceRequestsAccessNotFound,
  serviceRequestsConversionNotAllowed,
  serviceRequestsDocumentNotFound,
  serviceRequestsDuplicateIdempotency,
  serviceRequestsInvalidState,
  serviceRequestsServiceNotFound,
  serviceRequestsValidationFailed,
  serviceRequestsVersionConflict,
} from './service-requests-access.errors';
import { ServiceRequestsAccessIdempotency } from './service-requests-access.idempotency';
import { assertValidServiceRequestId, generateServiceRequestCode } from './service-requests-input-resolution';
import { ServiceRequestsAccessPersistence } from './service-requests-access.persistence';
import { ServiceRequestsAccessQuery } from './service-requests-access.query';
import { ServiceRequestsAccessValidation } from './service-requests-access.validation';

@Injectable()
export class ServiceRequestsAccessCommands {
  constructor(
    private readonly authz: ServiceRequestsAccessAuthz,
    private readonly persistence: ServiceRequestsAccessPersistence,
    private readonly validation: ServiceRequestsAccessValidation,
    private readonly idempotency: ServiceRequestsAccessIdempotency,
    private readonly query: ServiceRequestsAccessQuery,
    private readonly audit: ServiceRequestsAccessAudit,
    @Inject(SERVICE_REQUEST_CONVERSION_PORT)
    private readonly conversionPort: ServiceRequestConversionPort,
  ) {}

  async create(
    actor: IdentityAuthzContext,
    input: CreateServiceRequestInput,
  ): Promise<ServiceRequestDetailResponse> {
    const replay = await this.idempotency.resolveCreateReplay(actor, input);
    if (replay) {
      return replay;
    }

    const validated = this.validation.validateCreate(input);
    await this.authz.assertCreateAction(actor, input.clientId, input.unitId);
    const unitRegistered = await this.persistence.isUnitRegistered(input.unitId);
    await this.validation.assertCreateReferences(actor, input, unitRegistered);

    try {
      const created = await this.persistence.create({
        requestCode: generateServiceRequestCode(),
        unitId: input.unitId,
        originSource: validated.originSource,
        externalContact: validated.externalContact,
        externalOriginReference: input.externalOriginReference?.trim() || null,
        clientId: input.clientId ?? null,
        serviceDefinitionId: input.serviceDefinitionId ?? null,
        serviceDefinitionVersionId: input.serviceDefinitionVersionId ?? null,
        description: input.description?.trim() || null,
        location: validated.location,
        desiredStartAt: input.desiredStartAt ?? null,
        desiredEndAt: input.desiredEndAt ?? null,
        operationalNotes: input.operationalNotes?.trim() || null,
        proposalId: input.proposalId ?? null,
        purchaseOrderId: input.purchaseOrderId ?? null,
        idempotencyKey: input.idempotencyKey?.trim() || null,
        actorIdentityId: actor.identityId,
      });

      await this.audit.recordCreate(actor, created);
      return this.query.toDetail(actor, created);
    } catch (error) {
      if (this.persistence.isIdempotencyViolation(error)) {
        throw serviceRequestsDuplicateIdempotency();
      }
      throw error;
    }
  }

  async updateDraft(
    actor: IdentityAuthzContext,
    serviceRequestId: string,
    input: UpdateServiceRequestDraftInput,
  ): Promise<ServiceRequestDetailResponse> {
    assertValidServiceRequestId(serviceRequestId);
    await this.query.requireRecord(actor, serviceRequestId, AUTHZ_ACTIONS.RequestsServiceRequestUpdate);

    const validated = this.validation.validateUpdateDraft(input);

    const current = await this.persistence.findById(serviceRequestId);
    if (!current) {
      throw serviceRequestsAccessNotFound();
    }

    await this.validation.assertUpdateReferences(actor, current, validated);

    const updated = await this.persistence.updateDraft({
      serviceRequestId,
      rowVersion: validated.rowVersion,
      originSource: validated.originSource,
      externalContact: validated.externalContact,
      externalOriginReference: validated.externalOriginReference,
      clientId: validated.clientId,
      serviceDefinitionId: validated.serviceDefinitionId,
      serviceDefinitionVersionId: validated.serviceDefinitionVersionId,
      description: validated.description,
      location: validated.location,
      desiredStartAt: validated.desiredStartAt,
      desiredEndAt: validated.desiredEndAt,
      operationalNotes: validated.operationalNotes,
      proposalId: validated.proposalId,
      purchaseOrderId: validated.purchaseOrderId,
      actorIdentityId: actor.identityId,
    });

    if (updated === 'VERSION_CONFLICT') {
      throw serviceRequestsVersionConflict();
    }
    if (updated === 'INVALID_STATE') {
      throw serviceRequestsInvalidState();
    }

    return this.query.toDetail(actor, updated);
  }

  async submit(
    actor: IdentityAuthzContext,
    serviceRequestId: string,
    input: { rowVersion: number },
  ): Promise<ServiceRequestDetailResponse> {
    assertValidServiceRequestId(serviceRequestId);
    const current = await this.query.requireRecord(
      actor,
      serviceRequestId,
      AUTHZ_ACTIONS.RequestsServiceRequestSubmit,
    );
    this.validation.validateSubmitReady(current);
    return this.transition(actor, serviceRequestId, input, 'submit', AUTHZ_ACTIONS.RequestsServiceRequestSubmit);
  }

  async startReview(
    actor: IdentityAuthzContext,
    serviceRequestId: string,
    input: { rowVersion: number },
  ): Promise<ServiceRequestDetailResponse> {
    return this.transition(actor, serviceRequestId, input, 'startReview', AUTHZ_ACTIONS.RequestsServiceRequestReview);
  }

  async approve(
    actor: IdentityAuthzContext,
    serviceRequestId: string,
    input: ApproveServiceRequestInput,
  ): Promise<ServiceRequestDetailResponse> {
    const validated = this.validation.validateApprove(input);
    return this.transition(
      actor,
      serviceRequestId,
      validated,
      'approve',
      AUTHZ_ACTIONS.RequestsServiceRequestApprove,
      validated.priority ?? null,
    );
  }

  async reject(
    actor: IdentityAuthzContext,
    serviceRequestId: string,
    input: RejectServiceRequestInput,
  ): Promise<ServiceRequestDetailResponse> {
    const validated = this.validation.validateReject(input);
    return this.transition(
      actor,
      serviceRequestId,
      validated,
      'reject',
      AUTHZ_ACTIONS.RequestsServiceRequestReject,
      null,
      validated.rejectionReason,
    );
  }

  async cancel(
    actor: IdentityAuthzContext,
    serviceRequestId: string,
    input: CancelServiceRequestInput,
  ): Promise<ServiceRequestDetailResponse> {
    const validated = this.validation.validateCancel(input);
    return this.transition(
      actor,
      serviceRequestId,
      validated,
      'cancel',
      AUTHZ_ACTIONS.RequestsServiceRequestCancel,
      null,
      null,
      validated.cancellationReason,
    );
  }

  async convert(
    actor: IdentityAuthzContext,
    serviceRequestId: string,
    input: { rowVersion: number },
  ): Promise<ServiceRequestDetailResponse> {
    assertValidServiceRequestId(serviceRequestId);
    const current = await this.query.requireRecord(
      actor,
      serviceRequestId,
      AUTHZ_ACTIONS.RequestsServiceRequestConvert,
    );

    let validated;
    try {
      validated = this.validation.validateRowVersion(input);
      assertTransition(current.status as ServiceRequestStatus, 'convert');
    } catch (error) {
      if (error instanceof ServiceRequestValidationError || error instanceof ServiceRequestStateError) {
        if (error instanceof ServiceRequestStateError && error.code === 'CONVERSION_NOT_ALLOWED') {
          throw serviceRequestsConversionNotAllowed();
        }
        throw serviceRequestsInvalidState();
      }
      throw error;
    }

    const conversion = await this.conversionPort.convert({
      serviceRequestId,
      rowVersion: validated.rowVersion,
      actorIdentityId: actor.identityId,
    });

    switch (conversion.outcome) {
      case 'converted':
        await this.audit.recordConvert(actor, serviceRequestId, conversion.serviceOrderId);
        break;
      case 'already_converted':
        throw serviceRequestsInvalidState();
      case 'version_conflict':
        throw serviceRequestsVersionConflict();
      case 'service_not_found':
        throw serviceRequestsServiceNotFound();
      case 'invalid_state':
        throw serviceRequestsInvalidState();
      default:
        throw serviceRequestsInvalidState();
    }

    const converted = await this.persistence.findById(serviceRequestId);
    if (!converted) {
      throw serviceRequestsAccessNotFound();
    }

    return this.query.toDetail(actor, converted);
  }

  async linkDocument(
    actor: IdentityAuthzContext,
    serviceRequestId: string,
    input: LinkServiceRequestDocumentInput,
  ): Promise<ServiceRequestDetailResponse> {
    assertValidServiceRequestId(serviceRequestId);
    const current = await this.query.requireRecord(
      actor,
      serviceRequestId,
      AUTHZ_ACTIONS.RequestsServiceRequestUpdate,
    );

    const validated = this.validation.validateLinkDocument(input);

    const document = await this.persistence.findDocumentById(validated.documentId);
    if (!document) {
      throw serviceRequestsDocumentNotFound();
    }
    if (document.unit_id !== current.unit_id) {
      throw serviceRequestsAccessDenied();
    }

    await this.persistence.linkDocument(
      serviceRequestId,
      validated.documentId,
      validated.linkPurpose,
      actor.identityId,
    );

    return this.query.getById(actor, serviceRequestId);
  }

  private async transition(
    actor: IdentityAuthzContext,
    serviceRequestId: string,
    input: { rowVersion: number; priority?: string | null },
    transition: 'submit' | 'startReview' | 'approve' | 'reject' | 'cancel',
    action: AuthzAction,
    priority: string | null = null,
    rejectionReason: string | null = null,
    cancellationReason: string | null = null,
  ): Promise<ServiceRequestDetailResponse> {
    assertValidServiceRequestId(serviceRequestId);
    const current = await this.query.requireRecord(actor, serviceRequestId, action);

    let nextStatus: ServiceRequestStatus;
    try {
      this.validation.validateRowVersion(input);
      nextStatus = assertTransition(current.status as ServiceRequestStatus, transition);
    } catch (error) {
      if (error instanceof ServiceRequestValidationError || error instanceof ServiceRequestStateError) {
        throw error instanceof ServiceRequestStateError ? serviceRequestsInvalidState() : serviceRequestsValidationFailed();
      }
      throw error;
    }

    const updated = await this.persistence.transition({
      serviceRequestId,
      rowVersion: input.rowVersion,
      nextStatus,
      actorIdentityId: actor.identityId,
      currentStatus: current.status,
      priority,
      rejectionReason,
      cancellationReason,
      transitionField: transition,
    });

    if (updated === 'VERSION_CONFLICT') {
      throw serviceRequestsVersionConflict();
    }
    if (updated === 'INVALID_STATE') {
      throw serviceRequestsInvalidState();
    }

    await this.audit.recordTransition(actor, serviceRequestId, transition);
    return this.query.toDetail(actor, updated);
  }
}