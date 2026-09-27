export const PROPOSAL_ERROR_CODES = {
  VALIDATION_FAILED: 'COMMERCIAL_VALIDATION_FAILED',
  DENIED: 'COMMERCIAL_DENIED',
  NOT_FOUND: 'COMMERCIAL_PROPOSAL_NOT_FOUND',
  VERSION_NOT_FOUND: 'COMMERCIAL_PROPOSAL_VERSION_NOT_FOUND',
  INVALID_STATE: 'COMMERCIAL_PROPOSAL_INVALID_STATE',
  VERSION_CONFLICT: 'COMMERCIAL_PROPOSAL_VERSION_CONFLICT',
  CLIENT_NOT_FOUND: 'COMMERCIAL_CLIENT_NOT_FOUND',
  CLIENT_INACTIVE: 'COMMERCIAL_CLIENT_INACTIVE',
  UNIT_NOT_REGISTERED: 'COMMERCIAL_UNIT_NOT_REGISTERED',
  SERVICE_NOT_FOUND: 'COMMERCIAL_SERVICE_NOT_FOUND',
  DOCUMENT_NOT_FOUND: 'COMMERCIAL_DOCUMENT_NOT_FOUND',
  REVISION_NOT_ALLOWED: 'COMMERCIAL_REVISION_NOT_ALLOWED',
  DRAFT_EXISTS: 'COMMERCIAL_DRAFT_VERSION_EXISTS',
} as const;

export type ProposalErrorCode = (typeof PROPOSAL_ERROR_CODES)[keyof typeof PROPOSAL_ERROR_CODES];

export const PROPOSAL_VERSION_STATUSES = {
  Draft: 'DRAFT',
  Issued: 'ISSUED',
  Accepted: 'ACCEPTED',
  Rejected: 'REJECTED',
  Expired: 'EXPIRED',
  Cancelled: 'CANCELLED',
} as const;

export type ProposalVersionStatus =
  (typeof PROPOSAL_VERSION_STATUSES)[keyof typeof PROPOSAL_VERSION_STATUSES];

export const PROPOSAL_PRICING_STRUCTURES = {
  GlobalPrice: 'GLOBAL_PRICE',
  Itemized: 'ITEMIZED',
} as const;

export type ProposalPricingStructure =
  (typeof PROPOSAL_PRICING_STRUCTURES)[keyof typeof PROPOSAL_PRICING_STRUCTURES];

export const PROPOSAL_ITEM_KINDS = {
  Service: 'SERVICE',
  Material: 'MATERIAL',
  Labor: 'LABOR',
  Equipment: 'EQUIPMENT',
  Transport: 'TRANSPORT',
  Other: 'OTHER',
} as const;

export type ProposalItemKind = (typeof PROPOSAL_ITEM_KINDS)[keyof typeof PROPOSAL_ITEM_KINDS];

export const PROPOSAL_ACCEPTANCE_ORIGINS = {
  ClientWrittenConfirmation: 'CLIENT_WRITTEN_CONFIRMATION',
  ClientPortal: 'CLIENT_PORTAL',
  InternalApproval: 'INTERNAL_APPROVAL',
} as const;

export type ProposalAcceptanceOrigin =
  (typeof PROPOSAL_ACCEPTANCE_ORIGINS)[keyof typeof PROPOSAL_ACCEPTANCE_ORIGINS];

export const PROPOSAL_DOCUMENT_LINK_PURPOSES = {
  Attachment: 'ATTACHMENT',
  IssuedCopy: 'ISSUED_COPY',
  AcceptanceEvidence: 'ACCEPTANCE_EVIDENCE',
} as const;

export type ProposalDocumentLinkPurpose =
  (typeof PROPOSAL_DOCUMENT_LINK_PURPOSES)[keyof typeof PROPOSAL_DOCUMENT_LINK_PURPOSES];

export type Proposal = {
  id: string;
  proposalCode: string;
  clientId: string;
  unitId: string;
  title: string;
  currentVersionNumber: number | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
  /**
   * Projecao da versao CORRENTE, exposta pela listagem.
   *
   * Todos os campos vem do backend. `null` significa "a proposta ainda nao tem versao" — a
   * interface declara a ausencia e nunca presume estado comercial.
   */
  currentVersionStatus: string | null;
  currencyCode: string | null;
  /** Valor de venda da versao corrente, conforme a regra de precificacao do dominio. */
  saleTotal: string | null;
  validUntil: string | null;
  /** Nome do cliente quando o modulo CLIENTES autoriza; `null` quando nao autoriza. */
  clientName?: string | null;
  revisionNumber?: number | null;
  revisionCount?: number;
  /** Solicitacoes de origem que o ator PODE ler (vazio quando nenhuma e legivel). */
  originRequests?: Array<{ id: string; requestCode: string; status: string }>;
  issuedAt?: string | null;
  acceptedAt?: string | null;
};

export const PROPOSAL_LIST_SORTS = {
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  validUntil: 'validUntil',
  value: 'value',
  revision: 'revision',
} as const;

export type ProposalListSort = (typeof PROPOSAL_LIST_SORTS)[keyof typeof PROPOSAL_LIST_SORTS];
export type ProposalListDirection = 'asc' | 'desc';

export type ProposalTransition =
  | 'issue'
  | 'accept'
  | 'reject'
  | 'expire'
  | 'cancel'
  | 'revise';

