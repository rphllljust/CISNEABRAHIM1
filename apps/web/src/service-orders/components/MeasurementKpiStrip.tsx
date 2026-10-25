import { cn } from '../../ui/utils/cn';
import type { MeasurementWorkbenchReadModel } from '../types/measurement-workbench.types';
import {
  billingResultTone,
  formatDuration,
  formatMoney,
  formatSignedPercent,
  severityTone,
  stateLabel,
} from '../utils/measurement-workbench-format';

/**
 * FAIXA DE KPIs DO WORKBENCH DE MEDIÇÃO.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * O QUE ESTA FAIXA **NÃO** FAZ
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Não calcula variação percentual, não soma valores, não decide se está dentro da
 * tolerância. Cada célula mostra um campo que o backend já publicou:
 *
 *   GROSS VALUE        economics.grossValue
 *   VARIANCE           varianceSummary.highestSeverity + economics.financialVariance
 *   MEASUREMENT        statuses.measurement
 *   ACCEPTANCE         statuses.acceptance
 *   BILLING            statuses.billingEligibility
 *   AGE                processContext.health.elapsedSeconds
 *
 * "VARIANCE" mostra a SEVERIDADE e o VALOR da exposição, não um percentual:
 * o percentual de uma dimensão isolada representaria mal um conjunto com várias
 * — e o backend já escolheu qual severidade governa.
 */

function KpiCell({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  detail?: string | null;
  tone?: 'neutral' | 'info' | 'warning' | 'critical' | 'success';
}) {
  const toneClass = {
    neutral: 'text-gray-900',
    info: 'text-brand-700',
    warning: 'text-amber-700',
    critical: 'text-red-700',
    success: 'text-emerald-700',
  }[tone];

  return (
    <div className="min-w-0 flex-1 border-r border-[color:var(--color-divider)] px-3 py-2 last:border-r-0">
      <p className="cisne-meta-label m-0">{label}</p>
      <p className={cn('m-0 truncate text-sm font-semibold tabular-nums', toneClass)}>{value}</p>
      {detail ? <p className="m-0 truncate text-[11px] text-gray-500">{detail}</p> : null}
    </div>
  );
}

export function MeasurementKpiStrip({ workbench }: { workbench: MeasurementWorkbenchReadModel }) {
  const { economics, statuses, varianceSummary, processContext, commercialContext } = workbench;

  const grossValue = formatMoney(economics.grossValue, economics.currency) ?? 'Não apurado';
  const exposure = formatMoney(economics.financialVariance, economics.currency);

  /**
   * A variação é apresentada como SEVERIDADE + EXPOSIÇÃO.
   *
   * Quando não há decisão pendente, o valor vira "Sem desvio" em vez de "R$ 0,00":
   * zero afirmaria que nada foi medido, e o que se sabe é que nada diverge.
   */
  const varianceValue = varianceSummary.decisionRequiredCount === 0
    ? stateLabel(varianceSummary.highestSeverity) ?? 'Sem desvio'
    : (stateLabel(varianceSummary.highestSeverity) ?? varianceSummary.highestSeverity);
  const varianceDetail = varianceSummary.decisionRequiredCount > 0
    ? exposure ?? `${varianceSummary.decisionRequiredCount} exigem decisão`
    : severityTone(varianceSummary.highestSeverity) === 'neutral'
      ? `Tolerância ${formatSignedPercent(commercialContext.tolerance.percentage)?.replace('+', '') ?? ''}`
      : null;

  const age = formatDuration(processContext.health.elapsedSeconds);

  return (
    <section
      aria-label="Indicadores da medição"
      data-region="measurement-kpi-strip"
      className="mb-2 flex flex-wrap items-stretch overflow-hidden rounded-[10px] border border-[color:var(--color-border-default)] bg-white"
    >
      <KpiCell label="Valor bruto" value={grossValue} detail={null} />
      <KpiCell
        label="Variação"
        value={varianceValue}
        detail={varianceDetail}
        tone={severityTone(varianceSummary.highestSeverity)}
      />
      <KpiCell
        label="Medição"
        value={stateLabel(statuses.measurement) ?? statuses.measurement}
        tone={statuses.measurement === 'REJECTED' ? 'critical' : 'neutral'}
      />
      <KpiCell
        label="Aceite"
        value={stateLabel(statuses.acceptance) ?? statuses.acceptance}
        tone={
          statuses.acceptance === 'ACCEPTED'
            ? 'success'
            : statuses.acceptance === 'REJECTED'
              ? 'critical'
              : statuses.acceptance === 'PENDING'
                ? 'warning'
                : 'neutral'
        }
      />
      <KpiCell
        label="Faturamento"
        value={stateLabel(statuses.billingEligibility) ?? statuses.billingEligibility}
        detail={billingResultTone(statuses.billingEligibility) === 'success' ? 'Pronto para faturar' : null}
        tone={billingResultTone(statuses.billingEligibility)}
      />
      <KpiCell
        label="Idade no estágio"
        value={age ?? '—'}
        detail={processContext.health.currentStageLabel}
        tone={processContext.health.risk === 'HIGH' ? 'critical' : 'neutral'}
      />
    </section>
  );
}

/** Faixa de resumo da FILA: tamanho do problema por estágio, na primeira dobra. */
export function MeasurementQueueStrip({
  counts,
  total,
}: {
  counts: Record<string, number>;
  total: number;
}) {
  const order = [
    ['READY_NOT_PREPARED', 'Prontos'],
    ['ACCEPTED_NOT_BILLABLE', 'Bloqueados'],
    ['APPROVED_NOT_ACCEPTED', 'Aguar. aceite'],
    ['MEASURED_NOT_APPROVED', 'Não aprovados'],
    ['EXECUTED_NOT_MEASURED', 'Não medidos'],
  ] as const;

  return (
    <section
      aria-label="Resumo da fila de medição"
      className="mb-2 flex flex-wrap items-stretch overflow-hidden rounded-[10px] border border-[color:var(--color-border-default)] bg-[color:var(--color-surface-header)]"
    >
      <KpiCell label="Total" value={String(total)} />
      {order.map(([stage, label]) => (
        <KpiCell
          key={stage}
          label={label}
          value={String(counts[stage] ?? 0)}
          tone={(counts[stage] ?? 0) > 0 ? 'info' : 'neutral'}
        />
      ))}
    </section>
  );
}
