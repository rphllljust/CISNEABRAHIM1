export const REPORT_ERROR_CODES = {
  ACCESS_DENIED: 'REPORT_ACCESS_DENIED',
  INVALID_REQUEST: 'REPORT_INVALID_REQUEST',
  NOT_FOUND: 'REPORT_NOT_FOUND',
  NOT_READY: 'REPORT_NOT_READY',
  FORMAT_UNSUPPORTED: 'REPORT_FORMAT_UNSUPPORTED',
  CANCELLED: 'REPORT_CANCELLED',
} as const;

export type ReportErrorCode = (typeof REPORT_ERROR_CODES)[keyof typeof REPORT_ERROR_CODES];

export type ReportCatalogItem = {
  reportType: string;
  label: string;
  formats: string[];
  /** Backend-authorized filter contract for this report type. */
  allowedFilters?: Array<keyof ReportFilters>;
  sensitive: boolean;
  columns: string[];
};

export type ReportFilters = {
  period?: string;
  from?: string;
  to?: string;
  unitId?: string;
  clientId?: string;
  serviceDefinitionId?: string;
  status?: string;
};

export type ReportContract = {
  name: string;
  filters: ReportFilters;
  columns: string[];
  sort: { field: string; direction: 'ASC' | 'DESC' };
  timezone: string;
  generatedAt: string | null;
  actor: { identityId: string; sessionId: string };
  scope: { summary: string };
};

export type ReportPreviewResponse = {
  contract: ReportContract;
  preview: Record<string, unknown>[];
  total: number;
};

export type ReportExportStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export type ReportExportSummary = {
  id: string;
  reportType: string;
  format: string;
  status: ReportExportStatus;
  contract: ReportContract;
  rowCount: number | null;
  fileSizeBytes: number | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  downloadReady: boolean;
};
