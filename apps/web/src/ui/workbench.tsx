import type { ReactNode } from 'react';
import { cn } from './utils/cn';
import { EmptyState } from './EmptyState';

/**
 * WORKBENCH ENTERPRISE — a superficie de FILA, nao de consulta.
 *
 * O CISNE tinha telas de processo (Alertas, Faturamento, Conciliacao, Fechamento, Work Inbox)
 * construidas como formulario de consulta: tres `<select>`, uma frase e espaco vazio. O operador
 * nao abria aquilo para trabalhar; abria para descobrir que nao havia nada para fazer.
 *
 * A gramatica absorvida do benchmark (axelor-open-suite) e sempre a mesma: uma FAIXA DE RESUMO
 * que diz o tamanho do problema, uma FILA DE EXCECOES ordenada pelo fato que exige acao, o
 * CONTEXTO de cada item e a PROXIMA ACAO real. Este componente entrega essa moldura uma unica vez
 * para todas as filas — nenhuma tela de processo monta o proprio shell.
 *
 * Ele NAO calcula severidade, nao ordena e nao infere prioridade: a ordem vem do servidor e o
 * chamador apenas a entrega. Nenhum comportamento, filtro, rota ou capability mora aqui.
 */

/** Faixa de resumo: os numeros reais da fila, na primeira dobra. */
export function WorkbenchSummaryStrip({ children }: { children: ReactNode }) {
  return (
    <section
      aria-label="Resumo da fila"
      className="mb-2 flex flex-wrap items-stretch gap-2 rounded-md border border-gray-200 bg-white px-3 py-2"
    >
      {children}
    </section>
  );
}

/**
 * Um indicador da faixa. `tone` pinta o numero pelo SIGNIFICADO operacional que o chamador ja
 * conhece (critico, atencao, neutro) — nao ha heuristica de risco aqui.
 */
export function WorkbenchMetric({
  value,
  label,
  tone = 'neutral',
  href,
}: {
  value: ReactNode;
  label: string;
  tone?: 'neutral' | 'info' | 'warning' | 'critical' | 'success';
  /** Quando a contagem tem uma lista correspondente, o numero e o atalho para ela. */
  href?: string;
}) {
  const toneClass = {
    neutral: 'text-gray-900',
    info: 'text-brand-700',
    warning: 'text-amber-700',
    critical: 'text-red-700',
    success: 'text-emerald-700',
  }[tone];

  const body = (
    <>
      <strong className={cn('text-lg leading-none font-semibold tabular-nums', toneClass)}>
        {value}
      </strong>
      <span className="text-[11px] font-medium text-gray-500">{label}</span>
    </>
  );

  const className =
    'flex min-w-24 flex-col items-start gap-0.5 rounded border border-gray-200 bg-gray-50/70 px-2.5 py-1.5 no-underline transition-colors';

  if (href) {
    return (
      <a href={href} className={cn(className, 'hover:border-brand-300 hover:bg-brand-50/50')}>
        {body}
      </a>
    );
  }
  return <div className={className}>{body}</div>;
}

/**
 * Secao de fila. `count` e opcional e sempre o numero REAL publicado; sem ele, nenhum total e
 * inventado. `emptyMessage` so aparece quando a fila esta vazia — uma secao vazia continua
 * dizendo o que ela era.
 */
export function WorkbenchQueue({
  title,
  description,
  count,
  action,
  emptyTitle,
  emptyDescription,
  emptyAction,
  children,
}: {
  title: string;
  description?: ReactNode;
  count?: number | null;
  action?: ReactNode;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  emptyAction?: ReactNode;
  children?: ReactNode;
}) {
  const isEmpty = count === 0 || (!children && count === undefined);
  return (
    <section className="mb-3" aria-label={title}>
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          {typeof count === 'number' ? (
            <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] font-semibold text-gray-600 tabular-nums">
              {count}
            </span>
          ) : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
      {description ? <p className="mb-1.5 text-xs text-gray-500">{description}</p> : null}
      {isEmpty ? (
        <EmptyState
          title={emptyTitle ?? 'Nada nesta fila'}
          description={emptyDescription}
          action={emptyAction}
        />
      ) : (
        children
      )}
    </section>
  );
}

/**
 * Uma linha de trabalho da fila.
 *
 * A ordem dos elementos e deliberada e igual em todas as filas do produto: SEVERIDADE -> MOTIVO
 * (o titulo) -> OBJETO relacionado -> IDADE real -> PROXIMA ACAO. O operador le a mesma coisa na
 * mesma posicao, seja em Alertas, Faturamento ou Conciliacao.
 */
export function WorkbenchQueueItem({
  severity,
  severityTone = 'neutral',
  title,
  reason,
  context,
  age,
  action,
  drilldown,
}: {
  /** Marcador de severidade/estado do item — o fato que ordena a fila. */
  severity?: ReactNode;
  severityTone?: 'neutral' | 'info' | 'warning' | 'critical' | 'success';
  title: ReactNode;
  /** Por que este item esta na fila. Sem motivo, a linha e so um registro. */
  reason?: ReactNode;
  /** Objeto relacionado (cliente, OS, titulo) com link humano. */
  context?: ReactNode;
  /** Idade/prazo REAL publicado pelo servidor. */
  age?: ReactNode;
  /** Acao principal — o que o operador faz agora. */
  action?: ReactNode;
  /** Acesso ao objeto completo. */
  drilldown?: ReactNode;
}) {
  const stripe = {
    neutral: 'before:bg-gray-300',
    info: 'before:bg-brand-400',
    warning: 'before:bg-amber-400',
    critical: 'before:bg-red-500',
    success: 'before:bg-emerald-400',
  }[severityTone];

  return (
    <article
      className={cn(
        'relative mb-1.5 grid grid-cols-1 items-start gap-x-4 gap-y-1.5 rounded-md border border-gray-200 bg-white py-2 pr-3 pl-3.5',
        'before:absolute before:top-2 before:bottom-2 before:left-0 before:w-0.5 before:rounded-full before:content-[""]',
        stripe,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {severity ? <span className="shrink-0">{severity}</span> : null}
        <span className="min-w-0 text-[13px] font-semibold text-gray-900">{title}</span>
      </div>
      {reason ? <p className="m-0 text-xs text-gray-600">{reason}</p> : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
        {context ? <span className="min-w-0">{context}</span> : null}
        {age ? <span className="tabular-nums">{age}</span> : null}
      </div>
      {action || drilldown ? (
        <div className="flex flex-wrap items-center gap-2">
          {action}
          {drilldown}
        </div>
      ) : null}
    </article>
  );
}

/**
 * Acoes do item: uma primaria visivel, o resto discreto. Mesma decisao de `RowActionMenu`, aplicada
 * a fila — acao primaria e a que resolve o item.
 */
export const workbenchPrimaryActionClass =
  'inline-flex items-center rounded-md border border-brand-600 bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white no-underline transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60';

export const workbenchSecondaryActionClass =
  'inline-flex items-center rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 no-underline transition-colors hover:bg-gray-50';
