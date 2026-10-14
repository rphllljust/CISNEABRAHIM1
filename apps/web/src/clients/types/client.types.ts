export const CLIENT_STATUSES = {
  Active: 'ACTIVE',
  Inactive: 'INACTIVE',
} as const;

export type ClientStatus = (typeof CLIENT_STATUSES)[keyof typeof CLIENT_STATUSES];

export const PURCHASE_ORDER_REQUIREMENTS = {
  NotRequired: 'NOT_REQUIRED',
  BeforeExecution: 'BEFORE_EXECUTION',
  BeforeBilling: 'BEFORE_BILLING',
} as const;

export type PurchaseOrderRequirement =
  (typeof PURCHASE_ORDER_REQUIREMENTS)[keyof typeof PURCHASE_ORDER_REQUIREMENTS];

export const CONTACT_PURPOSES = {
  Operational: 'operational',
  Commercial: 'commercial',
  Billing: 'billing',
} as const;

export type ContactPurpose = (typeof CONTACT_PURPOSES)[keyof typeof CONTACT_PURPOSES];

export const ADDRESS_PURPOSES = {
  Operational: 'operational',
  Billing: 'billing',
  Correspondence: 'correspondence',
} as const;

export type AddressPurpose = (typeof ADDRESS_PURPOSES)[keyof typeof ADDRESS_PURPOSES];

/**
 * PAPEL do contato na organização do CLIENTE — eixo diferente de `ContactPurpose`.
 *
 * `purpose` diz com o que o contato se relaciona no CISNE; `role` diz quem é a pessoa na empresa
 * do Cliente. `null` é um valor LEGÍTIMO e significa "não declarado": o backfill da migration 0097
 * não atribuiu papel a nenhum contato histórico, e a UI não deve inventar um.
 */
export const CONTACT_ROLES = {
  Operational: 'operational',
  Commercial: 'commercial',
  Billing: 'billing',
  Purchasing: 'purchasing',
  Fiscal: 'fiscal',
  Contracts: 'contracts',
  Management: 'management',
} as const;

export type ContactRole = (typeof CONTACT_ROLES)[keyof typeof CONTACT_ROLES];

export type ClientContact = {
  id?: string;
  name: string;
  purpose: ContactPurpose;
  role?: ContactRole | null;
  isPrimary?: boolean;
  /** Instante em que o contato saiu de operação. Presença = inativo (o registro é preservado). */
  deactivatedAt?: string | null;
  email?: string | null;
  phone?: string | null;
};

export type ClientAddress = {
  id?: string;
  purpose: AddressPurpose;
  /** Unidade a que o endereço pertence. `null` = endereço do Cliente, não de uma unidade. */
  unitId?: string | null;
  unitName?: string | null;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  district?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
};

/** UNIDADE DO CLIENTE — filial ou estabelecimento declarado. */
export type ClientUnit = {
  id: string;
  name: string;
  isHeadquarters: boolean;
  city: string | null;
  state: string | null;
  /** Contagem REAL de endereços desta unidade, calculada no servidor. */
  addressCount: number;
};

/** QUALIDADE DOS DADOS — apontamentos reais. Não existe nota: ver `client-quality`. */
export const CLIENT_QUALITY_SEVERITIES = ['blocking', 'attention', 'advisory'] as const;

export type ClientQualitySeverity = (typeof CLIENT_QUALITY_SEVERITIES)[number];

export type ClientQualityFinding = {
  code: string;
  severity: ClientQualitySeverity;
  summary: string;
  consequence: string;
};

export type ClientDataQuality = {
  /** `true` sempre que o servidor respondeu: separa "avaliado" de "não avaliado". */
  evaluated: boolean;
  isComplete: boolean;
  findings: ClientQualityFinding[];
};

/** RAZÕES DE DUPLICIDADE — os mesmos códigos publicados por `client-duplicates.ts` no servidor. */
export const CLIENT_DUPLICATE_REASONS = {
  TaxIdMatch: 'TAX_ID_MATCH',
  ExternalReferenceMatch: 'EXTERNAL_REFERENCE_MATCH',
  LegalNameMatch: 'LEGAL_NAME_MATCH',
  TradeNameMatch: 'TRADE_NAME_MATCH',
} as const;

export type ClientDuplicateReason =
  (typeof CLIENT_DUPLICATE_REASONS)[keyof typeof CLIENT_DUPLICATE_REASONS];

export type ClientDuplicateMatch = {
  id: string;
  legalName: string;
  tradeName: string | null;
  normalizedTaxId: string;
  externalErpId: string | null;
  status: string;
  reasons: ClientDuplicateReason[];
  /**
   * `true` = coincidência PROVADA (documento ou referência externa). `false` = SUSPEITA que exige
   * confirmação humana. A UI usa isso para não tratar as duas como dúvida equivalente.
   */
  certain: boolean;
};

export type ClientDuplicateCheck = {
  checked: boolean;
  certainCount: number;
  suspectedCount: number;
  matches: ClientDuplicateMatch[];
};

