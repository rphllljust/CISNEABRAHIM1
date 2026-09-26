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

export type ClientContact = {
  id?: string;
  name: string;
  purpose: ContactPurpose;
  email?: string | null;
  phone?: string | null;
};

export type ClientAddress = {
  id?: string;
  purpose: AddressPurpose;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  district?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
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
  contacts: ClientContact[];
  addresses: ClientAddress[];
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
