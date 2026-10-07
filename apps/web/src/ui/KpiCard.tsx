import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from './utils/cn';

export type KpiCardTone = 'default' | 'primary' | 'secondary' | 'critical' | 'warning' | 'success';

export type KpiCardProps = {
  label: string;
  value: ReactNode;
  context?: string;
  unit?: string;
  href?: string | null;
  ariaLabel: string;
  tone?: KpiCardTone;
  className?: string;
  footer?: ReactNode;
};

function KpiCardContent({
  label,
  value,
  context,
  unit,
  footer,
}: Pick<KpiCardProps, 'label' | 'value' | 'context' | 'unit' | 'footer'>) {
  return (
    <>
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className="mt-2 flex items-baseline gap-1.5">
        <span className="text-3xl font-semibold tracking-tight text-gray-900 tabular-nums" aria-hidden="true">
          {value}
        </span>
        {unit ? <span className="text-sm text-gray-500">{unit}</span> : null}
      </p>
      {context ? <p className="mt-2 text-xs text-gray-400">{context}</p> : null}
      {footer}
    </>
  );
}

export function KpiCard({
  label,
  value,
  context,
  unit,
  href,
  ariaLabel,
  className,
  footer,
}: KpiCardProps) {
  const surface = cn(
    'rounded-md border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgb(15_23_42/0.04)]',
    href && 'block text-inherit no-underline transition hover:bg-gray-50/80 focus-visible:cisne-focus-ring',
    className,
  );

  if (href) {
    return (
      <Link className={surface} to={href} aria-label={ariaLabel}>
        <KpiCardContent label={label} value={value} context={context} unit={unit} footer={footer} />
      </Link>
    );
  }

  return (
    <article className={surface} aria-label={ariaLabel}>
      <KpiCardContent label={label} value={value} context={context} unit={unit} footer={footer} />
    </article>
  );
}
