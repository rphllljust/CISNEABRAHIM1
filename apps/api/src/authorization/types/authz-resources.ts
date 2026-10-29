/**
 * Tipos de recurso tipados — sem entidades empresariais (OS, faturamento, etc.).
 */
export const AUTHZ_RESOURCE_TYPES = {
  Probe: 'authz:probe',
  Grant: 'authz:grant',
  ApprovalMatrix: 'authz:approval-matrix',
  Platform: 'platform:system',
  OperationalUnit: 'organization:operational-unit',
  ScopedRecord: 'authz:scoped-record',
  Client: 'client:client',
  Supplier: 'supplier:supplier',
  Procurement: 'procurement:procurement',
  CatalogService: 'catalog:service',
  CatalogUnit: 'catalog:unit',
  ResourcesResourceType: 'resources:resource-type',
  ResourcesLaborType: 'resources:labor-type',
  ResourcesAsset: 'resources:asset',
  DocumentsDocument: 'documents:document',
  CommercialPolicy: 'commercial:policy',
  CommercialProposal: 'commercial:proposal',
  CommercialPurchaseOrder: 'commercial:purchase-order',
  CommercialContract: 'commercial:contract',
  RequestsServiceRequest: 'requests:service-request',
  ServiceOrdersServiceOrder: 'service-orders:service-order',
  PeoplePerson: 'people:person',
  IssuerLegalEntity: 'issuer:legal-entity',
  IssuerEstablishment: 'issuer:establishment',
  IssuerTaxRegistration: 'issuer:tax-registration',
  IssuerCertificate: 'issuer:certificate',
  FinanceReceivable: 'finance:receivable',
  FinancePayable: 'finance:payable',
  FinanceExpense: 'finance:expense',
  FinanceCollection: 'finance:collection',
  FinanceTreasury: 'finance:treasury',
  FinanceBudget: 'finance:budget',
  FinanceCashForecast: 'finance:cash-forecast',
  AccountingLedger: 'accounting:ledger',
  FiscalDocument: 'fiscal:document',
  FiscalTaxEngine: 'fiscal:tax-engine',
  FiscalPeriod: 'fiscal:period',
  InventoryStock: 'inventory:stock',
  PayrollLedger: 'payroll:ledger',
  AccessAdmin: 'authz:access-admin',
} as const;

export type AuthzResourceType = (typeof AUTHZ_RESOURCE_TYPES)[keyof typeof AUTHZ_RESOURCE_TYPES];

const RESOURCE_TYPE_SET = new Set<string>(Object.values(AUTHZ_RESOURCE_TYPES));

export function isAuthzResourceType(value: string): value is AuthzResourceType {
  return RESOURCE_TYPE_SET.has(value);
}
