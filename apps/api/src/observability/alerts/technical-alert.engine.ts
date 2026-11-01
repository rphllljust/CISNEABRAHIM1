import type { TechnicalAlertPolicy } from './technical-alert-policy';
import { TECHNICAL_ALERT_RUNBOOKS } from './technical-alert-runbooks';
import {
  TECHNICAL_ALERT_SEVERITIES,
  TECHNICAL_ALERT_STATUSES,
  TECHNICAL_ALERT_TYPES,
  type TechnicalAlertConditionInput,
  type TechnicalAlertConditionResult,
  type TechnicalAlertDefinition,
  type TechnicalAlertSnapshot,
  type TechnicalAlertType,
} from './technical-alert.types';

export function buildTechnicalAlertDefinitions(
  policy: TechnicalAlertPolicy,
): TechnicalAlertDefinition[] {
  return [
    {
      alertType: TECHNICAL_ALERT_TYPES.HighErrorRate,
      title: 'Alta taxa de erro HTTP',
      defaultSeverity: TECHNICAL_ALERT_SEVERITIES.Warning,
      thresholdDescription: `error_rate >= ${policy.highErrorRateThreshold}`,
      durationMs: policy.highErrorRateDurationMs,
      runbook: TECHNICAL_ALERT_RUNBOOKS[TECHNICAL_ALERT_TYPES.HighErrorRate],
    },
    {
      alertType: TECHNICAL_ALERT_TYPES.HighLatencyP95,
      title: 'Latência HTTP p95 elevada',
      defaultSeverity: TECHNICAL_ALERT_SEVERITIES.Info,
      thresholdDescription: `p95 >= ${policy.highLatencyP95ThresholdMs}ms`,
      durationMs: policy.highLatencyP95DurationMs,
    },
    {
      alertType: TECHNICAL_ALERT_TYPES.HighLatencyP99,
      title: 'Latência HTTP p99 elevada',
      defaultSeverity: TECHNICAL_ALERT_SEVERITIES.Warning,
      thresholdDescription: `p99 >= ${policy.highLatencyP99ThresholdMs}ms`,
      durationMs: policy.highLatencyP99DurationMs,
      runbook: TECHNICAL_ALERT_RUNBOOKS[TECHNICAL_ALERT_TYPES.HighLatencyP99],
    },
    {
      alertType: TECHNICAL_ALERT_TYPES.DbConnectionSaturation,
      title: 'Saturação do pool de conexões DB',
      defaultSeverity: TECHNICAL_ALERT_SEVERITIES.Critical,
      thresholdDescription: `pool.waiting >= ${policy.dbPoolWaitingThreshold}`,
      durationMs: policy.dbPoolSaturationDurationMs,
      runbook: TECHNICAL_ALERT_RUNBOOKS[TECHNICAL_ALERT_TYPES.DbConnectionSaturation],
    },
    {
      alertType: TECHNICAL_ALERT_TYPES.WorkerStalled,
      title: 'Worker de background jobs parado',
      defaultSeverity: TECHNICAL_ALERT_SEVERITIES.Critical,
      thresholdDescription: `pending >= ${policy.workerPendingThreshold} sem atividade`,
      durationMs: policy.workerStalledDurationMs,
      runbook: TECHNICAL_ALERT_RUNBOOKS[TECHNICAL_ALERT_TYPES.WorkerStalled],
    },
    {
      alertType: TECHNICAL_ALERT_TYPES.OutboxBacklog,
      title: 'Backlog do outbox elevado',
      defaultSeverity: TECHNICAL_ALERT_SEVERITIES.Warning,
      thresholdDescription: `pending >= ${policy.outboxPendingThreshold}`,
      durationMs: policy.outboxBacklogDurationMs,
      runbook: TECHNICAL_ALERT_RUNBOOKS[TECHNICAL_ALERT_TYPES.OutboxBacklog],
    },
    {
      alertType: TECHNICAL_ALERT_TYPES.BillingReceivableHandoffFailure,
      title: 'Faturamento finalizado sem recebível ou recuperação financeira falhada',
      defaultSeverity: TECHNICAL_ALERT_SEVERITIES.Critical,
      thresholdDescription: 'receivable_handoff_dead >= 1 OR billing_receivable_orphans_over_5m >= 1',
      durationMs: 0,
      runbook: TECHNICAL_ALERT_RUNBOOKS[TECHNICAL_ALERT_TYPES.BillingReceivableHandoffFailure],
    },
    {
      alertType: TECHNICAL_ALERT_TYPES.StorageFailure,
      title: 'Falhas de object storage',
      defaultSeverity: TECHNICAL_ALERT_SEVERITIES.Critical,
      thresholdDescription: `failures >= ${policy.storageFailureThreshold}`,
      durationMs: policy.storageFailureDurationMs,
      runbook: TECHNICAL_ALERT_RUNBOOKS[TECHNICAL_ALERT_TYPES.StorageFailure],
    },
    {
      alertType: TECHNICAL_ALERT_TYPES.ErpFailures,
      title: 'Falhas de integração ERP (ACL adapter)',
      defaultSeverity: TECHNICAL_ALERT_SEVERITIES.Warning,
      thresholdDescription: `erp_failures >= ${policy.erpFailureThreshold} (somente quando ERP_INTEGRATION_CONFIGURED)`,
      durationMs: policy.erpFailureDurationMs,
      runbook: TECHNICAL_ALERT_RUNBOOKS[TECHNICAL_ALERT_TYPES.ErpFailures],
    },
    {
      alertType: TECHNICAL_ALERT_TYPES.TrackingFailures,
      title: 'Falhas de integração de rastreio (ACL adapter)',
      defaultSeverity: TECHNICAL_ALERT_SEVERITIES.Info,
      thresholdDescription: `tracking_failures >= ${policy.trackingFailureThreshold} (somente quando TRACKING_INTEGRATION_CONFIGURED)`,
      durationMs: policy.trackingFailureDurationMs,
    },
    {
      alertType: TECHNICAL_ALERT_TYPES.NotificationFailures,
      title: 'Falhas de notificação acumuladas',
      defaultSeverity: TECHNICAL_ALERT_SEVERITIES.Warning,
      thresholdDescription: `notification_failures >= ${policy.notificationFailureThreshold}`,
      durationMs: policy.notificationFailureDurationMs,
    },
    {
      alertType: TECHNICAL_ALERT_TYPES.BackupFailure,
      title: 'Falha no último backup',
      defaultSeverity: TECHNICAL_ALERT_SEVERITIES.Critical,
      thresholdDescription: 'backup_status=failed',
      durationMs: 0,
      runbook: TECHNICAL_ALERT_RUNBOOKS[TECHNICAL_ALERT_TYPES.BackupFailure],
    },
    {
      alertType: TECHNICAL_ALERT_TYPES.DiskResourceExhaustion,
      title: 'Disco do storage próximo do limite',
      defaultSeverity: TECHNICAL_ALERT_SEVERITIES.Critical,
      thresholdDescription: `disk_usage >= ${policy.diskUsageCriticalPercent}%`,
      durationMs: policy.diskUsageDurationMs,
      runbook: TECHNICAL_ALERT_RUNBOOKS[TECHNICAL_ALERT_TYPES.DiskResourceExhaustion],
    },
  ];
}

