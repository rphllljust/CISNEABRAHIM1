export const BACKGROUND_JOB_KINDS = {
  Notification: 'NOTIFICATION',
  Integration: 'INTEGRATION',
  DocumentProcessing: 'DOCUMENT_PROCESSING',
  ReportGeneration: 'REPORT_GENERATION',
  OperationalAlertScan: 'OPERATIONAL_ALERT_SCAN',
  BillingReceivableHandoff: 'BILLING_RECEIVABLE_HANDOFF',
  BillingReceivableCancel: 'BILLING_RECEIVABLE_CANCEL',
} as const;

export type BackgroundJobKind = (typeof BACKGROUND_JOB_KINDS)[keyof typeof BACKGROUND_JOB_KINDS];

export const BACKGROUND_JOB_STATUSES = {
  Pending: 'PENDING',
  Running: 'RUNNING',
  Completed: 'COMPLETED',
  Failed: 'FAILED',
  Dead: 'DEAD',
} as const;

export type BackgroundJobStatus = (typeof BACKGROUND_JOB_STATUSES)[keyof typeof BACKGROUND_JOB_STATUSES];

export const BACKGROUND_JOB_FAILURE_CLASSES = {
  Transient: 'TRANSIENT',
  Permanent: 'PERMANENT',
} as const;

export type BackgroundJobFailureClass =
  (typeof BACKGROUND_JOB_FAILURE_CLASSES)[keyof typeof BACKGROUND_JOB_FAILURE_CLASSES];

export const BACKGROUND_JOB_PAYLOAD_VERSION = 1;
