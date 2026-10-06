import { Link } from 'react-router-dom';
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

      {/*
        INDICADORES COMPACTOS: rótulo curto acima, número grande abaixo. Nao e uma tag nem um
        cardao — a leitura é "quantos", e o drilldown fica no próprio número.
      */}
      <ul className="dashboard-kpi-list">
        {kpis.map((kpi) => {
          const body = (
            <>
              <span className="dashboard-kpi-list__label">{kpi.label}</span>
              <span className="dashboard-kpi-list__value tabular-nums">
                {kpi.value}
                {kpi.unit ? <span className="dashboard-kpi-list__unit">{kpi.unit}</span> : null}
              </span>
              <span className="dashboard-kpi-list__context">{kpi.context}</span>
            </>
          );

          return (
            <li key={kpi.id} className="dashboard-kpi-list__item">
              {kpi.href ? (
                <Link
                  className="dashboard-kpi-list__cell"
                  to={kpi.href}
                  aria-label={`${kpi.ariaLabel}. ${HREF_LABELS[kpi.id] ?? 'Abrir lista'}.`}
                >
                  {body}
                </Link>
              ) : (
                <span className="dashboard-kpi-list__cell">{body}</span>
              )}
            </li>
          );
        })}
      </ul>

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