export type ProposalNextStepCode =
  | 'COMPLETE_AND_ISSUE'
  | 'AWAIT_CLIENT_DECISION'
  | 'FOLLOW_COMMERCIAL_FLOW'
  | 'CREATE_NEW_REVISION'
  | 'CLOSED';

export type ProposalReadiness = {
  nextStep: ProposalNextStepCode;
  nextStepTransition: ProposalTransition | null;
  availableTransitions: ProposalTransition[];
  blockers: string[];
};

export type ProposalLinkedKind = 'REQUEST' | 'SERVICE_ORDER' | 'PURCHASE_ORDER';

export type ProposalLinked = {
  kind: ProposalLinkedKind;
  id: string;
  label: string;
  status: string | null;
  occurredAt: string;
  /** Preenchido quando a relacao chega por intermedio de outro objeto (pedido via OS). */
  viaLabel: string | null;
};

export type ProposalRelated = {
  client: { id: string; name: string } | null;
};

export type ProposalRevisionSummary = {
  versionNumber: number;
  status: ProposalVersionStatus;
  saleTotal: string | null;
  currencyCode: string;
  validUntil: string | null;
  createdAt: string;
  issuedAt: string | null;
  acceptedAt: string | null;
  rejectedAt: string | null;
  expiredAt: string | null;
  cancelledAt: string | null;
  supersededAt: string | null;
  isCurrent: boolean;
  supersedesVersionNumber: number | null;
  itemCount: number;
};

export type ProposalRevisionDiffField = {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
};

export type ProposalRevisionDiffLine = {
  change: 'ADDED' | 'REMOVED' | 'CHANGED';
  key: string;
  description: string;
  fields: ProposalRevisionDiffField[];
};

export type ProposalRevisionDiff = {
  fromRevisionNumber: number;
  toRevisionNumber: number;
  fields: ProposalRevisionDiffField[];
  lines: ProposalRevisionDiffLine[];
  totals: { linesAdded: number; linesRemoved: number; linesChanged: number };
};

export type ProposalItem = {
  id: string;
  lineNumber: number;
  itemKind: string;
  description: string;
  serviceDefinitionId: string | null;
  serviceDefinitionVersionId: string | null;
  serviceSnapshot: Record<string, unknown> | null;
  commercialSnapshot: Record<string, unknown> | null;
  quantity: string | null;
  unitCode: string | null;
  unitSalePrice: string | null;
  unitInternalCost: string | null;
  lineSaleAmount: string | null;
  lineInternalCost: string | null;
};

export type ProposalDocumentLink = {
  id: string;
  documentId: string;
  linkPurpose: string;
  createdAt: string;
};

export type ProposalVersion = {
  id: string;
  proposalId: string;
  versionNumber: number;
  status: ProposalVersionStatus;
  pricingStructure: ProposalPricingStructure;
  currencyCode: string;
  globalSalePrice: string | null;
  globalInternalCost: string | null;
  itemsSaleTotal: string | null;
  itemsInternalCostTotal: string | null;
  commercialTerms: Record<string, unknown>;
  clientSnapshot: Record<string, unknown> | null;
  validUntil: string | null;
  notes: string | null;
  issuedAt: string | null;
  issuedByIdentityId: string | null;
  supersededAt: string | null;
  acceptedAt: string | null;
  acceptedByIdentityId: string | null;
  acceptanceOriginCode: string | null;
  acceptanceEvidenceDocumentId: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  expiredAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  rowVersion: number;
  items: ProposalItem[];
  documents: ProposalDocumentLink[];
};

export type ProposalDetail = {
  proposal: Proposal;
  currentVersion: ProposalVersion | null;
  related: ProposalRelated;
  revisions: ProposalRevisionSummary[];
  revisionComparison: ProposalRevisionDiff | null;
  linkedChain: ProposalLinked[];
  readiness: ProposalReadiness;
};

export type ProposalListResponse = {
  items: Proposal[];
  limit: number;
  offset: number;
};

export type ProposalItemInput = {
  lineNumber?: number;
  itemKind?: ProposalItemKind;
  description: string;
  serviceDefinitionId?: string;
  serviceDefinitionVersionId?: string;
  quantity?: string;
  unitCode?: string;
  unitSalePrice?: string;
  lineSaleAmount?: string;
};

export type CreateProposalPayload = {
  clientId: string;
  unitId: string;
  title: string;
  pricingStructure: ProposalPricingStructure;
  currencyCode?: string;
  globalSalePrice?: string;
  commercialTerms?: Record<string, unknown>;
  validUntil?: string;
  notes?: string;
  items?: ProposalItemInput[];
};

export type UpdateProposalDraftPayload = {
  rowVersion: number;
  title?: string;
  pricingStructure?: ProposalPricingStructure;
  currencyCode?: string;
  globalSalePrice?: string | null;
  commercialTerms?: Record<string, unknown>;
  validUntil?: string | null;
  notes?: string | null;
  items?: ProposalItemInput[];
};

export type AcceptProposalPayload = {
  rowVersion: number;
  acceptanceOriginCode: ProposalAcceptanceOrigin;
  acceptanceEvidenceDocumentId?: string;
};

export type RejectProposalPayload = {
  rowVersion: number;
  rejectionReason?: string;
};

export type CancelProposalPayload = {
  rowVersion: number;
  cancellationReason?: string;
};

export type LinkProposalDocumentPayload = {
  documentId: string;
  linkPurpose: ProposalDocumentLinkPurpose;
};
