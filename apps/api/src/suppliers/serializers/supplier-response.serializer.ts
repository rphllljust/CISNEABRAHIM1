export type SupplierContactResponse = {
  id: string;
  name: string;
  purpose: string;
  email: string | null;
  phone: string | null;
};

export type SupplierAddressResponse = {
  id: string;
  purpose: string;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
};

export type SupplierHistoryResponse = {
  id: string;
  eventKind: string;
  actorIdentityId: string;
  occurredAt: string;
};

export type SupplierResponse = {
  id: string;
  legalName: string;
  tradeName: string | null;
  taxId: string;
  externalErpId: string | null;
  paymentTerms: string | null;
  currencyCode: string;
  status: string;
  version: number;
  deactivatedAt: string | null;
  deactivationReason: string | null;
  contacts: SupplierContactResponse[];
  addresses: SupplierAddressResponse[];
};

/**
 * Resumo de listagem: identifica o fornecedor por referência humana (razão social, nome
 * fantasia, CNPJ) sem exigir que o operador conheça o identificador técnico.
 */
export type SupplierSummaryResponse = {
  id: string;
  legalName: string;
  tradeName: string | null;
  taxId: string;
  paymentTerms: string | null;
  currencyCode: string;
  status: string;
  version: number;
  updatedAt: string;
};

export type SupplierListResponse = {
  items: SupplierSummaryResponse[];
  limit: number;
  offset: number;
  total: number;
  totalPages: number;
};

export type SupplierRow = {
  id: string;
  legal_name: string;
  trade_name: string | null;
  normalized_tax_id: string;
  external_erp_id: string | null;
  payment_terms: string | null;
  currency_code: string;
  status: string;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
  deactivated_at: Date | string | null;
  deactivation_reason: string | null;
};

export type SupplierContactRow = {
  id: string;
  name: string;
  purpose: string;
  email: string | null;
  phone: string | null;
};

export type SupplierAddressRow = {
  id: string;
  purpose: string;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
};

export function toSupplierResponse(  row: SupplierRow,
  contacts: SupplierContactRow[],
  addresses: SupplierAddressRow[],
): SupplierResponse {
  return {
    id: row.id,
    legalName: row.legal_name,
    tradeName: row.trade_name,
    taxId: row.normalized_tax_id,
    externalErpId: row.external_erp_id,
    paymentTerms: row.payment_terms,
    currencyCode: row.currency_code,
    status: row.status,
    version: row.version,
    deactivatedAt: row.deactivated_at ? String(row.deactivated_at) : null,
    deactivationReason: row.deactivation_reason,
    contacts: contacts.map((item) => ({
      id: item.id,
      name: item.name,
      purpose: item.purpose,
      email: item.email,
      phone: item.phone,
    })),
    addresses: addresses.map((item) => ({
      id: item.id,
      purpose: item.purpose,
      street: item.street,
      number: item.number,
      complement: item.complement,
      district: item.district,
      city: item.city,
      state: item.state,
      postalCode: item.postal_code,
      country: item.country,
    })),
  };
}

export function toSupplierSummaryResponse(row: SupplierRow): SupplierSummaryResponse {
  return {
    id: row.id,
    legalName: row.legal_name,
    tradeName: row.trade_name,
    taxId: row.normalized_tax_id,
    paymentTerms: row.payment_terms,
    currencyCode: row.currency_code,
    status: row.status,
    version: row.version,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}
