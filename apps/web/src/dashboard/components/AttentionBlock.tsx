import type { ExecutiveAttentionItem } from '../types/dashboard.types';
import { Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '../../ui/Badge';
import { cn } from '../../ui/utils/cn';

type AttentionBlockProps = {
  items: ExecutiveAttentionItem[];
};

function AttentionEmptyState() {
  return (
    <div
      className="mb-10 rounded-md bg-emerald-50 p-4 ring-1 ring-emerald-600/10 ring-inset"
      role="status"
    >
      <div className="flex items-center gap-3">
        <Check className="h-5 w-5 shrink-0 text-emerald-600" strokeWidth={2.4} aria-hidden />
        <p className="text-sm font-medium text-emerald-800">Nenhuma pendência crítica no momento.</p>
      </div>
    </div>
  );
}

/**
 * Linguagem de ação derivada do tipo do item — sem criar regra de negócio.
 * Apenas traduz o identificador existente em um verbo de gestão.
 */
function resolveAttentionAction(item: ExecutiveAttentionItem): string {
  switch (item.id) {
    case 'overdue-service-orders':
      return 'Ver OS vencidas';
    case 'stalled-measurements':
      return 'Revisar medições';
    case 'overdue-receivables':
      return 'Ver vencimentos';
    case 'commercial-divergences':
      return 'Ver divergências';
    case 'service-orders-due-soon':
      return 'Ver OS a vencer';
    default:
      return 'Ver detalhes';
  }
}

export function AttentionBlock({ items }: AttentionBlockProps) {
  if (items.length === 0) {
    return <AttentionEmptyState />;
  }

  return (
    <section aria-labelledby="attention-heading">
      <header className="mb-3">
        <h2 id="attention-heading" className="text-base font-semibold text-gray-900">
          Atenção necessária
        </h2>
      </header>
      <div className="grid gap-3" role="list">
        {items.map((item) => {
          const severity = item.severity;
          const isCritical = severity === 'critical';
          const isWarning = severity === 'warning';
          const card = (
            <div
              className={cn(
                'min-h-24 rounded-md bg-white p-3.5 shadow-sm ring-1',
                isCritical && 'ring-red-500/30 bg-red-50/40',
                isWarning && 'ring-amber-500/25 bg-amber-50/40',
                severity === 'info' && 'ring-gray-900/5',
              )}
            >
              <p className="text-sm font-medium text-gray-500">{item.label}</p>
              <p
                className={cn(
                  'mt-1 text-xl font-semibold tabular-nums',
                  isCritical ? 'text-red-700' : isWarning ? 'text-amber-700' : 'text-gray-900',
                )}
                aria-hidden="true"
              >
                {item.count}
              </p>
              {item.detail ? <p className="mt-1 text-xs text-gray-400">{item.detail}</p> : null}
              {item.maxDelayDays !== null && isCritical ? (
                <Badge tone="error" className="mt-2">
                  Prioridade máxima
                </Badge>
              ) : isWarning && item.maxDelayDays !== null ? (
                <Badge tone="warning" className="mt-2">
                  Acompanhar prazo
                </Badge>
              ) : null}
              <p className="mt-2 text-xs font-medium text-brand-600">{resolveAttentionAction(item)}</p>
            </div>
          );

          if (item.href) {
            return (
              <div key={item.id} role="listitem">
                <Link className="block text-inherit no-underline" to={item.href} aria-label={item.ariaLabel}>
                  {card}
                </Link>
              </div>
            );
          }

          return (
            <article key={item.id} role="listitem" aria-label={item.ariaLabel}>
              {card}
            </article>
          );
        })}
      </div>
    </section>
  );
}
