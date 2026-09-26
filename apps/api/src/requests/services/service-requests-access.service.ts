import { Injectable } from '@nestjs/common';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import type {
  ApproveServiceRequestInput,
  CancelServiceRequestInput,
  CreateServiceRequestInput,
  LinkServiceRequestDocumentInput,
  RejectServiceRequestInput,
  UpdateServiceRequestDraftInput,
} from '../domain/service-request.validation';
import type { ServiceRequestDetailResponse } from '../serializers/service-requests-response.serializer';
import { toServiceRequestResponse } from '../serializers/service-requests-response.serializer';
import { ServiceRequestsAccessCommands } from './service-requests-access.commands';
import { ServiceRequestsAccessQuery } from './service-requests-access.query';

@Injectable()
export class ServiceRequestsAccessService {
  constructor(
    private readonly commands: ServiceRequestsAccessCommands,
    private readonly query: ServiceRequestsAccessQuery,
  ) {}

  listOperationalUnits(actor: IdentityAuthzContext): Promise<{ items: string[] }> {
    return this.query.listOperationalUnits(actor);
  }

  registerOperationalUnit(actor: IdentityAuthzContext, refId: string): Promise<{ items: string[] }> {
    return this.query.registerOperationalUnit(actor, refId);
  }

  create(actor: IdentityAuthzContext, input: CreateServiceRequestInput): Promise<ServiceRequestDetailResponse> {
    return this.commands.create(actor, input);
  }

  updateDraft(
    actor: IdentityAuthzContext,
    serviceRequestId: string,
    input: UpdateServiceRequestDraftInput,
  ): Promise<ServiceRequestDetailResponse> {
    return this.commands.updateDraft(actor, serviceRequestId, input);
  }

  submit(
    actor: IdentityAuthzContext,
    serviceRequestId: string,
    input: { rowVersion: number },
  ): Promise<ServiceRequestDetailResponse> {
    return this.commands.submit(actor, serviceRequestId, input);
  }

  startReview(
    actor: IdentityAuthzContext,
    serviceRequestId: string,
    input: { rowVersion: number },
  ): Promise<ServiceRequestDetailResponse> {
    return this.commands.startReview(actor, serviceRequestId, input);
  }

  approve(
    actor: IdentityAuthzContext,
    serviceRequestId: string,
    input: ApproveServiceRequestInput,
  ): Promise<ServiceRequestDetailResponse> {
    return this.commands.approve(actor, serviceRequestId, input);
  }

  reject(
    actor: IdentityAuthzContext,
    serviceRequestId: string,
    input: RejectServiceRequestInput,
  ): Promise<ServiceRequestDetailResponse> {
    return this.commands.reject(actor, serviceRequestId, input);
  }

  cancel(
    actor: IdentityAuthzContext,
    serviceRequestId: string,
    input: CancelServiceRequestInput,
  ): Promise<ServiceRequestDetailResponse> {
    return this.commands.cancel(actor, serviceRequestId, input);
  }

  convert(
    actor: IdentityAuthzContext,
    serviceRequestId: string,
    input: { rowVersion: number },
  ): Promise<ServiceRequestDetailResponse> {
    return this.commands.convert(actor, serviceRequestId, input);
  }

  linkDocument(
    actor: IdentityAuthzContext,
    serviceRequestId: string,
    input: LinkServiceRequestDocumentInput,
  ): Promise<ServiceRequestDetailResponse> {
    return this.commands.linkDocument(actor, serviceRequestId, input);
  }

  getById(actor: IdentityAuthzContext, serviceRequestId: string): Promise<ServiceRequestDetailResponse> {
    return this.query.getById(actor, serviceRequestId);
  }

  list(
    actor: IdentityAuthzContext,
    query: { clientId?: string; unitId?: string; status?: string; limit: number; offset: number },
  ): Promise<{ items: ReturnType<typeof toServiceRequestResponse>[]; limit: number; offset: number }> {
    return this.query.list(actor, query);
  }

  summary(
    actor: IdentityAuthzContext,
    query: { clientId?: string; unitId?: string },
  ) {
    return this.query.summary(actor, query);
  }
}