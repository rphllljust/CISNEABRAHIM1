import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { ContractsOperationalValidationService } from '../../commercial/services/contracts-operational-validation.service';
import {
  buildServiceOrderContractSnapshot,
  extractPaymentTermsFromCommercialTerms,
  resolveConversionContractReference,
} from '../../requests/domain/service-request-contract';
import type {
  ServiceRequestConversionInput,
  ServiceRequestConversionPort,
  ServiceRequestConversionResult,
} from '../../requests/domain/service-request-conversion.port';
import {
  buildServiceOrderClientSnapshot,
  buildServiceOrderProposalSnapshot,
  buildServiceOrderPurchaseOrderSnapshot,
  buildServiceOrderServiceSnapshot,
  type ServiceOrderProposalSnapshot,
} from '../domain/service-order-snapshot';
import { ServiceOrdersRepository } from '../repositories/service-orders.repository';

@Injectable()
export class ServiceRequestConversionService implements ServiceRequestConversionPort {
  constructor(
    private readonly repository: ServiceOrdersRepository,
    private readonly contractOperationalValidation: ContractsOperationalValidationService,
  ) {}

  async convert(input: ServiceRequestConversionInput): Promise<ServiceRequestConversionResult> {
    const snapshots = await this.buildSnapshots(input.serviceRequestId);
    if (!snapshots) {
      return { outcome: 'service_not_found' };
    }

    const result = await this.repository.convertFromServiceRequest({
      serviceRequestId: input.serviceRequestId,
      rowVersion: input.rowVersion,
      actorIdentityId: input.actorIdentityId,
      internalCode: this.generateInternalCode(),
      orderNumber: this.generateOrderNumber(),
      clientSnapshot: snapshots.clientSnapshot,
      serviceSnapshot: snapshots.serviceSnapshot,
      proposalSnapshot: snapshots.proposalSnapshot,
      purchaseOrderSnapshot: snapshots.purchaseOrderSnapshot,
      customerPurchaseOrderNumber: snapshots.customerPurchaseOrderNumber,
      rcNumber: snapshots.rcNumber,
      contractReference: snapshots.contractReference,
      contractSnapshot: snapshots.contractSnapshot,
      contractId: snapshots.contractId,
    });

    switch (result.outcome) {
      case 'converted':
        return { outcome: 'converted', serviceOrderId: result.serviceOrder.id };
      case 'already_converted':
        return { outcome: 'already_converted', serviceOrderId: result.serviceOrderId };
      case 'invalid_state':
        return { outcome: 'invalid_state' };
      case 'version_conflict':
        return { outcome: 'version_conflict' };
      default:
        return { outcome: 'version_conflict' };
    }
  }

  private async buildSnapshots(serviceRequestId: string): Promise<{
    serviceSnapshot: Record<string, unknown>;
    clientSnapshot: Record<string, unknown> | null;
    proposalSnapshot: Record<string, unknown> | null;
    purchaseOrderSnapshot: Record<string, unknown> | null;
    customerPurchaseOrderNumber: string | null;
    rcNumber: string | null;
    contractReference: string | null;
    contractSnapshot: Record<string, unknown> | null;
    contractId: string | null;
  } | null> {
    const request = await this.repository.findServiceRequestById(serviceRequestId);
    if (!request?.service_definition_id) {
      return null;
    }

    const source = await this.repository.findServiceSnapshotSource(
      request.service_definition_id,
      request.service_definition_version_id ?? undefined,
    );
    if (!source) {
      return null;
    }

    const parts = await this.repository.loadServiceSnapshotParts(
      source.service_definition_version_id,
    );
    const serviceSnapshot = buildServiceOrderServiceSnapshot({
      source,
      ...parts,
    });

    let clientSnapshot: Record<string, unknown> | null = null;
    if (request.client_id) {
      const client = await this.repository.findClientById(request.client_id);
      if (client) {
        clientSnapshot = buildServiceOrderClientSnapshot(client);
      }
    }

    let proposalSnapshot: Record<string, unknown> | null = null;
    let proposalCommercialTerms: Record<string, unknown> | null = null;
    if (request.proposal_id) {
      const proposal = await this.repository.findProposalById(request.proposal_id);
      if (proposal) {
        const built = buildServiceOrderProposalSnapshot(proposal);
        proposalSnapshot = built;
        proposalCommercialTerms = proposal.commercial_terms;
      }
    }

    let purchaseOrderSnapshot: Record<string, unknown> | null = null;
    let rcNumber: string | null = null;
    if (request.purchase_order_id) {
      const purchaseOrder = await this.repository.findPurchaseOrderById(request.purchase_order_id);
      if (purchaseOrder) {
        purchaseOrderSnapshot = buildServiceOrderPurchaseOrderSnapshot(purchaseOrder);
        rcNumber = purchaseOrder.rc_number;
      }
    }

    const contractReference = resolveConversionContractReference({
      originSource: request.origin_source,
      externalOriginReference: request.external_origin_reference,
      proposalCommercialTerms,
    });
    const proposalTerms = proposalSnapshot as ServiceOrderProposalSnapshot | null;

    let contractSnapshot: Record<string, unknown> | null = null;
    let contractId: string | null = null;
    if (contractReference && request.client_id) {
      const resolved = await this.contractOperationalValidation.tryResolveContractForOperationalUse(
        request.client_id,
        contractReference,
      );
      if (resolved) {
        contractId = resolved.contract.id;
        contractSnapshot = { ...resolved.snapshot };
      }
    }
    if (!contractSnapshot && contractReference) {
      contractSnapshot = buildServiceOrderContractSnapshot({
        contractReference,
        paymentTerms:
          proposalTerms?.paymentTerms ??
          extractPaymentTermsFromCommercialTerms(proposalCommercialTerms),
        serviceRequestId: request.origin_source ? serviceRequestId : null,
        originSource: request.origin_source,
      });
    }

    return {
      serviceSnapshot,
      clientSnapshot,
      proposalSnapshot,
      purchaseOrderSnapshot,
      customerPurchaseOrderNumber: null,
      rcNumber,
      contractReference: contractId
        ? (contractSnapshot as { contractNumber?: string }).contractNumber ?? contractReference
        : contractReference,
      contractSnapshot,
      contractId,
    };
  }

  private generateInternalCode(): string {
    return `SO-INT-${new Date().getUTCFullYear()}-${randomBytes(4).toString('hex').toUpperCase()}`;
  }

  private generateOrderNumber(): string {
    return `OS-${new Date().getUTCFullYear()}-${randomBytes(4).toString('hex').toUpperCase()}`;
  }
}
