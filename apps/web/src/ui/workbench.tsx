import type { ReactNode } from 'react';
import { cn } from './utils/cn';
import { EmptyState } from './EmptyState';
/*
 * A GRAMATICA DA LINHA DE TRABALHO VEM COM O COMPONENTE.
 *
 * `.dashboard-queue-item` / `.dashboard-queue-head` sao a linha de fila do produto inteiro — a
 * Central de trabalho, os workspaces de dominio e o Control Center desenham a MESMA linha. Elas
 * vivem neste modulo (`workbench.css`) e sao importadas AQUI, junto do `WorkbenchQueue`, para que
 * qualquer consumidor receba o estilo junto do componente — e nao por depender do CSS do dashboard,
 * que e composicao de uma tela especifica.
 */
import './workbench.css';

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
      className="mb-2 flex flex-wrap items-stretch gap-0 border-y border-gray-200 bg-gray-50/80 px-2 py-2"
    >
      {children}
    </section>
  );
}

/**
 * Um indicador da faixa. `tone` pinta o numero pelo SIGNIFICADO operacional que o chamador ja
 * conhece (critico, atencao, neutro) — nao ha heuristica de risco aqui.
 *
 * FOUNDATION: o indicador deixou de ser uma caixinha contornada (`rounded border bg-gray-50/70`) e
 * passou a ser uma CELULA da faixa, separada por divisor vertical. Numa faixa de 6 indicadores, seis
 * caixas com borda produzem ruido de contorno que compete com os numeros; divisores deixam o NUMERO
 * ser o sinal.
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
      <strong className={cn('text-xl leading-none font-semibold tracking-tight tabular-nums', toneClass)}>
        {value}
      </strong>
      <span className="cisne-meta-label">{label}</span>
    </>
  );

  const className =
    'flex min-w-28 flex-col items-start gap-0.5 border-l border-gray-200 px-4 py-1 no-underline transition-colors first:border-l-0';

  if (href) {
    return (
      <a href={href} className={cn(className, 'hover:bg-brand-50/50')}>
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
 *
 * `regionLabel` nomeia a REGIAO da fila quando o titulo visivel nao pode ser o nome acessivel —
 * caso de uma tela que publica MAIS DE UMA fila e precisa distinguir as duas para quem le a pagina.
 * Sem ele, o nome acessivel continua sendo o proprio titulo.
 */
export function WorkbenchQueue({
  title,
  regionLabel,
  description,
  count,
  action,
  emptyTitle,
  emptyDescription,
  emptyAction,
  children,
}: {
  title: string;
  regionLabel?: string;
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
    <section className="mb-2" aria-label={regionLabel ?? title}>
      <div className="mb-0 flex flex-wrap items-center justify-between gap-2 border-y border-gray-200 bg-gray-100 px-2.5 py-1.5">
        <div className="flex items-baseline gap-2">
          <h2 className="cisne-type-workspace m-0">{title}</h2>
          {typeof count === 'number' ? (
            <span className="cisne-type-meta font-semibold tabular-nums">{count}</span>
          ) : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-1.5">{action}</div> : null}
      </div>
      {description ? <p className="cisne-type-helper m-0 border-b border-gray-100 bg-white px-2.5 py-1">{description}</p> : null}
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
 *
 * FOUNDATION: cada item era um CARD (`rounded-md border bg-white` com margem inferior), ou seja, a
 * fila virava uma pilha de caixas — o operador via 3 itens onde cabiam 10. Agora o item e uma LINHA
 * de fila: densa, separada por divisor, com a regua de severidade marcando o fato que ordena. A
 * acao continua na mesma posicao relativa, entao a leitura em coluna permanece.
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
    neutral: 'border-l-gray-300',
    info: 'border-l-brand-400',
    warning: 'border-l-amber-400',
    critical: 'border-l-red-500',
    success: 'border-l-emerald-400',
  }[severityTone];

  return (
    <article
      className={cn(
        'grid grid-cols-1 items-center gap-x-4 gap-y-0.5 border-b border-l-[3px] border-gray-100 bg-white py-2 pr-2 pl-3 transition-colors last:border-b-0 hover:bg-brand-50/30 md:grid-cols-[minmax(0,1fr)_auto]',
        'min-h-[var(--row-height-comfortable)]',
        stripe,
      )}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {severity ? <span className="shrink-0">{severity}</span> : null}
          <span className="cisne-type-primary min-w-0">{title}</span>
        </div>
        {reason ? <p className="cisne-type-meta m-0">{reason}</p> : null}
        {context || age ? (
          <div className="cisne-type-meta flex flex-wrap items-center gap-x-4 gap-y-0.5">
            {context ? <span className="min-w-0">{context}</span> : null}
            {age ? <span className="tabular-nums">{age}</span> : null}
          </div>
        ) : null}
      </div>
      {action || drilldown ? (
        <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
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
 *
 * FOUNDATION: a acao primaria perdeu a borda duplicada (`border` + `bg` da mesma cor) e passou a usar
 * a altura de controle do sistema. A secundaria continua neutra, mas o contraste entre as duas
 * aumentou — antes ambas tinham contorno e peso parecidos, o que e o "8 botoes com o mesmo peso".
 */
export const workbenchPrimaryActionClass =
  'cisne-type-action inline-flex min-h-[var(--control-height)] items-center rounded-md bg-brand-600 px-2.5 no-underline text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60';

export const workbenchSecondaryActionClass =
  'cisne-type-action inline-flex min-h-[var(--control-height)] items-center rounded-md px-2 text-gray-600 no-underline transition-colors hover:bg-gray-100 hover:text-gray-900';
