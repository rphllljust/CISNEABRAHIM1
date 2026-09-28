import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../ui/Button';
import { Dropdown } from '../ui/Dropdown';
import { StatusBadge } from '../ui/StatusBadge';
import { cn } from '../ui/utils/cn';
import { toHumanReference, toHumanText } from './human-text';
import type { ObjectAction, ObjectHeaderStatus, ObjectMetadataField } from './types';

/**
 * 1 — OBJECT HEADER
 *
 * Referencia humana + titulo + contexto + estado + metadados + acoes.
 *
 * Nao exibe UUID e nao exibe nome de capability: valores que sejam identificador
 * tecnico sao OMITIDOS pela guarda de `human-text`, nunca substituidos por placeholder.
 *
 * A acao primaria e a mais provavel AGORA. Acoes secundarias ficam em "Mais acoes".
 * Acoes destrutivas ficam separadas, no fim do menu, sob rotulo explicito.
 */

export type EnterpriseObjectHeaderProps = {
  reference?: string | null;
  title: string;
  subtitle?: string | null;
  status?: ObjectHeaderStatus | null;
  metadata?: ObjectMetadataField[];
  primaryAction?: ObjectAction | null;
  secondaryActions?: ObjectAction[];
  destructiveActions?: ObjectAction[];
  className?: string;
};

function renderFact(value: ReactNode | string | null | undefined): ReactNode {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    const human = toHumanText(value);
    return human === null ? null : human;
  }
  return value;
}

function ObjectActionButton({ action, variant }: { action: ObjectAction; variant: 'primary' | 'secondary' }) {
  const disabled = action.disabled === true;
  const label = toHumanText(action.label) ?? action.label;

  // Acao com destino real e um LINK: navegacao nao deve virar botao com efeito colateral.
  if (action.to && !disabled && !action.loading) {
    return (
      <Link
        to={action.to}
        className={cn(
          'inline-flex min-h-[var(--spacing-touch)] items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-semibold no-underline transition-colors',
          variant === 'primary'
            ? 'border border-brand-600 bg-brand-600 text-white shadow-sm hover:bg-brand-700'
            : 'border border-gray-300 bg-white text-gray-700 ring-1 ring-gray-300 ring-inset hover:bg-gray-50',
        )}
      >
        {label}
      </Link>
    );
  }

  return (
    <Button
      type="button"
      variant={variant}
      disabled={disabled}
      loading={action.loading === true}
      title={disabled && action.disabledReason ? action.disabledReason : undefined}
      onClick={action.onSelect}
      className={variant === 'secondary' ? 'text-xs' : undefined}
    >
      {label}
    </Button>
  );
}

export function EnterpriseObjectHeader({
  reference,
  title,
  subtitle,
  status,
  metadata = [],
  primaryAction,
  secondaryActions = [],
  destructiveActions = [],
  className,
}: EnterpriseObjectHeaderProps) {
  const humanReference = toHumanReference(reference);
  const humanTitle = toHumanText(title) ?? title;
  const humanSubtitle = toHumanText(subtitle);
  const statusLabel = status ? toHumanText(status.label) : null;
  const statusDescription = status ? toHumanText(status.description) : null;

  const visibleMetadata = metadata
    .map((field) => ({ ...field, rendered: renderFact(field.value) }))
    .filter((field) => field.rendered !== null && field.rendered !== undefined && field.rendered !== '');

  const menuItems = [
    ...secondaryActions.map((action) => ({
      id: action.id,
      label: toHumanText(action.label) ?? action.label,
      disabled: action.disabled === true,
      onSelect: () => action.onSelect?.(),
    })),
    ...destructiveActions.map((action) => ({
      id: action.id,
      label: toHumanText(action.label) ?? action.label,
      disabled: action.disabled === true,
      onSelect: () => action.onSelect?.(),
    })),
  ];

  return (
    <header className={cn('rounded-lg bg-white px-4 py-3 shadow-sm ring-1 ring-gray-900/5', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {humanReference ? (
              <span className="rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-gray-700 tabular-nums">
                {humanReference}
              </span>
            ) : null}
            <h1 className="m-0 truncate text-lg leading-tight font-semibold text-gray-900">{humanTitle}</h1>
            {statusLabel ? <StatusBadge label={statusLabel} tone={status?.tone} /> : null}
          </div>
          {humanSubtitle ? <p className="mt-0.5 text-sm text-gray-600">{humanSubtitle}</p> : null}
          {statusDescription ? <p className="mt-0.5 text-xs text-gray-500">{statusDescription}</p> : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {primaryAction ? <ObjectActionButton action={primaryAction} variant="primary" /> : null}
          {menuItems.length > 0 ? (
            <Dropdown
              label="Mais ações"
              trigger={<span className="rounded-md px-3 py-2 text-sm font-semibold text-gray-700 ring-1 ring-gray-300 ring-inset hover:bg-gray-50">Mais ações</span>}
              items={menuItems}
            />
          ) : null}
        </div>
      </div>

      {visibleMetadata.length > 0 ? (
        <dl className="mt-2.5 grid grid-cols-2 gap-x-6 gap-y-1.5 border-t border-gray-100 pt-2.5 sm:grid-cols-3 lg:grid-cols-5">
          {visibleMetadata.map((field) => (
            <div key={field.label} className="min-w-0">
              <dt className="text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
                {field.label}
              </dt>
              <dd
                className={cn(
                  'truncate text-sm tabular-nums',
                  field.emphasis ? 'font-semibold text-gray-900' : 'text-gray-700',
                )}
              >
                {field.rendered}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </header>
  );
}
