import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from './utils/cn';

/**
 * Composicao visual "enterprise" — componentes OPT-IN.
 *
 * Nao substituem nem alteram `ModulePage`, `ModulePageHeader`, `FilterCard` ou `DataTable`:
 * sao usados apenas pelas telas que adotam o padrao explicitamente. Nenhum comportamento,
 * filtro, rota, capability ou estado muda — so a apresentacao.
 */

/* ------------------------------------------------------------------ cabeçalho */

export function EnterpriseListHeader({
  title,
  description,
  metrics,
  action,
}: {
  title: string;
  description?: string;
  metrics?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="mb-3 rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-gray-900">{title}</h1>
          {description ? <p className="mt-0.5 text-xs text-gray-500">{description}</p> : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
      {metrics ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 bg-gray-50/70 px-4 py-2">
          {metrics}
        </div>
      ) : null}
    </header>
  );
}

export type MetricTone = 'neutral' | 'warning' | 'critical' | 'info';

const METRIC_TONE: Record<MetricTone, string> = {
  neutral: 'border-gray-200 bg-white text-gray-700',
  info: 'border-brand-200 bg-brand-50 text-brand-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  critical: 'border-red-200 bg-red-50 text-red-800',
};

export function EnterpriseMetric({
  value,
  label,
  tone = 'neutral',
}: {
  value: ReactNode;
  label: string;
  tone?: MetricTone;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-baseline gap-1.5 rounded-md border px-2 py-1 text-xs',
        METRIC_TONE[tone],
      )}
    >
      <strong className="text-sm font-semibold tabular-nums">{value}</strong>
      <span className="font-medium">{label}</span>
    </span>
  );
}

/* -------------------------------------------------------------------- toolbar */

export function EnterpriseToolbar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-end gap-2 border-b border-gray-200 bg-gray-50/70 px-3 py-2',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Campo compacto de toolbar: rotulo pequeno acima, controle denso abaixo. */
export function EnterpriseField({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-[10px] font-semibold tracking-wide text-gray-500 uppercase"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

/** Controle de toolbar: mesma semantica dos filtros atuais, densidade maior. */
export const enterpriseControlClass =
  'w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-[13px] text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30';

/* ---------------------------------------------------------------------- tabela */

export const enterpriseTableCardClass =
  'mb-4 overflow-x-auto rounded-lg border border-gray-200 bg-white';

export const enterpriseTableClass = 'w-full border-separate border-spacing-0';

export const enterpriseHeadCellClass =
  'sticky top-0 z-10 border-b border-gray-200 bg-gray-50 px-3 py-2 text-left text-[11px] font-semibold tracking-wider text-gray-500 uppercase';

export const enterpriseNumericHeadCellClass = cn(enterpriseHeadCellClass, 'text-right');

export const enterpriseCellClass =
  'border-b border-gray-100 px-3 py-2.5 align-top text-[13px] text-gray-700';

export const enterpriseCellMutedClass = cn(enterpriseCellClass, 'text-gray-500');

export const enterpriseNumericCellClass = cn(
  enterpriseCellClass,
  'text-right tabular-nums whitespace-nowrap',
);

export const enterpriseRowClass = 'group transition-colors hover:bg-brand-50/40';

/* -------------------------------------------------------------- células ricas */

/** Coluna de identificacao: linha forte (codigo) + linha de contexto. */
export function PrimaryRecordCell({
  href,
  identifier,
  context,
  meta,
}: {
  href: string;
  identifier: string;
  context?: string | null;
  meta?: string | null;
}) {
  return (
    <div className="min-w-0">
      <Link
        to={href}
        className="text-[13px] font-semibold text-brand-800 no-underline hover:text-brand-900 hover:underline"
      >
        {identifier}
      </Link>
      {context ? (
        <p className="mt-0.5 max-w-[38ch] truncate text-xs text-gray-500" title={context}>
          {context}
        </p>
      ) : null}
      {meta ? (
        <p className="mt-0.5 font-mono text-[11px] text-gray-400">{meta}</p>
      ) : null}
    </div>
  );
}

/**
 * Status com contexto: nunca um badge solto.
 *
 * `accent` desenha a barra lateral discreta de alerta — sinaliza o fato real sem pintar a linha.
 */
export function RecordStatusCell({
  badge,
  context,
  accent = 'none',
}: {
  badge: ReactNode;
  context?: ReactNode;
  accent?: 'none' | 'warning' | 'critical';
}) {
  const accentClass =
    accent === 'critical'
      ? 'before:bg-red-400'
      : accent === 'warning'
        ? 'before:bg-amber-400'
        : '';
  return (
    <div
      className={cn(
        'relative flex flex-col items-start gap-1',
        accent !== 'none' &&
          cn('pl-2.5 before:absolute before:top-0 before:bottom-0 before:left-0 before:w-0.5 before:rounded-full before:content-[""]', accentClass),
      )}
    >
      {badge}
      {context ? <span className="text-[11px] leading-tight text-gray-500">{context}</span> : null}
    </div>
  );
}

/* ------------------------------------------------------------------- ações */

/**
 * Uma acao primaria visivel; as secundarias ficam sob "•••" para nao competir.
 * Usa `<details>` nativo: sem biblioteca nova e sem estado de aplicacao.
 */
export function RowActionMenu({
  primary,
  secondary,
  label,
}: {
  primary: ReactNode;
  secondary?: ReactNode;
  label: string;
}) {
  return (
    <div className="flex flex-col items-end gap-1">
      {primary}
      {secondary ? (
        <details className="relative">
          <summary
            className="cursor-pointer list-none rounded px-1.5 text-xs font-medium text-gray-400 marker:content-[''] hover:bg-gray-100 hover:text-gray-600"
            aria-label={`Mais ações — ${label}`}
          >
            •••
          </summary>
          <div className="absolute right-0 z-20 mt-1 flex min-w-40 flex-col gap-1 rounded-md border border-gray-200 bg-white p-2 shadow-lg">
            {secondary}
          </div>
        </details>
      ) : null}
    </div>
  );
}

/** Botao de acao primaria compacto, para uso dentro da linha. */
export const rowPrimaryActionClass =
  'inline-flex items-center rounded-md border border-brand-600 bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white no-underline transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60';

/** Acao secundaria dentro do menu "•••". */
export const rowSecondaryActionClass =
  'w-full rounded px-2 py-1 text-left text-xs font-medium text-gray-600 no-underline hover:bg-gray-50 hover:text-gray-900';
