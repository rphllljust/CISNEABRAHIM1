import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../ui/utils/cn';

/**
 * DRILL-DOWN — todo indicador tem caminho ate o dado.
 *
 * Regra de produto: nenhum numero importante fica orfao. Se um KPI mostra um
 * valor, ele carrega a lista ja filtrada que produziu aquele valor; a lista
 * carrega o registro. A tela nao recalcula o numero — ela so transporta o
 * recorte. O filtro viaja por query string, para o operador poder voltar,
 * compartilhar e favoritar.
 */

export type DrilldownTone = 'neutral' | 'warning' | 'critical' | 'info';

const TONE_CLASS: Record<DrilldownTone, string> = {
  neutral: 'border-gray-200 bg-white text-gray-800 hover:border-gray-300',
  info: 'border-brand-200 bg-brand-50/60 text-brand-900 hover:border-brand-300',
  warning: 'border-amber-200 bg-amber-50/70 text-amber-900 hover:border-amber-300',
  critical: 'border-red-200 bg-red-50/70 text-red-900 hover:border-red-300',
};

const VALUE_TONE: Record<DrilldownTone, string> = {
  neutral: 'text-gray-900',
  info: 'text-brand-900',
  warning: 'text-amber-900',
  critical: 'text-red-800',
};

export type DrilldownMetricProps = {
  label: string;
  value: ReactNode;
  /** Destino obrigatorio: um KPI sem caminho ate o dado nao deve existir. */
  to: string;
  hint?: string;
  tone?: DrilldownTone;
  /** Contagem zero pode ser um fato bom — mostrar sem alarme. */
  muted?: boolean;
  className?: string;
};

export function DrilldownMetric({
  label,
  value,
  to,
  hint,
  tone = 'neutral',
  muted = false,
  className,
}: DrilldownMetricProps) {
  return (
    <Link
      to={to}
      aria-label={`${label}: ${hint ?? 'abrir lista filtrada'}`}
      className={cn(
        'group flex min-w-[8.5rem] flex-col gap-0.5 rounded-lg border px-3 py-2 no-underline transition-colors focus-visible:cisne-focus-ring',
        TONE_CLASS[tone],
        muted && 'opacity-70',
        className,
      )}
    >
      <span className="text-[10px] font-semibold tracking-wide uppercase opacity-70">{label}</span>
      <span className={cn('text-lg leading-tight font-semibold tabular-nums', VALUE_TONE[tone])}>
        {value}
      </span>
      <span className="text-[10px] leading-tight opacity-70 group-hover:underline">
        {hint ?? 'Ver lista filtrada'}
      </span>
    </Link>
  );
}

/** Linha de indicadores clicaveis — o "KPI strip" que nao termina em si mesmo. */
export function DrilldownRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-3 flex flex-wrap gap-2', className)} role="group">
      {children}
    </div>
  );
}
