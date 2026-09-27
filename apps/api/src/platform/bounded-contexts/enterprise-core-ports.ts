import { BOUNDED_CONTEXT, BOUNDED_CONTEXT_READINESS } from './bounded-context';

/**
 * Ports for enterprise contexts. Implemented contexts expose Nest providers.
 * Enterprise nucleus ports are wired. Legal payroll formulas remain UNDECIDED.
 */
export const ENTERPRISE_CORE_PORT = {
  FinanceReceivable: Symbol('ENTERPRISE_CORE_PORT.FinanceReceivable'),
  FinancePayable: Symbol('ENTERPRISE_CORE_PORT.FinancePayable'),
  FiscalDocument: Symbol('ENTERPRISE_CORE_PORT.FiscalDocument'),
  AccountingLedger: Symbol('ENTERPRISE_CORE_PORT.AccountingLedger'),
  InventoryStock: Symbol('ENTERPRISE_CORE_PORT.InventoryStock'),
  PayrollContract: Symbol('ENTERPRISE_CORE_PORT.PayrollContract'),
  CommercialSupplier: Symbol('ENTERPRISE_CORE_PORT.CommercialSupplier'),
  CommercialClient: Symbol('ENTERPRISE_CORE_PORT.CommercialClient'),
} as const;

export type CommercialSupplierView = {
  id: string;
  status: string;
  currencyCode: string;
  paymentTerms: string | null;
};

/**
 * Referência humana do Fornecedor para leitura por outro contexto.
 *
 * Existe para que um contexto consumidor (Compras, Financeiro) identifique o fornecedor por
 * nome/CNPJ SEM ler as tabelas privadas do contexto Comercial: o dado atravessa a fronteira pelo
 * port, nunca por junção SQL (`module-boundary-rules`).
 */
export type CommercialSupplierReference = {
  id: string;
  legalName: string;
  tradeName: string | null;
  taxId: string;
};

export type CommercialSupplierPort = {
  findPublishedById(supplierId: string): Promise<CommercialSupplierView | null>;
  requireActive(supplierId: string): Promise<CommercialSupplierView>;
  assertNotInactive(supplierId: string): Promise<void>;
  /** Referências humanas dos fornecedores pedidos (no máximo uma leitura por página). */
  findReferencesByIds(supplierIds: string[]): Promise<CommercialSupplierReference[]>;
  /**
   * Identificadores de fornecedores que casam com o termo informado (nome, nome fantasia ou
   * CNPJ). O consumidor usa a lista para filtrar o próprio dado sem tocar em `pty.suppliers`.
   */
  searchIdsByTerm(term: string, limit: number): Promise<string[]>;
};

export type CommercialClientView = {
  id: string;
  status: string;
  purchaseOrderRequirement: string;
};

export type CommercialClientPort = {
  findPublishedById(clientId: string): Promise<CommercialClientView | null>;
  requireActive(clientId: string): Promise<CommercialClientView>;
  assertNotInactive(clientId: string): Promise<void>;
};

export type OpenReceivableFromBillingInput = {
  billingRecordId: string;
  billingDocumentId: string;
  serviceOrderId: string;
  measurementId: string;
  unitId: string;
  clientId: string;
  principal: string;
  currencyCode: string;
  dueDate: string;
  paymentTerms: string;
  externalReference?: string | null;
  actorIdentityId: string;
  installments?: Array<{ installmentNumber: number; principal: string; dueDate: string }>;
};

export type FinanceReceivablePort = {
  openFromBilling(
    input: OpenReceivableFromBillingInput,
  ): Promise<{ receivableId: string; idempotent: boolean }>;
  cancelFromBilling(input: {
    billingDocumentId: string;
    actorIdentityId: string;
    reason: string;
  }): Promise<void>;
};

export type OpenPayableFromTaxObligationInput = {
  taxObligationId: string;
  taxAssessmentId: string;
  unitId: string;
  counterpartyId: string;
  principal: string;
  currencyCode: string;
  dueDate: string;
  paymentTerms: string;
  expenseCategoryId: string;
  costCenterId: string;
  costCenterCode: string;
  originReference: string;
  externalReference?: string | null;
  actorIdentityId: string;
};

export type TaxObligationPayableView = {
  payableId: string;
  principal: string;
  currencyCode: string;
  originKind: string;
  originId: string;
  lifecycle: string;
};

export type OpenPayableFromProcurementReceiptInput = {
  receiptId: string;
  supplierPurchaseOrderId: string;
  unitId: string;
  supplierId: string;
  principal: string;
  currencyCode: string;
  dueDate: string;
  paymentTerms: string;
  expenseCategoryId: string;
  costCenterId: string;
  costCenterCode: string;
  originReference: string;
  actorIdentityId: string;
};

export type OpenPayableFromSupplierInvoiceInput = {
  invoiceId: string;
  unitId: string;
  supplierId: string;
  principal: string;
  currencyCode: string;
  dueDate: string;
  paymentTerms: string;
  expenseCategoryId: string;
  costCenterId: string;
  costCenterCode: string;
  originReference: string;
  externalReference?: string | null;
  actorIdentityId: string;
};

