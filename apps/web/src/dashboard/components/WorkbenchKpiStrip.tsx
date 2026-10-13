import { Link } from 'react-router-dom';
import { cn } from '../../ui/utils/cn';
import type { WorkbenchKpi } from '../utils/build-workbench-kpis';

/**
 * FAIXA DE INDICADORES DO WORKSPACE — celulas densas, nao cards.
 *
 * Um ERP Tier-1 nao abre a area de trabalho com um mosaico de caixas: ele abre com uma FAIXA de
 * numeros que o operador percorre em uma varredura horizontal. Cada celula e separada por DIVISOR,
 * nao por contorno — seis contornos competindo com seis numeros e ruido de forma, e o numero deixa
 * de ser o sinal.
 *
 * REGRA DE AREA (a mesma que o painel analitico ja segue): indicador sem dado publicado NAO reserva
 * celula. Faixa sem indicador nao renderiza nada — nao existe grade de "—".
 *
 * TODO indicador daqui tem destino: numero sem drilldown e decoracao.
 */
export function WorkbenchKpiStrip({ kpis }: { kpis: WorkbenchKpi[] }) {
  if (kpis.length === 0) {
    return null;
  }

  return (
    <section
      role="region"
      aria-labelledby="workspace-kpi-heading"
      className="dashboard-kpi-strip"
    >
      <h2 id="workspace-kpi-heading" className="cisne-sr-only">
        Indicadores operacionais
      </h2>
      <ul className="dashboard-kpi-strip__list">
        {kpis.map((kpi) => (
          <li key={kpi.id} className="dashboard-kpi-strip__item">
            <Link
              className={cn('dashboard-kpi-cell', `dashboard-kpi-cell--${kpi.tone}`)}
              to={kpi.href}
              aria-label={kpi.ariaLabel}
            >
              <span className="dashboard-kpi-cell__value tabular-nums">{kpi.value}</span>
              <span className="dashboard-kpi-cell__label">
                {kpi.label}
                {kpi.unit ? <span className="dashboard-kpi-cell__unit"> {kpi.unit}</span> : null}
              </span>
              <span className="dashboard-kpi-cell__context">{kpi.context}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
