import type { ReactNode, MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button } from './Button';
import { PageHeader } from './PageHeader';
import { Pagination } from './Pagination';
import { cn } from './utils/cn';

export const filterControlClass =
  'w-full rounded-md border-0 bg-white py-2 px-3 text-sm text-gray-900 ring-1 ring-gray-300 ring-inset outline-none focus:ring-2 focus:ring-brand-500';

export const filterLabelClass = 'mb-1.5 block text-xs font-semibold text-gray-700';

export function ModulePage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <main id="main-content" className={cn('w-full', className)}>
      {children}
    </main>
  );
}

export function FilterCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'mb-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ModuleTableCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'mb-6 overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-gray-900/5',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ModulePrimaryLink({
  to,
  children,
  className,
}: {
  to: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      to={to}
      className={cn(
        'inline-flex min-h-9 items-center rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm no-underline transition hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function ModuleTableLink({
  to,
  children,
  onClick,
}: {
  to: string;
  children: ReactNode;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <Link
      to={to}
      className="text-sm font-semibold text-brand-700 no-underline hover:text-brand-800"
      onClick={onClick}
    >
      {children}
    </Link>
  );
}

export function ModuleCodeCell({ children }: { children: ReactNode }) {
  return <span className="font-mono text-sm text-gray-600 tabular-nums">{children}</span>;
}

export function ModulePageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return <PageHeader title={title} description={description} actions={action} className="mb-8" />;
}

/**
 * Blocos de estado do modulo.
 *
 * Eles renderizam CONTEUDO, nunca a moldura da pagina: quem chama ja esta dentro de um
 * `ModulePage` (via `renderQueryGate`) ou envolve o retorno em `ModulePage` (listas que fazem
 * retorno antecipado). Antes cada um deles abria o proprio `<main id="main-content">`, o que
 * produzia HTML invalido (id duplicado) e landmarks `<main>` aninhados em toda pagina que
 * exibia estado de carregamento, negacao ou erro.
 */
export function ModuleLoadingState({ title, message }: { title: string; message: string }) {
  return (
    <>
      <ModulePageHeader title={title} />
      <p aria-busy="true" aria-live="polite" className="text-sm text-gray-500">
        {message}
      </p>
    </>
  );
}

export function ModuleDeniedState({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <>
      <ModulePageHeader title={title} />
      <p className="text-sm text-red-700" role="alert">
        {message}
      </p>
      <p className="mt-3">
        <Link
          to="/app"
          className="text-sm font-medium text-brand-600 no-underline hover:text-brand-700"
        >
          Voltar ao início
        </Link>
      </p>
    </>
  );
}

export function ModuleErrorState({
  title,
  message,
  retryable,
  onRetry,
}: {
  title: string;
  message: string;
  retryable: boolean;
  onRetry?: () => void;
}) {
  return (
    <>
      <ModulePageHeader title={title} />
      <p
        className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-500/20 ring-inset"
        role="alert"
      >
        {message}
      </p>
      {retryable && onRetry ? (
        <div className="mt-4">
          <Button type="button" variant="secondary" onClick={onRetry}>
            Tentar novamente
          </Button>
        </div>
      ) : null}
    </>
  );
}

export function ModulePagination({
  pageNumber,
  rangeLabel,
  onPrevious,
  onNext,
  previousDisabled,
  nextDisabled,
  previousLabel = 'Anterior',
  nextLabel = 'Próxima',
}: {
  pageNumber: number;
  rangeLabel?: string;
  onPrevious: () => void;
  onNext: () => void;
  previousDisabled: boolean;
  nextDisabled: boolean;
  previousLabel?: string;
  nextLabel?: string;
}) {
  return (
    <Pagination
      pageLabel={rangeLabel ?? `Página ${pageNumber}`}
      onPrevious={onPrevious}
      onNext={onNext}
      previousDisabled={previousDisabled}
      nextDisabled={nextDisabled}
      previousLabel={previousLabel}
      nextLabel={nextLabel}
      className="gap-4"
    />
  );
}

export const moduleTableClass = 'w-full divide-y divide-gray-200';

export const moduleTableHeadClass = 'bg-gray-50/60';

export const moduleTableHeaderCellClass =
  'px-6 py-3 text-left text-xs font-semibold tracking-wider text-gray-500 uppercase';

export const moduleTableRowClass = 'transition hover:bg-gray-50';

export const moduleTableCellClass = 'px-6 py-3.5 text-sm text-gray-700 whitespace-nowrap';