export type FinancePayablePort = {
  openFromTaxObligation(
    input: OpenPayableFromTaxObligationInput,
  ): Promise<{ payableId: string; principal: string; currencyCode: string; idempotent: boolean }>;
  cancelFromTaxObligation(input: {
    taxObligationId: string;
    actorIdentityId: string;
    reason: string;
  }): Promise<void>;
  findByTaxObligation(taxObligationId: string): Promise<TaxObligationPayableView | null>;
  openFromProcurementReceipt(
    input: OpenPayableFromProcurementReceiptInput,
  ): Promise<{ payableId: string; principal: string; currencyCode: string; idempotent: boolean }>;
  findByProcurementReceipt(receiptId: string): Promise<TaxObligationPayableView | null>;
  openFromSupplierInvoice(
    input: OpenPayableFromSupplierInvoiceInput,
  ): Promise<{ payableId: string; principal: string; currencyCode: string; idempotent: boolean }>;
  findBySupplierInvoice(invoiceId: string): Promise<TaxObligationPayableView | null>;
};

export type FiscalDocumentPort = {
  createFromSource(input: {
    sourceKind: string;
    sourceId: string;
    unitId: string;
    actorIdentityId: string;
    idempotencyKey: string;
    description: string;
    currencyCode: string;
    issuedOn: string;
    parties: Array<{
      role: string;
      legalName: string;
      taxIdentifier: string;
      partySnapshot?: Record<string, unknown>;
    }>;
    items: Array<{
      lineNumber: number;
      description: string;
      quantity: string;
      unitAmount: string;
      lineAmount: string;
      itemSnapshot?: Record<string, unknown>;
    }>;
    taxDetails?: Array<{
      lineNumber: number;
      componentLabel: string;
      amount: string;
      detailSnapshot?: Record<string, unknown>;
    }>;
    billingDocumentId?: string;
  }): Promise<{ fiscalDocumentId: string; idempotent: boolean }>;
};

export type AccountingPostFromSourceInput = {
  sourceContext: string;
  sourceId: string;
  unitId: string;
  sourceReference?: string;
  chartId?: string;
  periodId?: string;
  description?: string;
  occurredOn?: string;
  currencyCode?: string;
  idempotencyKey?: string;
  actorIdentityId?: string;
  lines?: Array<{
    lineNumber: number;
    accountId: string;
    direction: string;
    amount: string;
    description?: string | null;
  }>;
};

export type AccountingConfirmedEventInput = {
  originKind: string;
  eventKind: string;
  sourceId: string;
  unitId: string;
  amount: string;
  currencyCode: string;
  occurredOn: string;
  idempotencyKey?: string;
  sourceReference?: string;
  actorIdentityId: string;
  context?: Record<string, unknown>;
};

export type AccountingReverseConfirmedEventInput = {
  originKind: string;
  eventKind: string;
  sourceId: string;
  unitId: string;
  actorIdentityId: string;
  reason: string;
  idempotencyKey?: string;
};

export type AccountingLedgerPort = {
  postFromSource(
    input: AccountingPostFromSourceInput,
  ): Promise<{ journalEntryId: string; idempotent: boolean }>;
  postConfirmedEvent(input: AccountingConfirmedEventInput): Promise<{
    journalEntryId: string;
    postingRequestId: string;
    idempotent: boolean;
  }>;
  reverseConfirmedEvent(input: AccountingReverseConfirmedEventInput): Promise<{
    journalEntryId: string | null;
    postingRequestId: string | null;
    idempotent: boolean;
  }>;
};

export type InventoryStockPort = {
  postMovement(input: {
    inventoryItemId: string;
    warehouseId: string;
    unitId: string;
    movementType?: string;
    quantity?: string;
    idempotencyKey?: string;
    actorIdentityId?: string;
    destinationWarehouseId?: string;
    occurredOn?: string;
    description?: string;
  }): Promise<void | { movementIds: string[]; idempotent: boolean }>;
};

export type PayrollContractPort = {
  closePeriod(input: { payrollPeriodId: string; unitId: string }): Promise<void>;
};

export const ENTERPRISE_CORE_PORT_READINESS = {
  [ENTERPRISE_CORE_PORT.FinanceReceivable]: BOUNDED_CONTEXT_READINESS[BOUNDED_CONTEXT.Finance],
  [ENTERPRISE_CORE_PORT.FinancePayable]: BOUNDED_CONTEXT_READINESS[BOUNDED_CONTEXT.Finance],
  [ENTERPRISE_CORE_PORT.FiscalDocument]: BOUNDED_CONTEXT_READINESS[BOUNDED_CONTEXT.Fiscal],
  [ENTERPRISE_CORE_PORT.AccountingLedger]: BOUNDED_CONTEXT_READINESS[BOUNDED_CONTEXT.Accounting],
  [ENTERPRISE_CORE_PORT.InventoryStock]: BOUNDED_CONTEXT_READINESS[BOUNDED_CONTEXT.Inventory],
  [ENTERPRISE_CORE_PORT.PayrollContract]: BOUNDED_CONTEXT_READINESS[BOUNDED_CONTEXT.Payroll],
  [ENTERPRISE_CORE_PORT.CommercialSupplier]: BOUNDED_CONTEXT_READINESS[BOUNDED_CONTEXT.Commercial],
  [ENTERPRISE_CORE_PORT.CommercialClient]: BOUNDED_CONTEXT_READINESS[BOUNDED_CONTEXT.Commercial],
} as const;
