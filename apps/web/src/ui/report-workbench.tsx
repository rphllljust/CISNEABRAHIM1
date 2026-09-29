import type { ReactNode } from 'react';
import { cn } from './utils/cn';

/**
 * REPORT WORKBENCH — a superficie de relatorio, nao um formulario com um painel ao lado.
 *
 * A tela de Relatorios estava ERRADA ARQUITETURALMENTE: `.reports-layout` era
 * `grid-template-columns: minmax(240px,280px) 1fr` — uma coluna esquerda de selecao e o resto para
 * a previa. Em 1440px isso desperdicava ~280px com tres controles empilhados e fazia a previa — o
 * UNICO conteudo real da tela — nascer estreita. Pior: `.reports-page` trazia `max-width: 1100px`,
 * entao a tela de relatorio ocupava menos largura que qualquer worklist do produto, e a primeira
 * dobra era um cartao de filtro.
 *
 * Aqui a gramatica e de mesa de trabalho: CABECALHO com identidade e acao de exportacao, TOOLBAR
 * HORIZONTAL com os filtros reais, e a PREVIA ocupando a LARGURA PRINCIPAL. O status do job de
 * exportacao vive junto da acao, compacto, em vez de virar um bloco que empurra a tabela.
 *
 * Nenhum filtro, contrato, ordem de coluna ou regra de exportacao muda: so a moldura.
 */

export function ReportWorkbenchHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="mb-2 flex flex-wrap items-end justify-between gap-2">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-gray-900">{title}</h1>
        {description ? <p className="mt-0.5 text-xs text-gray-500">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </header>
  );
}

/** Toolbar horizontal: uma linha de filtros reais, densa, alinhada a esquerda. */
export function ReportToolbar({
  children,
  meta,
}: {
  children: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <section
      aria-label="Filtros do relatório"
      className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-1.5"
    >
      {children}
      {meta ? (
        <span className="ml-auto text-[11px] font-medium text-gray-500 tabular-nums">{meta}</span>
      ) : null}
    </section>
  );
}

/** Rotulo + controle inline, mesma densidade das worklists. */
export function ReportField({
  label,
  htmlFor,
  children,
  grow = false,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  grow?: boolean;
}) {
  return (
    <div className={cn('flex min-w-0 items-center gap-1.5', grow && 'min-w-56 flex-1')}>
      <label
        htmlFor={htmlFor}
        className="shrink-0 text-[10px] font-semibold tracking-wide text-gray-500 uppercase"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

export const reportControlClass =
  'rounded border border-gray-300 bg-white px-2 py-1 text-[13px] text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30';

export const reportSelectClass = cn(reportControlClass, 'cursor-pointer');

/**
 * Previa: ocupa a largura PRINCIPAL da tela. `min-w-0` e obrigatorio — sem ele a grade densa
 * estoura o container flex e a pagina inteira ganha scroll horizontal.
 */
export function ReportPreview({
  children,
  meta,
  action,
}: {
  children: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section aria-label="Pré-visualização do relatório" className="min-w-0">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold text-gray-900">Pré-visualização</h2>
          {meta ? <span className="text-[11px] text-gray-500 tabular-nums">{meta}</span> : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Faixa compacta de status do job de exportacao.
 *
 * Antes o status era um `<div className="reports-status">` com `margin-top` inline abaixo da
 * tabela: o operador gerava a exportacao e o retorno aparecia FORA do campo de visao, depois de
 * rolar a previa inteira. Aqui ele mora junto do cabecalho, ao lado do botao que o disparou.
 */
export function ReportJobStatus({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'critical' | 'success';
  children: ReactNode;
}) {
  const toneClass = {
    neutral: 'border-gray-200 bg-gray-50 text-gray-700',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    critical: 'border-red-200 bg-red-50 text-red-800',
  }[tone];
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] font-medium', toneClass)}
    >
      {children}
    </span>
  );
}