/** NÓ DA HIERARQUIA — `relation` e `depth` são posição relativa ao Cliente consultado. */
export type ClientHierarchyNode = {
  id: string;
  legal_name: string;
  trade_name: string | null;
  status: string;
  parent_client_id: string | null;
  group_id: string | null;
  group_name: string | null;
  child_count: number;
  depth: number;
  relation: 'self' | 'parent' | 'child';
};

export type ClientHierarchy = {
  rootId: string;
  nodes: ClientHierarchyNode[];
  /** `true` quando o teto de profundidade ou de nós foi atingido — a árvore é PARCIAL. */
  truncated: boolean;
  maxDepth: number;
};

/** ENTRADA DA TRILHA DE AUDITORIA — o par (antes, depois) de cada alteração. */
export type ClientAuditTrailEntry = {
  id: string;
  action: string;
  actorIdentityId: string;
  correlationId: string;
  occurredAt: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

export type ClientAuditTrail = {
  items: ClientAuditTrailEntry[];
  limit: number;
  offset: number;
  total: number;
  totalPages: number;
};

export type Client = {
  id: string;
  legalName: string;
  tradeName: string | null;
  taxId: string;
  externalErpId: string | null;
  status: ClientStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  deactivatedAt: string | null;
  deactivationReason: string | null;
  purchaseOrderRequirement: PurchaseOrderRequirement;
  /** GRUPO ECONÔMICO — vínculo declarado. `null` = não declarado (nunca inferido). */
  groupId: string | null;
  groupName: string | null;
  /** MATRIZ declarada na hierarquia, com o nome já resolvido pelo servidor. */
  parentClientId: string | null;
  parentClientName: string | null;
  /** Filhos DIRETOS declarados. */
  childCount: number;
  contacts: ClientContact[];
  addresses: ClientAddress[];
  units: ClientUnit[];
};

/**
 * Projeção de listagem devolvida por `GET /api/v1/clients`.
 *
 * Deliberadamente menor que `Client`: a lista serve para identificar e localizar, não para exibir
 * o cadastro completo. Contatos e endereços pertencem ao detalhe (`GET /api/v1/clients/:id`).
 * Não há campo de localidade: nenhuma regra confirmada define qual endereço representaria o
 * Cliente quando ele tem mais de um.
 */
export type ClientSummary = {
  id: string;
  legalName: string;
  tradeName: string | null;
  taxId: string;
  status: ClientStatus;
  /**
   * Versão do registro, publicada na listagem para permitir comando em lote.
   *
   * `activate`/`deactivate` exigem concorrência otimista; sem a versão aqui, cada linha do lote
   * precisaria de um `GET /clients/:id` adicional (N+1 no caminho de escrita).
   */
  version: number;
  createdAt: string;
  updatedAt: string;
};

export const CLIENT_LIST_SORTS = {
  LegalName: 'legalName',
  UpdatedAt: 'updatedAt',
} as const;

export type ClientListSort = (typeof CLIENT_LIST_SORTS)[keyof typeof CLIENT_LIST_SORTS];

export const CLIENT_LIST_DIRECTIONS = {
  Asc: 'asc',
  Desc: 'desc',
} as const;

export type ClientListDirection =
  (typeof CLIENT_LIST_DIRECTIONS)[keyof typeof CLIENT_LIST_DIRECTIONS];

export type ClientListResponse = {
  items: ClientSummary[];
  limit: number;
  offset: number;
  /** Total sob os mesmos filtros da página: vem na mesma resposta, sem consulta adicional. */
  total: number;
  totalPages: number;
};

export type CreateClientPayload = {
  legalName: string;
  tradeName?: string;
  taxId: string;
  externalErpId?: string;
  purchaseOrderRequirement?: PurchaseOrderRequirement;
  contacts: Array<{
    name: string;
    purpose: ContactPurpose;
    email?: string;
    phone?: string;
  }>;
  addresses?: Array<{
    purpose: AddressPurpose;
    street?: string;
    number?: string;
    complement?: string;
    district?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  }>;
};

export type UpdateClientPayload = {
  version: number;
  legalName?: string;
  tradeName?: string | null;
  externalErpId?: string | null;
  purchaseOrderRequirement?: PurchaseOrderRequirement;
  contacts?: CreateClientPayload['contacts'];
  addresses?: CreateClientPayload['addresses'];
};

export const CLIENT_ERROR_CODES = {
  VALIDATION_FAILED: 'CLIENT_VALIDATION_FAILED',
  NOT_FOUND: 'CLIENT_NOT_FOUND',
  TAX_ID_CONFLICT: 'CLIENT_TAX_ID_CONFLICT',
  VERSION_CONFLICT: 'CLIENT_VERSION_CONFLICT',
  INVALID_STATE: 'CLIENT_INVALID_STATE',
  INACTIVE: 'CLIENT_INACTIVE',
  DENIED: 'CLIENT_DENIED',
} as const;

export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[keyof typeof CLIENT_ERROR_CODES];
