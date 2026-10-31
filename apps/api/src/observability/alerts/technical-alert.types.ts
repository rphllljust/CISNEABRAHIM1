export const TECHNICAL_ALERT_SEVERITIES = {
  Info: 'INFO',
  Warning: 'WARNING',
  Critical: 'CRITICAL',
} as const;

export type TechnicalAlertSeverity =
  (typeof TECHNICAL_ALERT_SEVERITIES)[keyof typeof TECHNICAL_ALERT_SEVERITIES];

export const TECHNICAL_ALERT_STATUSES = {
  Firing: 'FIRING',
  Resolved: 'RESOLVED',
} as const;

export type TechnicalAlertStatus =
  (typeof TECHNICAL_ALERT_STATUSES)[keyof typeof TECHNICAL_ALERT_STATUSES];

export const TECHNICAL_ALERT_TYPES = {
  HighErrorRate: 'HIGH_ERROR_RATE',
  HighLatencyP95: 'HIGH_LATENCY_P95',
  HighLatencyP99: 'HIGH_LATENCY_P99',
  DbConnectionSaturation: 'DB_CONNECTION_SATURATION',
  WorkerStalled: 'WORKER_STALLED',
  OutboxBacklog: 'OUTBOX_BACKLOG',
  StorageFailure: 'STORAGE_FAILURE',
  ErpFailures: 'ERP_FAILURES',
  TrackingFailures: 'TRACKING_FAILURES',
  NotificationFailures: 'NOTIFICATION_FAILURES',
  BackupFailure: 'BACKUP_FAILURE',
  DiskResourceExhaustion: 'DISK_RESOURCE_EXHAUSTION',
  BillingReceivableHandoffFailure: 'BILLING_RECEIVABLE_HANDOFF_FAILURE',
} as const;

export type TechnicalAlertType =
  (typeof TECHNICAL_ALERT_TYPES)[keyof typeof TECHNICAL_ALERT_TYPES];

export type TechnicalAlertRunbook = {
  meaning: string;
  possibleCauses: string[];
  firstChecks: string[];
  safeAction: string;
  escalation: string;
};

export type TechnicalAlertDefinition = {
  alertType: TechnicalAlertType;
  title: string;
  defaultSeverity: TechnicalAlertSeverity;
  thresholdDescription: string;
  durationMs: number;
  runbook?: TechnicalAlertRunbook;
};

export type TechnicalAlertConditionInput = {
  httpErrorRate: number | null;
  httpRequestCount: number;
  httpLatencyP95Ms: number | null;
  httpLatencyP99Ms: number | null;
  dbPoolWaiting: number | null;
  dbPoolTotal: number | null;
  dbPoolIdle: number | null;
  workerPending: number;
  workerInFlight: number;
  workerProcessed: number;
  workerLastActivityAt: string | null;
  outboxPending: number;
  outboxFailed: number;
  /** Authoritative DB counts; omitted in old test fixtures only. */
  receivableHandoffDead?: number;
  billingReceivableOrphans?: number;
  storageFailures: number;
  erpFailures: number;
  trackingFailures: number;
  erpIntegrationConfigured: boolean;
  trackingIntegrationConfigured: boolean;
  notificationFailures: number;
  backupStatus: 'unknown' | 'ok' | 'failed';
  diskUsagePercent: number | null;
};

export type TechnicalAlertConditionResult = {
  alertType: TechnicalAlertType;
  breached: boolean;
  severity: TechnicalAlertSeverity;
  message: string;
  observedValue: string;
};

export type TechnicalAlertSnapshot = {
  alertType: TechnicalAlertType;
  status: TechnicalAlertStatus;
  severity: TechnicalAlertSeverity;
  title: string;
  message: string;
  observedValue: string;
  firingSince: string | null;
  resolvedAt: string | null;
  runbook?: TechnicalAlertRunbook;
};