export function evaluateTechnicalAlertConditions(
  input: TechnicalAlertConditionInput,
  policy: TechnicalAlertPolicy,
): TechnicalAlertConditionResult[] {
  const results: TechnicalAlertConditionResult[] = [];

  const errorRate =
    input.httpRequestCount >= policy.minHttpRequestsForErrorRate && input.httpRequestCount > 0
      ? input.httpErrorRate
      : null;

  results.push(
    condition({
      alertType: TECHNICAL_ALERT_TYPES.HighErrorRate,
      breached: errorRate !== null && errorRate >= policy.highErrorRateThreshold,
      severity:
        errorRate !== null && errorRate >= policy.highErrorRateThreshold * 2
          ? TECHNICAL_ALERT_SEVERITIES.Critical
          : TECHNICAL_ALERT_SEVERITIES.Warning,
      message: 'Taxa de erro HTTP acima do limiar.',
      observedValue: errorRate === null ? 'insufficient_samples' : errorRate.toFixed(4),
    }),
  );

  results.push(
    condition({
      alertType: TECHNICAL_ALERT_TYPES.HighLatencyP95,
      breached:
        input.httpLatencyP95Ms !== null &&
        input.httpLatencyP95Ms >= policy.highLatencyP95ThresholdMs,
      severity: TECHNICAL_ALERT_SEVERITIES.Info,
      message: 'Latência p95 HTTP acima do limiar.',
      observedValue: formatMs(input.httpLatencyP95Ms),
    }),
  );

  results.push(
    condition({
      alertType: TECHNICAL_ALERT_TYPES.HighLatencyP99,
      breached:
        input.httpLatencyP99Ms !== null &&
        input.httpLatencyP99Ms >= policy.highLatencyP99ThresholdMs,
      severity:
        input.httpLatencyP99Ms !== null &&
        input.httpLatencyP99Ms >= policy.highLatencyP99ThresholdMs * 2
          ? TECHNICAL_ALERT_SEVERITIES.Critical
          : TECHNICAL_ALERT_SEVERITIES.Warning,
      message: 'Latência p99 HTTP acima do limiar.',
      observedValue: formatMs(input.httpLatencyP99Ms),
    }),
  );

  const poolWaiting = input.dbPoolWaiting ?? 0;
  results.push(
    condition({
      alertType: TECHNICAL_ALERT_TYPES.DbConnectionSaturation,
      breached: poolWaiting >= policy.dbPoolWaitingThreshold,
      severity: TECHNICAL_ALERT_SEVERITIES.Critical,
      message: 'Clientes aguardando conexão no pool PostgreSQL.',
      observedValue: String(poolWaiting),
    }),
  );

  const workerStalled = isWorkerStalled(input, policy);
  results.push(
    condition({
      alertType: TECHNICAL_ALERT_TYPES.WorkerStalled,
      breached: workerStalled,
      severity: TECHNICAL_ALERT_SEVERITIES.Critical,
      message: 'Fila de background jobs sem consumo.',
      observedValue: `pending=${input.workerPending},in_flight=${input.workerInFlight}`,
    }),
  );

  results.push(
    condition({
      alertType: TECHNICAL_ALERT_TYPES.OutboxBacklog,
      breached: input.outboxPending >= policy.outboxPendingThreshold,
      severity:
        input.outboxPending >= policy.outboxPendingThreshold * 2
          ? TECHNICAL_ALERT_SEVERITIES.Critical
          : TECHNICAL_ALERT_SEVERITIES.Warning,
      message: 'Eventos outbox pendentes acima do limiar.',
      observedValue: String(input.outboxPending),
    }),
  );

  const deadReceivableJobs = input.receivableHandoffDead;
  const orphanInvoices = input.billingReceivableOrphans;
  // Null/undefined means not measured; do NOT report a false-zero recovery.
  if (deadReceivableJobs !== undefined && orphanInvoices !== undefined) {
    results.push(condition({
      alertType: TECHNICAL_ALERT_TYPES.BillingReceivableHandoffFailure,
      breached: deadReceivableJobs > 0 || orphanInvoices > 0,
      severity: TECHNICAL_ALERT_SEVERITIES.Critical,
      message: 'Documento FINALIZED sem recebível há mais de cinco minutos ou handoff financeiro em DEAD/FAILED.',
      observedValue: `orphan_finalized=${orphanInvoices},dead_or_failed_handoffs=${deadReceivableJobs}`,
    }));
  }

  const storageFailures = input.storageFailures;
  results.push(
    condition({
      alertType: TECHNICAL_ALERT_TYPES.StorageFailure,
      breached: storageFailures >= policy.storageFailureThreshold,
      severity: TECHNICAL_ALERT_SEVERITIES.Critical,
      message: 'Falhas registradas no object storage.',
      observedValue: String(storageFailures),
    }),
  );

  results.push(
    condition({
      alertType: TECHNICAL_ALERT_TYPES.ErpFailures,
      breached:
        input.erpIntegrationConfigured && input.erpFailures >= policy.erpFailureThreshold,
      severity:
        input.erpFailures >= policy.erpFailureThreshold * 3
          ? TECHNICAL_ALERT_SEVERITIES.Critical
          : TECHNICAL_ALERT_SEVERITIES.Warning,
      message: input.erpIntegrationConfigured
        ? 'Mensagens ERP em falha na inbox.'
        : 'ERP ACL adapter não configurado — alerta suprimido.',
      observedValue: input.erpIntegrationConfigured
        ? String(input.erpFailures)
        : 'adapter_unconfigured',
    }),
  );

  results.push(
    condition({
      alertType: TECHNICAL_ALERT_TYPES.TrackingFailures,
      breached:
        input.trackingIntegrationConfigured &&
        input.trackingFailures >= policy.trackingFailureThreshold,
      severity: TECHNICAL_ALERT_SEVERITIES.Info,
      message: input.trackingIntegrationConfigured
        ? 'Mensagens de rastreio em falha na inbox.'
        : 'Tracking ACL adapter não configurado — alerta suprimido.',
      observedValue: input.trackingIntegrationConfigured
        ? String(input.trackingFailures)
        : 'adapter_unconfigured',
    }),
  );

  results.push(
    condition({
      alertType: TECHNICAL_ALERT_TYPES.NotificationFailures,
      breached: input.notificationFailures >= policy.notificationFailureThreshold,
      severity:
        input.notificationFailures >= policy.notificationFailureThreshold * 2
          ? TECHNICAL_ALERT_SEVERITIES.Critical
          : TECHNICAL_ALERT_SEVERITIES.Warning,
      message: 'Tentativas de notificação falhadas acima do limiar.',
      observedValue: String(input.notificationFailures),
    }),
  );

  results.push(
    condition({
      alertType: TECHNICAL_ALERT_TYPES.BackupFailure,
      breached: input.backupStatus === 'failed',
      severity: TECHNICAL_ALERT_SEVERITIES.Critical,
      message: 'Último backup reportado como falho.',
      observedValue: input.backupStatus,
    }),
  );

  if (input.diskUsagePercent !== null) {
    const critical = input.diskUsagePercent >= policy.diskUsageCriticalPercent;
    const warning = input.diskUsagePercent >= policy.diskUsageWarningPercent;
    results.push(
      condition({
        alertType: TECHNICAL_ALERT_TYPES.DiskResourceExhaustion,
        breached: warning,
        severity: critical
          ? TECHNICAL_ALERT_SEVERITIES.Critical
          : TECHNICAL_ALERT_SEVERITIES.Warning,
        message: 'Uso de disco do storage acima do limiar.',
        observedValue: `${input.diskUsagePercent.toFixed(1)}%`,
      }),
    );
  }

  return results;
}

