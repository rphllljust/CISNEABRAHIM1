/**
 * Closed Release 1 surface for the web shell.
 * Canonical register: docs/01-foundation/release-1-closed-scope.md
 */

export const GATED_MODULE_IDS = [
  'finance',
  'fiscal',
  'accounting',
  'inventory',
  'payroll',
  'procurement',
  'suppliers',
  'contracts',
  'people',
  'rentals',
  'transport',
  'alerts',
  'reports',
  'approval-matrix',
  'operational-profitability',
] as const;

export type GatedModuleId = (typeof GATED_MODULE_IDS)[number];

export const FEATURE_FLAG_ENV: Record<GatedModuleId, string> = {
  finance: 'VITE_FEATURE_MODULE_FINANCE',
  fiscal: 'VITE_FEATURE_MODULE_FISCAL',
  accounting: 'VITE_FEATURE_MODULE_ACCOUNTING',
  inventory: 'VITE_FEATURE_MODULE_INVENTORY',
  payroll: 'VITE_FEATURE_MODULE_PAYROLL',
  procurement: 'VITE_FEATURE_MODULE_PROCUREMENT',
  suppliers: 'VITE_FEATURE_MODULE_SUPPLIERS',
  contracts: 'VITE_FEATURE_MODULE_CONTRACTS',
  people: 'VITE_FEATURE_MODULE_PEOPLE',
  rentals: 'VITE_FEATURE_MODULE_RENTALS',
  transport: 'VITE_FEATURE_MODULE_TRANSPORT',
  alerts: 'VITE_FEATURE_MODULE_ALERTS',
  reports: 'VITE_FEATURE_MODULE_REPORTS',
  'approval-matrix': 'VITE_FEATURE_MODULE_APPROVAL_MATRIX',
  'operational-profitability': 'VITE_FEATURE_MODULE_OPERATIONAL_PROFITABILITY',
};

export const GATED_WEB_PATH_PREFIXES: ReadonlyArray<{ prefix: string; moduleId: GatedModuleId }> = [
  { prefix: '/app/finance', moduleId: 'finance' },
  { prefix: '/app/fiscal', moduleId: 'fiscal' },
  { prefix: '/app/accounting', moduleId: 'accounting' },
  { prefix: '/app/inventory', moduleId: 'inventory' },
  { prefix: '/app/payroll', moduleId: 'payroll' },
  { prefix: '/app/procurement', moduleId: 'procurement' },
  { prefix: '/app/suppliers', moduleId: 'suppliers' },
  { prefix: '/app/people', moduleId: 'people' },
  { prefix: '/app/rentals', moduleId: 'rentals' },
  { prefix: '/app/transport', moduleId: 'transport' },
  { prefix: '/app/alerts', moduleId: 'alerts' },
  { prefix: '/app/reports', moduleId: 'reports' },
  { prefix: '/app/operational-profitability', moduleId: 'operational-profitability' },
];

export function matchGatedWebPath(pathname: string): GatedModuleId | null {
  for (const entry of GATED_WEB_PATH_PREFIXES) {
    if (pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`)) {
      return entry.moduleId;
    }
  }
  return null;
}
