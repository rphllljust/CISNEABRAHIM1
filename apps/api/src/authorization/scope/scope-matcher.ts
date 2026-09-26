import type { GrantRow } from '../repositories/authorization.repository';
import { AUTHZ_SCOPES, type AuthzResourceContext } from '../types/authz-scopes';

export type ScopeMatchInput = {
  grant: Pick<GrantRow, 'scope_type' | 'resource_id' | 'resource_type'>;
  identityId: string;
  context?: AuthzResourceContext;
};

/**
 * Verifica se uma concessão cobre o contexto do recurso.
 * Fail-closed: contexto ausente em escopos contextuais → não casa.
 */
export function grantMatchesResourceContext(input: ScopeMatchInput): boolean {
  const { grant, identityId, context } = input;

  switch (grant.scope_type) {
    case AUTHZ_SCOPES.Global:
      return grant.resource_id === null;

    case AUTHZ_SCOPES.Own:
      if (grant.resource_id && context?.resourceId) {
        return grant.resource_id === context.resourceId;
      }
      return context?.ownerIdentityId === identityId;

    case AUTHZ_SCOPES.Assigned:
      if (context?.assignedIdentityId !== identityId) {
        return false;
      }
      if (grant.resource_id && context.resourceId) {
        return grant.resource_id === context.resourceId;
      }
      return true;

    case AUTHZ_SCOPES.Unit:
      return (
        grant.resource_id !== null &&
        context?.unitId !== undefined &&
        grant.resource_id === context.unitId
      );

    case AUTHZ_SCOPES.Client:
      return (
        grant.resource_id !== null &&
        context?.clientId !== undefined &&
        grant.resource_id === context.clientId
      );

    case AUTHZ_SCOPES.Contract:
      return (
        grant.resource_id !== null &&
        context?.contractId !== undefined &&
        grant.resource_id === context.contractId
      );

    case AUTHZ_SCOPES.Document:
      return (
        grant.resource_id !== null &&
        context?.documentId !== undefined &&
        grant.resource_id === context.documentId
      );

    case AUTHZ_SCOPES.Financial:
      return (
        context?.isFinancial === true &&
        grant.resource_id !== null &&
        context.contractId !== undefined &&
        grant.resource_id === context.contractId
      );

    case AUTHZ_SCOPES.Platform:
      return grant.resource_type === 'platform:system' || grant.resource_type.startsWith('authz:');

    default:
      return false;
  }
}

export function toResourceContextFromClient(client: { id: string }): AuthzResourceContext {
  return {
    resourceId: client.id,
    clientId: client.id,
  };
}

export function toResourceContextFromPerson(person: { id: string }): AuthzResourceContext {
  return {
    resourceId: person.id,
  };
}

export function toResourceContextFromPhysicalAsset(asset: {
  id: string;
  unit_id: string;
}): AuthzResourceContext {
  return {
    resourceId: asset.id,
    unitId: asset.unit_id,
  };
}

export function toResourceContextFromDocument(document: {
  id: string;
  unit_id: string;
}): AuthzResourceContext {
  return {
    resourceId: document.id,
    unitId: document.unit_id,
    documentId: document.id,
  };
}

export function toResourceContextFromProposal(proposal: {
  id: string;
  unit_id: string;
  client_id: string;
}): AuthzResourceContext {
  return {
    resourceId: proposal.id,
    unitId: proposal.unit_id,
    clientId: proposal.client_id,
  };
}

export function toResourceContextFromPurchaseOrder(purchaseOrder: {
  id: string;
  unit_id: string;
  client_id: string;
}): AuthzResourceContext {
  return {
    resourceId: purchaseOrder.id,
    unitId: purchaseOrder.unit_id,
    clientId: purchaseOrder.client_id,
  };
}

export function toResourceContextFromContract(contract: {
  id: string;
  unit_id: string;
  client_id: string;
}): AuthzResourceContext {
  return {
    resourceId: contract.id,
    unitId: contract.unit_id,
    clientId: contract.client_id,
    contractId: contract.id,
  };
}

export function toResourceContextFromServiceRequest(serviceRequest: {
  id: string;
  unit_id: string;
  client_id: string | null;
}): AuthzResourceContext {
  return {
    resourceId: serviceRequest.id,
    unitId: serviceRequest.unit_id,
    clientId: serviceRequest.client_id ?? undefined,
  };
}

export function toResourceContextFromReceivable(receivable: {
  id: string;
  unitId: string;
  clientId: string;
}): AuthzResourceContext {
  return {
    resourceId: receivable.id,
    unitId: receivable.unitId,
    clientId: receivable.clientId,
    isFinancial: true,
  };
}

export function toResourceContextFromPayable(payable: {
  id: string;
  unitId: string;
}): AuthzResourceContext {
  return {
    resourceId: payable.id,
    unitId: payable.unitId,
    isFinancial: true,
  };
}

export function toResourceContextFromTreasuryAccount(account: {
  id: string;
  unitId: string;
}): AuthzResourceContext {
  return {
    resourceId: account.id,
    unitId: account.unitId,
    isFinancial: true,
  };
}

export function toResourceContextFromAccounting(resource: {
  id: string;
  unitId: string;
}): AuthzResourceContext {
  return {
    resourceId: resource.id,
    unitId: resource.unitId,
    isFinancial: true,
  };
}

export function toResourceContextFromServiceOrder(serviceOrder: {
  id: string;
  unit_id: string;
  client_id: string | null;
  assigned_identity_id?: string | null;
}): AuthzResourceContext {
  return {
    resourceId: serviceOrder.id,
    unitId: serviceOrder.unit_id,
    clientId: serviceOrder.client_id ?? undefined,
    assignedIdentityId: serviceOrder.assigned_identity_id ?? undefined,
  };
}

export function toResourceContextFromScopedRecord(record: {
  id: string;
  owner_identity_id: string;
  assigned_identity_id: string | null;
  unit_id: string;
  client_id: string;
  contract_id: string;
  document_id: string;
  is_financial: boolean;
}): AuthzResourceContext {
  return {
    resourceId: record.id,
    ownerIdentityId: record.owner_identity_id,
    assignedIdentityId: record.assigned_identity_id ?? undefined,
    unitId: record.unit_id,
    clientId: record.client_id,
    contractId: record.contract_id,
    documentId: record.document_id,
    isFinancial: record.is_financial,
  };
}
