import { Link } from 'react-router-dom';
import { Check, ShieldAlert } from 'lucide-react';
import { cn } from '../../ui/utils/cn';
import type { ExecutiveAttentionItem } from '../types/dashboard.types';
import { attentionDrillHref, sortAttentionBySeverity } from '../utils/dashboard-semantics';

type AttentionBlockProps = {
  items: ExecutiveAttentionItem[];
};

const SEVERITY_LABEL: Record<ExecutiveAttentionItem['severity'], string> = {
  critical: 'Crítico',
  warning: 'Atenção',
  info: 'Informativo',
};

/**
 * Linguagem de acao derivada do tipo do item — sem criar regra de negocio.
 * Traduz o identificador existente em um verbo de gestao.
 */
function resolveAttentionAction(item: ExecutiveAttentionItem): string {
  switch (item.id) {
    case 'overdue-service-orders':
      return 'Ver OS vencidas';
    case 'approaching-due-service-orders':
      return 'Ver OS a vencer';
    case 'pending-measurements':
      return 'Revisar medições';
    case 'overdue-receivables':
      return 'Ver títulos vencidos';
    case 'divergences':
      return 'Ver divergências';
    default:
      return 'Ver detalhes';
  }
}

/**
 * DECISION CENTER — a area mais importante do painel.
 *
 * Cada excecao ocupa UMA linha compacta: severidade, motivo, quantidade,
 * prazo real quando existe e a PROXIMA ACAO. A lista leva a lista filtrada de
 * verdade; quando o recorte nao existe em nenhuma tela, a linha continua sendo
 * excecao (nunca escondida) e declara a ausencia em vez de prometer link.
 *
 * Ausencia de excecao NAO vira card verde gigante: vira uma linha.
 */
export function AttentionBlock({ items }: AttentionBlockProps) {
  if (items.length === 0) {
    return (
      <section className="dashboard-decision" aria-labelledby="attention-heading" role="status">
        <header className="dashboard-section-head">
          <h2 id="attention-heading" className="dashboard-section-head__title">
            Central de decisão
          </h2>
        </header>
        <p className="dashboard-decision__clear">
          <Check className="dashboard-decision__clear-icon" strokeWidth={2.6} aria-hidden />
          Nenhuma pendência crítica no período autorizado.
        </p>
      </section>
    );
  }

  const ordered = sortAttentionBySeverity(items);
  const criticalCount = ordered.filter((item) => item.severity === 'critical').length;

  return (
    <section className="dashboard-decision" aria-labelledby="attention-heading">
      <header className="dashboard-section-head">
        <h2 id="attention-heading" className="dashboard-section-head__title">
          Central de decisão
        </h2>
        <p className="dashboard-section-head__meta">
          {ordered.length} {ordered.length === 1 ? 'exceção' : 'exceções'} · {criticalCount}{' '}
          {criticalCount === 1 ? 'crítica' : 'críticas'} · mais urgente primeiro
        </p>
      </header>

      <ul className="dashboard-decision__list">
        {ordered.map((item) => {
          const href = attentionDrillHref(item);
          const row = (
            <>
              <span
                className={cn(
                  'dashboard-decision__severity',
                  item.severity === 'critical' && 'dashboard-decision__severity--critical',
                  item.severity === 'warning' && 'dashboard-decision__severity--warning',
                )}
              >
                {SEVERITY_LABEL[item.severity]}
              </span>
              {/* OBJETO (o que e) e IMPACTO/PRAZO (o que pesa) — o fato da linha. */}
              <span className="dashboard-decision__reason">
                <span className="dashboard-decision__reason-label">
                  <span className="dashboard-decision__count tabular-nums">{item.count}</span>
                  {item.label}
                </span>
                {item.detail ? (
                  <span className="dashboard-decision__reason-detail">{item.detail}</span>
                ) : null}
              </span>
              <span
                className={cn(
                  'dashboard-decision__deadline',
                  item.maxDelayDays !== null && 'dashboard-decision__deadline--set',
                )}
              >
                {item.maxDelayDays !== null ? `${item.maxDelayDays} d` : ''}
              </span>
              <span className="dashboard-decision__action">
                {href ? (
                  <>
                    {resolveAttentionAction(item)}
                    <span aria-hidden className="dashboard-decision__action-arrow">
                      →
                    </span>
                  </>
                ) : (
                  <span className="dashboard-decision__action--absent">
                    sem lista filtrada para este recorte
                  </span>
                )}
              </span>
            </>
          );

          return (
            <li key={item.id} className="dashboard-decision__row-wrap">
              {href ? (
                <Link className="dashboard-decision__row" to={href} aria-label={item.ariaLabel}>
                  {row}
                </Link>
              ) : (
                <div className="dashboard-decision__row" aria-label={item.ariaLabel}>
                  {row}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p className="dashboard-decision__legend">
        <ShieldAlert className="dashboard-decision__legend-icon" strokeWidth={2} aria-hidden />
        Coluna “Prazo” mostra o maior atraso real entre as exceções quando o backend o publica.
      </p>
    </section>
  );
}
