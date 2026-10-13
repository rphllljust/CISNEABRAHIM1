import { Link } from 'react-router-dom';
import { Check, CircleAlert, CircleHelp, TriangleAlert } from 'lucide-react';
import { cn } from '../../ui/utils/cn';
import { attentionDrillHref, sortAttentionBySeverity } from '../utils/dashboard-semantics';
import type { OperationalSituation } from '../utils/dashboard-situation';

/**
 * SITUATION HANDLING — o estado operacional do recorte, em UMA faixa.
 *
 * Esta secao substitui o antigo "banner de excecao" e corrige o defeito conceitual que ele tinha:
 * o bloco verde "Operação sem exceções críticas" era renderizado sempre que a LISTA de excecoes
 * vinha vazia — inclusive quando o servidor nao publicou aquela excecao para o periodo. Lista vazia
 * de uma fonte ausente nao e operacao normal.
 *
 * QUATRO ESTADOS, com peso visual proporcional e SEM cor decorativa:
 *
 *   critical  regua vermelha + as excecoes criticas em linha, com drill
 *   warning   regua ambar + contagem, sem dramatizar
 *   normal    UMA linha discreta de status (nunca um card verde grande)
 *   unknown   UMA linha NEUTRA que declara o que nao foi publicado
 *
 * `unknown` nao usa vermelho nem ambar: nao e risco medido, e ausencia de medicao. Pintar de
 * alerta um dado que nao existe ensina o operador a ignorar alertas.
 *
 * A faixa NAO inventa excecao nem agrega contagem: tudo o que aparece aqui veio publicado no
 * snapshot executivo.
 */
export function SituationPanel({ situation }: { situation: OperationalSituation }) {
  if (situation.level === 'critical') {
    const ordered = sortAttentionBySeverity(situation.criticalItems);
    return (
      <section className="dashboard-situation dashboard-situation--critical" aria-labelledby="situation-heading">
        <header className="dashboard-situation__head">
          <CircleAlert className="dashboard-situation__icon" strokeWidth={2.2} aria-hidden />
          <h2 id="situation-heading" className="dashboard-situation__title">
            {situation.title}
          </h2>
          <p className="dashboard-situation__detail">{situation.detail}</p>
        </header>

        <ul className="dashboard-situation__list">
          {ordered.map((item) => {
            const href = attentionDrillHref(item);
            const body = (
              <>
                <span className="dashboard-situation__count tabular-nums">{item.count}</span>
                <span className="dashboard-situation__label">{item.label}</span>
                {item.detail ? <span className="dashboard-situation__fact">{item.detail}</span> : null}
                <span className="dashboard-situation__action">
                  {href ? 'Abrir recorte' : 'sem lista filtrada para este recorte'}
                </span>
              </>
            );
            return (
              <li key={item.id} className="dashboard-situation__item">
                {href ? (
                  <Link className="dashboard-situation__row" to={href} aria-label={item.ariaLabel}>
                    {body}
                  </Link>
                ) : (
                  <div className="dashboard-situation__row" aria-label={item.ariaLabel}>
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  if (situation.level === 'warning') {
    return (
      <section
        className="dashboard-situation dashboard-situation--warning"
        aria-label="Situação operacional"
        role="status"
      >
        <TriangleAlert className="dashboard-situation__icon" strokeWidth={2.2} aria-hidden />
        <p className="dashboard-situation__line">
          <strong>{situation.title}</strong>
          <span className="dashboard-situation__line-detail">{situation.detail}</span>
        </p>
      </section>
    );
  }

  if (situation.level === 'unknown') {
    return (
      <section
        className="dashboard-situation dashboard-situation--unknown"
        aria-label="Situação operacional"
        role="status"
      >
        <CircleHelp className="dashboard-situation__icon" strokeWidth={2.2} aria-hidden />
        <p className="dashboard-situation__line">
          <strong>{situation.title}</strong>
          <span className="dashboard-situation__line-detail">{situation.detail}</span>
        </p>
      </section>
    );
  }

  return (
    <section
      className="dashboard-situation dashboard-situation--normal"
      aria-label="Situação operacional"
      role="status"
    >
      <Check className="dashboard-situation__icon" strokeWidth={2.6} aria-hidden />
      <p className="dashboard-situation__line">
        <strong>{situation.title}</strong>
        <span className="dashboard-situation__line-detail">{situation.detail}</span>
      </p>
    </section>
  );
}

/**
 * EXCECOES DE AUSENCIA — o que falta LER, nao o que falta fazer.
 *
 * A fila de trabalho e uma leitura paginada e por dominio; o snapshot executivo e outra. Quando a
 * fila nao responde, ou quando um dominio nao respondeu nesta leitura, a tela precisa DIZER isso:
 * uma fila incompleta apresentada como completa e pior que um erro visivel.
 *
 * Fica separada do bloco de situacao de proposito: "nao consegui ler" nao e "ha excecao critica",
 * e misturar os dois faria o operador tratar falha de leitura como pendencia de negocio.
 */
export function SituationGaps({
  inboxPhase,
  unavailableDomains,
  errorMessage,
}: {
  inboxPhase: 'loading' | 'ready' | 'denied' | 'error';
  unavailableDomains: ReadonlyArray<string>;
  errorMessage: string | null;
}) {
  if (inboxPhase !== 'error' && unavailableDomains.length === 0) {
    return null;
  }

  return (
    <p className={cn('dashboard-situation-gap')} role="status">
      {inboxPhase === 'error'
        ? `${errorMessage ?? 'A fila de trabalho não pôde ser lida.'} O painel continua exibindo o que o snapshot executivo publicou.`
        : `Fila incompleta: ${unavailableDomains.join(', ')} não respondeu nesta leitura. As demais fontes estão completas.`}
    </p>
  );
}
