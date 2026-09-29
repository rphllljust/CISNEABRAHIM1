import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '../../ui/utils/cn';
import { formatMoney } from '../utils/dashboard-formatters';
import type { DashboardKpi, DashboardKpiVariant } from '../utils/build-dashboard-kpis';
import type { BusinessFlowStage } from '../utils/dashboard-semantics';

type DashboardKpiStripProps = {
  kpis: DashboardKpi[];
};

const VARIANT_CLASS: Record<DashboardKpiVariant, string> = {
  critical: 'dashboard-kpi--critical',
  warning: 'dashboard-kpi--warning',
  primary: 'dashboard-kpi--primary',
  success: 'dashboard-kpi--success',
  secondary: 'dashboard-kpi--secondary',
};

export function DashboardKpiStrip({ kpis }: DashboardKpiStripProps) {
  if (kpis.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="kpi-heading" className="dashboard-kpi-strip">
      <header className="dashboard-section-head">
        <h2 id="kpi-heading" className="dashboard-section-head__title">
          Saúde da empresa
        </h2>
        <p className="dashboard-section-head__meta">
          {kpis.length} indicadores · cada número abre a lista que o produziu
        </p>
      </header>

      <ul className="dashboard-kpi-strip__list">
        {kpis.map((kpi) => (
          <li key={kpi.id} className="dashboard-kpi-strip__item">
            <KpiCell kpi={kpi} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function KpiCell({ kpi }: { kpi: DashboardKpi }) {
  const body = (
    <>
      <p className="dashboard-kpi__label">{kpi.label}</p>
      <p className="dashboard-kpi__value">
        <span className="dashboard-kpi__number" aria-hidden="true">
          {kpi.value}
        </span>
        {kpi.unit ? <span className="dashboard-kpi__unit">{kpi.unit}</span> : null}
      </p>
      <p className="dashboard-kpi__context">{kpi.context}</p>
      {kpi.href && kpi.actionLabel ? (
        <p className="dashboard-kpi__action" aria-hidden="true">
          {kpi.actionLabel}
          <ArrowUpRight className="dashboard-kpi__action-icon" strokeWidth={2.2} aria-hidden />
        </p>
      ) : (
        <p className="dashboard-kpi__action dashboard-kpi__action--absent" aria-hidden="true">
          sem lista filtrada
        </p>
      )}
    </>
  );

  if (kpi.href) {
    return (
      <Link
        className={cn('dashboard-kpi', VARIANT_CLASS[kpi.variant])}
        to={kpi.href}
        aria-label={`${kpi.ariaLabel}. Abrir lista filtrada.`}
      >
        {body}
      </Link>
    );
  }

  return (
    <article className={cn('dashboard-kpi', VARIANT_CLASS[kpi.variant])} aria-label={kpi.ariaLabel}>
      {body}
    </article>
  );
}

/**
 * BUSINESS FLOW — continuidade empresa -> caixa.
 *
 * Faixa horizontal: cada etapa traz quantidade (e valor quando o snapshot ja
 * publica) e SO leva a lista filtrada real. Etapa sem destino prova-se por
 * ausencia de recorte na tela de destino; ela continua visivel como contexto,
 * nunca como link generico de modulo.
 */
export function BusinessFlowStrip({ stages }: { stages: BusinessFlowStage[] }) {
  if (stages.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="flow-heading" className="dashboard-flow">
      <header className="dashboard-section-head">
        <h2 id="flow-heading" className="dashboard-section-head__title">
          Fluxo empresa → caixa
        </h2>
        <p className="dashboard-section-head__meta">
          Volume em cada etapa autorizada. Nenhuma etapa é somada a outra.
        </p>
      </header>

      <ol className="dashboard-flow__list">
        {stages.map((stage, index) => (
          <li key={stage.id} className="dashboard-flow__item">
            <div
              className={cn(
                'dashboard-flow__stage',
                stage.situation === 'critical' && 'dashboard-flow__stage--critical',
                stage.situation === 'attention' && 'dashboard-flow__stage--attention',
              )}
            >
              <p className="dashboard-flow__label">{stage.label}</p>
              <p className="dashboard-flow__value">
                <span className="dashboard-flow__number" aria-hidden="true">
                  {stage.count ?? '—'}
                </span>
                {stage.amount ? (
                  <span className="dashboard-flow__amount" aria-hidden="true">
                    {stage.amount}
                  </span>
                ) : null}
              </p>
              <p className="dashboard-flow__hint">{stage.hint}</p>
              <p className="dashboard-flow__situation">{stage.situationLabel}</p>
              {stage.href ? (
                <Link className="dashboard-flow__link" to={stage.href}>
                  Abrir recorte
                </Link>
              ) : (
                <span className="dashboard-flow__link dashboard-flow__link--absent">
                  sem lista filtrada
                </span>
              )}
            </div>
            {index < stages.length - 1 ? (
              <span className="dashboard-flow__arrow" aria-hidden>
                →
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Leitura secundaria de volume do periodo (nao compete com a faixa de decisao). */
export function PeriodVolumeFootnote({
  volume,
}: {
  volume: { opened: number; completed: number; hrefOpened: string; hrefCompleted: string };
}) {
  return (
    <p className="dashboard-volume">
      <span className="dashboard-volume__label">No período</span>
      <Link className="dashboard-volume__link" to={volume.hrefOpened}>
        {volume.opened} abertas
      </Link>
      <span aria-hidden className="dashboard-volume__sep">
        ·
      </span>
      <Link className="dashboard-volume__link" to={volume.hrefCompleted}>
        {volume.completed} concluídas
      </Link>
    </p>
  );
}

/** Valor monetario compacto para linhas de excecao financeira. */
export function InlineAmount({ amount }: { amount: string }) {
  return <span className="dashboard-inline-amount tabular-nums">{formatMoney(amount)}</span>;
}
