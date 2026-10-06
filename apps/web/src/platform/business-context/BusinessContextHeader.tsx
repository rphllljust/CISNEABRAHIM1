/**
 * BUSINESS CONTEXT HEADER — A FAIXA DE FOCO
 *
 * Mostra QUAL objeto de negocio esta em foco e o que cada modulo respondeu para ele — sem que o
 * operador navegue por 5 modulos (Pagina 12 do relatorio).
 *
 * ---------------------------------------------------------------------------------------------
 * A DISTINCAO QUE ESTE COMPONENTE NAO PODE PERDER
 * ---------------------------------------------------------------------------------------------
 *
 * `empty` e `denied` sao renderizados de forma DIFERENTE e com texto diferente:
 *
 *   - `empty`      "0 recebíveis em aberto"        — fato de negocio. O operador conclui algo.
 *   - `denied`     "sem permissão para consultar"  — NAO e um zero. E ausencia de acesso.
 *   - `idle`       nao aparece                     — o modulo nao acompanha este foco.
 *   - `loading`    "consultando…"                  — nunca exibido como numero.
 *
 * Confundir os dois faz o operador concluir que um cliente nao tem titulo vencido quando na
 * verdade ele nao pode ver os titulos. Em contexto financeiro, essa conclusao tem consequencia.
 */

import {
  describeFocus,
  BUSINESS_CONTEXT_LABELS,
  type BusinessContextConsumerReport,
  type BusinessContextEntity,
  type BusinessContextFocus,
} from './types';

export type BusinessContextHeaderProps = {
  focus: BusinessContextFocus | null;
  reports: Record<string, BusinessContextConsumerReport>;
  /** Volta ao foco anterior. `false` = sem historico. */
  canGoBack: boolean;
  onBack: () => void;
  onClear: () => void;
  /** Abre o objeto completo. Quando ausente, o titulo nao e link. */
  onOpen?: (focus: BusinessContextFocus) => void;
  className?: string;
};

export function BusinessContextHeader({
  focus,
  reports,
  canGoBack,
  onBack,
  onClear,
  onOpen,
  className,
}: BusinessContextHeaderProps) {
  if (!focus) {
    return null;
  }

  const visible = Object.values(reports).filter((report) => report.state !== 'idle');

  return (
    <section
      className={[
        'rounded-md border border-slate-300 bg-slate-50 px-4 py-3',
        className ?? '',
      ].join(' ')}
      aria-label={`Contexto de negócio: ${describeFocus(focus)}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">
            {BUSINESS_CONTEXT_LABELS[focus.entity]}
          </span>
          {onOpen ? (
            <button
              type="button"
              onClick={() => onOpen(focus)}
              className="text-sm font-semibold text-slate-900 underline decoration-slate-300 hover:decoration-slate-900"
            >
              {focus.label || focus.id}
            </button>
          ) : (
            <span className="text-sm font-semibold text-slate-900">
              {focus.label || focus.id}
            </span>
          )}
          {focus.unitId ? (
            <span className="text-xs text-slate-500">unidade {focus.unitId}</span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {canGoBack ? (
            <button
              type="button"
              onClick={onBack}
              className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-white"
              title="Voltar ao objeto anteriormente em foco, sem refazer a busca."
            >
              ← foco anterior
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClear}
            className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-white"
            title="Remover o objeto em foco. As telas deixam de acompanhar este contexto."
          >
            limpar foco
          </button>
        </div>
      </div>

      {visible.length > 0 ? (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {visible.map((report) => (
            <ContextConsumerCard key={report.consumerId} report={report} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function ContextConsumerCard({ report }: { report: BusinessContextConsumerReport }) {
  const badge =
    report.state === 'loading'
      ? { text: 'consultando…', tone: 'text-slate-500' }
      : report.state === 'matched'
        ? { text: String(report.count ?? '—'), tone: 'text-slate-900' }
        : report.state === 'empty'
          ? { text: '0', tone: 'text-slate-500' }
          : { text: '—', tone: 'text-amber-700' };

  /**
   * Texto do estado. `denied` NUNCA mostra numero: exibir "0" ali seria afirmar um fato de negocio
   * que o servidor nao confirmou.
   */
  const detail =
    report.state === 'denied'
      ? (report.hint ?? 'Sem permissão para consultar este módulo.')
      : report.state === 'empty'
        ? (report.hint ?? 'Nenhum registro em aberto para este objeto.')
        : report.state === 'loading'
          ? 'Consultando…'
          : (report.hint ?? null);

  const content = (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-slate-600">{report.label}</span>
        <span className={['text-lg font-semibold tabular-nums', badge.tone].join(' ')}>
          {report.state === 'loading' ? '…' : badge.text}
        </span>
      </div>
      {detail ? <p className="mt-0.5 text-xs text-slate-500">{detail}</p> : null}
    </>
  );

  const base = 'rounded border border-slate-200 bg-white px-3 py-2';

  if (report.to && report.state !== 'denied') {
    return (
      <li>
        <a href={report.to} className={`${base} block hover:border-slate-400`}>
          {content}
        </a>
      </li>
    );
  }

  return <li className={base}>{content}</li>;
}

/** Barra de salto entre entidades em foco — atalho para o drilldown cruzado. */
export function BusinessContextSwitcher({
  entities,
  onSelect,
  className,
}: {
  entities?: BusinessContextEntity[];
  onSelect: (entity: BusinessContextEntity) => void;
  className?: string;
}) {
  const list = entities ?? (Object.keys(BUSINESS_CONTEXT_LABELS) as BusinessContextEntity[]);
  return (
    <div className={className} role="group" aria-label="Entidades de contexto">
      {list.map((entity) => (
        <button
          key={entity}
          type="button"
          onClick={() => onSelect(entity)}
          className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
        >
          {BUSINESS_CONTEXT_LABELS[entity]}
        </button>
      ))}
    </div>
  );
}
