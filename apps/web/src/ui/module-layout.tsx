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

/**
 * BARRA DE FILTROS COMPACTA — a mesma gramatica das worklists, para as 28 superficies de
 * backoffice que ainda usavam o cartao.
 *
 * O `FilterCard` era `mb-6 rounded-xl ... p-6`: um cartao de respiro largo com sombra, que em
 * 1440px empurrava a grade para baixo e fazia o filtro dominar a primeira dobra — exatamente o
 * "nao usar card gigante para filtros". Os controles e o comportamento nao mudam; o que muda e
 * a moldura, que passa a ter a densidade de uma linha de operacao.
 */
export function FilterCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'mb-2 flex flex-wrap items-end gap-2 rounded-md border border-gray-200 bg-white px-2.5 py-2',
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

/**
 * ESCOPO DE UNIDADE — nunca o identificador tecnico.
 *
 * Nenhum contrato do CISNE publica hoje o NOME HUMANO da unidade operacional: o que
 * chega as telas e `unitId`, identificador interno (em HML, um slug sintetico como
 * `unit-synthetic-homolog`). Renderizado cru ele nao diz nada ao operador e vaza a
 * forma interna do dado — encontrado em Solicitacoes, Documentos e Fiscal.
 *
 * Enquanto o backend nao publicar o rotulo humano, a superficie declara o ESCOPO. Um
 * unico primitivo evita que cada tela resolva isso do seu jeito — ou nao resolva.
 *
 * PARK registrado: nome humano da unidade nas telas operacionais.
 */
export function UnitScopeLabel({ unitId }: { unitId: string | null | undefined }) {
  const hasScope = typeof unitId === 'string' && unitId.trim().length > 0;
  return <>{hasScope ? 'No seu escopo' : 'Sem unidade'}</>;
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
 * PAGINA DE ESTADO — lista que faz RETORNO ANTECIPADO ainda precisa dizer onde o operador esta.
 *
 * Uma lista que carrega, nega ou falha antes de montar a grade nao tem cabecalho proprio: ela
 * troca a pagina inteira pelo bloco de estado. Sem esta moldura a superficie ficava sem `<h1>`
 * — o operador via "Carregando…" sem saber de que tela. Aqui o titulo da pagina e o bloco de
 * estado convivem, na MESMA hierarquia das telas que ja carregaram.
 */
export function ModuleStatePage({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <ModulePage>
      <ModulePageHeader title={title} />
      {children}
    </ModulePage>
  );
}

/**
 * Blocos de estado do modulo.
 *
 * Eles renderizam CONTEUDO, nunca a moldura da pagina: quem chama ja esta dentro de um
 * `ModulePage` (via `renderQueryGate`) ou envolve o retorno em `ModulePage` (listas que fazem
 * retorno antecipado). Antes cada um deles abria o proprio `<main id="main-content">`, o que
 * produzia HTML invalido (id duplicado) e landmarks `<main>` aninhados em toda pagina que
 * exibia estado de carregamento, negacao ou erro.
 *
 * HIERARQUIA (corrigido): eles tambem NAO abrem mais um `ModulePageHeader`. A pagina de
 * backoffice ja renderiza o proprio cabecalho antes de consultar a lista; o gate devolvia um
 * segundo `<h1>` com o mesmo titulo, e a superficie abria com "Central de fechamento /
 * Central de fechamento". Um estado de carga/erro/negacao e um bloco DENTRO da pagina — nao
 * uma pagina paralela. `title` permanece como rotulo ACESSIVEL do bloco (o `<h1>` da pagina
 * segue sendo a identidade), entao nada se perde em semantica nem em leitor de tela.
 */
export function ModuleLoadingState({ title, message }: { title?: string; message: string }) {
  return (
    <p
      aria-busy="true"
      aria-live="polite"
      aria-label={title}
      className="text-sm text-gray-500"
    >
      {message}
    </p>
  );
}

export function ModuleDeniedState({ title, message }: { title?: string; message: string }) {
  return (
    <div aria-label={title} className="flex flex-col gap-2">
      <p className="m-0 text-sm text-red-700" role="alert">
        {message}
      </p>
      <p className="m-0">
        <Link
          to="/app"
          className="text-sm font-medium text-brand-600 no-underline hover:text-brand-700"
        >
          Voltar ao início
        </Link>
      </p>
    </div>
  );
}

export function ModuleErrorState({
  title,
  message,
  retryable,
  onRetry,
}: {
  title?: string;
  message: string;
  retryable: boolean;
  onRetry?: () => void;
}) {
  return (
    <div aria-label={title} className="flex flex-col gap-3">
      <p
        className="m-0 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-500/20 ring-inset"
        role="alert"
      >
        {message}
      </p>
      {retryable && onRetry ? (
        <div>
          <Button type="button" variant="secondary" onClick={onRetry}>
            Tentar novamente
          </Button>
        </div>
      ) : null}
    </div>
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
