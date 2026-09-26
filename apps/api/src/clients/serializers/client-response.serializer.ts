import type {
  AddressPurpose,
  ClientStatus,
  ContactPurpose,
  PurchaseOrderRequirement,
} from '../domain/client-status';

export type ClientContactRow = {
  id: string;
  name: string;
  purpose: ContactPurpose;
  email: string | null;
  phone: string | null;
};

export type ClientAddressRow = {
  id: string;
  purpose: AddressPurpose;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
};

export type ClientRow = {
  id: string;
  legal_name: string;
  trade_name: string | null;
  normalized_tax_id: string;
  external_erp_id: string | null;
  status: ClientStatus;
  version: number;
  created_at: string;
  updated_at: string;
  deactivated_at: string | null;
  deactivation_reason: string | null;
  purchase_order_requirement: PurchaseOrderRequirement;
};

export type ClientDetail = ClientRow & {
  contacts: ClientContactRow[];
  addresses: ClientAddressRow[];
};

/**
 * Projeção de listagem do master data de Clientes.
 *
 * A lista existe para identificar e localizar um Cliente, não para exibi-lo por inteiro. Carregar
 * contatos e endereços completos de cada linha da página era o comportamento anterior: 3 consultas
 * e dois arrays aninhados por linha para uma tabela que mostrava razão social, CNPJ e status.
 *
 * Endereço/localidade NÃO faz parte desta projeção: não há regra empresarial confirmada que defina
 * qual endereço representa a localidade do Cliente quando ele tem mais de um (SRC-002 Q14 confirma
 * apenas as FINALIDADES `operational`/`billing`/`correspondence`). Escolher uma delas seria
 * inventar semântica de negócio, então a coluna não é oferecida.
 */
export type ClientSummaryRow = {
  id: string;
  legal_name: string;
  trade_name: string | null;
  normalized_tax_id: string;
  status: ClientStatus;
  created_at: string;
  updated_at: string;
};

export type ClientSummary = {
  id: string;
  legalName: string;
  tradeName: string | null;
  taxId: string;
  status: ClientStatus;
  createdAt: string;
  updatedAt: string;
};

/**
 * Metadados de paginação suficientes para a UI não precisar de consulta adicional: o total e o
 * número de páginas vêm da mesma requisição da página. Antes, a UI inferia "existe próxima página"
 * de `items.length === limit`, o que oferecia uma página fantasma sempre que o total fosse múltiplo
 * exato do tamanho da página.
 */
export type ClientListResponse = {
  items: ClientSummary[];
  limit: number;
  offset: number;
  total: number;
  totalPages: number;
};

export type ClientResponse = {
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
  contacts: Array<{
    id: string;
    name: string;
    purpose: ContactPurpose;
    email: string | null;
    phone: string | null;
  }>;
  addresses: Array<{
    id: string;
    purpose: AddressPurpose;
    street: string | null;
    number: string | null;
    complement: string | null;
    district: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    country: string | null;
  }>;
};

export function toClientResponse(detail: ClientDetail): ClientResponse {
  return {
    id: detail.id,
    legalName: detail.legal_name,
    tradeName: detail.trade_name,
    taxId: detail.normalized_tax_id,
    externalErpId: detail.external_erp_id,
    status: detail.status,
    version: detail.version,
    createdAt: detail.created_at,
    updatedAt: detail.updated_at,
    deactivatedAt: detail.deactivated_at,
    deactivationReason: detail.deactivation_reason,
    purchaseOrderRequirement: detail.purchase_order_requirement,
    contacts: detail.contacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      purpose: contact.purpose,
      email: contact.email,
      phone: contact.phone,
    })),
    addresses: detail.addresses.map((address) => ({
      id: address.id,
      purpose: address.purpose,
      street: address.street,
      number: address.number,
      complement: address.complement,
      district: address.district,
      city: address.city,
      state: address.state,
      postalCode: address.postal_code,
      country: address.country,
    })),
  };
}

export function toClientSummaryResponse(row: ClientSummaryRow): ClientSummary {
  return {
    id: row.id,
    legalName: row.legal_name,
    tradeName: row.trade_name,
    taxId: row.normalized_tax_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
