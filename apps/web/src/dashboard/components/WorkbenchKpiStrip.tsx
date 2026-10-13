import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CircleDollarSign,
  ClipboardList,
  Ruler,
} from 'lucide-react';
import { cn } from '../../ui/utils/cn';
import type { WorkbenchKpi, WorkbenchKpiTone } from '../utils/build-workbench-kpis';

/**
 * FAIXA DE INDICADORES DO WORKSPACE — celulas densas, nao cards.
 *
 * Um ERP Tier-1 nao abre a area de trabalho com um mosaico de caixas: ele abre com uma FAIXA de
 * numeros que o operador percorre em uma varredura horizontal. Cada celula e separada por DIVISOR,
 * nao por contorno — cinco contornos competindo com cinco numeros e ruido de forma, e o numero
 * deixa de ser o sinal.
 *
 * ESTRUTURA INTERNA: [icone em superficie tonal] ROTULO / VALOR / contexto / destino.
 *
 * O ICONE NAO E DECORACAO. Numa faixa de cinco numeros parecidos (contagens de titulos e de ordens),
 * a pastilha tonal e o que permite ao olho achar a celula certa sem ler todos os rotulos — e ela
 * carrega o TOM do indicador (critico, atencao, informativo), o unico lugar da celula onde a cor
 * de estado aparece em area.
 *
 * REGRA DE AREA (a mesma do painel analitico): indicador sem dado publicado NAO reserva celula.
 * Faixa sem indicador nao renderiza nada — nao existe grade de "—".
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
        {kpis.map((kpi) => {
          const Glyph = glyphFor(kpi);
          return (
            <li key={kpi.id} className="dashboard-kpi-strip__item">
              <Link
                className={cn('dashboard-kpi-cell', `dashboard-kpi-cell--${kpi.tone}`)}
                to={kpi.href}
                aria-label={kpi.ariaLabel}
              >
                <span className="dashboard-kpi-cell__glyph" aria-hidden>
                  <Glyph className="dashboard-kpi-cell__glyph-icon" strokeWidth={2.2} />
                </span>
                <span className="dashboard-kpi-cell__label">{kpi.label}</span>
                <span className="dashboard-kpi-cell__value tabular-nums">
                  {kpi.value}
                  {kpi.unit ? <span className="dashboard-kpi-cell__unit"> {kpi.unit}</span> : null}
                </span>
                <span className="dashboard-kpi-cell__context">{kpi.context}</span>
                {/*
                  RODAPE DE DESTINO — a celula DIZ que tem para onde ir, sem exigir o clique para
                  descobrir. Numero sem drilldown e decoracao, e o operador precisa saber disso antes
                  de tentar.
                */}
                <span className="dashboard-kpi-cell__drill">
                  Ver<span aria-hidden> →</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * GLIFO POR IDENTIDADE DO INDICADOR.
 *
 * O mapa e por ID estavel do read model (`overdue-receivables`, `approaching-due-service-orders`…),
 * nunca por heuristica de texto do rotulo. KPI que o backend publique sem glifo conhecido recebe o
 * generico de atividade — a faixa nao quebra e nenhum icone e inventado com significado falso.
 */
const KPI_GLYPHS: Record<string, typeof Activity> = {
  'overdue-receivables': CircleDollarSign,
  'overdue-service-orders': AlertTriangle,
  'approaching-due-service-orders': CalendarClock,
  'pending-measurements': Ruler,
  'active-service-orders': ClipboardList,
};

function glyphFor(kpi: WorkbenchKpi): typeof Activity {
  return KPI_GLYPHS[kpi.id] ?? (kpi.tone === 'warning' ? CalendarClock : Activity);
}

export type { WorkbenchKpiTone };
