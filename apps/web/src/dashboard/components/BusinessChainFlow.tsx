import { Link } from 'react-router-dom';
import { Money } from '../../ui/Money';
import { cn } from '../../ui/utils/cn';
import type { BusinessFlowStage } from '../utils/dashboard-semantics';

/**
 * FLUXO EMPRESARIAL — a cadeia Operacao -> Medicao -> Faturamento -> Recebimento como PROCESSO.
 *
 * A ideia original da tela era boa; a execucao nao contava a historia. Os estagios apareciam como
 * colunas de uma tabela horizontal estatica, com 6,75rem de altura minima, separadas por linhas —
 * o operador lia quatro caixas, nao uma cadeia.
 *
 * O que muda aqui e a LEITURA, nao o dado:
 *
 *   - a CONTINUIDADE e VISIVEL: cada estagio e ligado ao seguinte por um conector de regua, entao a
 *     faixa le como um caminho e nao como uma grade;
 *   - cada estagio e um passo do processo com o MESMO conteudo: numero, estado, fato e o drillback
 *     para a lista que o produziu;
 *   - o ULTIMO estagio nao tem conector de saida — a cadeia termina no caixa, e desenhar seta depois
 *     dele sugeriria um passo que nao existe.
 *
 * AUSENCIA NAO VIRA ZERO. Estagio sem contagem publicada mostra "sem contagem" e permanece na
 * cadeia: a etapa existe no processo, o que nao existe e o numero. Trocar isso por "0" seria
 * afirmar que nao ha nada parado ali — e o servidor nao disse isso.
 */
export function BusinessChainFlow({
  stages,
  domainLabel,
}: {
  stages: BusinessFlowStage[];
  /** Nome do recorte ativo — declarado para deixar claro o que a cadeia esta mostrando. */
  domainLabel: string;
}) {
  if (stages.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="flow-heading" className="dashboard-chain">
      <header className="dashboard-chain__head">
        <h2 id="flow-heading" className="dashboard-chain__title">
          Fluxo operacional
        </h2>
        <p className="dashboard-chain__meta">
          {stages.map((stage) => stage.label).join(' → ')} · {domainLabel}
        </p>
      </header>

      <ol className="dashboard-chain__stages">
        {stages.map((stage, index) => {
          const isLast = index === stages.length - 1;
          const className = cn(
            'dashboard-chain__stage',
            stage.situation === 'critical' && 'dashboard-chain__stage--critical',
            stage.situation === 'attention' && 'dashboard-chain__stage--attention',
            stage.count === null && 'dashboard-chain__stage--unknown',
            stage.href && 'dashboard-chain__stage--actionable',
          );

          const content = (
            <>
              {/*
                CIRCULO DE ETAPA — o estado da etapa e o proprio icone circular. Ele carrega cor por
                SIGNIFICADO (critico/atencao/neutro) e o numero publicado dentro, quando existe. Sem
                contagem, o circulo fica neutro e o numero nao aparece: AUSENCIA != ZERO.
              */}
              <span className="dashboard-chain__node" aria-hidden>
                {stage.count !== null ? (
                  <span className="dashboard-chain__node-count tabular-nums">{stage.count}</span>
                ) : (
                  <span className="dashboard-chain__node-empty">—</span>
                )}
              </span>

              <span className="dashboard-chain__body">
                <span className="dashboard-chain__label">{stage.label}</span>
                <span className="dashboard-chain__situation">{stage.situationLabel}</span>
              </span>

              {stage.amount ? (
                <Money value={stage.amount} className="dashboard-chain__exposure" />
              ) : null}
            </>
          );

          return (
            <li key={stage.id} className="dashboard-chain__step">
              {stage.href ? (
                <Link to={stage.href} className={className} aria-label={`${stage.label}: ${stage.situationLabel}. Abrir a fila desta etapa.`}>
                  {content}
                </Link>
              ) : (
                <div className={className}>{content}</div>
              )}
              {/*
                CONECTOR DE PROCESSO — a regua que costura um estagio ao seguinte. Ele e decorativo
                no DOM (`aria-hidden`) e a continuidade ja esta declarada na ordem da lista ordenada.
              */}
              {!isLast ? <span className="dashboard-chain__connector" aria-hidden /> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
