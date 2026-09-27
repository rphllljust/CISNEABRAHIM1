import { Injectable } from '@nestjs/common';
import { ServiceRequestsRepository } from '../repositories/service-requests.repository';
import type {
  CreateServiceRequestPersistenceInput,
  UpdateServiceRequestDraftPersistenceInput,
} from '../repositories/service-requests.repository.types';

@Injectable()
export class ServiceRequestsAccessPersistence {
  constructor(private readonly repository: ServiceRequestsRepository) {}

  listOperationalUnits(): Promise<string[]> {
    return this.repository.listOperationalUnits();
  }

  registerOperationalUnit(refId: string): Promise<void> {
    return this.repository.registerOperationalUnit(refId);
  }

  findById(id: string) {
    return this.repository.findById(id);
  }

  findByIdempotencyKey(key: string) {
    return this.repository.findByIdempotencyKey(key);
  }

  isUnitRegistered(unitId: string) {
    return this.repository.isUnitRegistered(unitId);
  }

  create(input: CreateServiceRequestPersistenceInput) {
    return this.repository.create(input);
  }

  isIdempotencyViolation(error: unknown) {
    return this.repository.isIdempotencyViolation(error);
  }

  updateDraft(input: UpdateServiceRequestDraftPersistenceInput) {
    return this.repository.updateDraft(input);
  }

  transition(input: Parameters<ServiceRequestsRepository['transition']>[0]) {
    return this.repository.transition(input);
  }

  findDocumentById(documentId: string) {
    return this.repository.findDocumentById(documentId);
  }

  linkDocument(
    serviceRequestId: string,
    documentId: string,
    linkPurpose: string,
    actorIdentityId: string,
  ) {
    return this.repository.linkDocument(serviceRequestId, documentId, linkPurpose, actorIdentityId);
  }

  listDocumentLinks(serviceRequestId: string) {
    return this.repository.listDocumentLinks(serviceRequestId);
  }

  listHistoryEvents(serviceRequestId: string) {
    return this.repository.listHistoryEvents(serviceRequestId);
  }

  listServiceRequests(
    whereClause: string,
    params: unknown[],
    limit: number,
    offset: number,
    orderClause?: string,
  ) {
    return this.repository.listServiceRequests(whereClause, params, limit, offset, orderClause);
  }

  listClientLabels(clientIds: string[]) {
    return this.repository.listClientLabels(clientIds);
  }

  listServiceLabels(
    items: Array<{ serviceDefinitionId: string; serviceDefinitionVersionId: string | null }>,
  ) {
    return this.repository.listServiceLabels(items);
  }

  findLinkedChain(serviceRequestId: string) {
    return this.repository.findLinkedChain(serviceRequestId);
  }

  countListSummary(whereClause: string, params: unknown[]) {
    return this.repository.countListSummary(whereClause, params);
  }
}