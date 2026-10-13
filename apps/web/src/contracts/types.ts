/**
 * Tipos do módulo de contratos comerciais.
 *
 * Espelham exatamente o backend (apps/api/src/commercial):
 * - serializer: serializers/contracts-response.serializer.ts
 * - domínio/estados: domain/contract.ts
 * - códigos de erro: errors/commercial-error-codes.ts
 * Nenhum campo/estado/endpoint é inventado aqui.
 */

export const CONTRACT_ERROR_CODES = {
  VALIDATION_FAILED: 'COMMERCIAL_VALIDATION_FAILED',
  DENIED: 'COMMERCIAL_DENIED',
  NOT_FOUND: 'COMMERCIAL_CONTRACT_NOT_FOUND',
  CLIENT_NOT_FOUND: 'COMMERCIAL_CLIENT_NOT_FOUND',
  CLIENT_INACTIVE: 'COMMERCIAL_CLIENT_INACTIVE',
  UNIT_NOT_REGISTERED: 'COMMERCIAL_UNIT_NOT_REGISTERED',
  SERVICE_NOT_FOUND: 'COMMERCIAL_SERVICE_NOT_FOUND',
  DOCUMENT_NOT_FOUND: 'COMMERCIAL_DOCUMENT_NOT_FOUND',
  DUPLICATE: 'COMMERCIAL_CONTRACT_DUPLICATE',
  VERSION_CONFLICT: 'COMMERCIAL_CONTRACT_VERSION_CONFLICT',
  INVALID_STATE: 'COMMERCIAL_CONTRACT_INVALID_STATE',
  CLIENT_MISMATCH: 'COMMERCIAL_CONTRACT_CLIENT_MISMATCH',
  NOT_ACTIVE: 'COMMERCIAL_CONTRACT_NOT_ACTIVE',
  NOT_YET_VALID: 'COMMERCIAL_CONTRACT_NOT_YET_VALID',
  EXPIRED: 'COMMERCIAL_CONTRACT_EXPIRED',
  CLOSED: 'COMMERCIAL_CONTRACT_CLOSED',
} as const;

export type ContractErrorCode =
  (typeof CONTRACT_ERROR_CODES)[keyof typeof CONTRACT_ERROR_CODES];

export const CONTRACT_STATUSES = {
  Draft: 'DRAFT',
  Active: 'ACTIVE',
  Closed: 'CLOSED',
  Expired: 'EXPIRED',
} as const;

export type ContractStatus = (typeof CONTRACT_STATUSES)[keyof typeof CONTRACT_STATUSES];

export const CONTRACT_DOCUMENT_LINK_PURPOSES = {
  Contract: 'CONTRACT',
  Amendment: 'AMENDMENT',
  Supporting: 'SUPPORTING',
} as const;

export type ContractDocumentLinkPurpose =
  (typeof CONTRACT_DOCUMENT_LINK_PURPOSES)[keyof typeof CONTRACT_DOCUMENT_LINK_PURPOSES];

export type Contract = {
  id: string;
  internalCode: string;
  clientId: string;
  unitId: string;
  contractNumber: string;
  title: string;
  scopeDescription: string | null;
  validFrom: string;
  validTo: string | null;
  currencyCode: string;
  paymentTerms: string | null;
  paymentMethod: string | null;
  commercialTerms: Record<string, unknown>;
  clientSnapshot: Record<string, unknown> | null;
  status: ContractStatus;
  activatedAt: string | null;
  closedAt: string | null;
  closureReason: string | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type ContractItem = {
  id: string;
  lineNumber: number;
  description: string;
  serviceDefinitionId: string | null;
  serviceDefinitionVersionId: string | null;
  serviceSnapshot: Record<string, unknown> | null;
  quantity: string | null;
  unitCode: string | null;
  unitPrice: string | null;
  lineTotal: string | null;
};

export type ContractDocumentLink = {
  id: string;
  documentId: string;
  linkPurpose: string;
  createdAt: string;
};

export type ContractDetail = {
  contract: Contract;
  items: ContractItem[];
  documentLinks: ContractDocumentLink[];
};

export type ContractListResponse = {
  items: Contract[];
  limit: number;
  offset: number;
};

export type ListContractsParams = {
  limit: number;
  offset: number;
  clientId?: string;
  unitId?: string;
  status?: string;
  search?: string;
  /** Janela de vigência: contratos cujo intervalo INTERSECTA [effectiveFrom, effectiveTo]. */
  effectiveFrom?: string;
  effectiveTo?: string;
  /** Filtro avançado já convertido para o contrato do servidor. */
  advanced?: import('../engine').AdvancedFilterPayload | null;
};

export type ContractItemInput = {
  lineNumber?: number;
  description: string;
  serviceDefinitionId?: string;
  serviceDefinitionVersionId?: string;
  quantity?: string;
  unitCode?: string;
  unitPrice?: string;
  lineTotal?: string;
};

export type CreateContractPayload = {
  clientId: string;
  unitId: string;
  contractNumber: string;
  title: string;
  scopeDescription?: string;
  validFrom: string;
  validTo?: string;
  currencyCode?: string;
  paymentTerms?: string;
  paymentMethod?: string;
  commercialTerms?: Record<string, unknown>;
  items?: ContractItemInput[];
};

export type UpdateContractDraftPayload = {
  rowVersion: number;
  contractNumber?: string;
  title?: string;
  scopeDescription?: string | null;
  validFrom?: string;
  validTo?: string | null;
  currencyCode?: string;
  paymentTerms?: string | null;
  paymentMethod?: string | null;
  commercialTerms?: Record<string, unknown>;
  items?: ContractItemInput[];
};

export type CloseContractPayload = {
  rowVersion: number;
  closureReason?: string;
};

export type ActivateContractPayload = {
  rowVersion: number;
};

export type LinkContractDocumentPayload = {
  documentId: string;
  linkPurpose: ContractDocumentLinkPurpose;
};