function isWorkerStalled(input: TechnicalAlertConditionInput, policy: TechnicalAlertPolicy): boolean {
  if (input.workerPending < policy.workerPendingThreshold) {
    return false;
  }
  if (input.workerInFlight > 0) {
    return false;
  }
  if (!input.workerLastActivityAt) {
    return true;
  }
  const idleMs = Date.now() - new Date(input.workerLastActivityAt).getTime();
  return idleMs >= policy.workerStalledDurationMs;
}

function condition(input: {
  alertType: TechnicalAlertType;
  breached: boolean;
  severity: TechnicalAlertConditionResult['severity'];
  message: string;
  observedValue: string;
}): TechnicalAlertConditionResult {
  return {
    alertType: input.alertType,
    breached: input.breached,
    severity: input.severity,
    message: input.message,
    observedValue: input.observedValue,
  };
}

function formatMs(value: number | null): string {
  return value === null ? 'n/a' : `${value.toFixed(0)}ms`;
}

export type TechnicalAlertStateEntry = {
  breachStartedAt: string | null;
  firingSince: string | null;
  lastResolvedAt: string | null;
};

export class TechnicalAlertStateTracker {
  private readonly entries = new Map<TechnicalAlertType, TechnicalAlertStateEntry>();

  evaluate(input: {
    now: Date;
    conditions: TechnicalAlertConditionResult[];
    definitions: TechnicalAlertDefinition[];
  }): TechnicalAlertSnapshot[] {
    const snapshots: TechnicalAlertSnapshot[] = [];

    for (const definition of input.definitions) {
      const condition = input.conditions.find((entry) => entry.alertType === definition.alertType);
      const breached = condition?.breached ?? false;
      const entry = this.entries.get(definition.alertType) ?? {
        breachStartedAt: null,
        firingSince: null,
        lastResolvedAt: null,
      };

      if (!breached) {
        if (entry.firingSince) {
          entry.lastResolvedAt = input.now.toISOString();
        }
        entry.breachStartedAt = null;
        entry.firingSince = null;
        this.entries.set(definition.alertType, entry);
        continue;
      }

      if (!entry.breachStartedAt) {
        entry.breachStartedAt = input.now.toISOString();
      }

      const breachDurationMs =
        input.now.getTime() - new Date(entry.breachStartedAt).getTime();
      const shouldFire = breachDurationMs >= definition.durationMs;

      if (shouldFire && !entry.firingSince) {
        entry.firingSince = input.now.toISOString();
      }

      if (shouldFire && condition) {
        snapshots.push({
          alertType: definition.alertType,
          status: TECHNICAL_ALERT_STATUSES.Firing,
          severity: condition.severity,
          title: definition.title,
          message: condition.message,
          observedValue: condition.observedValue,
          firingSince: entry.firingSince,
          resolvedAt: null,
          runbook:
            condition.severity === TECHNICAL_ALERT_SEVERITIES.Critical
              ? definition.runbook
              : undefined,
        });
      }

      this.entries.set(definition.alertType, entry);
    }

    return snapshots;
  }

  getResolvedSince(lastEvaluationAt: string | null): TechnicalAlertSnapshot[] {
    if (!lastEvaluationAt) {
      return [];
    }
    const resolved: TechnicalAlertSnapshot[] = [];
    for (const [alertType, entry] of this.entries.entries()) {
      if (
        entry.lastResolvedAt &&
        entry.lastResolvedAt > lastEvaluationAt &&
        !entry.firingSince
      ) {
        resolved.push({
          alertType,
          status: TECHNICAL_ALERT_STATUSES.Resolved,
          severity: TECHNICAL_ALERT_SEVERITIES.Info,
          title: `${alertType} resolved`,
          message: 'Condição normalizada.',
          observedValue: '',
          firingSince: null,
          resolvedAt: entry.lastResolvedAt,
        });
      }
    }
    return resolved;
  }
}
