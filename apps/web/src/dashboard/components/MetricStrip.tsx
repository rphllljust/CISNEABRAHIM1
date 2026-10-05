import { Link } from 'react-router-dom';
import { useMemo } from 'react';
import { EnterpriseMetric } from '../../ui/enterprise-list';
import type { DashboardKpi } from '../utils/build-dashboard-kpis';

/**
 * SAUDE DA EMPRESA — METRIC STRIP COMPACTO.
 *
 * Nao e uma faixa de cards: e uma linha de indicadores com valor real. Cada numero leva a lista
 * que o produziu; indicador sem lista filtrada real continua sendo verdade e continua visivel —
 * apenas sem promessa de navegacao.
 *
 * REGRA DE AREA: metrica sem dado publicado NAO reserva celula. Se nada foi publicado, a faixa
 * inteira encolhe para UMA linha discreta. Nao existe grade de "—".
 */

const HREF_LABELS: Record<string, string> = {
  'overdue-receivables': 'Ver títulos vencidos',
  'overdue-service-orders': 'Ver OS vencidas',
  'approaching-due-service-orders': 'Ver OS a vencer',
  'awaiting-billing': 'Abrir faturamento',
  'active-service-orders': 'Ver ordens ativas',
  'completed-service-orders': 'Ver concluídas',
};

export function MetricStrip({
  kpis,
  volume,
}: {
  kpis: DashboardKpi[];
  volume: { opened: number; completed: number; hrefOpened: string; hrefCompleted: string } | null;
}) {
  const groups = useMemo(() => {
    const critical = kpis.filter((kpi) => kpi.variant === 'critical');
    const warning = kpis.filter((kpi) => kpi.variant === 'warning');
    const rest = kpis.filter((kpi) => kpi.variant !== 'critical' && kpi.variant !== 'warning');
    return [
      { id: 'critical', items: critical, tone: 'critical' as const },
      { id: 'warning', items: warning, tone: 'warning' as const },
      { id: 'rest', items: rest, tone: 'info' as const },
    ].filter((group) => group.items.length > 0);
  }, [kpis]);

  if (kpis.length === 0) {
    return (
      <section aria-labelledby="kpi-heading" className="dashboard-block dashboard-block--compact">
        <header className="dashboard-section-head">
          <h2 id="kpi-heading" className="dashboard-section-head__title">
            Saúde da empresa
          </h2>
        </header>
        <p className="dashboard-panel__empty">
          Indicadores adicionais aparecem quando houver volume no período.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="kpi-heading" className="dashboard-block dashboard-block--compact">
      <header className="dashboard-section-head">
        <h2 id="kpi-heading" className="dashboard-section-head__title">
          Saúde da empresa
        </h2>
      </header>

      <div className="dashboard-metric-strip">
        {groups.map((group) => (
          <ul key={group.id} className="dashboard-metric-strip__row" aria-label={`Indicadores ${group.id}`}>
            {group.items.map((kpi) => (
              <li key={kpi.id} className="dashboard-metric-strip__item">
                {kpi.href ? (
                  <Link
                    className="dashboard-metric-link"
                    to={kpi.href}
                    aria-label={`${kpi.ariaLabel}. ${HREF_LABELS[kpi.id] ?? 'Abrir lista'}.`}
                    title={`${kpi.label}: ${kpi.context}`}
                  >
                    <EnterpriseMetric
                      value={`${kpi.value}${kpi.unit ? ` ${kpi.unit}` : ''}`}
                      label={kpi.label}
                      tone={group.tone}
                    />
                  </Link>
                ) : (
                  <span className="dashboard-metric-static" title={`${kpi.label}: ${kpi.context}`}>
                    <EnterpriseMetric
                      value={`${kpi.value}${kpi.unit ? ` ${kpi.unit}` : ''}`}
                      label={kpi.label}
                      tone="neutral"
                    />
                  </span>
                )}
              </li>
            ))}
          </ul>
        ))}
      </div>

      {volume ? (
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
      ) : null}
    </section>
  );
}

/** @deprecated Mantido apenas para os testes de contrato do contrato anterior de KPI. */
export type { DashboardKpi };
