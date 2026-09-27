export type SupplierDetail = {
  id: string;
  legalName: string;
  tradeName: string | null;
  taxId: string;
  paymentTerms: string | null;
  currencyCode: string;
  status: string;
  version: number;
  deactivationReason: string | null;
  contacts: Array<{ id: string; name: string; purpose: string; email: string | null; phone: string | null }>;
};

/** Linha de listagem: referência humana do fornecedor, sem dados de contato. */
export type SupplierSummary = {
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
  items: SupplierSummary[];
  limit: number;
  offset: number;
  total: number;
  totalPages: number;
};

export type SupplierHistoryItem = {
  id: string;
  eventKind: string;
  actorIdentityId: string;
  occurredAt: string;
};
