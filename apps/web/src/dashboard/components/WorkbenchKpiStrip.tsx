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
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * REGRA DE AREA — AGORA CUMPRIDA PELO CODIGO, E NAO APENAS ESCRITA AQUI
 *
 * "Indicador sem dado publicado NAO reserva celula" estava escrito neste arquivo desde a wave
 * anterior, mas o componente renderizava OS CINCO com o mesmo peso: uma celula de 186x127px que
 * continha um travessao e a frase "Nao publicado neste recorte".
 *
 * Medido no DOM real de `/app` em 1600x900, antes desta correcao:
 *
 *   2 das 5 celulas (371px de 964px — 38,5% da faixa) gastavam uma caixa inteira, com borda de
 *   acento, icone em pastilha tonal e rodape de destino, para dizer "—".
 *
 * A faixa e a PRIMEIRA superficie de dado da primeira dobra. Gastar 38% dela em placeholders
 * empurra o trabalho real (a fila) para fora da tela — medido: a fila comecava em y=969 num
 * viewport de 900.
 *
 * AGORA: os indicadores COM numero ocupam celulas de largura igual (flex, nao grid de colunas
 * fixas) e os SEM numero sao recolhidos numa UNICA linha de rodape que nomeia todos de uma vez.
 * A informacao nao se perde — "Recebiveis vencidos e Ordens vencendo nao foram publicados neste
 * recorte" e dito — mas ela para de custar 129px de altura e 371px de largura.
 *
 * AUSENCIA CONTINUA NAO SENDO ZERO: nada aqui imprime "0" para um indicador que o servidor nao
 * publicou. O que muda e o PRECO COBRADO para dizer a verdade.
 */
export function WorkbenchKpiStrip({ kpis }: { kpis: WorkbenchKpi[] }) {
  if (kpis.length === 0) {
    return null;
  }

  const measured = kpis.filter((kpi) => !kpi.unmeasured);
  const unmeasured = kpis.filter((kpi) => kpi.unmeasured);

  /*
   * FAIXA SEM NENHUM NUMERO PUBLICADO — nao existe celula vazia nem grade de travessoes.
   * Uma linha diz o que falta, com os destinos preservados.
   */
  if (measured.length === 0) {
    return (
      <section role="region" aria-labelledby="workspace-kpi-heading" className="dashboard-kpi-strip">
        <h2 id="workspace-kpi-heading" className="cisne-sr-only">
          Indicadores operacionais
        </h2>
        <p className="dashboard-kpi-strip__unpublished" role="status">
          <span className="dashboard-kpi-strip__unpublished-label">
            Nenhum indicador publicado neste recorte
          </span>
          {unmeasured.map((kpi) => (
            <Link key={kpi.id} className="dashboard-kpi-strip__unpublished-link" to={kpi.href}>
              {kpi.label}
            </Link>
          ))}
        </p>
      </section>
    );
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
        {measured.map((kpi) => {
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

      {/*
        RODAPE DOS NAO PUBLICADOS — a verdade dita uma vez, em uma linha, sem area de card.
        Cada nome continua sendo um LINK para a lista correspondente: o que nao existe e a
        contagem sob este recorte, nao a lista.
      */}
      {unmeasured.length > 0 ? (
        <p className="dashboard-kpi-strip__unpublished" role="status">
          <span className="dashboard-kpi-strip__unpublished-label">
            Não publicado neste recorte
          </span>
          {unmeasured.map((kpi) => (
            <Link key={kpi.id} className="dashboard-kpi-strip__unpublished-link" to={kpi.href}>
              {kpi.label}
            </Link>
          ))}
        </p>
      ) : null}
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
