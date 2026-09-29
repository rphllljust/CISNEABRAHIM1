import { cn } from '../../ui/utils/cn';
import type { ProductivitySummary } from '../types/dashboard.types';
import { formatHours, formatPercent } from '../utils/dashboard-formatters';

type ProductivityPanelProps = {
  productivity: ProductivitySummary;
};

type DenseMetric = {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: 'neutral' | 'positive' | 'warning';
};

/**
 * PRODUTIVIDADE — FAIXA DENSA, nao 5 cards enormes.
 *
 * Um unico painel com as metricas de BI ja existentes lado a lado. Metrica sem
 * amostra real aparece como “amostra insuficiente” e NAO vira zero: o backend
 * distingue `available=false` de valor zero.
 *
 * Os indicadores sao de GRANULARIDADE de periodo (taxa, cycle time, retrabalho,
 * utilizacao, evidencia, aceite): a lista de OS de destino nao interpreta recortes
 * de taxa nem de janela, entao esta faixa NAO promete drilldown — o drill de
 * OS concluidas no periodo e feito pelo KPI executivo, que tem recorte real
 * (`status=COMPLETED`, `from`/`to`, `event=completed`).
 */
export function ProductivityPanel({ productivity }: ProductivityPanelProps) {
  const metrics: DenseMetric[] = [
    {
      id: 'completed',
      label: 'OS concluídas',
      value: String(productivity.completed),
      detail: 'volume no período',
      tone: 'positive',
    },
    {
      id: 'on-time',
      label: 'Taxa no prazo',
      value: formatPercent(productivity.onTimeRate),
      detail: productivity.onTimeRate.available
        ? `${productivity.onTimeRate.numerator}/${productivity.onTimeRate.denominator} elegíveis`
        : 'amostra insuficiente',
      tone:
        productivity.onTimeRate.available && (productivity.onTimeRate.value ?? 0) < 0.9
          ? 'warning'
          : 'neutral',
    },
    {
      id: 'cycle-time',
      label: 'Cycle time',
      value: formatHours(productivity.averageCycleTime.valueHours),
      detail: `amostra ${productivity.averageCycleTime.sampleSize}`,
      tone: 'neutral',
    },
    {
      id: 'rework',
      label: 'Retrabalho',
      value: formatPercent(productivity.reworkRate),
      detail: productivity.reworkRate.concept
        ? `${productivity.reworkRate.numerator}/${productivity.reworkRate.denominator} medições`
        : 'amostra insuficiente',
      tone: productivity.reworkRate.available && (productivity.reworkRate.value ?? 0) > 0 ? 'warning' : 'neutral',
    },
    {
      id: 'utilization',
      label: 'Utilização',
      value: formatPercent(productivity.utilization),
      detail: productivity.utilization.concept ? 'janela alocada / planejada' : 'amostra insuficiente',
      tone: 'neutral',
    },
    {
      id: 'evidence',
      label: 'Evidência',
      value: formatPercent(productivity.evidenceCompleteness),
      detail: productivity.evidenceCompleteness.available
        ? `${productivity.evidenceCompleteness.numerator}/${productivity.evidenceCompleteness.denominator} OS`
        : 'amostra insuficiente',
      tone: 'neutral',
    },
    {
      id: 'acceptance',
      label: 'Aceite de medição',
      value: formatPercent(productivity.measurementAcceptance),
      detail: productivity.measurementAcceptance.available
        ? `${productivity.measurementAcceptance.numerator}/${productivity.measurementAcceptance.denominator} medições`
        : 'amostra insuficiente',
      tone: 'neutral',
    },
  ];

  return (
    <section aria-labelledby="productivity-heading" className="dashboard-block">
      <header className="dashboard-section-head">
        <h2 id="productivity-heading" className="dashboard-section-head__title">
          Produtividade
        </h2>
        <p className="dashboard-section-head__meta">
          Desempenho do período no escopo autorizado. Nenhuma métrica é recalculada aqui.
        </p>
      </header>

      <ul className="dashboard-dense">
        {metrics.map((metric) => (
          <li key={metric.id} className="dashboard-dense__item">
            <div
              className={cn('dashboard-dense__cell', `dashboard-dense__cell--${metric.tone}`)}
              aria-label={`${metric.label}: ${metric.value}`}
            >
              <span className="dashboard-dense__label">{metric.label}</span>
              <span className="dashboard-dense__value tabular-nums" aria-hidden="true">
                {metric.value}
              </span>
              <span className="dashboard-dense__detail">{metric.detail}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
