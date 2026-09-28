import type { GatedModuleId } from '../release-scope/release-1-scope';

export type ShellNavAccessCheck =
  | 'authz-probe'
  | 'client-list'
  | 'catalog-list'
  | 'asset-list'
  | 'request-list'
  | 'proposal-list'
  | 'purchase-order-list'
  | 'contract-list'
  | 'billing-list'
  | 'document-list'
  | 'service-order-list'
  | 'people-list'
  | 'finance-overview'
  | 'finance-receivable-list'
  | 'finance-payable-list'
  | 'finance-treasury-list'
  | 'finance-reconciliation-read'
  | 'finance-expense-read'
  | 'finance-budget-read'
  | 'finance-forecast-read'
  | 'fiscal-document-read'
  | 'fiscal-tax-read'
  | 'fiscal-period-read'
  | 'accounting-journal-read'
  | 'accounting-fixed-asset-read'
  | 'inventory-read'
  | 'payroll-read'
  | 'procurement-read'
  | 'supplier-read'
  | 'access-admin';

export type ShellNavItem = {
  id: string;
  label: string;
  path: string;
  capabilityId: string | null;
  accessCheck?: ShellNavAccessCheck;
  featureFlag?: GatedModuleId;
};

export type ShellNavGroup = {
  id: string;
  label: string;
  items: ShellNavItem[];
};

export type NavAccessMap = Record<string, boolean>;

export type ShellBreadcrumbItem = {
  label: string;
  href?: string;
};
