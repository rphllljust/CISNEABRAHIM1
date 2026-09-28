import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../ui/utils/cn';
import { toHumanText } from './human-text';
import type { ObjectContextField } from './types';

/**
 * 4 — CONTEXTO EMPRESARIAL
 *
 * Responde "do que estamos falando?" com os fatos que QUALIFICAM o objeto:
 * cliente, unidade, responsavel, valor, validade, origem, solicitacao relacionada.
 *
 * Campo sem dado real e OMITIDO. Nao existe "—", "N/D" ou linha vazia: ausencia de
 * informacao e ausencia de linha, nunca um placeholder que finge completude.
 */

export type ObjectContextBlockProps = {
  title?: string;
  fields: ObjectContextField[];
  className?: string;
  /** Numero de colunas em telas grandes. */
  columns?: 2 | 3 | 4;
};

function renderFieldValue(value: ReactNode | string | null | undefined): ReactNode {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return toHumanText(value);
  }
  return value;
}

export function ObjectContextBlock({
  title = 'Contexto',
  fields,
  className,
  columns = 3,
}: ObjectContextBlockProps) {
  const visible = fields
    .map((field) => ({ ...field, rendered: renderFieldValue(field.value) }))
    .filter((field) => field.rendered !== null && field.rendered !== undefined && field.rendered !== '');

  if (visible.length === 0) {
    return null;
  }

  return (
    <section
      aria-label={title}
      className={cn('rounded-lg bg-white px-4 py-3 shadow-sm ring-1 ring-gray-900/5', className)}
    >
      <h2 className="m-0 mb-2 text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
        {title}
      </h2>
      <dl
        className={cn(
          'grid gap-x-6 gap-y-2',
          columns === 2 && 'sm:grid-cols-2',
          columns === 3 && 'sm:grid-cols-2 lg:grid-cols-3',
          columns === 4 && 'sm:grid-cols-2 lg:grid-cols-4',
        )}
      >
        {visible.map((field) => (
          <div key={field.label} className="min-w-0">
            <dt className="text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
              {field.label}
            </dt>
            <dd className="m-0 truncate text-sm text-gray-800">
              {field.to ? (
                <Link to={field.to} className="text-brand-700 no-underline hover:text-brand-800">
                  {field.rendered}
                </Link>
              ) : (
                field.rendered
              )}
            </dd>
            {field.hint ? <p className="m-0 text-[11px] text-gray-500">{field.hint}</p> : null}
          </div>
        ))}
      </dl>
    </section>
  );
}
